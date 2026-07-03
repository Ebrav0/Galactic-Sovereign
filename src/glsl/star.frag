#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_radius;
uniform float u_time;
uniform float u_seed;
uniform vec3 u_color;
uniform vec3 u_secondary;
uniform vec3 u_corona;
uniform float u_glowScale;
uniform float u_pulseSpeed;
uniform float u_rotationSpeed;
uniform float u_temperature;
uniform float u_coronaIntensity;
uniform float u_lensStrength;
uniform float u_turbulence;
uniform float u_intel;
uniform int u_mode; // 0=system, 1=galaxy
uniform int u_features;
uniform int u_pass; // 0=full, 1=core, 2=outer

vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289v3(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289v2(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p, int octaves) {
  float v = 0.0;
  float a = 0.5;
  vec2 shift = vec2(100.0 + u_seed * 0.01);
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    v += a * snoise(p);
    p = rot * p * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}

bool hasFeature(int f) { return (u_features & f) != 0; }

float angleDiff(float a, float b) {
  return atan(sin(a - b), cos(a - b));
}

// Tight angular mask for localized limb features.
float siteArc(float angle, float siteAngle, float width) {
  return exp(-pow(angleDiff(angle, siteAngle) / max(width, 0.04), 2.0));
}

float siteHash(float i) {
  return fract(sin((u_seed * 0.000013 + i * 127.1) * 43758.5453));
}

// Soft prominence arch — sways and breathes.
float prominenceArch(float normR, float angle, float siteAngle, float idx, float t) {
  float sway = sin(t * 1.8 + idx) * 0.06;
  float site = siteAngle + sway;
  float span = 0.28 + siteHash(idx + 6.0) * 0.2;
  float dAng = abs(angleDiff(angle, site));
  if (dAng > span) return 0.0;

  float archT = dAng / span;
  float lift = 0.18 + siteHash(idx + 8.0) * 0.16 + 0.08 * sin(t * 2.2 + idx);
  float archR = 1.0 + lift * sin(archT * 3.14159265);
  float band = exp(-abs(normR - archR) / 0.09);
  band *= sin(archT * 3.14159265);
  float wisp = 0.55 + 0.45 * fbm(vec2(archT * 6.0 - t * 1.2, dAng * 12.0 + idx), 3);
  return band * wisp * smoothstep(0.98, 1.06, normR);
}

// Jagged lightning arc erupting from the limb.
vec3 lightningStrike(vec2 delta, float angle, float siteAngle, float idx, float t, vec3 boltTint) {
  vec2 dir = vec2(cos(siteAngle), sin(siteAngle));
  vec2 pDir = vec2(-dir.y, dir.x);
  float along = dot(delta, dir);
  float perp = dot(delta, pDir);
  float relOut = along - u_radius * 0.985;
  if (relOut < -u_radius * 0.02) return vec3(0.0);

  float relN = relOut / u_radius;
  float angM = exp(-pow(angleDiff(angle, siteAngle) / (0.12 + siteHash(idx + 2.0) * 0.08), 2.0));

  float reach = 0.18 + siteHash(idx + 5.0) * 0.42;
  float life = smoothstep(reach + 0.04, -0.01, relN);
  if (life < 0.01) return vec3(0.0);

  // Flicker / strike cadence
  float strike = fract(t * (1.6 + siteHash(idx + 7.0)) + siteHash(idx) * 6.0);
  float active = smoothstep(0.0, 0.08, strike) * (1.0 - smoothstep(0.08, 0.38, strike));
  active = max(active, 0.25 + 0.75 * step(0.72, strike) * (1.0 - smoothstep(0.72, 0.92, strike)));

  // Jagged bolt path
  float jag1 = fbm(vec2(relN * 20.0 - t * 1.4 + idx * 3.1, idx * 1.7)) * 2.0 - 1.0;
  float jag2 = fbm(vec2(relN * 38.0 + t * 2.0 + idx, idx + 11.0)) * 2.0 - 1.0;
  float jag = (jag1 * 0.72 + jag2 * 0.28) * u_radius * (0.06 + siteHash(idx + 3.0) * 0.05);

  float coreW = u_radius * (0.012 + 0.008 * (1.0 - relN / max(reach, 0.01)));
  float dBolt = abs(perp - jag);
  float core = exp(-pow(dBolt / coreW, 2.0));
  float glow = exp(-pow(dBolt / (coreW * 5.0), 2.0));

  // Fork branch
  float forkAt = 0.25 + siteHash(idx + 9.0) * 0.35;
  float forkSign = siteHash(idx + 11.0) > 0.5 ? 1.0 : -1.0;
  float forkMask = exp(-pow((relN - forkAt) / 0.08, 2.0));
  float forkJag = jag + forkSign * u_radius * 0.07 * forkMask;
  float forkD = abs(perp - forkJag);
  float fork = exp(-pow(forkD / (coreW * 1.4), 2.0)) * forkMask * smoothstep(forkAt, forkAt + 0.2, relN);

  float bolt = (core * 1.8 + glow * 0.55 + fork * 1.1) * angM * life * active;
  vec3 col = mix(boltTint, vec3(1.0, 0.98, 0.95), core * 0.85 + fork * 0.5);
  return col * bolt * (0.85 + u_turbulence * 0.45);
}

void main() {
  vec2 px = v_uv * u_resolution;
  px.y = u_resolution.y - px.y;
  vec2 delta = px - u_center;
  float dist = length(delta);
  float normDist = dist / max(u_radius, 1.0);

  if (u_intel < 0.5) {
    float edge = smoothstep(u_radius * 1.06, u_radius * 0.7, dist);
    vec3 fog = mix(vec3(0.31, 0.34, 0.41), vec3(0.14, 0.16, 0.23), normDist);
    float alpha = edge * 0.85;
    if (alpha < 0.01) discard;
    fragColor = vec4(fog, alpha);
    return;
  }

  float pulse = 0.5 + 0.5 * sin(u_time * u_pulseSpeed * 4.0);
  float anim = u_time * 0.0018;
  float spin = u_time * u_rotationSpeed * 28.0;
  float outerSpin = u_time * u_rotationSpeed * 42.0;

  if (u_mode == 1) {
    float glowR = u_radius * u_glowScale * 0.72;
    float coronaFalloff = 1.0 - smoothstep(u_radius * 0.55, glowR, dist);
    coronaFalloff *= (0.82 + 0.18 * pulse) * u_coronaIntensity * 0.55;
    float disk = 1.0 - smoothstep(u_radius * 0.88, u_radius * 1.02, dist);
    vec3 body = mix(u_secondary, u_color, 0.55);
    vec3 hot = mix(body, mix(u_corona, vec3(1.0, 0.97, 0.9), 0.35), pow(max(0.0, 1.0 - normDist), 1.6));
    vec3 coronaCol = mix(u_corona, u_secondary, 0.35);
    vec3 col = hot * disk + coronaCol * coronaFalloff * 0.38;
    float alpha = max(disk * 0.95, coronaFalloff * 0.42);
    if (alpha < 0.005) discard;
    fragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    return;
  }

  float angle = atan(delta.y, delta.x);
  mat2 rotMat = mat2(cos(spin), -sin(spin), sin(spin), cos(spin));

  float coronaR = u_radius * u_glowScale;
  vec2 coronaUV = rotMat * delta / u_radius;
  vec2 coronaFlow = coronaUV + vec2(anim * 0.12, anim * 0.08);
  float coronaNoise = fbm(coronaFlow * (2.0 + u_turbulence * 1.5) + u_seed * 0.001, 3);
  float coronaFalloff = 1.0 - smoothstep(u_radius * 0.78, coronaR, dist);
  coronaFalloff *= 0.72 + 0.28 * coronaNoise;
  coronaFalloff *= (0.88 + 0.12 * pulse) * u_coronaIntensity;

  vec3 coronaCol = mix(u_corona, u_secondary, coronaNoise * 0.35 + 0.25);
  vec3 bloomOut = coronaCol * coronaFalloff * 0.12;

  float outerMask = smoothstep(u_radius * 0.92, u_radius * 1.04, dist);
  float boltTime = anim;
  vec3 boltTint = mix(mix(u_secondary, u_corona, 0.45), vec3(0.82, 0.9, 1.0), u_temperature);
  vec3 plasmaHot = mix(u_corona, mix(u_color, vec3(1.0, 0.94, 0.82), 0.5), 0.6);
  vec3 plasmaWarm = mix(u_secondary, u_corona, 0.45);
  vec3 flareCol = vec3(0.0);

  // Lightning — all stars
  if (hasFeature(128)) {
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float sAngle = siteHash(fi) * 6.2831853 + outerSpin * 0.03;
      flareCol += lightningStrike(delta, angle, sAngle, fi, boltTime, boltTint);
    }
  }

  if (hasFeature(64)) {
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float pAngle = siteHash(fi + 30.0) * 6.2831853 + outerSpin * 0.1;
      float arch = prominenceArch(normDist, angle, pAngle, fi + 10.0, boltTime);
      flareCol += mix(plasmaWarm, plasmaHot, 0.55) * arch * 1.35;
    }
  }

  vec3 starCol = vec3(0.0);
  float coreAlpha = 0.0;

  // Limb ripple — living edge
  float limbRipple = 1.0 + 0.01 * sin(angle * 5.0 + anim * 1.2)
                        + 0.006 * sin(angle * 9.0 - anim * 0.9);
  float effectiveR = u_radius * limbRipple;

  if (dist < effectiveR * 1.06) {
    vec2 surfUV = rotMat * delta / u_radius;
    vec2 flow = surfUV * 6.0 + vec2(anim * 0.16, anim * 0.11);

    float mu = sqrt(max(0.0, 1.0 - normDist * normDist));
    float limb = pow(mu, 0.28);

    float gran = 0.0;
    float granBright = 0.0;
    if (hasFeature(1)) {
      float coarse = fbm(flow + u_seed * 0.001, 4);
      float fine = fbm(flow * 2.4 + vec2(anim * 0.2, 0.0) + u_seed * 0.002, 5);
      float cells = smoothstep(-0.05, 0.35, coarse) * smoothstep(0.95, 0.45, fine);
      gran = coarse * 0.18 + fine * 0.12;
      granBright = cells * (0.65 + 0.35 * sin(anim * 1.5 + coarse * 8.0));
    }

    float spotDark = 0.0;
    if (hasFeature(2)) {
      vec2 spotUV = surfUV + vec2(anim * 0.03, anim * 0.02);
      float spots = fbm(spotUV * 2.8 + vec2(u_seed * 0.003, 0.0), 3);
      spotDark = smoothstep(0.38, 0.55, spots) * 0.32;
    }

    vec3 centerHot = mix(u_color, vec3(1.0, 0.98, 0.92), u_temperature * 0.45 + gran * 0.5);
    vec3 edgeCool = mix(u_secondary * 0.9, u_color, 0.4);
    vec3 hot = mix(edgeCool, centerHot, limb) * (1.0 - spotDark);
    hot += vec3(1.0, 0.94, 0.82) * granBright * 0.22;

    // Convection shimmer
    float shimmer = sin(dot(surfUV, vec2(4.0, 3.0)) + anim * 1.6) * 0.035;
    hot *= 1.0 + shimmer;

    float coreSize = hasFeature(32) ? 0.24 : 0.38;
    float core = pow(mu, 1.0 / coreSize);
    starCol = mix(hot, vec3(1.0, 0.99, 0.94), core * (0.58 + u_temperature * 0.22));

    if (hasFeature(128)) {
      for (int a = 0; a < 3; a++) {
        float ai = float(a);
        float aAngle = siteHash(ai + 40.0) * 6.2831853 + outerSpin * 0.02;
        float nearLimb = smoothstep(0.55, 0.95, normDist) * siteArc(angle, aAngle, 0.16);
        float flicker = 0.5 + 0.5 * sin(boltTime * 2.0 + ai * 2.1);
        starCol += boltTint * nearLimb * flicker * 0.15;
      }
    }

    coreAlpha = 1.0 - smoothstep(effectiveR * 0.94, effectiveR * 1.01, dist);
  }

  if (hasFeature(16)) {
    float phase = fract(u_time * 0.0009 + u_seed * 0.00001);
    if (phase < 0.1) {
      float intensity = 1.0 - phase / 0.1;
      bloomOut += vec3(1.0) * intensity * 0.75;
      starCol += vec3(1.0) * intensity * 0.35;
    }
  }

  if (hasFeature(4) && u_lensStrength > 0.0) {
    float spike = pow(abs(sin(angle * 4.0 + outerSpin * 0.08)), 10.0) * u_lensStrength;
    spike += pow(abs(cos(angle * 4.0 - outerSpin * 0.05)), 14.0) * u_lensStrength * 0.5;
    float spikeFalloff = 1.0 - smoothstep(u_radius * 0.5, coronaR * 2.2, dist);
    bloomOut += u_corona * spike * spikeFalloff * 0.55;
  }

  float outerActivity = outerMask * length(bloomOut + flareCol);
  vec3 outerCol = min(bloomOut + flareCol, vec3(3.0));
  float outerAlpha = clamp(length(bloomOut + flareCol) * 0.65, 0.0, 1.0);

  if (u_pass == 1) {
    if (coreAlpha < 0.005 && length(starCol) < 0.005) discard;
    fragColor = vec4(starCol, clamp(coreAlpha, 0.0, 1.0));
    return;
  }

  if (u_pass == 2) {
    if (outerAlpha < 0.004 && length(outerCol) < 0.004) discard;
    fragColor = vec4(outerCol, clamp(outerAlpha, 0.0, 1.0));
    return;
  }

  vec3 finalCol = starCol + outerCol;
  float alpha = max(coreAlpha, outerAlpha);
  if (alpha < 0.005 && length(finalCol) < 0.005) discard;
  fragColor = vec4(finalCol, clamp(alpha + coronaFalloff * 0.2, 0.0, 1.0));
}
