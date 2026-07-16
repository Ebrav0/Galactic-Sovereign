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
uniform float u_exposure;
uniform float u_chromatic;
uniform float u_intel;
uniform int u_mode; // 0=system, 1=galaxy
uniform int u_features;
uniform int u_pass; // 0=full, 1=core, 2=outer
uniform float u_quality; // low=.25, medium=.55, high=1

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

float flarePulse(float phase) {
  float strike = smoothstep(0.0, 0.06, phase) * (1.0 - smoothstep(0.08, 0.38, phase));
  float ember = smoothstep(0.38, 0.44, phase) * (1.0 - smoothstep(0.44, 0.82, phase)) * 0.32;
  return max(strike, ember);
}

float sunspotField(vec2 surfUV, float t) {
  float shade = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float lat = mix(-0.52, 0.52, siteHash(fi + 210.0));
    float lon = siteHash(fi + 230.0) * 6.2831853 + t * (0.18 + siteHash(fi + 250.0) * 0.08);
    float band = sqrt(max(0.0, 1.0 - lat * lat));
    vec2 site = vec2(cos(lon) * band, lat);
    float visible = smoothstep(1.02, 0.78, length(site));
    vec2 d = surfUV - site;
    float rot = lon * 0.7 + fi;
    mat2 m = mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
    d = m * d;
    float scale = 0.075 + siteHash(fi + 270.0) * 0.07;
    float ellipse = length(d / vec2(scale * 1.45, scale));
    float umbra = exp(-ellipse * ellipse * 3.4);
    float penumbra = exp(-ellipse * ellipse * 0.95);
    shade = max(shade, (penumbra * 0.34 + umbra * 0.46) * visible);
  }
  return shade;
}

vec3 solarFlareJet(vec2 delta, float angle, float siteAngle, float idx, float t, vec3 hotTint) {
  vec2 dir = vec2(cos(siteAngle), sin(siteAngle));
  vec2 tangent = vec2(-dir.y, dir.x);
  float along = dot(delta, dir);
  float perp = dot(delta, tangent);
  float rel = (along - u_radius * 0.93) / max(u_radius, 1.0);
  if (rel < -0.02) return vec3(0.0);

  float reach = 0.44 + siteHash(idx + 310.0) * 0.62;
  if (rel > reach) return vec3(0.0);

  float phase = fract(t * (0.12 + siteHash(idx + 330.0) * 0.18) + siteHash(idx + 350.0));
  float pulse = flarePulse(phase);
  float simmer = (0.15 + 0.1 * siteHash(idx + 370.0)) * (0.5 + 0.5 * sin(t * 0.9 + idx * 2.7));
  float activity = max(pulse, simmer);

  float curve = sin(rel * (4.8 + siteHash(idx + 390.0) * 3.0) + t * 1.1 + idx) * u_radius * 0.1 * max(rel, 0.0);
  float ribbonW = u_radius * (0.045 + rel * 0.06 + siteHash(idx + 410.0) * 0.026);
  float dRibbon = abs(perp - curve);
  float core = exp(-pow(dRibbon / max(ribbonW * 0.28, 0.001), 2.0));
  float veil = exp(-pow(dRibbon / max(ribbonW, 0.001), 2.0));
  float taper = pow(max(0.0, 1.0 - rel / reach), 0.72);
  float base = smoothstep(-0.02, 0.08, rel);
  float fan = smoothstep(0.0, 0.38, rel) * (1.0 - smoothstep(reach * 0.55, reach, rel));
  float angular = exp(-pow(angleDiff(angle, siteAngle) / (0.18 + rel * 0.44), 2.0));

  vec3 whiteHot = vec3(1.0, 0.96, 0.84);
  vec3 ember = mix(hotTint, vec3(1.0, 0.32, 0.16), 0.34);
  vec3 coreCol = mix(ember, whiteHot, clamp(core * 0.34 + pulse * 0.12, 0.0, 0.62));
  vec3 veilCol = mix(ember, hotTint, 0.35);
  return (coreCol * core * 1.75 + veilCol * veil * 1.64 + ember * fan * 0.48)
    * taper * base * angular * activity * 1.35;
}

