// Poster Frame: border, grid, crop marks and a logo mark over the picture below.
// p0 = (columns, rows, weight, marks), p1 = (logo, opacity, logo corner 0..3 clockwise from top left,
// own logo from the media shelf (V18): 0 the drawn ring-and-plus mark, 1 treated, 2 untreated).

// 1 on a line `w` pixels either side of distance 0, with a pixel of soft edge.
fn stroke(d: f32, w: f32) -> f32 {
  return 1.0 - smoothstep(w, w + 1.0, d);
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let res = size();
  let px = in.uv * res;
  let base = textureSampleLevel(below, samp, in.uv, 0.0).rgb;
  let s = min(res.x, res.y);
  let margin = 0.05 * s;
  let w = mix(0.5, 2.5, frame.p0.z) * s / 1080.0;
  let lo = vec2f(margin);
  let hi = res - margin;
  let inside = all(px > lo) && all(px < hi);

  // Border.
  var m = 0.0;
  let edge = min(min(abs(px.x - lo.x), abs(px.x - hi.x)), min(abs(px.y - lo.y), abs(px.y - hi.y)));
  if (all(px > lo - w - 1.0) && all(px < hi + w + 1.0)) {
    m = stroke(edge, w);
  }

  // Grid, thinner and fainter than the border.
  let cell = (hi - lo) / max(vec2f(frame.p0.x, frame.p0.y), vec2f(1.0));
  let g = abs(fract((px - lo) / cell + 0.5) - 0.5) * cell;
  if (inside) {
    m = max(m, 0.4 * stroke(min(g.x, g.y), w * 0.5));
  }

  // Crop marks: short ticks outside each corner, in line with the edges.
  let gap = margin * 0.25;
  let len = margin * 0.5;
  var marks = 0.0;
  for (var i = 0; i < 4; i++) {
    let right = i == 1 || i == 2;
    let bottom = i >= 2;
    let corner = vec2f(select(lo.x, hi.x, right), select(lo.y, hi.y, bottom));
    let q = (px - corner) * vec2f(select(-1.0, 1.0, right), select(-1.0, 1.0, bottom));
    if (q.x > gap && q.x < gap + len) { marks = max(marks, stroke(abs(q.y), w)); }
    if (q.y > gap && q.y < gap + len) { marks = max(marks, stroke(abs(q.x), w)); }
  }
  m = max(m, marks * frame.p0.w);

  // Logo mark: a ring crossed by a plus, in one corner inside the border.
  let logoCorner = i32(frame.p1.z + 0.5);
  let r = 0.032 * s;
  let inset = margin * 0.6 + r * 1.6;
  let c = vec2f(
    select(lo.x + inset, hi.x - inset, logoCorner == 1 || logoCorner == 2),
    select(lo.y + inset, hi.y - inset, logoCorner >= 2),
  );
  let d = px - c;
  let ring = stroke(abs(length(d) - r), w * 1.2);
  let plus = max(
    stroke(abs(d.x), w) * step(abs(d.y), r * 1.45),
    stroke(abs(d.y), w) * step(abs(d.x), r * 1.45),
  );
  var logo = max(ring, plus) * frame.p1.x;

  let ink = vec3f(0.94);
  var logoInk = mix(ink, pal_ramp(time() * 0.04 + d.y / (4.0 * r)), 0.6);
  if (frame.p1.w > 0.5) {
    // The owner's logo, fitted into a box the size of the drawn mark.
    let dims = vec2f(textureDimensions(layerTex));
    let box = 2.9 * r * vec2f(min(1.0, dims.x / dims.y), min(1.0, dims.y / dims.x));
    let local = d / box + 0.5;
    let inBox = all(local >= vec2f(0.0)) && all(local <= vec2f(1.0));
    let tex = textureSampleLevel(layerTex, samp, clamp(local, vec2f(0.0), vec2f(1.0)), 0.0);
    logo = select(0.0, tex.a, inBox) * frame.p1.x;
    // Treated, the logo is a shape in the frame's ink; untreated, its own colors.
    if (frame.p1.w > 1.5) {
      logoInk = tex.rgb;
    }
  }
  var col = mix(base, ink, clamp(m * frame.p1.y, 0.0, 1.0));
  col = mix(col, logoInk, clamp(logo * (0.4 + frame.p1.y), 0.0, 1.0));
  return vec4f(col, 1.0);
}
