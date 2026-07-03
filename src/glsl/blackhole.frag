#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_radius;
uniform float u_time;
uniform float u_large; // 1.0 = system view

void main() {
  vec2 px = v_uv * u_resolution;
  px.y = u_resolution.y - px.y;
  vec2 delta = px - u_center;
  float dist = length(delta);
  float normDist = dist / max(u_radius, 1.0);
  float angle = atan(delta.y, delta.x);

  float diskScale = mix(1.9, 2.6, u_large);
  float outerR = u_radius * (diskScale + 1.6);

  if (dist > outerR) discard;

  // outer purple glow
  float outerGlow = 1.0 - smoothstep(u_radius * 1.5, outerR, dist);
  vec3 col = vec3(0.59, 0.35, 1.0) * outerGlow * 0.3;

  // accretion disk
  float diskInner = u_radius * 1.02;
  float diskOuter = u_radius * diskScale;
  if (dist >= diskInner && dist <= diskOuter) {
    float diskT = (dist - diskInner) / (diskOuter - diskInner);
    float rot = u_time * 0.0004 + angle;
    float shimmer = 0.72 + 0.08 * sin(u_time * 0.002 + rot * 3.0);
    float doppler = 0.5 + 0.5 * sin(angle - u_time * 0.0003);
    vec3 hotSide = mix(vec3(1.0, 0.67, 0.35), vec3(1.0, 0.47, 0.59), diskT);
    vec3 coldSide = mix(vec3(0.59, 0.35, 1.0), vec3(0.35, 0.24, 0.78), diskT);
    col = mix(coldSide, hotSide, doppler) * shimmer * (1.0 - diskT * 0.5);
  }

  // plasma arcs
  float base = u_time * 0.0012;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float arcStart = base * (1.0 + fi * 0.35) + fi * 2.094;
    float arcR = u_radius * (1.25 + fi * 0.28);
    float arcDist = abs(dist - arcR);
    float arcAngle = mod(angle - arcStart + 3.14159, 6.28318);
    if (arcAngle < 2.8 && arcDist < u_radius * 0.12) {
      vec3 arcCol = mod(float(i), 2.0) < 0.5
        ? vec3(0.71, 0.51, 1.0)
        : vec3(0.48, 0.82, 1.0);
      col += arcCol * (1.0 - arcDist / (u_radius * 0.12)) * 0.55;
    }
  }

  // photon ring
  float photonR = u_radius * 1.5;
  float ring = exp(-pow((dist - photonR) / (u_radius * 0.06), 2.0));
  col += vec3(0.71, 0.51, 1.0) * ring * 0.8;

  // event horizon
  if (dist < u_radius) {
    col = vec3(0.008, 0.012, 0.04);
    float edge = smoothstep(u_radius * 0.92, u_radius, dist);
    col = mix(col, vec3(0.71, 0.51, 1.0), edge * 0.6);
  }

  float alpha = outerGlow * 0.9 + ring;
  if (dist < u_radius) alpha = 1.0;
  if (dist >= diskInner && dist <= diskOuter) alpha = max(alpha, 0.85);

  if (alpha < 0.01) discard;
  fragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
