// Color Bleed: a spectral rainbow smear off the shapes and type below, dripping down the frame,
// plus a band of spectrum of its own (the visor in the prototype's "Color Bleed" sketch).
// p0 = (drip share of frame height, smear px at 1080p, tint to palette, growth through builds)
// p1 = (own band 0..1, jolt from the last hit 0..1)

fn bleed_luma(c: vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }

// The layer's own band across the middle of the frame, antialiased.
fn bleed_band(uv: vec2f) -> f32 {
  let res = size();
  let x = (uv.x - 0.5) * res.x / res.y;
  let px = 1.0 / res.y;
  let bottom = 0.47 + 0.015 * frame.p1.y;
  let across = 1.0 - smoothstep(0.30 - px * 2.0, 0.30, abs(x));
  let down = smoothstep(0.40 - px, 0.40 + px, uv.y) * (1.0 - smoothstep(bottom - px, bottom + px, uv.y));
  return across * down * frame.p1.x;
}

// Where drips start: bright shapes in the picture below, and the band.
fn bleed_source(uv: vec2f) -> f32 {
  let below_shape = smoothstep(0.45, 0.85, bleed_luma(textureSampleLevel(below, samp, uv, 0.0).rgb));
  return max(below_shape, bleed_band(uv));
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let t = time();
  let res = size();
  let drip = frame.p0.x;
  let smear = frame.p0.y;
  let tint = frame.p0.z;
  let growth = frame.p0.w;
  let jolt = frame.p1.y;
  var uv = in.uv;

  // On a hit, some rows of the picture shove sideways.
  let row = floor(uv.y * 26.0);
  let tick = floor(t * 8.0);
  let r = hash21(vec2f(row, tick));
  uv.x += (r - 0.5) * 0.09 * jolt * step(0.6, r);

  // Sideways RGB smear of what is below.
  let off = vec2f(smear * (1.0 + 2.0 * jolt) / 1080.0 * res.y / res.x, 0.0);
  var col = vec3f(
    textureSampleLevel(below, samp, uv + off, 0.0).r,
    textureSampleLevel(below, samp, uv, 0.0).g,
    textureSampleLevel(below, samp, uv - off, 0.0).b,
  );

  // Rainbow edges: where the picture below changes fast, the edge turns spectral.
  let ex = vec2f(2.0 / res.x, 0.0);
  let ey = vec2f(0.0, 2.0 / res.y);
  let gx = bleed_luma(textureSampleLevel(below, samp, uv + ex, 0.0).rgb) - bleed_luma(textureSampleLevel(below, samp, uv - ex, 0.0).rgb);
  let gy = bleed_luma(textureSampleLevel(below, samp, uv + ey, 0.0).rgb) - bleed_luma(textureSampleLevel(below, samp, uv - ey, 0.0).rgb);
  let edge = clamp(length(vec2f(gx, gy)) * 2.5, 0.0, 1.0);

  // Drips: each thin column runs down from any shape above it, some far longer than others,
  // and they all get longer through a build.
  let column = floor(uv.x * res.x / max(res.y / 220.0, 1.0));
  let rc = hash21(vec2f(column * 1.37, floor(t * 0.25)));
  let len = drip * (0.12 + 0.88 * rc * rc) * (1.0 + growth * 1.5 * build());
  var streak = 0.0;
  var reach = 0.0;
  for (var k = 1u; k <= 12u; k++) {
    let d = len * f32(k) / 12.0;
    let s = bleed_source(uv - vec2f(0.0, d)) * (1.0 - 0.6 * f32(k) / 12.0);
    if (s > streak) {
      streak = s;
      reach = d;
    }
  }

  let hue = uv.y * 1.6 + rc * 0.12 + t * 0.04 + jolt * 0.25 - reach * 2.0;
  let rainbow = mix(spectral(hue), pal_ramp(hue * 0.5), tint) * 1.15;
  let a = max(max(bleed_band(uv), streak * 0.9), edge * 0.8);

  // The rainbow's own split, so the smear reads as light through a prism.
  let fringe = (spectral(hue + 0.5) - rainbow) * smear / 40.0 * a * (1.0 - a);
  col = mix(col, rainbow, a) + fringe;
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
