// Shared by every layer. Each layer is one full-screen pass that reads the
// picture below it (`below`) and writes the picture with itself on top.

struct Frame {
  // x = t in seconds, y = energy 0..1, zw = frame size in pixels
  head: vec4f,
  p0: vec4f,
  p1: vec4f,
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var below: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<storage, read> spectrum: array<f32, 64>;

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

fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

// The house style's spectral rainbow: hue 0..1 wraps around.
fn spectral(h: f32) -> vec3f {
  return 0.5 + 0.5 * cos(2.0 * PI * (h + vec3f(0.0, 0.33, 0.67)));
}
