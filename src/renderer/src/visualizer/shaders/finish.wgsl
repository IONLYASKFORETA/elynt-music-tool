// Finish: grain, scanlines and vignette over the whole picture, pushed by energy.
// p0 = (grain, scanlines, vignette, energyResponse).

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let uv = in.uv;
  let e = energy() * frame.p0.w;
  let res = size();

  // A touch of chromatic aberration that opens up on loud frames.
  let ab = (uv - 0.5) * (0.002 + 0.008 * e);
  var col = vec3f(
    textureSampleLevel(below, samp, uv + ab, 0.0).r,
    textureSampleLevel(below, samp, uv, 0.0).g,
    textureSampleLevel(below, samp, uv - ab, 0.0).b,
  );

  let line = 0.5 + 0.5 * sin(uv.y * res.y * PI);
  col *= 1.0 - frame.p0.y * 0.45 * line;

  let d = length((uv - 0.5) * vec2f(res.x / res.y, 1.0));
  col *= 1.0 - frame.p0.z * smoothstep(0.35, 1.05, d);

  let grain = hash21(floor(uv * res) + fract(time() * 61.7) * 917.0) - 0.5;
  col += grain * frame.p0.x * (0.6 + 0.8 * e);

  return vec4f(max(col, vec3f(0.0)), 1.0);
}
