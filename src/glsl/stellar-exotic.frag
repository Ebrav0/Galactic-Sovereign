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
uniform vec3 u_companionColor;
uniform float u_separation;
uniform float u_companionScale;
uniform float u_axisCompression;
uniform float u_orbitSpeed;
uniform float u_orbitPhase;
uniform float u_exposure;
uniform float u_chromatic;
uniform float u_intel;
uniform int u_kind; // 0=convective, 1=binary, 2=supergiant, 3=pulsar, 4=quasar,
                    // 5=hot, 6=compact, 7=flare, 8=giant, 9=brown dwarf,
                    // 10=neutron, 11=magnetar, 12=Wolf-Rayet, 13=hypergiant,
                    // 14=black-hole binary
uniform int u_mode; // 0=system, 1=galaxy
uniform int u_pass; // 0=full, 1=core, 2=outer
uniform float u_quality;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + u_seed * 0.017) * 43758.5453123);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.52;
  for (int i = 0; i < 5; i++) {
    v += a * noise2(p);
    p = p * 2.07 + vec2(13.1, 7.7);
    a *= 0.5;
  }
  return v;
}

float gauss(float x, float w) {
  return exp(-(x * x) / max(w * w, 0.00001));
}

void addSphere(vec2 p, float radius, vec3 warm, vec3 cool, float t,
  inout vec3 coreCol, inout float coreAlpha, inout vec3 outerCol, inout float outerAlpha) {
  float d = length(p);
  float n = fbm(p / max(radius, 1.0) * 4.8 + vec2(t * 0.06, -t * 0.04));
  float disk = 1.0 - smoothstep(radius * 0.92, radius * 1.02, d);
  float limb = pow(max(0.0, 1.0 - d / radius), 0.28);
  vec3 surface = mix(cool, warm, clamp(n * 0.9 + limb * 0.55, 0.0, 1.0));
  surface += vec3(1.0, 0.95, 0.86) * pow(limb, 3.2) * 0.38;
  coreCol += surface * disk;
  coreAlpha = max(coreAlpha, disk);

  float halo = (1.0 - smoothstep(radius * 0.92, radius * 2.45, d)) * (1.0 - disk);
  float rays = pow(0.5 + 0.5 * sin(atan(p.y, p.x) * 9.0 + t * 0.8), 5.0);
  outerCol += mix(cool, warm, 0.45) * halo * (0.35 + rays * 0.45);
  outerAlpha = max(outerAlpha, halo * 0.55);
}

