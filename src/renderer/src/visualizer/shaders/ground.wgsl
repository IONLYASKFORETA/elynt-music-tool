// Ground: a black field with a slow color shift. p0 = (hueSpeed per minute, lift, own media).
// Own media (V18; p0.z 1 treated, 2 untreated) fills the frame as a background texture under the glow.

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let t = time();
  let hue = t * frame.p0.x / 60.0;
  let lift = frame.p0.y;
  let res = size();
  let aspect = res.x / res.y;
  let uv = vec2f(in.uv.x * aspect, in.uv.y);

  let a = vec2f(0.30 * aspect + 0.12 * sin(t * 0.13), 0.35 + 0.10 * cos(t * 0.11));
  let b = vec2f(0.72 * aspect + 0.10 * cos(t * 0.09), 0.68 + 0.12 * sin(t * 0.07));
  let da = distance(uv, a);
  let db = distance(uv, b);
  let glow = spectral(hue) * exp(-da * da * 5.0) + spectral(hue + 0.4) * exp(-db * db * 5.0);

  var field = vec3f(0.0);
  if (frame.p0.z > 0.5) {
    // Cover the frame: crop the media's longer side rather than letterbox it.
    let dims = vec2f(textureDimensions(layerTex));
    let ratio = (dims.x / dims.y) / aspect;
    var tuv = in.uv;
    if (ratio > 1.0) {
      tuv.x = (tuv.x - 0.5) / ratio + 0.5;
    } else {
      tuv.y = (tuv.y - 0.5) * ratio + 0.5;
    }
    let tex = textureSampleLevel(layerTex, samp, tuv, 0.0);
    field = media_look(tex.rgb, in.uv * res, frame.p0.z) * tex.a * 0.8;
  }
  return vec4f(field + glow * lift, 1.0);
}
