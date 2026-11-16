// Glitch: block tears, datamosh, pixel drag and RGB split over the picture below.
// p0 = (amount 0..1, block px at 1080p, RGB split px at 1080p, drag 0..1); p1 = (mosh 0..1)

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let t = time();
  let res = size();
  let amount = frame.p0.x;
  let block = max(frame.p0.y, 4.0) / 1080.0 * res.y;
  let drag = frame.p0.w;
  let mosh = frame.p1.x;
  let tick = floor(t * 15.0);
  var uv = in.uv;

  // Block tears: wide blocks jump sideways.
  let cell = floor(uv * res / vec2f(block * 4.0, block));
  let h = hash21(cell + tick * 0.37);
  let torn = step(1.0 - amount * 0.6, h);
  uv.x += torn * (hash21(cell.yx + tick) - 0.5) * 0.22 * amount;

  // Datamosh: some blocks show a stale, shoved copy of the picture, snapped to macroblocks.
  let mcell = floor(in.uv * res / block);
  let moshed = step(1.0 - mosh * 0.45, hash21(mcell * 1.7 + floor(t * 6.0)));
  let flow = (vec2f(hash21(mcell + 3.1), hash21(mcell + 7.7)) - 0.5) * 0.1;
  let mb_size = 16.0 / res;
  let snapped = (floor(uv / mb_size) + 0.5) * mb_size;
  uv = mix(uv, snapped + flow * mosh, moshed);

  // Pixel drag: thin columns freeze at one row and stretch it down the frame.
  let column = floor(in.uv.x * res.x / 3.0);
  let streak = step(1.0 - drag * 0.25, hash21(vec2f(column, tick)));
  let from_row = hash21(vec2f(column + 1.0, tick));
  uv.y = mix(uv.y, min(uv.y, from_row), streak);

  // RGB split, wider on torn blocks.
  let s = frame.p0.z * (0.3 + amount) * (1.0 + torn) / 1080.0 * res.y;
  let off = vec2f(s / res.x, torn * s * 0.3 / res.y);
  var col = vec3f(
    textureSampleLevel(below, samp, uv + off, 0.0).r,
    textureSampleLevel(below, samp, uv, 0.0).g,
    textureSampleLevel(below, samp, uv - off, 0.0).b,
  );

  // A few torn blocks flash the vision's colors, and bright lines of noise cut across.
  let fill = step(1.0 - amount * 0.07, hash21(cell * 2.3 + tick));
  col = mix(col, pal(u32(h * 5.0)), fill * 0.7);
  let line = step(1.0 - amount * 0.02, hash21(vec2f(floor(in.uv.y * res.y / 2.0), tick)));
  col += line * 0.6;

  return vec4f(max(col, vec3f(0.0)), 1.0);
}
