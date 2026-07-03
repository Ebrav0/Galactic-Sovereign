#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_bloom;
uniform float u_intensity;
uniform float u_chromatic;

void main() {
  vec2 off = vec2(u_chromatic / 800.0, 0.0);
  float r = texture(u_bloom, v_uv + off).r;
  float g = texture(u_bloom, v_uv).g;
  float b = texture(u_bloom, v_uv - off).b;
  float a = texture(u_bloom, v_uv).a;
  vec3 col = vec3(r, g, b) * u_intensity;
  fragColor = vec4(col, a * u_intensity);
}
