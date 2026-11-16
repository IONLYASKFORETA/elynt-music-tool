// Subject: an image (layerTex) fitted into the frame over the picture below, with a palette glow
// off its edges. p0 = (height as a share of the frame, centre x, centre y, glow).
// p1.x = own media (V18): 0 none (a generated or picked image, as it is), 1 treated, 2 untreated.

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let res = size();
  let dims = vec2f(textureDimensions(layerTex));
  let base = textureSampleLevel(below, samp, in.uv, 0.0).rgb;

  // Height from the scale, width from the image's own shape, shrunk if it would run off the sides.
  var h = frame.p0.x * res.y;
  var w = h * dims.x / dims.y;
  let widest = res.x * 0.96;
  if (w > widest) {
    h *= widest / w;
    w = widest;
  }
  let centre = vec2f(frame.p0.y, frame.p0.z) * res;
  let local = (in.uv * res - centre) / vec2f(w, h) + 0.5;
  let img = textureSampleLevel(layerTex, samp, clamp(local, vec2f(0.0), vec2f(1.0)), 0.0);
  let inBox = all(local >= vec2f(0.0)) && all(local <= vec2f(1.0));
  let a = select(0.0, img.a, inBox);
  var rgb = img.rgb;
  if (frame.p1.x > 0.5) {
    rgb = media_look(rgb, in.uv * res, frame.p1.x);
  }

  // Glow: how much of the image is close by, where the image itself isn't.
  var near = 0.0;
  for (var i = 0; i < 8; i++) {
    let angle = f32(i) * PI / 4.0;
    let q = local + vec2f(cos(angle), sin(angle)) * 0.035;
    if (all(q >= vec2f(0.0)) && all(q <= vec2f(1.0))) {
      near += textureSampleLevel(layerTex, samp, q, 0.0).a;
    }
  }
  let halo = near / 8.0 * (1.0 - a) * frame.p0.w;
  let glow = pal_ramp(local.y * 0.8 + time() * 0.08) * halo;

  return vec4f(mix(base, rgb, a) + glow, 1.0);
}
