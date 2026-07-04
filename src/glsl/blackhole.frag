#version 300 es
precision highp float;

// Cinematic dormant wormhole — swirled accretion disk, photon ring,
// gravitational lens arcs, polar jets, and an infalling ember swarm.

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_radius;
uniform float u_time;
uniform float u_large; // 1.0 = system view

const vec3 VIOLET = vec3(0.59, 0.35, 1.0);
const vec3 DEEP_VIOLET = vec3(0.32, 0.18, 0.66);
const vec3 CYAN = vec3(0.45, 0.82, 1.0);
const vec3 EMBER = vec3(1.0, 0.62, 0.3);
const vec3 HOT_PINK = vec3(1.0, 0.45, 0.62);

float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash2(i);
  float b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0));
  float d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.13 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return v;
}

// Anisotropic glow dot stretched along its direction of travel.
float particleGlow(vec2 delta, vec2 pos, vec2 vel, float size) {
  vec2 d = delta - pos;
  vec2 dir = normalize(vel + vec2(0.0001));
  float along = dot(d, dir);
  float perp = dot(d, vec2(-dir.y, dir.x));
  float g = exp(-(along * along) / (size * size * 9.0) - (perp * perp) / (size * size));
  return g;
}

void main() {
  vec2 px = v_uv * u_resolution;
  px.y = u_resolution.y - px.y;
  vec2 delta = px - u_center;
  float dist = length(delta);
  float angle = atan(delta.y, delta.x);
  float t = u_time * 0.001;

  float diskScale = mix(2.1, 2.8, u_large);
  float outerR = u_radius * (diskScale + 2.4);
  if (dist > outerR) discard;

  float normR = dist / max(u_radius, 1.0);
  vec3 col = vec3(0.0);
  float alpha = 0.0;

  // ---------- outer nebular glow ----------
  float outerGlow = 1.0 - smoothstep(u_radius * 1.2, outerR, dist);
  outerGlow *= outerGlow;
  float glowPulse = 0.85 + 0.15 * sin(t * 0.7);
  col += DEEP_VIOLET * outerGlow * 0.35 * glowPulse;
  alpha = max(alpha, outerGlow * 0.55);

  // ---------- swirled accretion disk ----------
  float diskInner = u_radius * 1.04;
  float diskOuter = u_radius * diskScale;
  if (dist >= diskInner * 0.85 && dist <= diskOuter * 1.25) {
    float diskT = clamp((dist - diskInner) / (diskOuter - diskInner), 0.0, 1.0);
    // Spiral shear: inner material orbits faster (Keplerian-ish).
    float omega = 0.55 / max(pow(normR, 1.5), 0.15);
    float swirl = angle + t * omega + 3.5 * log(max(normR, 0.35));
    // Turbulent streaks flowing around the disk.
    float streaks = fbm(vec2(swirl * 2.4, normR * 6.0 - t * 0.35));
    float fine = fbm(vec2(swirl * 6.0 + 13.7, normR * 14.0 + t * 0.2));
    float density = smoothstep(0.18, 0.85, streaks * 0.72 + fine * 0.38);

    // Relativistic beaming — the approaching side burns brighter.
    float doppler = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(angle - t * 0.55), 2.0);

    float edgeIn = smoothstep(diskInner * 0.85, diskInner * 1.1, dist);
    float edgeOut = 1.0 - smoothstep(diskOuter * 0.9, diskOuter * 1.25, dist);
    float diskMask = edgeIn * edgeOut;

    float heat = (1.0 - diskT);
    vec3 hot = mix(EMBER, vec3(1.0, 0.94, 0.85), heat * heat * doppler);
    vec3 cool = mix(DEEP_VIOLET, HOT_PINK, streaks * 0.6);
    vec3 diskCol = mix(cool, hot, heat * (0.45 + 0.55 * doppler));

    float brightness = diskMask * density * (0.55 + 0.85 * doppler) * (0.6 + 0.6 * heat);
    col += diskCol * brightness * 1.35;
    alpha = max(alpha, min(1.0, brightness * 1.2));
  }

  // ---------- gravitational lens arcs (light bent over the poles) ----------
  {
    float arcR = u_radius * 1.28;
    float vertical = abs(sin(angle));
    float arcBand = exp(-pow((dist - arcR) / (u_radius * 0.1), 2.0));
    float shimmer = 0.7 + 0.3 * fbm(vec2(angle * 3.0 + t * 0.4, dist * 0.02));
    col += mix(VIOLET, EMBER, vertical * 0.5) * arcBand * vertical * shimmer * 0.75;
    alpha = max(alpha, arcBand * vertical * 0.8);
  }

  // ---------- photon ring ----------
  {
    float photonR = u_radius * 1.12;
    float ring = exp(-pow((dist - photonR) / (u_radius * 0.035), 2.0));
    float ring2 = exp(-pow((dist - photonR * 1.06) / (u_radius * 0.02), 2.0)) * 0.5;
    col += mix(vec3(1.0, 0.9, 0.8), VIOLET, 0.35) * (ring + ring2) * 1.5;
    alpha = max(alpha, ring + ring2);
  }

  // ---------- polar jets ----------
  {
    float jetPulse = 0.72 + 0.28 * sin(t * 1.7);
    for (int j = 0; j < 2; j++) {
      float sgn = j == 0 ? 1.0 : -1.0;
      // Jets fire along ±y with a slow precession wobble.
      float jetAngle = sgn * 1.5707963 + 0.12 * sin(t * 0.23 + float(j) * 3.1);
      vec2 jdir = vec2(cos(jetAngle), sin(jetAngle));
      float along = dot(delta, jdir);
      float perp = dot(delta, vec2(-jdir.y, jdir.x));
      if (along < u_radius * 0.6) continue;
      float reach = outerR * 0.98;
      float lifeT = clamp(along / reach, 0.0, 1.0);
      float width = u_radius * (0.08 + lifeT * 0.5);
      float core = exp(-(perp * perp) / (width * width * 0.25));
      float halo = exp(-(perp * perp) / (width * width * 2.2));
      float fade = (1.0 - lifeT) * smoothstep(u_radius * 0.6, u_radius * 1.1, along);
      // Pulses travelling up the jet.
      float pulses = 0.65 + 0.35 * sin(along * 0.05 - t * 6.0);
      vec3 jetCol = mix(CYAN, VIOLET, lifeT) * (core * 1.6 + halo * 0.4);
      col += jetCol * fade * pulses * jetPulse * 0.9;
      alpha = max(alpha, (core + halo * 0.4) * fade * 0.85);
    }
  }

  // ---------- infalling ember swarm ----------
  {
    float maxR = diskOuter * 1.2;
    for (int i = 0; i < 30; i++) {
      float fi = float(i);
      float h1 = hash1(fi + 1.0);
      float h2 = hash1(fi + 40.0);
      float h3 = hash1(fi + 80.0);
      float speed = 0.06 + h2 * 0.1;
      float cycle = fract(t * speed + h1 * 9.0);
      // Spiral from the rim down to the photon ring.
      float pr = mix(maxR, u_radius * 1.08, pow(cycle, 0.72));
      float spin = t * (0.5 + h3 * 0.7) + h1 * 6.2831853 + cycle * 7.0;
      vec2 pos = vec2(cos(spin), sin(spin)) * pr;
      vec2 vel = vec2(-sin(spin), cos(spin)) - normalize(pos) * 0.6;
      float size = u_radius * (0.02 + h3 * 0.03) * (1.0 + (1.0 - cycle));
      float g = particleGlow(delta, pos, vel, size);
      float heat = cycle;
      vec3 pCol = mix(mix(VIOLET, HOT_PINK, h2), vec3(1.0, 0.9, 0.75), heat * heat);
      float fade = smoothstep(0.0, 0.15, cycle) * (0.5 + 0.5 * heat);
      float flick = 0.7 + 0.3 * sin(t * (6.0 + h2 * 9.0) + fi);
      col += pCol * g * fade * flick * 1.15;
      alpha = max(alpha, g * fade);
    }
  }

  // ---------- event horizon + dormant wormhole iris ----------
  if (dist < u_radius) {
    float rim = smoothstep(u_radius * 0.86, u_radius, dist);
    // Slow spiral shimmer deep inside — the dormant gate.
    float iris = fbm(vec2(angle * 2.0 + t * 0.25 + 2.2 * log(max(normR, 0.05)), normR * 5.0 - t * 0.15));
    float irisMask = smoothstep(0.15, 0.75, normR) * (1.0 - rim);
    vec3 inner = vec3(0.004, 0.006, 0.02);
    inner += DEEP_VIOLET * iris * irisMask * 0.22;
    // Pinprick singularity glimmer at the very center.
    float core = exp(-normR * normR * 55.0) * (0.5 + 0.5 * sin(t * 2.3));
    inner += VIOLET * core * 0.5;
    col = mix(inner, VIOLET * 0.85, rim * rim * 0.75);
    alpha = 1.0;
  }

  if (alpha < 0.012) discard;
  fragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
