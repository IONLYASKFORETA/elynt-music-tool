// Classic: the spectrum, mirrored out from the center, bass in the middle,
// with rainbow color bleed, chrome tips and energy-driven glitch slices.
// p0 = (height, bleed px at 1080p, barFill, glitch).

fn band(i: u32) -> f32 { return spectrum[min(i, 63u)]; }

// 1 inside a bar, 0 outside, antialiased.
fn bar_mask(uv: vec2f) -> f32 {
  let x = abs(uv.x - 0.5) * 2.0;
  let f = x * 64.0;
  let cell = fract(f);
  let h = band(u32(f)) * frame.p0.x * 0.5;
  let y = abs(uv.y - 0.5);
  let px = 1.0 / size().y;
  let fill = frame.p0.z * 0.5;
  let across = 1.0 - smoothstep(fill - 0.06, fill, abs(cell - 0.5));
  let up = 1.0 - smoothstep(h - px, h + px, y);
  return across * up * step(0.002, h);
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let t = time();
  let e = energy();
  var uv = in.uv;

  // Glitch: on loud frames some horizontal slices jump sideways.
  let slice = floor(uv.y * 28.0);
  let tick = floor(t * 14.0);
  let chance = frame.p0.w * e * e * 0.5;
  if (hash21(vec2f(slice, tick)) < chance) {
    uv.x += (hash21(vec2f(tick, slice + 7.0)) - 0.5) * 0.12;
  }

  let base = textureSampleLevel(below, samp, uv, 0.0).rgb;

  // Rainbow color bleed: red, green and blue see the bars at different offsets.
  let off = vec2f(frame.p0.y * (1.0 + 1.5 * e) / 1080.0 * size().y / size().x, 0.0);
  let m = vec3f(bar_mask(uv + off), bar_mask(uv), bar_mask(uv - off));

  let x = abs(uv.x - 0.5) * 2.0;
  let f = x * 64.0;
  let h = band(u32(f)) * frame.p0.x * 0.5;
  let y = abs(uv.y - 0.5);

  // Spectral color across the bands, an iridescent sheen up each bar, chrome-white tips.
  let hue = x * 0.85 + t * 0.03;
  let sheen = spectral(hue + y * 2.5 - t * 0.1);
  let tip = smoothstep(h - 0.035, h, y);
  var col = mix(spectral(hue), sheen, 0.35);
  col = mix(col, vec3f(1.0), tip * 0.85);
  let bars = col * m + (m - min(m.r, min(m.g, m.b))) * spectral(hue + 0.5) * 0.6;

  // Soft glow above each bar.
  let glow = spectral(hue) * exp(-max(y - h, 0.0) * 30.0) * band(u32(f)) * 0.18 * (1.0 - max(m.r, max(m.g, m.b)));

  return vec4f(base * (1.0 - max(m.g, 0.0) * 0.6) + bars + glow, 1.0);
}
