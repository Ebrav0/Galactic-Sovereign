#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_threshold;

void main() {
  vec4 c = texture(u_texture, v_uv);
  float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float bright = max(lum - u_threshold, 0.0) / max(1.0 - u_threshold, 0.001);
  fragColor = vec4(c.rgb * bright, c.a * bright);
}
