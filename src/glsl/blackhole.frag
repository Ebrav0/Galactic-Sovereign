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
uniform float u_warp;  // 0 = dormant, 1 = hyperspace exit

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
  float wt = t * (1.0 + u_warp * 32.0);

  // Hyperspace exit — spiral tunnel distortion and breathing scale.
  if (u_warp > 0.01) {
    float twist = angle + wt * (2.2 + u_warp * 5.5) + dist * 0.011 * u_warp;
    float breathe = 1.0 + u_warp * 0.22 * sin(wt * 5.5 + twist * 2.0);
    float tunnel = 1.0 - u_warp * 0.18 * sin(angle * 6.0 - wt * 9.0 - dist * 0.014);
    delta *= breathe * tunnel;
    dist = length(delta);
    angle = atan(delta.y, delta.x);
  }

  float diskScale = mix(2.1, 2.8, u_large);
  float outerR = u_radius * (diskScale + 2.4);
  if (dist > outerR) discard;

  float normR = dist / max(u_radius, 1.0);
  vec2 ang = vec2(cos(angle), sin(angle));
  vec3 col = vec3(0.0);
  float alpha = 0.0;

  // ---------- outer nebular glow ----------
  float outerGlow = 1.0 - smoothstep(u_radius * 1.2, outerR, dist);
  outerGlow *= outerGlow;
  float glowPulse = 0.85 + 0.15 * sin((u_warp > 0.01 ? wt : t) * 0.7);
  col += DEEP_VIOLET * outerGlow * (0.35 + u_warp * 0.25) * glowPulse;
  col += CYAN * outerGlow * u_warp * 0.18 * (0.6 + 0.4 * sin(wt * 3.2));
  alpha = max(alpha, outerGlow * (0.55 + u_warp * 0.25));

  // ---------- swirled accretion disk ----------
  float diskInner = u_radius * 1.04;
  float diskOuter = u_radius * diskScale;
  if (dist >= diskInner * 0.85 && dist <= diskOuter * 1.25) {
    float diskT = clamp((dist - diskInner) / (diskOuter - diskInner), 0.0, 1.0);
    // Spiral shear: inner material orbits faster (Keplerian-ish).
    float spinRate = u_warp > 0.01 ? wt : t;
    float omega = (0.55 + u_warp * 2.8) / max(pow(normR, 1.5), 0.15);
    float swirlPhase = spinRate * omega + 3.5 * log(max(normR, 0.35));
    float angMix = dot(ang, vec2(sin(spinRate * 0.62), cos(spinRate * 0.62))) * (4.0 + u_warp * 2.5);
    // Turbulent streaks — sample with sin/cos (continuous), never raw angle (avoids π seam).
    float streaks = fbm(vec2(angMix + ang.x * (2.4 + u_warp * 1.6), normR * 6.0 - spinRate * (0.35 + u_warp * 1.4)));
    float fine = fbm(vec2(angMix * 1.7 + ang.y * (6.0 + u_warp * 3.0) + 13.7, normR * 14.0 + spinRate * (0.2 + u_warp * 0.9)));
    float density = smoothstep(0.18, 0.85, streaks * 0.72 + fine * 0.38);

    // Relativistic beaming — the approaching side burns brighter.
    float doppler = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(angle - spinRate * (0.55 + u_warp * 1.8)), 2.0);

    float edgeIn = smoothstep(diskInner * 0.85, diskInner * 1.1, dist);
    float edgeOut = 1.0 - smoothstep(diskOuter * 0.9, diskOuter * 1.25, dist);
    float diskMask = edgeIn * edgeOut;

    float heat = (1.0 - diskT);
    vec3 hot = mix(EMBER, vec3(1.0, 0.94, 0.85), heat * heat * doppler);
    vec3 cool = mix(DEEP_VIOLET, HOT_PINK, streaks * 0.6);
    vec3 diskCol = mix(cool, hot, heat * (0.45 + 0.55 * doppler));

    float brightness = diskMask * density * (0.55 + 0.85 * doppler) * (0.6 + 0.6 * heat) * (1.0 + u_warp * 0.65);
    col += diskCol * brightness * (1.35 + u_warp * 0.55);
    col += CYAN * diskMask * density * u_warp * doppler * 0.35;
    alpha = max(alpha, min(1.0, brightness * 1.2));
  }

  // ---------- gravitational lens arcs (light bent over the poles) ----------
  {
    float arcR = u_radius * 1.28;
    float vertical = abs(sin(angle));
    float arcBand = exp(-pow((dist - arcR) / (u_radius * 0.1), 2.0));
    float shimmer = 0.7 + 0.3 * fbm(vec2(ang.x * 2.8 + ang.y * 1.6 + (u_warp > 0.01 ? wt : t) * 0.4, dist * 0.02));
    col += mix(VIOLET, EMBER, vertical * 0.5) * arcBand * vertical * shimmer * (0.75 + u_warp * 0.45);
    alpha = max(alpha, arcBand * vertical * 0.8);
  }

  // ---------- photon ring ----------
  {
    float photonR = u_radius * (1.12 + u_warp * 0.08 * sin(wt * 6.5));
    float ring = exp(-pow((dist - photonR) / (u_radius * (0.035 - u_warp * 0.008)), 2.0));
    float ring2 = exp(-pow((dist - photonR * 1.06) / (u_radius * 0.02), 2.0)) * (0.5 + u_warp * 0.35);
    col += mix(vec3(1.0, 0.9, 0.8), mix(VIOLET, CYAN, u_warp * 0.6), 0.35) * (ring + ring2) * (1.5 + u_warp * 0.8);
    alpha = max(alpha, ring + ring2);
  }

  // ---------- polar jets (tilted off-axis during warp to avoid cardinal streaks) ----------
  {
    float jetPulse = 0.72 + 0.28 * sin((u_warp > 0.01 ? wt : t) * (1.7 + u_warp * 2.5));
    float jetTilt = u_warp * 0.42;
    for (int j = 0; j < 2; j++) {
      float sgn = j == 0 ? 1.0 : -1.0;
      float jetAngle = sgn * (1.5707963 + jetTilt * sin((u_warp > 0.01 ? wt : t) * 0.31 + float(j) * 2.4))
        + (0.12 + u_warp * 0.22) * sin((u_warp > 0.01 ? wt : t) * (0.23 + u_warp * 1.1) + float(j) * 3.1);
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
      float pulses = 0.65 + 0.35 * sin(along * 0.05 - (u_warp > 0.01 ? wt : t) * (6.0 + u_warp * 8.0));
      vec3 jetCol = mix(CYAN, VIOLET, lifeT) * (core * (1.6 + u_warp * 0.9) + halo * (0.4 + u_warp * 0.3));
      col += jetCol * fade * pulses * jetPulse * (0.9 + u_warp * 0.55);
      alpha = max(alpha, (core + halo * 0.4) * fade * 0.85);
    }
  }

  // ---------- infalling / exit ember swarm ----------
  {
    float maxR = diskOuter * (1.2 + u_warp * 0.35);
    for (int i = 0; i < 30; i++) {
      float fi = float(i);
      float h1 = hash1(fi + 1.0);
      float h2 = hash1(fi + 40.0);
      float h3 = hash1(fi + 80.0);
      float speed = (0.06 + h2 * 0.1) * (1.0 + u_warp * 2.5);
      float cycle = fract((u_warp > 0.01 ? wt : t) * speed + h1 * 9.0);
      float pr;
      float spin;
      vec2 vel;
      if (u_warp > 0.35) {
        // Exiting hyperspace — embers blast outward from the iris.
        pr = mix(u_radius * 1.02, maxR * 1.15, pow(cycle, 0.45));
        spin = wt * (1.2 + h3 * 1.4) + h1 * 6.2831853 + cycle * 9.0;
        vel = vec2(-sin(spin), cos(spin)) * (0.8 + u_warp) + normalize(vec2(cos(spin), sin(spin))) * (0.5 + u_warp);
      } else {
        pr = mix(maxR, u_radius * 1.08, pow(cycle, 0.72));
        spin = t * (0.5 + h3 * 0.7) + h1 * 6.2831853 + cycle * 7.0;
        vel = vec2(-sin(spin), cos(spin)) - normalize(vec2(cos(spin), sin(spin))) * 0.6;
      }
      vec2 pos = vec2(cos(spin), sin(spin)) * pr;
      float size = u_radius * (0.02 + h3 * 0.03) * (1.0 + (1.0 - cycle));
      float g = particleGlow(delta, pos, vel, size);
      float heat = cycle;
      vec3 pCol = mix(mix(VIOLET, HOT_PINK, h2), vec3(1.0, 0.9, 0.75), heat * heat);
      float fade = smoothstep(0.0, 0.15, cycle) * (0.5 + 0.5 * heat);
      float flick = 0.7 + 0.3 * sin(t * (6.0 + h2 * 9.0) + fi);
      col += pCol * g * fade * flick * (1.15 + u_warp * 0.85);
      alpha = max(alpha, g * fade);
    }
  }

  // ---------- warp tunnel rings (hyperspace exit bands) ----------
  if (u_warp > 0.08) {
    for (int k = 0; k < 5; k++) {
      float fk = float(k);
      float bandR = u_radius * (1.18 + fk * 0.22) + sin(wt * (2.1 + fk * 0.7) + fk) * u_radius * 0.04 * u_warp;
      float band = exp(-pow((dist - bandR) / (u_radius * (0.045 + fk * 0.012)), 2.0));
      float spinBand = 0.5 + 0.5 * sin(dot(ang, vec2(sin(wt * 1.3 + fk), cos(wt * 1.3 + fk))) * (6.0 + fk * 2.0) - wt * 3.5);
      vec3 bandCol = mix(CYAN, mix(VIOLET, EMBER, fk * 0.2), fk * 0.18);
      col += bandCol * band * spinBand * u_warp * (0.35 + 0.12 * fk);
      alpha = max(alpha, band * spinBand * u_warp * 0.55);
    }
  }

  // ---------- event horizon + dormant wormhole iris ----------
  if (dist < u_radius) {
    float rim = smoothstep(u_radius * 0.86, u_radius, dist);
    float irisSpin = u_warp > 0.01 ? wt : t;
    float iris = fbm(vec2(ang.x * (2.0 + u_warp * 2.5) + ang.y * 1.8 + irisSpin * (0.25 + u_warp * 1.8) + 2.2 * log(max(normR, 0.05)), normR * 5.0 - irisSpin * (0.15 + u_warp * 0.65)));
    float irisMask = smoothstep(0.15, 0.75, normR) * (1.0 - rim);
    vec3 inner = vec3(0.004, 0.006, 0.02);
    inner += DEEP_VIOLET * iris * irisMask * (0.22 + u_warp * 0.35);
    float irisOpen = u_warp * (0.35 + 0.25 * sin(wt * 4.8));
    inner += mix(VIOLET, CYAN, u_warp) * irisOpen * exp(-normR * (3.0 - u_warp * 1.2));
    float core = exp(-normR * normR * 55.0) * (0.5 + 0.5 * sin((u_warp > 0.01 ? wt : t) * (2.3 + u_warp * 4.0)));
    inner += mix(VIOLET, vec3(0.85, 0.95, 1.0), u_warp) * core * (0.5 + u_warp * 0.55);
    col = mix(inner, VIOLET * 0.85, rim * rim * 0.75);
    alpha = 1.0;
  }

  if (alpha < 0.012) discard;
  fragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
