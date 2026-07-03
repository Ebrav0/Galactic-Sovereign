#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_alpha;

void main() {
  vec4 c = texture(u_texture, v_uv);
  fragColor = vec4(c.rgb, c.a * u_alpha);
}
