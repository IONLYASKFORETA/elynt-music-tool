// Poster Type: the rasterized type over the picture below. layerTex holds one block per
// channel (title, artist, katakana, words). p0 = each block's reveal 0..1, p1 = (chrome, glitch).

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let uv = in.uv;
  let t = time();
  let base = textureSampleLevel(below, samp, uv, 0.0).rgb;
  let reveal = frame.p0;

  // While a block snaps in it slices sideways in bands; once in, it sits clean.
  let band = floor(uv.y * 40.0);
  let jitter = (hash21(vec2f(band, floor(t * 30.0))) - 0.5) * 0.05 * frame.p1.y;
  let clean = textureSampleLevel(layerTex, samp, uv, 0.0);
  let shifted = textureSampleLevel(layerTex, samp, uv + vec2f(jitter, 0.0), 0.0);
  let settling = (1.0 - reveal) * step(vec4f(0.001), reveal);
  let mask = mix(clean, shifted, settling);
  let a = clamp(dot(mask, reveal), 0.0, 1.0);

  // White type with the vision's palette running through it like chrome.
  let tint = pal_ramp(uv.y * 1.6 + uv.x * 0.25 + t * 0.05);
  let ink = mix(vec3f(0.96), tint, frame.p1.x);
  return vec4f(mix(base, ink, a), 1.0);
}
