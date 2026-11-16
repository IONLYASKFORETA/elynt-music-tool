// Transition: composites the outgoing scene (held, bound as layerTex) with the incoming one
// (below). The plan works out the timing; this only draws it.
// p0 = (style, mix 0..1, intensity 0..1, progress 0..1). Style: 0 cut, 1 glitch wipe,
// 2 bleed wash, 3 chrome morph, 4 white flash (transitions.ts TRANSITION_STYLES).

fn incoming_at(uv: vec2f) -> vec3f { return textureSampleLevel(below, samp, uv, 0.0).rgb; }
fn outgoing_at(uv: vec2f) -> vec3f { return textureSampleLevel(layerTex, samp, uv, 0.0).rgb; }

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let style = u32(frame.p0.x + 0.5);
  let m = clamp(frame.p0.y, 0.0, 1.0);
  let k = clamp(frame.p0.z, 0.0, 1.0);
  let t = time();
  let res = size();
  let uv = in.uv;
  var col = incoming_at(uv);

  if (style == 1u) {
    // Glitch wipe: a torn edge sweeps left to right; the new scene is behind it.
    let tick = floor(t * 20.0);
    let row = floor(uv.y * res.y / (res.y / 24.0));
    let edge = m + (hash21(vec2f(row, tick)) - 0.5) * 0.3 * k;
    let near = 1.0 - smoothstep(0.0, 0.08 * k + 0.001, abs(uv.x - edge));
    let shove = vec2f((hash21(vec2f(row + 5.0, tick)) - 0.5) * 0.12 * near, 0.0);
    let split = vec2f(6.0 * k * near / res.x, 0.0);
    let side = step(uv.x, edge);
    let n = vec3f(incoming_at(uv + shove + split).r, incoming_at(uv + shove).g, incoming_at(uv + shove - split).b);
    let o = vec3f(outgoing_at(uv + shove + split).r, outgoing_at(uv + shove).g, outgoing_at(uv + shove - split).b);
    col = mix(o, n, side);
    let line = step(1.0 - 0.15 * near, hash21(vec2f(floor(uv.y * res.y / 2.0), tick)));
    col = mix(col, pal(u32(hash21(vec2f(row, tick + 1.0)) * 5.0)), line * 0.8);
  } else if (style == 2u) {
    // Bleed wash: a spectral wash drips down over the old scene and drains off the new one.
    let smear = vec2f(0.02 * k, 0.0);
    let base = mix(outgoing_at(uv - smear), incoming_at(uv + smear), m);
    let column = floor(uv.x * res.x / 6.0);
    let reach = k * (1.1 + 0.35 * hash21(vec2f(column, 1.0)));
    let wet = 1.0 - smoothstep(reach - 0.12, reach, uv.y);
    let hue = uv.y * 0.9 + uv.x * 0.25 - t * 0.35;
    let wash = mix(spectral(hue), pal_ramp(hue), 0.45);
    col = mix(base, wash, wet * 0.92 * smoothstep(0.0, 0.15, k));
  } else if (style == 3u) {
    // Chrome morph: both scenes run through a liquid-metal ripple and melt into each other.
    let p = (uv - 0.5) * vec2f(res.x / res.y, 1.0);
    let flow = vec2f(sin(p.y * 11.0 + t * 2.1) + sin(p.x * 7.0 - t * 1.3), cos(p.x * 9.0 - t * 1.7) + cos(p.y * 6.0 + t)) * 0.025 * k;
    let o = outgoing_at(uv + flow * (1.0 + m));
    let n = incoming_at(uv - flow * (2.0 - m));
    let metal = mix(o, n, m);
    let film = spectral(dot(flow, vec2f(14.0, 9.0)) / max(k, 0.001) * 0.2 + t * 0.15);
    let shine = pow(clamp(length(flow) / (0.05 * k + 0.0001), 0.0, 1.0), 3.0);
    col = metal + film * (0.25 + 0.5 * shine) * k;
  } else if (style == 4u) {
    // White flash: the scenes swap under a burst of white.
    col = mix(mix(outgoing_at(uv), col, m), vec3f(1.0), k);
  }
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