// Ember particle swarm — sparks spiraling off the star on the solar wind.
vec3 emberParticles(vec2 delta, float dist, float t, vec3 warmTint) {
  if (dist > u_radius * 3.4 || dist < u_radius * 0.92) return vec3(0.0);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 40; i++) {
    float fi = float(i);
    if (fi >= mix(12.0, 40.0, u_quality)) break;
    float h1 = siteHash(fi + 50.0);
    float h2 = siteHash(fi + 90.0);
    float h3 = siteHash(fi + 130.0);
    float speed = 0.05 + h2 * 0.12;
    float cycle = fract(t * speed + h1 * 7.0);
    float pr = u_radius * mix(1.02, 3.1, pow(cycle, 0.8));
    float dir = h2 > 0.5 ? 1.0 : -1.0;
    float pa = h1 * 6.2831853 + t * (0.12 + h3 * 0.3) * dir + cycle * 1.6 * dir;
    vec2 pp = vec2(cos(pa), sin(pa)) * pr;
    float d = length(delta - pp);
    float size = u_radius * (0.009 + h3 * 0.016) * (1.0 + cycle * 1.2);
    float fade = (1.0 - cycle) * smoothstep(0.0, 0.12, cycle);
    float flick = 0.6 + 0.4 * sin(t * (5.0 + h2 * 8.0) + fi * 2.7);
    float g = exp(-(d * d) / max(size * size * 2.0, 0.0001));
    acc += mix(u_corona, warmTint, h3) * g * fade * flick;
  }
  return acc * (0.85 + u_turbulence * 0.55);
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
  float strikeOn = smoothstep(0.0, 0.08, strike) * (1.0 - smoothstep(0.08, 0.38, strike));
  strikeOn = max(strikeOn, 0.25 + 0.75 * step(0.72, strike) * (1.0 - smoothstep(0.72, 0.92, strike)));

  // Jagged bolt path
  float jag1 = fbm(vec2(relN * 20.0 - t * 1.4 + idx * 3.1, idx * 1.7), 3) * 2.0 - 1.0;
  float jag2 = fbm(vec2(relN * 38.0 + t * 2.0 + idx, idx + 11.0), 3) * 2.0 - 1.0;
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

  float bolt = (core * 1.8 + glow * 0.55 + fork * 1.1) * angM * life * strikeOn;
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
  float angle = atan(delta.y, delta.x);

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
    // Compact optical fingerprint: every catalog class is recognizable on a
    // discovered galaxy node, not just in the full system close-up.
    float ray = pow(abs(cos(angle * 2.0 + spin * 0.35)), 32.0)
      + pow(abs(sin(angle * 2.0 - spin * 0.2)), 44.0) * 0.55;
    float rayFalloff = (1.0 - smoothstep(u_radius * 0.35, glowR * 1.6, dist))
      * smoothstep(u_radius * 0.72, u_radius * 0.98, dist);
    vec3 spectral = mix(coronaCol, vec3(0.64, 0.82, 1.0), clamp(u_chromatic * 0.16, 0.0, 0.38));
    col += spectral * ray * rayFalloff * (0.14 + u_chromatic * 0.08);
    alpha = max(alpha, ray * rayFalloff * 0.32);
    col *= u_exposure;
    if (alpha < 0.005) discard;
    fragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    return;
  }

  mat2 rotMat = mat2(cos(spin), -sin(spin), sin(spin), cos(spin));

  float coronaR = u_radius * u_glowScale;
  vec2 coronaUV = rotMat * delta / u_radius;
  vec2 coronaFlow = coronaUV + vec2(anim * 0.12, anim * 0.08);
  float coronaNoise = fbm(coronaFlow * (2.0 + u_turbulence * 1.5) + u_seed * 0.001, 3);
  float coronaFalloff = 1.0 - smoothstep(u_radius * 0.78, coronaR, dist);
  coronaFalloff *= 0.72 + 0.28 * coronaNoise;
  coronaFalloff *= (0.88 + 0.12 * pulse) * u_coronaIntensity;

  vec3 coronaCol = mix(u_corona, u_secondary, coronaNoise * 0.35 + 0.25);
  vec3 bloomOut = coronaCol * coronaFalloff * 0.2;

  // Rotating coronal streamers — long seamless rays sweeping the corona.
  {
    float s1 = pow(0.5 + 0.5 * sin(angle * 7.0 + outerSpin * 5.0), 3.5);
    float s2 = pow(0.5 + 0.5 * sin(angle * 11.0 - outerSpin * 8.0 + 2.1), 5.0);
    float s3 = pow(0.5 + 0.5 * sin(angle * 4.0 + outerSpin * 3.0 + 4.4), 2.5);
    float streamer = s1 * 0.55 + s2 * 0.4 + s3 * 0.45;
    float reach = 1.0 - smoothstep(u_radius * 1.05, coronaR * 1.75, dist);
    float outside = smoothstep(u_radius * 0.96, u_radius * 1.12, dist);
    streamer *= reach * outside * (0.7 + 0.3 * coronaNoise);
    bloomOut += coronaCol * streamer * (0.42 + 0.3 * u_coronaIntensity);
  }

  // Solar wind shimmer — fine turbulent wisps drifting off the limb.
  {
    float wisp = fbm(coronaUV * 5.5 + vec2(-anim * 0.5, anim * 0.3) + u_seed * 0.002, 4);
    float band = smoothstep(u_radius * 1.0, u_radius * 1.25, dist)
               * (1.0 - smoothstep(u_radius * 1.3, coronaR * 1.4, dist));
    bloomOut += mix(u_secondary, u_corona, 0.6) * max(0.0, wisp) * band * 0.28;
  }

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

  // Ember particle swarm riding the solar wind.
  flareCol += emberParticles(delta, dist, boltTime, plasmaHot);

  if (hasFeature(64)) {
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float pAngle = siteHash(fi + 30.0) * 6.2831853 + outerSpin * 0.1;
      float arch = prominenceArch(normDist, angle, pAngle, fi + 10.0, boltTime);
      flareCol += mix(plasmaWarm, plasmaHot, 0.55) * arch * 1.35;
    }
  }

  if (hasFeature(16)) {
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float fAngle = siteHash(fi + 300.0) * 6.2831853 + outerSpin * (0.025 + siteHash(fi + 301.0) * 0.035);
      flareCol += solarFlareJet(delta, angle, fAngle, fi + 40.0, boltTime, plasmaHot) * (1.0 + u_turbulence * 0.55);
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
    float limb = pow(mu, 0.35);

    float gran = 0.0;
    float granBright = 0.0;
    float granDark = 0.0;
    if (hasFeature(1)) {
      float coarse = fbm(flow + u_seed * 0.001, 4);
      float fine = fbm(flow * 2.4 + vec2(anim * 0.2, 0.0) + u_seed * 0.002, 5);
      float micro = fbm(flow * 7.8 + vec2(-anim * 0.28, anim * 0.19) + u_seed * 0.004, 4);
      float laneNet = 1.0 - smoothstep(0.08, 0.36, abs(coarse - fine * 0.72));
      float cells = smoothstep(-0.12, 0.42, coarse + fine * 0.35) * smoothstep(0.92, 0.34, micro);
      float faculae = smoothstep(0.58, 0.96, normDist) * smoothstep(0.18, 0.58, coarse + micro * 0.3);
      gran = coarse * 0.24 + fine * 0.16 + micro * 0.08;
      granBright = (cells * 0.82 + faculae * 0.55) * (0.72 + 0.28 * sin(anim * 1.5 + coarse * 8.0));
      // Dark intergranular lanes give the surface convection-cell depth.
      granDark = max(smoothstep(0.15, -0.35, coarse + fine * 0.5) * 0.34, laneNet * 0.2);
    }

    float spotDark = 0.0;
    if (hasFeature(2)) {
      vec2 spotUV = surfUV + vec2(anim * 0.03, anim * 0.02);
      float spots = fbm(spotUV * 2.8 + vec2(u_seed * 0.003, 0.0), 3);
      spotDark = sunspotField(surfUV, anim) + smoothstep(0.42, 0.62, spots) * 0.12;
    }

    vec3 centerHot = mix(u_color, vec3(1.0, 0.98, 0.92), u_temperature * 0.45 + gran * 0.5);
    vec3 edgeCool = mix(u_secondary * 0.62, u_color * 0.85, 0.4);
    vec3 hot = mix(edgeCool, centerHot, limb) * (1.0 - spotDark);
    hot *= 1.0 - granDark;
    hot += vec3(1.0, 0.94, 0.82) * granBright * 0.3;

    // Convection shimmer
    float shimmer = sin(dot(surfUV, vec2(4.0, 3.0)) + anim * 1.6) * 0.035;
    hot *= 1.0 + shimmer;

    float coreSize = hasFeature(32) ? 0.24 : 0.38;
    float core = pow(mu, 1.0 / coreSize);
    starCol = mix(hot, vec3(1.0, 0.99, 0.94), core * (0.42 + u_temperature * 0.2));

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

  if (hasFeature(4) && u_lensStrength > 0.0) {
    float spike = pow(abs(sin(angle * 4.0 + outerSpin * 0.08)), 10.0) * u_lensStrength;
    spike += pow(abs(cos(angle * 4.0 - outerSpin * 0.05)), 14.0) * u_lensStrength * 0.5;
    float spikeFalloff = 1.0 - smoothstep(u_radius * 0.5, coronaR * 2.2, dist);
    bloomOut += u_corona * spike * spikeFalloff * 0.55;
  }

  // Cinematic camera optics shared by the legacy catalog. The class metadata
  // controls exposure and spectral separation so even the protected home star
  // receives a visible presentation upgrade without changing its mechanics.
  {
    float opticSpin = outerSpin * 0.035 + u_seed * 0.0007;
    float crossRay = pow(abs(cos(angle * 2.0 + opticSpin)), 34.0);
    float diagonalRay = pow(abs(sin(angle * 3.0 - opticSpin * 0.7)), 54.0) * 0.42;
    float rayFalloff = (1.0 - smoothstep(u_radius * 0.62, coronaR * 1.72, dist))
      * smoothstep(u_radius * 0.78, u_radius * 1.02, dist);
    float spectralPhase = 0.5 + 0.5 * sin(angle * 2.0 + opticSpin);
    vec3 spectralA = mix(u_corona, vec3(0.48, 0.78, 1.0), clamp(u_chromatic * 0.2, 0.0, 0.46));
    vec3 spectralB = mix(u_secondary, vec3(1.0, 0.42, 0.22), clamp(u_chromatic * 0.14, 0.0, 0.34));
    vec3 spectral = mix(spectralA, spectralB, spectralPhase);
    float opticStrength = (0.32 + u_chromatic * 0.15) * (0.72 + u_temperature * 0.32);
    bloomOut += spectral * (crossRay + diagonalRay) * rayFalloff * opticStrength;

    float haloRadius = 1.3 + 0.055 * sin(anim * 0.7 + u_seed);
    float spectralHalo = exp(-pow((normDist - haloRadius) / 0.026, 2.0));
    spectralHalo *= 0.58 + 0.42 * sin(angle * 5.0 - opticSpin * 4.0);
    bloomOut += mix(spectralA, spectralB, 0.36) * spectralHalo * (0.12 + u_chromatic * 0.045);
  }

  float outerActivity = outerMask * length(bloomOut + flareCol);
  vec3 outerCol = min(bloomOut + flareCol, vec3(3.0)) * u_exposure;
  float outerAlpha = clamp(length(bloomOut + flareCol) * 0.65, 0.0, 1.0);
  vec3 exposedStar = starCol * u_exposure;

  if (u_pass == 1) {
    if (coreAlpha < 0.005 && length(exposedStar) < 0.005) discard;
    fragColor = vec4(exposedStar, clamp(coreAlpha, 0.0, 1.0));
    return;
  }

  if (u_pass == 2) {
    if (outerAlpha < 0.004 && length(outerCol) < 0.004) discard;
    fragColor = vec4(outerCol, clamp(outerAlpha, 0.0, 1.0));
    return;
  }

  vec3 finalCol = exposedStar + outerCol;
  float alpha = max(coreAlpha, outerAlpha);
  if (alpha < 0.005 && length(finalCol) < 0.005) discard;
  fragColor = vec4(finalCol, clamp(alpha + coronaFalloff * 0.2, 0.0, 1.0));
}
