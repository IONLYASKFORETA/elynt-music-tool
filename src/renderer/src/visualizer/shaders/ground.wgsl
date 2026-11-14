// Ground: a black field with a slow color shift. p0 = (hueSpeed per minute, lift).

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let t = time();
  let hue = t * frame.p0.x / 60.0;
  let lift = frame.p0.y;
  let aspect = size().x / size().y;
  let uv = vec2f(in.uv.x * aspect, in.uv.y);

  let a = vec2f(0.30 * aspect + 0.12 * sin(t * 0.13), 0.35 + 0.10 * cos(t * 0.11));
  let b = vec2f(0.72 * aspect + 0.10 * cos(t * 0.09), 0.68 + 0.12 * sin(t * 0.07));
  let da = distance(uv, a);
  let db = distance(uv, b);
  let glow = spectral(hue) * exp(-da * da * 5.0) + spectral(hue + 0.4) * exp(-db * db * 5.0);
  return vec4f(glow * lift, 1.0);
}
