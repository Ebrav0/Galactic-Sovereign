#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform vec2 u_texelSize;
uniform vec2 u_direction;

void main() {
  vec2 off = u_texelSize * u_direction;
  vec4 sum = texture(u_texture, v_uv) * 0.227027;
  sum += texture(u_texture, v_uv + off * 1.0) * 0.1945946;
  sum += texture(u_texture, v_uv - off * 1.0) * 0.1945946;
  sum += texture(u_texture, v_uv + off * 2.0) * 0.1216216;
  sum += texture(u_texture, v_uv - off * 2.0) * 0.1216216;
  sum += texture(u_texture, v_uv + off * 3.0) * 0.054054;
  sum += texture(u_texture, v_uv - off * 3.0) * 0.054054;
  sum += texture(u_texture, v_uv + off * 4.0) * 0.016216;
  sum += texture(u_texture, v_uv - off * 4.0) * 0.016216;
  fragColor = sum;
}
