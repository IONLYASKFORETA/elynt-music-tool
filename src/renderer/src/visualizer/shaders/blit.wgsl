// Copies the finished frame onto the canvas, scaling up from the render size.

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  return vec4f(textureSampleLevel(below, samp, in.uv, 0.0).rgb, 1.0);
}
