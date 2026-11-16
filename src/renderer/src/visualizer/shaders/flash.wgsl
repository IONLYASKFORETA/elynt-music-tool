// White flash (a moment): the frame burns white on the beat and fades back, a rim of the
// vision's first color showing at the edges as it goes.
// p0 = (amount 0..1)

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let a = clamp(frame.p0.x, 0.0, 1.0);
  let res = size();
  let col = textureSampleLevel(below, samp, in.uv, 0.0).rgb;
  let d = length((in.uv - 0.5) * vec2f(res.x / res.y, 1.0));
  let rim = pal(0u) * smoothstep(0.25, 1.0, d) * (1.0 - a);
  let hot = mix(vec3f(1.0), vec3f(0.9) + rim, smoothstep(0.6, 0.0, a));
  return vec4f(mix(col, hot, a), 1.0);
}
