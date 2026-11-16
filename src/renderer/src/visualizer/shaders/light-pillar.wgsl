// Light Pillar: vertical beams that slam down on the biggest moments, in the vision's colors
// with white-hot cores, after the pillar in the prototype's "Holo Chrome" sketch.
// p0 = (fire 0..1, beam count 1..7, core width px at 1080p, bloom 0..1)

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let base = textureSampleLevel(below, samp, in.uv, 0.0).rgb;
  let fire = frame.p0.x;
  if (fire <= 0.001) {
    return vec4f(base, 1.0);
  }

  let t = time();
  let res = size();
  let aspect = res.x / res.y;
  let x = (in.uv.x - 0.5) * aspect;
  let n = u32(clamp(frame.p0.y, 1.0, 7.0));
  let bloom = frame.p0.w;
  let spacing = min(0.35, 0.9 * aspect / f32(n));
  let seed = floor(t * 0.5);
  // The beams reach further down the frame the harder they fire.
  let reach = 0.25 + 0.95 * fire;
  let falloff = 1.0 - smoothstep(reach - 0.25, reach, in.uv.y);

  var light = vec3f(0.0);
  for (var i = 0u; i < 7u; i++) {
    if (i >= n) {
      break;
    }
    let fi = f32(i);
    // The first beam is in the middle; the rest go out to either side in turn.
    let side = select(-1.0, 1.0, i % 2u == 1u);
    let slot = f32((i + 1u) / 2u);
    let cx = side * slot * spacing + (hash21(vec2f(fi, seed)) - 0.5) * 0.06;
    let w = max(frame.p0.z, 1.0) / 1080.0 * (1.0 - 0.06 * fi);
    let d = abs(x - cx);
    let core = exp(-(d * d) / (w * w));
    let halo = exp(-d / (w * 8.0)) * bloom;
    let flicker = 0.85 + 0.15 * hash21(vec2f(fi, floor(t * 30.0)));
    let tone = mix(pal(i), vec3f(1.0), core * 0.85);
    light += tone * (core * 1.6 + halo * 0.7) * falloff * flicker;
    // Where a beam hits the floor it splashes out.
    let floor_glow = exp(-d / (w * 22.0)) * exp(-(1.0 - in.uv.y) * 10.0) * bloom * step(0.99, reach);
    light += pal(i) * floor_glow;
  }

  // The room drops toward black as the beams fire, so they cut through.
  let room = base * (1.0 - 0.4 * fire);
  let flash = pal(0u) * 0.08 * fire * fire;
  return vec4f(room + (light * fire) + flash, 1.0);
}
