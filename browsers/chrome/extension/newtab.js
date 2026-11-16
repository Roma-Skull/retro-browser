(() => {
  'use strict';

  const {
    STORAGE_KEY,
    QUICK_LINKS_KEY,
    SEARCH_ENGINE_KEY,
    DEFAULT_SETTINGS,
    DEFAULT_NEWTAB_SETTINGS,
    DEFAULT_QUICK_LINKS,
    normalizeSettings,
    resolveNewTabProfile
  } = globalThis.NeonHorizonDefaults;
  const { createShaderProfileController } = globalThis.NeonHorizonControls;

  const SEARCH_ENGINES = [
    { id: 'google', label: 'Google', buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
    { id: 'yandex', label: 'Яндекс', buildUrl: (q) => `https://ya.ru/search/?text=${encodeURIComponent(q)}` },
    { id: 'duckduckgo', label: 'DuckDuckGo', buildUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
    { id: 'bing', label: 'Bing', buildUrl: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` }
  ];

  const MONOGRAM_ACCENTS = [
    'linear-gradient(135deg, rgba(255,42,133,0.45), rgba(0,240,255,0.35))',
    'linear-gradient(135deg, rgba(181,55,242,0.48), rgba(255,42,133,0.35))',
    'linear-gradient(135deg, rgba(0,240,255,0.42), rgba(67,97,238,0.45))',
    'linear-gradient(135deg, rgba(255,107,61,0.42), rgba(181,55,242,0.42))'
  ];

  let appState = normalizeSettings(DEFAULT_SETTINGS);
  let activeQuickLinks = [...DEFAULT_QUICK_LINKS];
  let engineIndex = 0;
  let saveTimer = 0;

  // WebGL2 two-pass state (Pass 1: animated Outrun Synthwave scene -> FBO, Pass 2: CRT/VHS shader)
  const canvas = document.getElementById('crt-bg');
  let gl = null;
  let sceneProg = null;
  let crtProg = null;
  let sceneFbo = null;
  let sceneTex = null;
  let fboWidth = 0;
  let fboHeight = 0;
  let sceneLocs = null;
  let crtLocs = null;
  let webglReady = false;
  let rafId = 0;
  let sceneTime = 0;
  let crtTime = 0;
  let lastFrameMs = performance.now();

  const VERT_SRC = `#version 300 es
    in vec2 aPos;
    out vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  const FRAG_SCENE_SRC = `#version 300 es
    precision highp float;

    in vec2 vUv;
    out vec4 fragColor;

    uniform vec2 uResolution;
    uniform float uTime;

    float hash11(float p) {
      p = fract(p * 0.1031);
      p *= p + 33.33;
      p *= p + p;
      return fract(p);
    }

    vec4 hash14(vec2 p) {
      vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
      p4 += dot(p4, p4.wzxy + 33.33);
      return fract((p4.xxyz + p4.yzzw) * p4.zywx);
    }

    float sdSegment(vec2 pt, vec2 a, vec2 b) {
      vec2 pa = pt - a;
      vec2 ba = b - a;
      float h = clamp(dot(pa, ba) / max(1e-6, dot(ba, ba)), 0.0, 1.0);
      return length(pa - ba * h);
    }

    float mtnHeight(float idx, float side) {
      float x = abs(idx) * 0.105;
      float envelope = smoothstep(0.20, 0.55, x) * (0.55 + 0.45 * hash11(idx * 3.17 + side * 19.7));
      float peak = (0.042 + 0.088 * hash11(idx * 7.41 + side * 11.3)) * envelope;
      return peak;
    }

    float mtnPeakOffset(float idx, float side) {
      return (hash11(idx * 5.23 + side * 31.1) - 0.5) * 0.042;
    }

    vec3 renderStarfield(vec2 skyUv, float yAboveHor, float time) {
      vec2 grid = skyUv * vec2(38.0, 22.0);
      vec2 cell = floor(grid);
      vec2 f = fract(grid) - 0.5;
      vec4 rnd = hash14(cell);
      if (rnd.x < 0.72) return vec3(0.0);

      vec2 offset = (rnd.yz - 0.5) * 0.68;
      vec2 dVec = f - offset;
      float d = length(dVec);
      float size = mix(0.022, 0.055, fract(rnd.w * 7.3));
      float core = smoothstep(size, 0.0, d);

      // Brighter stars receive delicate 4-point synthwave cross sparkles
      float flare = 0.0;
      if (rnd.x > 0.92) {
        float crossH = exp(-abs(dVec.x) * 28.0) * exp(-abs(dVec.y) * 95.0);
        float crossV = exp(-abs(dVec.y) * 28.0) * exp(-abs(dVec.x) * 95.0);
        flare = (crossH + crossV) * 0.75;
      }

      float twinkle = 0.52 + 0.48 * sin(time * (1.1 + rnd.w * 2.5) + rnd.y * 6.2831853);
      float skyFade = smoothstep(0.03, 0.24, yAboveHor) * smoothstep(0.56, 0.40, yAboveHor);
      vec3 tint = rnd.w < 0.35
        ? vec3(0.45, 0.95, 1.0)
        : (rnd.w < 0.65 ? vec3(1.0, 0.55, 0.88) : vec3(0.92, 0.94, 1.0));
      return tint * (core + flare) * twinkle * skyFade * 1.15;
    }

    vec3 renderMountains(vec2 p, vec2 sunCenter, float pxScale, vec3 bgCol, float time) {
      if (p.y < 0.0 || abs(p.x) < 0.19) return bgCol;

      float side = p.x >= 0.0 ? 1.0 : -1.0;
      float xAbs = abs(p.x);
      float cellW = 0.105;
      float idx = floor(xAbs / cellW);

      float xL = idx * cellW;
      float xR = (idx + 1.0) * cellW;
      float hL = mtnHeight(idx, side);
      float hR = mtnHeight(idx + 1.0, side);
      float xP = (idx + 0.5) * cellW + mtnPeakOffset(idx, side);
      float hP = mtnHeight(idx + 0.5, side) * 1.24;

      vec2 vL = vec2(xL, hL);
      vec2 vP = vec2(xP, hP);
      vec2 vR = vec2(xR, hR);
      vec2 vBase = vec2((idx + 0.5) * cellW, 0.0);
      vec2 pt = vec2(xAbs, p.y);

      float ridgeY = pt.x < vP.x
        ? mix(vL.y, vP.y, clamp((pt.x - vL.x) / max(1e-5, vP.x - vL.x), 0.0, 1.0))
        : mix(vP.y, vR.y, clamp((pt.x - vP.x) / max(1e-5, vR.x - vP.x), 0.0, 1.0));

      float inside = 1.0 - smoothstep(ridgeY - pxScale * 1.1, ridgeY + pxScale * 1.1, pt.y);

      float dRidge = min(sdSegment(pt, vL, vP), sdSegment(pt, vP, vR));
      float dMesh = min(
        sdSegment(pt, vP, vBase),
        min(sdSegment(pt, vL, vBase), sdSegment(pt, vR, vBase))
      );

      float wireRidge = 1.0 - smoothstep(pxScale * 0.7, pxScale * 2.1, dRidge);
      float wireInner = (1.0 - smoothstep(pxScale * 0.45, pxScale * 1.6, dMesh)) * inside;

      // Subtle low-poly facet tinting + cyan-to-magenta neon rim
      float facet = pt.x < vP.x ? 0.0 : 1.0;
      vec3 darkFill = mix(vec3(0.032, 0.014, 0.072), vec3(0.052, 0.020, 0.115), facet);
      float sunProx = exp(-length(p - sunCenter) * 2.4);
      darkFill += vec3(0.14, 0.02, 0.12) * sunProx * 0.38;

      float pulse = 0.88 + 0.12 * sin(time * 1.5 - xAbs * 5.0);
      vec3 cyanWire = vec3(0.0, 0.94, 1.0);
      vec3 magWire = vec3(0.88, 0.22, 0.96);
      vec3 wireCol = mix(magWire, cyanWire, smoothstep(0.22, 0.72, xAbs) * 0.65 + smoothstep(0.01, 0.09, pt.y) * 0.35);

      vec3 mtnCol = darkFill + wireCol * (wireRidge * 0.95 + wireInner * 0.55) * pulse;
      vec3 res = mix(bgCol, mtnCol, inside);
      res += cyanWire * wireRidge * 0.35 * (1.0 - inside) * pulse;
      return res;
    }

    void main() {
      float aspect = uResolution.x / max(1.0, uResolution.y);
      float horY = 0.44;
      float pxScale = 1.0 / min(uResolution.x, uResolution.y);
      vec2 p = vec2((vUv.x - 0.5) * max(1.05, aspect), vUv.y - horY);
      vec2 sunCenter = vec2(0.0, 0.062);

      // 1. Deep Synthwave Twilight Sky & Horizon Nebula
      vec3 skyTop = vec3(0.0431, 0.0275, 0.0941);
      vec3 skyMid = vec3(0.088, 0.039, 0.195);
      vec3 skyHor = vec3(0.245, 0.055, 0.305);
      float tSky = clamp(p.y / (1.0 - horY), 0.0, 1.0);
      vec3 col = mix(skyHor, skyMid, smoothstep(0.0, 0.36, tSky));
      col = mix(col, skyTop, smoothstep(0.26, 0.92, tSky));

      // Subtle atmospheric aurora bands
      float aurora = sin(p.x * 3.1 + uTime * 0.22) * cos(p.y * 7.5 - uTime * 0.16);
      col += vec3(0.045, 0.012, 0.075) * max(0.0, aurora) * (1.0 - tSky);

      // 2. Retro Sliced Outrun Sun + Breathing Corona
      vec2 pSun = p - sunCenter;
      float sunR = 0.188;
      float sunDist = length(pSun);
      float sunBreath = 1.0 + 0.045 * sin(uTime * 1.35);

      float corona = exp(-max(0.0, sunDist - sunR) * 9.5) * 0.65 * sunBreath;
      float wideGlow = exp(-length(pSun * vec2(0.75, 1.45)) * 2.9) * 0.42;
      col += vec3(1.0, 0.16, 0.52) * (corona + wideGlow);

      if (p.y >= -0.002) {
        col += renderStarfield(vec2((vUv.x - 0.5) * max(1.0, aspect), vUv.y), p.y, uTime) * smoothstep(sunR * 0.95, sunR * 1.45, sunDist);

        float discMask = (1.0 - smoothstep(sunR - pxScale * 1.5, sunR + pxScale * 1.5, sunDist))
          * smoothstep(-pxScale, pxScale * 1.5, p.y);
        if (discMask > 0.001) {
          float hNorm = clamp((pSun.y + sunR) / (2.0 * sunR), 0.0, 1.0);
          vec3 sunTopCol = vec3(1.0, 0.91, 0.37);
          vec3 sunMidCol = vec3(1.0, 0.42, 0.26);
          vec3 sunBotCol = vec3(1.0, 0.165, 0.52);
          vec3 discCol = mix(sunBotCol, sunMidCol, smoothstep(0.08, 0.52, hNorm));
          discCol = mix(discCol, sunTopCol, smoothstep(0.45, 0.92, hNorm));

          // Smoothly drifting downward horizontal scan-slices across visible lower sun above horizon
          float visH = clamp((hNorm - 0.335) / 0.35, 0.0, 1.0);
          float slicePhase = fract(visH * 5.2 + uTime * 0.28);
          float sliceThickness = mix(0.42, 0.04, visH);
          float sliceGap = smoothstep(sliceThickness + 0.04, sliceThickness - 0.015, slicePhase)
            * step(visH, 0.96)
            * smoothstep(0.96, 0.80, visH);
          col = mix(col, discCol, discMask * (1.0 - sliceGap));
        }

        // 3. Low-Poly Wireframe Mountains
        col = renderMountains(p, sunCenter, pxScale, col, uTime);
      } else {
        // 4. Infinite 60fps Forward-Scrolling Perspective Neon Grid
        float yFloor = horY - vUv.y;
        float depth = 0.25 / max(0.0022, yFloor);
        float worldX = p.x * depth * 1.15;
        float worldZ = depth - uTime * 1.45;
        vec2 gCoord = vec2(worldX, worldZ);

        vec2 gFrac = abs(fract(gCoord - 0.5) - 0.5) / max(vec2(0.0008), fwidth(gCoord));
        float dLine = min(gFrac.x, gFrac.y);
        float lineCore = 1.0 - min(dLine, 1.0);
        float lineHalo = exp(-dLine * 0.68) * 0.28;
        float distFade = smoothstep(0.004, 0.032, yFloor);

        // Floor ambient gradient + animated sun shimmer trail across the center grid
        vec3 floorNear = vec3(0.039, 0.018, 0.088);
        vec3 floorHor = vec3(0.095, 0.026, 0.205);
        col = mix(floorHor, floorNear, smoothstep(0.0, 0.34, yFloor));

        float sunTrack = exp(-p.x * p.x * 16.0) * smoothstep(0.42, 0.0, yFloor);
        float ripple = 0.85 + 0.15 * sin(worldZ * 2.2 + uTime * 2.6);
        col += vec3(0.55, 0.12, 0.42) * sunTrack * 0.48 * ripple;

        vec3 gridCyan = vec3(0.0, 0.94, 1.0);
        vec3 gridMag = vec3(1.0, 0.18, 0.72);
        vec3 gridCol = mix(gridMag, gridCyan, exp(-yFloor * 5.2));
        col += gridCol * (lineCore * 0.95 + lineHalo) * distFade;
      }

      // 5. Electric Cyan Horizon Beam
      float horGlow = exp(-abs(vUv.y - horY) * 140.0);
      float horCore = exp(-abs(vUv.y - horY) * 520.0);
      col += vec3(0.0, 0.94, 1.0) * (horGlow * 0.52 + horCore * 0.85);

      fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `;

  const FRAG_CRT_SRC = `#version 300 es
    precision highp float;

    in vec2 vUv;
    out vec4 fragColor;

    uniform sampler2D uTex;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uCurvature;
    uniform float uScanlines;
    uniform float uBloom;
    uniform float uVhs;
    uniform float uVignette;
    uniform float uAnimate;
    uniform float uScanPeriod;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    vec3 sampleScene(vec2 uv) {
      return texture(uTex, clamp(uv, 0.001, 0.999)).rgb;
    }

    void main() {
      vec2 centered = vUv * 2.0 - 1.0;
      float r2 = dot(centered, centered);

      // Smooth radial barrel curvature with center-zoom compensation
      float k = uCurvature * 0.22;
      vec2 barrel = uCurvature > 0.001
        ? centered * (1.0 + k * r2) / (1.0 + k * 0.42)
        : centered;
      vec2 crtUv = barrel * 0.5 + 0.5;

      // Signed distance to rounded CRT glass aperture
      float rCorner = 0.042 * uCurvature;
      vec2 halfBox = vec2(1.0 - rCorner);
      vec2 dBox = abs(barrel) - halfBox;
      float sdf = length(max(dBox, 0.0)) + min(max(dBox.x, dBox.y), 0.0) - rCorner;
      float aa = 2.4 / min(uResolution.x, uResolution.y);
      float glassMask = uCurvature > 0.001 ? (1.0 - smoothstep(0.0, aa, sdf)) : 1.0;

      if (glassMask <= 0.001) {
        fragColor = vec4(0.0157, 0.0039, 0.0471, 1.0);
        return;
      }

      // VHS horizontal sync flutter & traveling tracking band
      vec2 sampleUv = crtUv;
      float trackPulse = 0.0;
      if (uVhs > 0.001) {
        float t = uAnimate > 0.5 ? uTime : 0.0;
        float wave = sin(sampleUv.y * 42.0 + t * 5.2) * cos(sampleUv.y * 13.0 - t * 2.1);
        float trackPos = fract(t * 0.11);
        float distTrack = abs(sampleUv.y - (1.0 - trackPos));
        trackPulse = smoothstep(0.045, 0.0, distTrack) * uVhs * step(0.5, uAnimate);
        sampleUv.x += (wave * 0.0014 + sin(sampleUv.y * 160.0 + t * 28.0) * 0.0045 * trackPulse) * uVhs;
      }

      // Chromatic RGB split along edges & VHS tape shift
      float chroma = uVhs * (0.0009 + 0.0038 * pow(length(centered), 1.35)) + trackPulse * 0.004;
      vec2 chromaVec = vec2(chroma, chroma * 0.12);
      vec3 baseCol;
      if (chroma > 0.0001) {
        baseCol.r = sampleScene(sampleUv + chromaVec).r;
        baseCol.g = sampleScene(sampleUv).g;
        baseCol.b = sampleScene(sampleUv - chromaVec).b;
      } else {
        baseCol = sampleScene(sampleUv);
      }

      // Phosphor bloom glow from bright highlights
      if (uBloom > 0.001) {
        vec2 texel = (2.5 + uBloom * 8.5) / uResolution;
        vec3 glowAcc = vec3(0.0);
        const float PI2 = 6.2831853;
        for (int i = 0; i < 8; i++) {
          float ang = float(i) * (PI2 / 8.0);
          vec2 dir = vec2(cos(ang), sin(ang));
          vec3 s1 = sampleScene(sampleUv + dir * texel * 1.1);
          vec3 s2 = sampleScene(sampleUv + dir * texel * 2.4);
          glowAcc += max(vec3(0.0), s1 - 0.34) * 0.65 + max(vec3(0.0), s2 - 0.34) * 0.35;
        }
        glowAcc /= 8.0;
        vec3 bloomTint = glowAcc * vec3(1.06 + uVhs * 0.14, 1.0, 1.14 + uVhs * 0.16);
        baseCol = 1.0 - (1.0 - baseCol) * (1.0 - clamp(bloomTint * uBloom * 0.72, 0.0, 0.92));
      }

      if (trackPulse > 0.001) {
        baseCol += vec3(0.04, 0.09, 0.12) * trackPulse;
      }

      // Physical-pixel locked scanlines (zero moire on any DPI) & subtle aperture grille
      if (uScanlines > 0.001) {
        float phaseY = fract(gl_FragCoord.y / max(2.0, uScanPeriod));
        float waveY = 0.5 + 0.5 * cos(phaseY * 6.2831853);
        float interlace = uAnimate > 0.5 ? (0.95 + 0.05 * sin(uTime * 52.0)) : 1.0;
        float scanMul = 1.0 - uScanlines * 0.36 * (1.0 - waveY) * interlace;
        baseCol *= scanMul;

        float sub = mod(floor(gl_FragCoord.x), 3.0);
        vec3 grille = sub < 0.5
          ? vec3(1.05, 0.96, 0.99)
          : (sub < 1.5 ? vec3(0.96, 1.05, 0.99) : vec3(0.98, 0.97, 1.06));
        baseCol *= mix(vec3(1.0), grille, uScanlines * 0.28);
      }

      if (uVhs > 0.001) {
        float frameSeed = uAnimate > 0.5 ? floor(uTime * 16.0) : 1.0;
        float n = hash12(floor(gl_FragCoord.xy * 0.75) + frameSeed * 19.7) - 0.5;
        baseCol += vec3(n * 1.06, n * 0.96, n * 1.12) * (0.075 * uVhs);
      }

      if (uVignette > 0.001) {
        float dist = length(centered * vec2(0.84, 0.94));
        float vig = 1.0 - uVignette * 0.78 * smoothstep(0.55, 1.32, dist);
        baseCol *= max(0.08, vig);

        float sheen = exp(-pow(length((crtUv - vec2(0.18, 0.85)) * vec2(1.4, 2.2)), 2.0) * 3.5);
        baseCol += vec3(0.18, 0.28, 0.36) * sheen * (0.08 * uVignette + 0.03 * uCurvature);
      }

      if (uCurvature > 0.001) {
        float innerShadow = smoothstep(-aa * 8.0, 0.0, sdf);
        baseCol *= 1.0 - innerShadow * (0.35 + 0.35 * uCurvature);
        float rimGlow = smoothstep(aa * 2.5, 0.0, abs(sdf)) * (0.18 + 0.26 * uCurvature);
        baseCol += vec3(0.71, 0.22, 0.95) * rimGlow;
      }

      vec3 bezelCol = vec3(0.0157, 0.0039, 0.0471);
      fragColor = vec4(mix(bezelCol, clamp(baseCol, 0.0, 1.0), glassMask), 1.0);
    }
  `;

  function compileShader(type, source) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function linkProgram(vertSrc, fragSrc) {
    const vs = compileShader(gl.VERTEX_SHADER, vertSrc);
    const fs = compileShader(gl.FRAGMENT_SHADER, fragSrc);
    if (!vs || !fs) return null;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.deleteProgram(prog);
      return null;
    }
    return prog;
  }

  function ensureFboSize(w, h) {
    if (fboWidth === w && fboHeight === h && sceneFbo && sceneTex) return;
    fboWidth = w;
    fboHeight = h;

    if (!sceneTex) sceneTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    if (!sceneFbo) sceneFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function initWebGL() {
    gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'low-power' });
    if (!gl) return false;

    sceneProg = linkProgram(VERT_SRC, FRAG_SCENE_SRC);
    crtProg = linkProgram(VERT_SRC, FRAG_CRT_SRC);
    if (!sceneProg || !crtProg) return false;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    const aPosScene = gl.getAttribLocation(sceneProg, 'aPos');
    gl.enableVertexAttribArray(aPosScene);
    gl.vertexAttribPointer(aPosScene, 2, gl.FLOAT, false, 0, 0);

    const aPosCrt = gl.getAttribLocation(crtProg, 'aPos');
    if (aPosCrt !== aPosScene && aPosCrt >= 0) {
      gl.enableVertexAttribArray(aPosCrt);
      gl.vertexAttribPointer(aPosCrt, 2, gl.FLOAT, false, 0, 0);
    }

    sceneLocs = {
      uResolution: gl.getUniformLocation(sceneProg, 'uResolution'),
      uTime: gl.getUniformLocation(sceneProg, 'uTime')
    };

    crtLocs = {
      uTex: gl.getUniformLocation(crtProg, 'uTex'),
      uResolution: gl.getUniformLocation(crtProg, 'uResolution'),
      uTime: gl.getUniformLocation(crtProg, 'uTime'),
      uCurvature: gl.getUniformLocation(crtProg, 'uCurvature'),
      uScanlines: gl.getUniformLocation(crtProg, 'uScanlines'),
      uBloom: gl.getUniformLocation(crtProg, 'uBloom'),
      uVhs: gl.getUniformLocation(crtProg, 'uVhs'),
      uVignette: gl.getUniformLocation(crtProg, 'uVignette'),
      uAnimate: gl.getUniformLocation(crtProg, 'uAnimate'),
      uScanPeriod: gl.getUniformLocation(crtProg, 'uScanPeriod')
    };

    webglReady = true;
    return true;
  }

  function resizeCanvas() {
    if (!gl) return;
    const dpr = Math.max(0.5, window.devicePixelRatio || 1);
    const w = Math.max(320, Math.round(window.innerWidth * dpr));
    const h = Math.max(240, Math.round(window.innerHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ensureFboSize(canvas.width, canvas.height);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function drawFrame() {
    if (!gl || !webglReady) return;
    resizeCanvas();

    const nt = resolveNewTabProfile(appState);
    const active = nt.enabled;
    const dpr = Math.max(0.5, window.devicePixelRatio || 1);
    let physPeriod = Math.max(4, Math.round(3.2 * dpr));
    if (physPeriod % 2 !== 0) physPeriod += 1;

    // Pass 1: Animated Neon Horizon Synthwave scene -> offscreen FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
    gl.useProgram(sceneProg);
    gl.uniform2f(sceneLocs.uResolution, canvas.width, canvas.height);
    gl.uniform1f(sceneLocs.uTime, sceneTime);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Pass 2: Configurable CRT/VHS post-processing -> viewport canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(crtProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1i(crtLocs.uTex, 0);
    gl.uniform2f(crtLocs.uResolution, canvas.width, canvas.height);
    gl.uniform1f(crtLocs.uTime, crtTime);
    gl.uniform1f(crtLocs.uCurvature, active ? nt.curvature / 100 : 0);
    gl.uniform1f(crtLocs.uScanlines, active ? nt.scanlines / 100 : 0);
    gl.uniform1f(crtLocs.uBloom, active ? nt.bloom / 100 : 0);
    gl.uniform1f(crtLocs.uVhs, active ? nt.vhs / 100 : 0);
    gl.uniform1f(crtLocs.uVignette, active ? nt.vignette / 100 : 0);
    gl.uniform1f(crtLocs.uAnimate, active && nt.animate ? 1.0 : 0.0);
    gl.uniform1f(crtLocs.uScanPeriod, physPeriod);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function isAnimationRunning(nt) {
    if (document.hidden) return false;
    const animBg = Boolean(nt.animateBg);
    const animCrt = Boolean(nt.enabled && nt.animate && (nt.vhs > 0 || nt.scanlines > 0));
    return animBg || animCrt;
  }

  function tick(now) {
    const nt = resolveNewTabProfile(appState);
    if (!isAnimationRunning(nt)) {
      rafId = 0;
      return;
    }
    const dt = Math.min(0.1, Math.max(0, (now - lastFrameMs) * 0.001));
    lastFrameMs = now;
    if (nt.animateBg) sceneTime += dt;
    if (nt.enabled && nt.animate) crtTime += dt;
    drawFrame();
    rafId = requestAnimationFrame(tick);
  }

  function syncRenderLoop() {
    if (!webglReady) return;
    const nt = resolveNewTabProfile(appState);
    drawFrame();
    if (isAnimationRunning(nt) && !rafId) {
      lastFrameMs = performance.now();
      rafId = requestAnimationFrame(tick);
    } else if (!isAnimationRunning(nt) && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  // Clock
  const clockTimeEl = document.getElementById('clock-time');
  const clockDateEl = document.getElementById('clock-date');
  const dateFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  function updateClock() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    clockTimeEl.textContent = `${hh}:${mm}`;
    clockDateEl.textContent = dateFmt.format(now);
  }

  // Search bar
  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');
  const engineBtn = document.getElementById('engine-btn');

  function renderEngineButton() {
    const eng = SEARCH_ENGINES[engineIndex] || SEARCH_ENGINES[0];
    engineBtn.textContent = eng.label;
  }

  function normalizeTargetUrl(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return trimmed;
    if (!/\s/.test(trimmed) && (/^localhost(:\d+)?(\/|$)/i.test(trimmed) || /^(\d{1,3}\.){3}\d{1,3}/.test(trimmed))) {
      return `http://${trimmed}`;
    }
    if (!/\s/.test(trimmed) && /\.[a-zA-Z]{2,}(\/|$)/.test(trimmed)) {
      return `https://${trimmed}`;
    }
    return '';
  }

  engineBtn.addEventListener('click', () => {
    engineIndex = (engineIndex + 1) % SEARCH_ENGINES.length;
    renderEngineButton();
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ [SEARCH_ENGINE_KEY]: SEARCH_ENGINES[engineIndex].id });
    }
  });

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (!query) return;
    const directUrl = normalizeTargetUrl(query);
    if (directUrl) {
      window.location.href = directUrl;
      return;
    }
    const eng = SEARCH_ENGINES[engineIndex] || SEARCH_ENGINES[0];
    window.location.href = eng.buildUrl(query);
  });

  // Quick Sites & Add Modal
  const sitesGrid = document.getElementById('sites-grid');
  const addModal = document.getElementById('add-modal');
  const addForm = document.getElementById('add-site-form');
  const addTitleInput = document.getElementById('add-title');
  const addUrlInput = document.getElementById('add-url');
  const cancelAddBtn = document.getElementById('btn-cancel-add');

  function extractHost(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (_) {
      return url;
    }
  }

  function monogramFor(title, url) {
    const src = (title || extractHost(url) || '?').trim();
    return src ? src[0].toUpperCase() : '?';
  }

  function persistQuickLinks(links) {
    activeQuickLinks = links;
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ [QUICK_LINKS_KEY]: links });
    }
    renderQuickLinks();
  }

  function renderQuickLinks() {
    sitesGrid.textContent = '';
    const visible = activeQuickLinks.slice(0, 7);

    visible.forEach((site, idx) => {
      const tile = document.createElement('a');
      tile.className = 'site-tile';
      tile.href = site.url;
      tile.title = `${site.title}\n${site.url}`;

      const badge = document.createElement('div');
      badge.className = 'site-monogram';
      badge.style.background = MONOGRAM_ACCENTS[idx % MONOGRAM_ACCENTS.length];
      badge.textContent = monogramFor(site.title, site.url);

      const label = document.createElement('div');
      label.className = 'site-name';
      label.textContent = site.title || extractHost(site.url);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'site-remove';
      removeBtn.title = 'Убрать';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const next = activeQuickLinks.filter((_, i) => i !== idx);
        persistQuickLinks(next);
      });

      tile.append(badge, label, removeBtn);
      sitesGrid.appendChild(tile);
    });

    if (visible.length < 8) {
      const addTile = document.createElement('button');
      addTile.type = 'button';
      addTile.className = 'site-tile is-add';
      addTile.title = 'Добавить сайт';

      const badge = document.createElement('div');
      badge.className = 'site-monogram';
      badge.textContent = '+';

      const label = document.createElement('div');
      label.className = 'site-name';
      label.textContent = 'Добавить';

      addTile.append(badge, label);
      addTile.addEventListener('click', () => {
        addTitleInput.value = '';
        addUrlInput.value = '';
        addModal.hidden = false;
        addTitleInput.focus();
      });
      sitesGrid.appendChild(addTile);
    }
  }

  cancelAddBtn.addEventListener('click', () => {
    addModal.hidden = true;
  });

  addModal.addEventListener('click', (e) => {
    if (e.target === addModal) addModal.hidden = true;
  });

  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = addTitleInput.value.trim();
    const rawUrl = addUrlInput.value.trim();
    if (!rawUrl) return;
    const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    try {
      new URL(url);
    } catch (_) {
      return;
    }
    const label = title || extractHost(url);
    persistQuickLinks([...activeQuickLinks, { title: label, url }]);
    addModal.hidden = true;
  });

  // CRT/VHS Settings Drawer
  const drawer = document.getElementById('crt-drawer');
  const toggleDrawerBtn = document.getElementById('btn-toggle-drawer');
  const dockDot = document.getElementById('dock-dot');
  const toggleSync = document.getElementById('toggle-sync-sites');
  const toggleAnimateBg = document.getElementById('toggle-animate-bg');
  const copySitesBtn = document.getElementById('btn-copy-sites');

  function persistState(immediate) {
    if (!chrome?.storage?.local) return;
    if (immediate) {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = 0;
      }
      chrome.storage.local.set({ [STORAGE_KEY]: appState });
      return;
    }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = 0;
      chrome.storage.local.set({ [STORAGE_KEY]: appState });
    }, 50);
  }

  let profileCtrl = null;

  function renderDrawerState() {
    const nt = resolveNewTabProfile(appState);
    if (profileCtrl) profileCtrl.render();
    drawer.classList.toggle('is-disabled', !nt.enabled);
    dockDot.classList.toggle('is-off', !nt.enabled);
    toggleSync.checked = Boolean(appState.newTab.syncWithSites);
    if (toggleAnimateBg) toggleAnimateBg.checked = Boolean(appState.newTab.animateBg);
    copySitesBtn.disabled = Boolean(appState.newTab.syncWithSites);
    syncRenderLoop();
  }

  profileCtrl = createShaderProfileController({
    root: drawer,
    getProfile: () => resolveNewTabProfile(appState),
    onPatch: (patch, immediate) => {
      if (appState.newTab.syncWithSites) {
        appState = normalizeSettings({ ...appState, ...patch });
      } else {
        appState = normalizeSettings({
          ...appState,
          newTab: { ...appState.newTab, ...patch }
        });
      }
      renderDrawerState();
      persistState(immediate);
    },
    onReset: () => {
      if (appState.newTab.syncWithSites) {
        appState = normalizeSettings({
          ...DEFAULT_SETTINGS,
          disabledHosts: appState.disabledHosts,
          newTab: { ...appState.newTab, syncWithSites: true }
        });
      } else {
        appState = normalizeSettings({
          ...appState,
          newTab: { ...DEFAULT_NEWTAB_SETTINGS, syncWithSites: false }
        });
      }
      renderDrawerState();
      persistState(true);
    }
  });

  toggleSync.addEventListener('change', () => {
    appState = normalizeSettings({
      ...appState,
      newTab: { ...appState.newTab, syncWithSites: toggleSync.checked }
    });
    renderDrawerState();
    persistState(true);
  });

  if (toggleAnimateBg) {
    toggleAnimateBg.addEventListener('change', () => {
      appState = normalizeSettings({
        ...appState,
        newTab: { ...appState.newTab, animateBg: toggleAnimateBg.checked }
      });
      renderDrawerState();
      persistState(true);
    });
  }

  copySitesBtn.addEventListener('click', () => {
    appState = normalizeSettings({
      ...appState,
      newTab: {
        enabled: appState.enabled,
        preset: appState.preset,
        curvature: appState.curvature,
        scanlines: appState.scanlines,
        bloom: appState.bloom,
        vhs: appState.vhs,
        vignette: appState.vignette,
        animate: appState.animate,
        syncWithSites: false
      }
    });
    renderDrawerState();
    persistState(true);
  });

  toggleDrawerBtn.addEventListener('click', () => {
    const nextOpen = drawer.hidden;
    drawer.hidden = !nextOpen;
    toggleDrawerBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!addModal.hidden) addModal.hidden = true;
      else if (!drawer.hidden) {
        drawer.hidden = true;
        toggleDrawerBtn.setAttribute('aria-expanded', 'false');
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (!drawer.hidden && !e.target.closest('.shader-dock')) {
      drawer.hidden = true;
      toggleDrawerBtn.setAttribute('aria-expanded', 'false');
    }
  });

  async function init() {
    updateClock();
    setInterval(updateClock, 15000);

    initWebGL();

    try {
      const stored = await chrome.storage.local.get([STORAGE_KEY, QUICK_LINKS_KEY, SEARCH_ENGINE_KEY]);
      appState = normalizeSettings(stored[STORAGE_KEY] || DEFAULT_SETTINGS);

      if (typeof stored[SEARCH_ENGINE_KEY] === 'string') {
        const idx = SEARCH_ENGINES.findIndex((e) => e.id === stored[SEARCH_ENGINE_KEY]);
        if (idx >= 0) engineIndex = idx;
      }

      if (Array.isArray(stored[QUICK_LINKS_KEY])) {
        activeQuickLinks = stored[QUICK_LINKS_KEY];
      } else if (chrome.topSites && chrome.topSites.get) {
        const top = await chrome.topSites.get();
        if (Array.isArray(top) && top.length > 0) {
          activeQuickLinks = top.slice(0, 7).map((item) => ({
            title: item.title || extractHost(item.url),
            url: item.url
          }));
        }
      }
    } catch (_) {
      // Safe fallback when previewed outside extension runtime
    }

    renderEngineButton();
    renderQuickLinks();
    renderDrawerState();

    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        if (changes[STORAGE_KEY]) {
          appState = normalizeSettings(changes[STORAGE_KEY].newValue);
          renderDrawerState();
        }
        if (changes[QUICK_LINKS_KEY] && Array.isArray(changes[QUICK_LINKS_KEY].newValue)) {
          activeQuickLinks = changes[QUICK_LINKS_KEY].newValue;
          renderQuickLinks();
        }
        if (changes[SEARCH_ENGINE_KEY]) {
          const idx = SEARCH_ENGINES.findIndex((e) => e.id === changes[SEARCH_ENGINE_KEY].newValue);
          if (idx >= 0) {
            engineIndex = idx;
            renderEngineButton();
          }
        }
      });
    }

    if (chrome?.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === 'NH_PREVIEW_SETTINGS' && msg.settings) {
          appState = normalizeSettings(msg.settings);
          renderDrawerState();
        }
      });
    }

    window.addEventListener('resize', () => {
      if (!rafId) syncRenderLoop();
    }, { passive: true });
    document.addEventListener('visibilitychange', syncRenderLoop);
  }

  init();
})();