void main() {
  vec2 px = v_uv * u_resolution;
  px.y = u_resolution.y - px.y;
  vec2 p = px - u_center;
  float d = length(p);
  float a = atan(p.y, p.x);
  float t = u_time * 0.001;

  if (u_intel < 0.5) {
    float silhouette = 0.0;
    float outerSilhouette = 0.0;
    if (u_kind == 0 || u_kind == 5 || u_kind == 6 || u_kind == 7 || u_kind == 9 || u_kind == 12) {
      float baseR = u_radius * (u_kind == 6 ? 0.58 : u_kind == 7 ? 0.9 : u_kind == 9 ? 0.82 : 1.0);
      silhouette = 1.0 - smoothstep(baseR * 0.9, baseR * 1.04, d);
      if (u_kind == 5) {
        float rays = pow(abs(cos(a * 2.0 + t * 0.08)), 44.0);
        outerSilhouette = rays * (1.0 - smoothstep(baseR * 0.7, baseR * 3.4, d)) * 0.34;
      } else if (u_kind == 6) {
        outerSilhouette = gauss(d - u_radius * 0.92, u_radius * 0.05) * 0.52;
      } else if (u_kind == 7 || u_kind == 12) {
        float eruptions = pow(0.5 + 0.5 * sin(a * 6.0 - t * 0.9), 12.0);
        outerSilhouette = eruptions * smoothstep(baseR * 0.82, baseR, d)
          * (1.0 - smoothstep(baseR, baseR * 2.5, d)) * 0.48;
      }
    } else if (u_kind == 10 || u_kind == 11) {
      float coreR = u_radius * 0.28;
      silhouette = 1.0 - smoothstep(coreR * 0.76, coreR, d);
      float rings = gauss(d - u_radius * 0.82, u_radius * 0.05);
      float loops = gauss(length(vec2(p.x, p.y * 2.8)) - u_radius * 1.25, u_radius * 0.07);
      outerSilhouette = max(rings, loops * (u_kind == 11 ? 1.4 : 0.7)) * 0.55;
    } else if (u_kind == 1) {
      float phase = t * u_orbitSpeed + u_orbitPhase;
      float sep = u_radius * u_separation * (u_mode == 1 ? 0.74 : 1.0);
      vec2 axis = vec2(cos(phase), sin(phase) * u_axisCompression);
      vec2 c1 = axis * sep * 0.48;
      vec2 c2 = -axis * sep * 0.62;
      float r1 = u_radius * (u_mode == 1 ? 0.72 : 0.67);
      float r2 = r1 * u_companionScale;
      silhouette = max(1.0 - smoothstep(r1 * 0.9, r1 * 1.06, length(p - c1)),
        1.0 - smoothstep(r2 * 0.9, r2 * 1.06, length(p - c2)));
      float bridge = gauss(abs(dot(p, vec2(-axis.y, axis.x))), u_radius * 0.08)
        * (1.0 - smoothstep(sep * 0.3, sep * 1.45, abs(dot(p, axis))));
      outerSilhouette = bridge * 0.38;
    } else if (u_kind == 2 || u_kind == 8 || u_kind == 13) {
      float edgeNoise;
      if (u_mode == 1) {
        edgeNoise = 0.5 + 0.32 * sin(a * 5.0 + t * 0.08 + u_seed)
          + 0.18 * sin(a * 11.0 - t * 0.05);
      } else {
        edgeNoise = fbm(vec2(cos(a), sin(a)) * 3.1 + vec2(t * 0.018, -t * 0.012));
      }
      float edgeR = u_radius * (u_kind == 13 ? (0.82 + edgeNoise * 0.3) : u_kind == 2 ? (0.86 + edgeNoise * 0.22) : (0.91 + edgeNoise * 0.12));
      silhouette = 1.0 - smoothstep(edgeR * 0.94, edgeR * 1.025, d);
      float dustyLimb = (1.0 - smoothstep(edgeR, u_radius * 1.62, d)) * (1.0 - silhouette);
      outerSilhouette = dustyLimb * (0.18 + 0.2 * pow(0.5 + 0.5 * sin(a * 5.0 - t * 0.2), 4.0));
    } else if (u_kind == 3) {
      float coreR = u_radius * (u_mode == 1 ? 0.38 : 0.3);
      silhouette = 1.0 - smoothstep(coreR * 0.78, coreR, d);
      float ring = gauss(d - u_radius * 0.8, u_radius * 0.055)
        + gauss(length(vec2(p.x, p.y * 2.8)) - u_radius * 1.16, u_radius * 0.07);
      float spin = t * 6.0 + u_orbitPhase;
      vec2 beamDir = normalize(vec2(cos(spin), sin(spin) * 0.52));
      float beam = gauss(abs(dot(p, vec2(-beamDir.y, beamDir.x))), u_radius * 0.045)
        * (1.0 - smoothstep(u_radius * 0.2, u_radius * (u_mode == 1 ? 3.2 : 5.5), abs(dot(p, beamDir))));
      outerSilhouette = max(ring * 0.55, beam * 0.32);
    } else if (u_kind == 14) {
      float phase = t * u_orbitSpeed + u_orbitPhase;
      vec2 donor = vec2(cos(phase), sin(phase) * 0.48) * u_radius * 1.25;
      float donorR = u_radius * 0.48;
      silhouette = 1.0 - smoothstep(donorR * 0.9, donorR * 1.04, length(p - donor));
      float diskD = length(vec2(p.x, p.y * 3.0));
      float disk = smoothstep(u_radius * 0.35, u_radius * 0.52, diskD)
        * (1.0 - smoothstep(u_radius * 1.45, u_radius * 2.2, diskD));
      silhouette = max(silhouette, disk * 0.75);
      outerSilhouette = gauss(p.x, u_radius * 0.08) * (1.0 - smoothstep(u_radius, u_radius * 5.0, abs(p.y))) * 0.38;
    } else {
      float diskD = length(vec2(p.x, p.y * (u_mode == 1 ? 2.2 : 3.4)));
      float disk = smoothstep(u_radius * 0.42, u_radius * 0.58, diskD)
        * (1.0 - smoothstep(u_radius * (u_mode == 1 ? 1.65 : 2.8), u_radius * (u_mode == 1 ? 2.2 : 3.6), diskD));
      float horizon = 1.0 - smoothstep(u_radius * 0.43, u_radius * 0.6, d);
      silhouette = max(disk * 0.72, horizon);
      float jets = gauss(p.x, u_radius * 0.075)
        * smoothstep(u_radius * 0.28, u_radius * 0.7, abs(p.y))
        * (1.0 - smoothstep(u_radius * 2.4, u_radius * (u_mode == 1 ? 4.0 : 6.5), abs(p.y)));
      outerSilhouette = jets * 0.38;
    }
    if (u_pass == 2) {
      if (outerSilhouette < 0.01) discard;
      fragColor = vec4(vec3(0.22, 0.25, 0.34) * outerSilhouette, outerSilhouette * 0.72);
      return;
    }
    if (silhouette < 0.01) discard;
    vec3 fog = mix(vec3(0.13, 0.15, 0.22), vec3(0.29, 0.32, 0.42), silhouette);
    fragColor = vec4(fog * silhouette, silhouette * 0.86);
    return;
  }

  vec3 coreCol = vec3(0.0);
  vec3 outerCol = vec3(0.0);
  float coreAlpha = 0.0;
  float outerAlpha = 0.0;

  if (u_kind == 0) {
    addSphere(p, u_radius, mix(u_color, vec3(1.0, 0.96, 0.84), 0.18), u_secondary,
      t, coreCol, coreAlpha, outerCol, outerAlpha);
    float diskMask = 1.0 - smoothstep(u_radius * 0.9, u_radius * 1.02, d);
    float convection = fbm(p / max(u_radius, 1.0) * 7.2 + vec2(t * 0.08, -t * 0.055));
    float fineCells = fbm(p / max(u_radius, 1.0) * 16.0 - vec2(t * 0.13, t * 0.07));
    coreCol *= 1.0 + diskMask * ((convection - 0.52) * 0.7 + (fineCells - 0.5) * 0.22);
    coreCol += u_corona * diskMask * smoothstep(0.68, 0.92, convection) * 0.16;
    float halo = (1.0 - smoothstep(u_radius * 0.92, u_radius * 3.25, d))
      * smoothstep(u_radius * 0.82, u_radius * 1.04, d);
    float ribbons = pow(0.5 + 0.5 * sin(a * 7.0 - t * 0.42 + fbm(vec2(a * 1.5, d / u_radius)) * 3.0), 5.0);
    float arch = gauss(d - u_radius * (1.15 + 0.08 * sin(a * 4.0 + t * 0.28)), u_radius * 0.045);
    outerCol += mix(u_secondary, u_corona, 0.62) * halo * (0.28 + ribbons * 0.72);
    outerCol += mix(u_corona, vec3(1.0, 0.9, 0.72), 0.34) * arch * 0.7;
    outerAlpha = max(outerAlpha, max(halo * (0.24 + ribbons * 0.38), arch * 0.52));
  } else if (u_kind == 5) {
    addSphere(p, u_radius, mix(u_color, vec3(1.0), 0.24), mix(u_secondary, u_color, 0.32),
      t * 1.35, coreCol, coreAlpha, outerCol, outerAlpha);
    float hotDisk = 1.0 - smoothstep(u_radius * 0.9, u_radius * 1.02, d);
    float shear = fbm(vec2(p.x / max(u_radius, 1.0) * 9.0 - t * 0.22,
      p.y / max(u_radius, 1.0) * 3.4 + t * 0.08));
    coreCol *= 0.84 + hotDisk * shear * 0.34;
    float spike = pow(abs(cos(a * 2.0 + t * 0.09)), 52.0)
      + pow(abs(sin(a * 3.0 - t * 0.055)), 68.0) * 0.36;
    float spikeFade = (1.0 - smoothstep(u_radius * 0.45, u_radius * (u_mode == 1 ? 3.4 : 5.2), d));
    float wind = pow(0.5 + 0.5 * sin(a * 12.0 - t * 1.3 - d * 0.018), 7.0)
      * smoothstep(u_radius * 0.88, u_radius * 1.05, d)
      * (1.0 - smoothstep(u_radius * 1.2, u_radius * 3.4, d));
    outerCol += mix(u_corona, vec3(0.64, 0.84, 1.0), 0.48) * spike * spikeFade * 1.25;
    outerCol += mix(u_secondary, u_corona, 0.72) * wind * 0.82;
    outerAlpha = max(outerAlpha, max(spike * spikeFade * 0.65, wind * 0.58));
  } else if (u_kind == 6) {
    float compactR = u_radius * (u_mode == 1 ? 0.62 : 0.56);
    addSphere(p, compactR, mix(u_color, vec3(1.0), 0.72), u_secondary,
      t * 1.8, coreCol, coreAlpha, outerCol, outerAlpha);
    float ring1 = gauss(d - u_radius * 0.82, u_radius * 0.035);
    float ring2 = gauss(length(vec2(p.x, p.y * 2.25)) - u_radius * 1.18, u_radius * 0.045);
    float spike = pow(abs(cos(a * 2.0 + t * 0.18)), 58.0)
      * (1.0 - smoothstep(compactR * 0.6, u_radius * 3.8, d));
    outerCol += mix(u_corona, vec3(0.82, 0.92, 1.0), 0.58) * (ring1 * 1.1 + ring2 * 0.72 + spike * 0.92);
    outerAlpha = max(outerAlpha, max(max(ring1, ring2) * 0.74, spike * 0.56));
  } else if (u_kind == 7) {
    addSphere(p, u_radius * 0.9, mix(u_color, vec3(1.0, 0.82, 0.62), 0.24), u_secondary,
      t * 1.55, coreCol, coreAlpha, outerCol, outerAlpha);
    float radial = d / max(u_radius, 1.0);
    float plumeField = pow(0.5 + 0.5 * sin(a * 6.0 - t * 1.7 + fbm(vec2(a * 2.2, radial * 2.0)) * 4.0), 10.0);
    float plumes = plumeField * smoothstep(0.78, 0.98, radial) * (1.0 - smoothstep(1.0, 3.1, radial));
    float flareRing = gauss(radial - (1.04 + 0.08 * sin(a * 5.0 + t)), 0.045);
    outerCol += mix(u_secondary, u_corona, 0.62) * plumes * 1.45;
    outerCol += mix(u_corona, vec3(1.0, 0.8, 0.54), 0.55) * flareRing * 0.86;
    outerAlpha = max(outerAlpha, max(plumes * 0.72, flareRing * 0.58));
  } else if (u_kind == 9) {
    float r = u_radius * (u_mode == 1 ? 0.78 : 0.88);
    float disk = 1.0 - smoothstep(r * 0.92, r * 1.02, d);
    float limb = pow(max(0.0, 1.0 - d / r), 0.32);
    float bands = 0.5 + 0.5 * sin(p.y / max(r, 1.0) * 18.0 + fbm(p / r * 3.0) * 4.0 + t * 0.25);
    float storm = gauss(length((p - vec2(r * 0.28, -r * 0.14)) / vec2(1.8, 0.7)), r * 0.15);
    coreCol += mix(u_secondary * 0.55, u_color, bands * 0.75 + limb * 0.25) * disk;
    coreCol += u_corona * storm * disk * 0.4;
    coreAlpha = disk;
    float infrared = (1.0 - smoothstep(r * 0.9, r * 2.1, d)) * (1.0 - disk);
    outerCol += mix(u_secondary, u_corona, 0.38) * infrared * 0.34;
    outerAlpha = infrared * 0.32;
  } else if (u_kind == 10 || u_kind == 11) {
    float magnetar = u_kind == 11 ? 1.0 : 0.0;
    float coreR = u_radius * (u_mode == 1 ? 0.34 : 0.27);
    float core = 1.0 - smoothstep(coreR * 0.7, coreR, d);
    coreCol += mix(u_corona, vec3(1.0), 0.78) * core * (2.0 + magnetar * 0.55);
    coreAlpha = core;
    float ring = gauss(d - u_radius * 0.8, u_radius * 0.042);
    float lens = gauss(length(vec2(p.x, p.y * 3.1)) - u_radius * 1.18, u_radius * 0.052);
    float twist = gauss(length(vec2(p.x * 0.62, p.y * 2.5)) - u_radius * (1.35 + 0.12 * sin(a * 3.0 + t * 2.4)), u_radius * 0.055);
    float quake = magnetar * pow(0.5 + 0.5 * sin(a * 7.0 - t * 8.0), 22.0)
      * (1.0 - smoothstep(u_radius * 0.3, u_radius * 2.5, d));
    outerCol += mix(u_secondary, u_corona, 0.58) * (ring + lens * 0.68 + twist * magnetar * 1.2);
    outerCol += vec3(1.0, 0.92, 1.0) * quake * 1.8;
    outerAlpha = max(max(ring, lens) * 0.72, max(twist * magnetar * 0.7, quake * 0.82));
  } else if (u_kind == 12) {
    float coreR = u_radius * 0.68;
    addSphere(p, coreR, vec3(1.0), mix(u_color, u_secondary, 0.45), t * 1.7,
      coreCol, coreAlpha, outerCol, outerAlpha);
    float radial = d / max(u_radius, 1.0);
    float spiral = pow(0.5 + 0.5 * sin(a * 5.0 - radial * 8.0 - t * 2.2 + fbm(vec2(a * 2.0, radial * 2.0)) * 3.0), 5.0);
    float shell = smoothstep(0.55, 0.8, radial) * (1.0 - smoothstep(0.9, 4.4, radial));
    float spikes = pow(abs(cos(a * 2.0 + t * 0.12)), 54.0) * (1.0 - smoothstep(0.4, 5.2, radial));
    outerCol += mix(u_secondary, u_corona, 0.7) * shell * spiral * 1.25;
    outerCol += vec3(0.82, 0.94, 1.0) * spikes * 1.15;
    outerAlpha = max(outerAlpha, max(shell * spiral * 0.68, spikes * 0.55));
  } else if (u_kind == 1) {
    float phase = t * u_orbitSpeed + u_orbitPhase;
    float sep = u_radius * u_separation * (u_mode == 1 ? 0.74 : 1.0);
    vec2 axis = vec2(cos(phase), sin(phase) * u_axisCompression);
    vec2 c1 = axis * sep * 0.48;
    vec2 c2 = -axis * sep * 0.62;
    float r1 = u_radius * (u_mode == 1 ? 0.72 : 0.67);
    float r2 = r1 * u_companionScale;
    addSphere(p - c2, r2, mix(u_companionColor, vec3(1.0), 0.32), u_companionColor * 0.62,
      t + 5.0, coreCol, coreAlpha, outerCol, outerAlpha);
    addSphere(p - c1, r1, mix(u_color, vec3(1.0), 0.28), u_secondary,
      t, coreCol, coreAlpha, outerCol, outerAlpha);
    float bridge = gauss(abs(dot(p, vec2(-axis.y, axis.x))), u_radius * 0.12)
      * (1.0 - smoothstep(sep * 0.3, sep * 1.6, abs(dot(p, axis))));
    outerCol += mix(u_corona, u_companionColor, 0.5) * bridge * 0.55;
    outerAlpha = max(outerAlpha, bridge * 0.35);
  } else if (u_kind == 2 || u_kind == 8 || u_kind == 13) {
    float angular = fbm(vec2(cos(a), sin(a)) * 3.2 + vec2(t * 0.025, -t * 0.018));
    float hero = u_kind == 2 || u_kind == 13 ? 1.0 : 0.0;
    float hyper = u_kind == 13 ? 1.0 : 0.0;
    float edgeR = u_radius * mix(0.94 + angular * 0.09, 0.88 + angular * (0.16 + hyper * 0.12), hero);
    float disk = 1.0 - smoothstep(edgeR * 0.96, edgeR * 1.015, d);
    vec2 surf = p / max(u_radius, 1.0);
    float cells = fbm(surf * 3.0 + vec2(t * 0.022, t * 0.014));
    float fine = fbm(surf * 10.0 - vec2(t * 0.04, t * 0.03));
    float limb = pow(max(0.0, 1.0 - d / max(edgeR, 1.0)), 0.25);
    vec3 body = mix(u_secondary * 0.65, u_color, cells);
    body = mix(body, vec3(1.0, 0.92, 0.78), limb * limb + fine * 0.18);
    coreCol += body * disk * (1.05 + cells * 0.28);
    coreAlpha = disk;

    float halo = (1.0 - smoothstep(edgeR * 0.9, u_radius * mix(3.25, 3.9, hero), d)) * (1.0 - disk);
    float plume = pow(0.5 + 0.5 * sin(a * 5.0 - t * 0.32 + angular * 5.0), 4.0);
    float dust = fbm(vec2(a * 1.8 + cos(a) * 2.0, d / u_radius * 2.4 - t * 0.05));
    outerCol += mix(u_secondary, u_corona, plume) * halo * (0.3 + plume * 0.7) * (0.65 + dust * 0.5);
    outerAlpha = max(outerAlpha, halo * (0.28 + plume * 0.36));
    float lossShells = hyper * (gauss(d - u_radius * 1.45, u_radius * 0.045)
      + gauss(d - u_radius * 2.05, u_radius * 0.065) * 0.7);
    outerCol += mix(u_secondary, u_corona, 0.6) * lossShells * 0.7;
    outerAlpha = max(outerAlpha, lossShells * 0.55);
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      if (fi >= mix(2.0 + hero, 4.0 + hero * 2.0, u_quality)) break;
      float pa = fi * 1.047 + u_seed * 0.03 + sin(t * 0.12 + fi) * 0.18;
      vec2 dir = vec2(cos(pa), sin(pa));
      float along = dot(p, dir) - edgeR * 0.82;
      float across = abs(dot(p, vec2(-dir.y, dir.x)));
      float jet = smoothstep(-0.02 * u_radius, 0.12 * u_radius, along)
        * (1.0 - smoothstep(u_radius * 0.2, u_radius * 1.8, along))
        * gauss(across, u_radius * (0.05 + max(along, 0.0) / u_radius * 0.08));
      outerCol += mix(u_corona, vec3(1.0), 0.34) * jet * 0.9;
      outerAlpha = max(outerAlpha, jet * 0.55);
    }
  } else if (u_kind == 3) {
    float spin = t * 6.0 + u_orbitPhase;
    float coreR = u_radius * (u_mode == 1 ? 0.42 : 0.34);
    float core = 1.0 - smoothstep(coreR * 0.78, coreR, d);
    float hot = 1.0 - smoothstep(0.0, coreR, d);
    coreCol += mix(u_corona, vec3(1.0), pow(hot, 2.0)) * core * 2.0;
    coreAlpha = core;
    float ring1 = gauss(d - u_radius * 0.78, u_radius * 0.045);
    float ring2 = gauss(length(vec2(p.x, p.y * 2.8)) - u_radius * 1.18, u_radius * 0.06);
    outerCol += mix(u_secondary, u_corona, 0.55) * (ring1 * 0.8 + ring2 * 0.65);
    outerAlpha = max(outerAlpha, max(ring1, ring2) * 0.75);

    vec2 beamDir = normalize(vec2(cos(spin), sin(spin) * 0.52));
    float axial = abs(dot(p, vec2(-beamDir.y, beamDir.x)));
    float along = abs(dot(p, beamDir));
    float beam = gauss(axial, u_radius * 0.07) * (1.0 - smoothstep(u_radius * 0.2, u_radius * 6.8, along));
    float beamCore = gauss(axial, u_radius * 0.018) * (1.0 - smoothstep(u_radius * 0.1, u_radius * 6.2, along));
    outerCol += u_corona * beam * 0.75 + vec3(0.92, 0.98, 1.0) * beamCore * 1.65;
    outerAlpha = max(outerAlpha, beam * 0.58 + beamCore * 0.45);
  } else if (u_kind == 14) {
    float phase = t * u_orbitSpeed + u_orbitPhase;
    vec2 donor = vec2(cos(phase), sin(phase) * 0.48) * u_radius * 1.25;
    float donorR = u_radius * 0.48;
    addSphere(p - donor, donorR, mix(u_companionColor, vec3(1.0), 0.35), u_color,
      t * 1.2, coreCol, coreAlpha, outerCol, outerAlpha);
    float diskD = length(vec2(p.x, p.y * (u_mode == 1 ? 2.4 : 3.2)));
    float disk = smoothstep(u_radius * 0.32, u_radius * 0.5, diskD)
      * (1.0 - smoothstep(u_radius * 1.5, u_radius * 2.35, diskD));
    float doppler = 0.35 + 0.65 * pow(0.5 + 0.5 * p.x / max(d, 1.0), 2.0);
    coreCol += mix(u_secondary, vec3(1.0, 0.92, 0.78), doppler) * disk * (0.7 + doppler);
    coreAlpha = max(coreAlpha, disk * 0.92);
    float horizon = 1.0 - smoothstep(u_radius * 0.34, u_radius * 0.5, d);
    coreCol = mix(coreCol, vec3(0.001, 0.002, 0.008), horizon);
    coreAlpha = max(coreAlpha, horizon);
    float streamLine = abs(dot(p - donor * 0.5, normalize(donor)));
    float streamCross = abs(dot(p - donor * 0.5, vec2(-normalize(donor).y, normalize(donor).x)));
    float stream = gauss(streamCross, u_radius * 0.07) * (1.0 - smoothstep(0.0, length(donor) * 0.72, streamLine));
    outerCol += mix(u_companionColor, u_corona, 0.55) * stream * 0.9;
    float jets = gauss(p.x, u_radius * 0.065) * smoothstep(u_radius * 0.5, u_radius, abs(p.y))
      * (1.0 - smoothstep(u_radius * 2.6, u_radius * 6.4, abs(p.y)));
    outerCol += u_corona * jets * 1.1;
    outerAlpha = max(outerAlpha, max(stream * 0.58, jets * 0.68));
  } else {
    float diskD = length(vec2(p.x, p.y * (u_mode == 1 ? 2.2 : 3.4)));
    float inner = u_radius * 0.58;
    float outer = u_radius * (u_mode == 1 ? 2.2 : 3.6);
    float diskMask = smoothstep(inner * 0.7, inner, diskD) * (1.0 - smoothstep(outer * 0.75, outer, diskD));
    float streak = fbm(vec2(a * 2.2 + t * 0.8, diskD / u_radius * 5.0 - t * 0.25));
    float doppler = 0.35 + 0.65 * pow(0.5 + 0.5 * p.x / max(d, 1.0), 2.0);
    vec3 diskCol = mix(u_secondary * 0.55, vec3(1.0, 0.94, 0.8), (1.0 - diskD / outer) * doppler);
    coreCol += diskCol * diskMask * (0.65 + streak * 1.1) * (0.55 + doppler);
    coreAlpha = max(coreAlpha, diskMask * 0.92);
    float horizon = 1.0 - smoothstep(u_radius * 0.43, u_radius * 0.58, d);
    coreCol = mix(coreCol, vec3(0.002, 0.004, 0.012), horizon);
    coreAlpha = max(coreAlpha, horizon);
    float photon = gauss(d - u_radius * 0.66, u_radius * 0.025);
    coreCol += mix(u_corona, vec3(1.0, 0.94, 0.8), 0.6) * photon * 2.2;
    coreAlpha = max(coreAlpha, photon);

    float jetWidth = u_radius * (0.06 + abs(p.y) / max(u_radius, 1.0) * 0.035);
    float jets = gauss(p.x, jetWidth) * smoothstep(u_radius * 0.35, u_radius * 0.85, abs(p.y))
      * (1.0 - smoothstep(u_radius * 3.0, u_radius * 7.8, abs(p.y)));
    float jetCore = gauss(p.x, jetWidth * 0.24) * jets;
    float pulse = 0.72 + 0.28 * sin(t * 3.4 - abs(p.y) * 0.045);
    outerCol += u_corona * jets * pulse * 0.85 + vec3(0.9, 0.98, 1.0) * jetCore * 1.7;
    outerAlpha = max(outerAlpha, jets * 0.72);
    float lens = gauss(d - u_radius * 1.05, u_radius * 0.055) * abs(sin(a));
    outerCol += mix(u_secondary, u_corona, 0.55) * lens;
    outerAlpha = max(outerAlpha, lens * 0.8);
  }

  if (u_mode == 1) {
    outerCol *= 0.72;
    outerAlpha *= 0.8;
  }
  coreCol *= u_exposure;
  outerCol *= u_exposure * (0.85 + u_chromatic * 0.08);

  if (u_pass == 1) {
    if (coreAlpha < 0.006) discard;
    fragColor = vec4(coreCol, clamp(coreAlpha, 0.0, 1.0));
    return;
  }
  if (u_pass == 2) {
    if (outerAlpha < 0.006) discard;
    fragColor = vec4(outerCol, clamp(outerAlpha, 0.0, 1.0));
    return;
  }
  vec3 col = coreCol + outerCol;
  float alpha = max(coreAlpha, outerAlpha);
  if (alpha < 0.006) discard;
  fragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
