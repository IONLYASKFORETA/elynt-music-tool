// Shared by every layer. Each layer is one full-screen pass that reads the
// picture below it (`below`) and writes the picture with itself on top.

struct Frame {
  // x = t in seconds, y = energy 0..1, zw = frame size in pixels
  head: vec4f,
  p0: vec4f,
  p1: vec4f,
  // x = how far into a build the track is, 0..1
  ctx: vec4f,
  // The vision's 3 to 5 colors, rgb 0..1; rows past the last repeat from the start.
  // palette[4].w = how many colors there are.
  palette: array<vec4f, 5>,
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var below: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<storage, read> spectrum: array<f32, 64>;
// A picture some layers draw from (type, a subject image); a clear 1x1 for the rest.
@group(0) @binding(4) var layerTex: texture_2d<f32>;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: VsOut;
  out.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}

const PI = 3.14159265;

fn time() -> f32 { return frame.head.x; }
fn energy() -> f32 { return frame.head.y; }
fn size() -> vec2f { return frame.head.zw; }
fn build() -> f32 { return frame.ctx.x; }

fn pal_count() -> u32 { return u32(clamp(frame.palette[4].w, 1.0, 5.0)); }
fn pal(i: u32) -> vec3f { return frame.palette[i % pal_count()].rgb; }

// The palette as a loop: x 0..1 runs through every color and back to the first, blended.
fn pal_ramp(x: f32) -> vec3f {
  let n = f32(pal_count());
  let f = fract(x) * n;
  let i = u32(floor(f));
  let k = smoothstep(0.0, 1.0, fract(f));
  return mix(pal(i), pal(i + 1u), k);
}

fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

// The house style's spectral rainbow: hue 0..1 wraps around.
fn spectral(h: f32) -> vec3f {
  return 0.5 + 0.5 * cos(2.0 * PI * (h + vec3f(0.0, 0.33, 0.67)));
}

// The house-style treatment for the owner's own media (V18): a duotone from near-black into the
// palette, posterized to a few steps, through a halftone screen. `flag` is the pass's media
// switch: 1 treated, 2 untreated (the media as it is). `px` is the pixel position in the frame.
fn media_look(c: vec3f, px: vec2f, flag: f32) -> vec3f {
  if (flag > 1.5) {
    return c;
  }
  let l = clamp(dot(c, vec3f(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  let steps = floor(l * 4.0 + 0.5) / 4.0;
  let duo = mix(vec3f(0.02), pal_ramp(0.15 + 0.6 * steps), steps);
  // Halftone: dots on a 45 degree grid, bigger where the media is brighter.
  let res = size();
  let cell = max(4.0, min(res.x, res.y) / 180.0);
  let q = vec2f(px.x + px.y, px.y - px.x) * 0.70710678 / cell;
  let d = length(fract(q) - 0.5);
  let radius = sqrt(l) * 0.7;
  let dots = 1.0 - smoothstep(radius - 0.05, radius + 0.05, d);
  return duo * mix(0.55, 1.0, dots);
}
