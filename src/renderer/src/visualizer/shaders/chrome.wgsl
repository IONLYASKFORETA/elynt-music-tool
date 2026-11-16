// Chrome: iridescent liquid metal after the prototype's "Holo Chrome" sketch, drawn as a 2D
// height field (cheap enough to stack) rather than raymarched. A few blobs melt into one another,
// the vision's palette is the room they reflect, and a thin-film rainbow sits on top.
// p0 = (size share of frame height, spikes 0..1, film 0..1, flow loops per minute)
// p1.x = own media (V18): 0 none, 1 treated, 2 untreated. Media is what the metal reflects.

// The blobs' field at p (frame-height units, centered). The surface is where it passes 1.
fn chrome_field(p: vec2f) -> f32 {
  let t = time() * frame.p0.w / 60.0 * 2.0 * PI;
  let r = frame.p0.x * 0.5;
  var f = 0.0;
  for (var i = 0u; i < 4u; i++) {
    let fi = f32(i);
    let c = vec2f(sin(t + fi * 2.1) * 0.34, cos(t * 1.3 + fi * 1.7) * 0.17) * (0.55 + 0.15 * fi);
    let ri = r * (1.0 - 0.15 * fi);
    let d = p - c;
    f += ri * ri / (dot(d, d) + 1e-4);
  }
  // Spikes: sharp ridges running out from the middle, growing on hits.
  let a = atan2(p.y, p.x);
  let ridge = pow(max(0.0, sin(a * 18.0 + time() * 0.5) * sin(length(p) * 42.0 - time() * 1.5)), 3.0);
  return f * (1.0 + frame.p0.y * 0.45 * ridge);
}

fn chrome_height(p: vec2f) -> f32 { return smoothstep(0.9, 3.2, chrome_field(p)); }

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let res = size();
  let base = textureSampleLevel(below, samp, in.uv, 0.0).rgb;
  let p = (in.uv - 0.5) * vec2f(res.x / res.y, -1.0);

  let f = chrome_field(p);
  let mask = smoothstep(0.96, 1.04, f);
  if (mask <= 0.0) {
    // A soft shadow of the metal on what is below.
    return vec4f(base * (1.0 - 0.35 * smoothstep(0.4, 1.0, f)), 1.0);
  }

  let e = 1.5 / res.y;
  let h = chrome_height(p);
  let dx = (chrome_height(p + vec2f(e, 0.0)) - h) / e;
  let dy = (chrome_height(p + vec2f(0.0, e)) - h) / e;
  let n = normalize(vec3f(-dx * 0.04, -dy * 0.04, 1.0));
  let v = vec3f(0.0, 0.0, 1.0);
  let fr = pow(1.0 - max(dot(n, v), 0.0), 2.0);
  let refl = reflect(-v, n);

  // The room the metal reflects: the palette top to bottom, with a bright horizon line.
  var env = mix(pal(1u), pal(0u), refl.y * 0.5 + 0.5);
  env = mix(env, pal(2u), smoothstep(0.3, 0.9, refl.x) * 0.6);
  if (frame.p1.x > 0.5) {
    // The owner's image or clip as the room: looked up by the reflected direction.
    let tex = textureSampleLevel(layerTex, samp, clamp(vec2f(refl.x, -refl.y) * 0.5 + 0.5, vec2f(0.0), vec2f(1.0)), 0.0).rgb;
    env = mix(env, media_look(tex, in.uv * res, frame.p1.x), 0.85);
  }
  env += vec3f(1.0) * exp(-abs(refl.y - 0.15) * 14.0) * 0.6;

  let film = spectral(dot(n, v) * 1.4 + time() * 0.05 + fr * 0.6);
  var col = mix(env, film, frame.p0.z * (0.45 + 0.25 * fr)) * (0.75 + 0.35 * fr);
  col += pow(max(dot(refl, normalize(vec3f(0.3, 0.8, 0.6))), 0.0), 40.0) * 1.2;
  // Dark rim where the metal curves away, so it reads as solid.
  col *= 0.55 + 0.45 * smoothstep(0.0, 0.25, h);

  return vec4f(mix(base, col, mask), 1.0);
}
