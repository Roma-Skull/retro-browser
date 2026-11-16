(() => {
  'use strict';

  if (window.top !== window.self) return;

  const { STORAGE_KEY, DEFAULT_SETTINGS, normalizeSettings } = globalThis.NeonHorizonDefaults;
  const HOST_TAG = 'nh-crt-shader';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  let currentSettings = normalizeSettings(DEFAULT_SETTINGS);
  let hostEl = null;
  let shadowRoot = null;
  let els = null;
  let rafResizeId = 0;
  let grainRafId = 0;
  let lastGrainTime = 0;
  let grainCtx = null;
  let grainImg = null;
  let isMounted = false;

  function isHostDisabled(settings) {
    const host = (window.location && window.location.hostname) || '';
    return Boolean(host && settings.disabledHosts.includes(host));
  }

  function isEffectivelyActive(settings) {
    return settings.enabled && !isHostDisabled(settings);
  }

  function ensureMounted() {
    if (isMounted || !document.documentElement) return;

    const existing = document.documentElement.querySelector(HOST_TAG);
    if (existing && existing.shadowRoot) {
      hostEl = existing;
      shadowRoot = existing.shadowRoot;
    } else {
      hostEl = document.createElement(HOST_TAG);
      shadowRoot = hostEl.attachShadow({ mode: 'open' });
      shadowRoot.innerHTML = `
        <style>
          :host {
            all: initial;
            position: fixed;
            inset: 0;
            width: 100vw;
            height: 100vh;
            pointer-events: none;
            z-index: 2147483647;
            display: block;
            overflow: hidden;
          }
          .layer {
            position: fixed;
            inset: 0;
            pointer-events: none;
          }
          #backdrop {
            will-change: backdrop-filter;
          }
          #scanlines {
            opacity: 0;
          }
          #scanlines.animating {
            animation: nh-interlace 0.12s steps(2, end) infinite;
          }
          #sweep {
            height: 90px;
            inset: auto 0 auto 0;
            top: -90px;
            left: 0;
            right: 0;
            background: linear-gradient(
              to bottom,
              transparent 0%,
              rgba(0, 240, 255, 0.045) 45%,
              rgba(255, 42, 133, 0.03) 60%,
              transparent 100%
            );
            opacity: 0;
          }
          #sweep.animating {
            animation: nh-sweep 6.5s linear infinite;
          }
          #vhs-tint {
            opacity: 0;
          }
          #vhs-grain {
            width: 100vw;
            height: 100vh;
            image-rendering: pixelated;
            opacity: 0;
          }
          #vhs-tracking {
            height: 28px;
            left: 0;
            right: 0;
            top: -28px;
            background: linear-gradient(
              to bottom,
              transparent 0%,
              rgba(255, 42, 133, 0.08) 35%,
              rgba(0, 240, 255, 0.11) 65%,
              transparent 100%
            );
            opacity: 0;
          }
          #vhs-tracking.animating {
            animation: nh-tracking 9.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
          }
          #bezel-svg {
            width: 100%;
            height: 100%;
            display: block;
          }
          @keyframes nh-interlace {
            0% { opacity: 1; }
            50% { opacity: 0.86; }
            100% { opacity: 1; }
          }
          @keyframes nh-sweep {
            0% { transform: translateY(-10vh); }
            100% { transform: translateY(115vh); }
          }
          @keyframes nh-tracking {
            0%, 72% { transform: translateY(-40px); opacity: 0; }
            74% { opacity: var(--nh-track-op, 0.5); }
            84% { transform: translateY(108vh); opacity: calc(var(--nh-track-op, 0.5) * 0.78); }
            86%, 100% { transform: translateY(112vh); opacity: 0; }
          }
        </style>
        <svg id="filter-svg" xmlns="${SVG_NS}" width="0" height="0" style="position:fixed;left:-9999px;top:-9999px;">
          <defs id="filter-defs"></defs>
        </svg>
        <div id="backdrop" class="layer"></div>
        <div id="scanlines" class="layer"></div>
        <div id="sweep" class="layer"></div>
        <div id="vhs-tint" class="layer"></div>
        <canvas id="vhs-grain" class="layer" width="128" height="128"></canvas>
        <div id="vhs-tracking" class="layer"></div>
        <div class="layer">
          <svg id="bezel-svg" xmlns="${SVG_NS}" preserveAspectRatio="none"></svg>
        </div>
      `;
      document.documentElement.appendChild(hostEl);
    }

    els = {
      filterDefs: shadowRoot.getElementById('filter-defs'),
      backdrop: shadowRoot.getElementById('backdrop'),
      scanlines: shadowRoot.getElementById('scanlines'),
      sweep: shadowRoot.getElementById('sweep'),
      vhsTint: shadowRoot.getElementById('vhs-tint'),
      vhsGrain: shadowRoot.getElementById('vhs-grain'),
      vhsTracking: shadowRoot.getElementById('vhs-tracking'),
      bezelSvg: shadowRoot.getElementById('bezel-svg')
    };

    grainCtx = els.vhsGrain.getContext('2d', { alpha: true });
    grainImg = grainCtx.createImageData(128, 128);
    isMounted = true;
  }

  function buildFilterGraph(settings, width, height) {
    const bloomNorm = settings.bloom / 100;
    const vhsNorm = settings.vhs / 100;

    if (bloomNorm <= 0) {
      els.backdrop.style.backdropFilter = 'none';
      els.filterDefs.innerHTML = '';
      return;
    }

    const bloomStd = (1.6 + bloomNorm * 3.8).toFixed(2);
    const bloomAlpha = (bloomNorm * 0.62).toFixed(3);
    const chromaBoost = (1.0 + vhsNorm * 0.18).toFixed(2);

    // Keep base DOM text razor-sharp on websites (avoid nearest-neighbor feDisplacementMap artifacts);
    // true bilinear CRT barrel distortion is rendered in WebGL2 on the custom New Tab page.
    els.filterDefs.innerHTML = `
      <filter id="nh-crt-filter" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse"
        x="0" y="0" width="${width}" height="${height}" color-interpolation-filters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation="${bloomStd}" result="bloomBlur"/>
        <feColorMatrix in="bloomBlur" type="matrix"
          values="${chromaBoost} 0 0 0 0  0 1.02 0 0 0  0 0 ${(1.12 + vhsNorm * 0.2).toFixed(2)} 0 0  0 0 0 ${bloomAlpha} 0"
          result="bloom"/>
        <feBlend in="SourceGraphic" in2="bloom" mode="screen" result="bloomed"/>
      </filter>
    `;
    els.backdrop.style.backdropFilter = 'url(#nh-crt-filter)';
  }

  /**
   * Generates a C1-smooth continuous barrel-curved CRT aperture path matching the WebGL2 bezel.
   */
  function buildRoundedBarrelPath(width, height, curvNorm) {
    const padMid = 1 + curvNorm * 1.5;
    const cornerPull = curvNorm * 10;
    const radius = Math.min(Math.min(width, height) * 0.16, 4 + curvNorm * 22);
    const left = padMid;
    const right = width - padMid;
    const top = padMid;
    const bottom = height - padMid;
    const halfW = width * 0.5;
    const halfH = height * 0.5;
    const kx = cornerPull / Math.max(1, halfW);
    const ky = cornerPull / Math.max(1, halfH);

    const pts = [];
    const pushWarped = (x0, y0) => {
      const nx = (x0 - halfW) / Math.max(1, halfW);
      const ny = (y0 - halfH) / Math.max(1, halfH);
      const x = halfW + (x0 - halfW) * (1 - kx * ny * ny);
      const y = halfH + (y0 - halfH) * (1 - ky * nx * nx);
      pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    };

    const edgeSteps = 18;
    const arcSteps = 12;

    // Top edge: left corner arc end -> right corner arc start
    for (let i = 0; i <= edgeSteps; i++) {
      pushWarped((left + radius) + ((right - radius) - (left + radius)) * (i / edgeSteps), top);
    }
    // Top-right quarter-circle
    for (let i = 1; i <= arcSteps; i++) {
      const a = -Math.PI * 0.5 + (Math.PI * 0.5) * (i / arcSteps);
      pushWarped((right - radius) + Math.cos(a) * radius, (top + radius) + Math.sin(a) * radius);
    }
    // Right edge
    for (let i = 1; i <= edgeSteps; i++) {
      pushWarped(right, (top + radius) + ((bottom - radius) - (top + radius)) * (i / edgeSteps));
    }
    // Bottom-right quarter-circle
    for (let i = 1; i <= arcSteps; i++) {
      const a = (Math.PI * 0.5) * (i / arcSteps);
      pushWarped((right - radius) + Math.cos(a) * radius, (bottom - radius) + Math.sin(a) * radius);
    }
    // Bottom edge
    for (let i = 1; i <= edgeSteps; i++) {
      pushWarped((right - radius) - ((right - radius) - (left + radius)) * (i / edgeSteps), bottom);
    }
    // Bottom-left quarter-circle
    for (let i = 1; i <= arcSteps; i++) {
      const a = Math.PI * 0.5 + (Math.PI * 0.5) * (i / arcSteps);
      pushWarped((left + radius) + Math.cos(a) * radius, (bottom - radius) + Math.sin(a) * radius);
    }
    // Left edge
    for (let i = 1; i <= edgeSteps; i++) {
      pushWarped(left, (bottom - radius) - ((bottom - radius) - (top + radius)) * (i / edgeSteps));
    }
    // Top-left quarter-circle
    for (let i = 1; i < arcSteps; i++) {
      const a = Math.PI + (Math.PI * 0.5) * (i / arcSteps);
      pushWarped((left + radius) + Math.cos(a) * radius, (top + radius) + Math.sin(a) * radius);
    }

    return `M ${pts[0]} L ${pts.slice(1).join(' ')} Z`;
  }

  function buildBezelAndVignette(settings, width, height) {
    const curvNorm = settings.curvature / 100;
    const vigNorm = settings.vignette / 100;

    if (curvNorm <= 0 && vigNorm <= 0) {
      els.bezelSvg.innerHTML = '';
      return;
    }

    const vigMidAlpha = (vigNorm * 0.44).toFixed(3);
    const vigEdgeAlpha = (vigNorm * 0.88).toFixed(3);
    const glassAlpha = (vigNorm * 0.048 + curvNorm * 0.025).toFixed(3);
    const glassMidAlpha = (vigNorm * 0.018 + curvNorm * 0.012).toFixed(3);

    let clipDef = '';
    let bezelPaths = '';
    if (curvNorm > 0) {
      const pathD = buildRoundedBarrelPath(width, height, curvNorm);
      const rimAlpha = (0.10 + curvNorm * 0.14).toFixed(3);
      const shadowAlpha = (0.34 + curvNorm * 0.34).toFixed(3);
      const shadowStroke = (10 + curvNorm * 12).toFixed(1);
      const shadowBlur = (3 + curvNorm * 5).toFixed(1);

      clipDef = `
        <clipPath id="nh-crt-clip"><path d="${pathD}"/></clipPath>
        <filter id="nh-shadow-blur" x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur stdDeviation="${shadowBlur}"/>
        </filter>
      `;
      bezelPaths = `
        <g clip-path="url(#nh-crt-clip)">
          <path fill="none" stroke="rgba(2, 0, 10, ${shadowAlpha})" stroke-width="${shadowStroke}" filter="url(#nh-shadow-blur)" d="${pathD}"/>
        </g>
        <path fill="#04010c" fill-rule="evenodd" d="M 0,0 H ${width} V ${height} H 0 Z ${pathD}"/>
        <path fill="none" stroke="rgba(168, 92, 246, ${rimAlpha})" stroke-width="1" d="${pathD}"/>
      `;
    }

    els.bezelSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    els.bezelSvg.innerHTML = `
      <defs>
        ${clipDef}
        <radialGradient id="nh-vig" cx="50%" cy="50%" r="72%">
          <stop offset="56%" stop-color="rgba(0,0,0,0)"/>
          <stop offset="89%" stop-color="rgba(5,2,14,${vigMidAlpha})"/>
          <stop offset="100%" stop-color="rgba(2,1,8,${vigEdgeAlpha})"/>
        </radialGradient>
        <linearGradient id="nh-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="rgba(255,255,255,${glassAlpha})"/>
          <stop offset="28%" stop-color="rgba(0,240,255,${glassMidAlpha})"/>
          <stop offset="58%" stop-color="rgba(255,255,255,0)"/>
        </linearGradient>
      </defs>
      ${vigNorm > 0 ? `<rect width="${width}" height="${height}" fill="url(#nh-vig)"/><rect width="${width}" height="${height}" fill="url(#nh-glass)"/>` : ''}
      ${bezelPaths}
    `;
  }

  function renderGrainFrame(now) {
    if (!isMounted || document.hidden || !isEffectivelyActive(currentSettings) || !currentSettings.animate || currentSettings.vhs <= 0) {
      grainRafId = 0;
      return;
    }
    if (now - lastGrainTime >= 75) {
      lastGrainTime = now;
      const data = grainImg.data;
      for (let i = 0; i < data.length; i += 4) {
        const luma = (Math.random() * 255) | 0;
        const tintShift = Math.random();
        data[i] = tintShift > 0.65 ? Math.min(255, luma + 35) : luma;
        data[i + 1] = luma;
        data[i + 2] = tintShift < 0.35 ? Math.min(255, luma + 40) : luma;
        data[i + 3] = luma > 175 ? 95 : 8;
      }
      grainCtx.putImageData(grainImg, 0, 0);
    }
    grainRafId = requestAnimationFrame(renderGrainFrame);
  }

  function syncAnimationLoop() {
    const shouldAnimateGrain =
      isMounted &&
      !document.hidden &&
      isEffectivelyActive(currentSettings) &&
      currentSettings.animate &&
      currentSettings.vhs > 0;

    if (shouldAnimateGrain && !grainRafId) {
      grainRafId = requestAnimationFrame(renderGrainFrame);
    } else if (!shouldAnimateGrain && grainRafId) {
      cancelAnimationFrame(grainRafId);
      grainRafId = 0;
    }
  }

  function applySettings(nextSettings) {
    currentSettings = normalizeSettings(nextSettings);
    ensureMounted();
    if (!isMounted) return;

    const active = isEffectivelyActive(currentSettings);
    hostEl.style.display = active ? 'block' : 'none';

    if (!active) {
      els.backdrop.style.backdropFilter = 'none';
      els.scanlines.classList.remove('animating');
      els.sweep.classList.remove('animating');
      els.vhsTracking.classList.remove('animating');
      syncAnimationLoop();
      return;
    }

    const width = Math.max(320, window.innerWidth || 1280);
    const height = Math.max(240, window.innerHeight || 720);

    buildFilterGraph(currentSettings, width, height);
    buildBezelAndVignette(currentSettings, width, height);

    // Scanlines & RGB subpixel grille snapped to integer physical device pixels (prevents DPI moiré)
    const dpr = Math.max(0.5, window.devicePixelRatio || 1);
    let physPeriod = Math.max(4, Math.round(3.2 * dpr));
    if (physPeriod % 2 !== 0) physPeriod += 1;
    const cssHalf = ((physPeriod / 2) / dpr).toFixed(4);
    const cssPeriod = (physPeriod / dpr).toFixed(4);

    const colCss = Math.max(1, Math.round(dpr)) / dpr;
    const c1 = colCss.toFixed(4);
    const c2 = (colCss * 2).toFixed(4);
    const c3 = (colCss * 3).toFixed(4);
    const c4 = (colCss * 4).toFixed(4);

    const scanNorm = currentSettings.scanlines / 100;
    const scanAlpha = (scanNorm * 0.44).toFixed(3);
    const maskAlpha = (scanNorm * 0.065).toFixed(3);
    els.scanlines.style.opacity = scanNorm > 0 ? '1' : '0';
    els.scanlines.style.background = `
      repeating-linear-gradient(
        to bottom,
        transparent 0px,
        transparent ${cssHalf}px,
        rgba(4, 1, 14, ${scanAlpha}) ${cssHalf}px,
        rgba(4, 1, 14, ${scanAlpha}) ${cssPeriod}px
      ),
      repeating-linear-gradient(
        to right,
        rgba(255, 42, 133, ${maskAlpha}) 0px,
        rgba(40, 255, 190, ${maskAlpha}) ${c1}px,
        rgba(0, 195, 255, ${maskAlpha}) ${c2}px,
        transparent ${c3}px,
        transparent ${c4}px
      )
    `;

    // VHS chromatic edge tint, tracking sweep, and analog tape grain
    const vhsNorm = currentSettings.vhs / 100;
    const edgePink = (vhsNorm * 0.14).toFixed(3);
    const edgeCyan = (vhsNorm * 0.16).toFixed(3);
    els.vhsTint.style.opacity = vhsNorm > 0 ? '1' : '0';
    els.vhsTint.style.background = `
      radial-gradient(ellipse at center, transparent 54%, rgba(255, 42, 133, ${edgePink}) 86%, rgba(0, 240, 255, ${edgeCyan}) 100%),
      linear-gradient(90deg, rgba(255, 42, 133, ${(vhsNorm * 0.045).toFixed(3)}) 0%, transparent 10%, transparent 90%, rgba(0, 240, 255, ${(vhsNorm * 0.045).toFixed(3)}) 100%)
    `;
    els.vhsGrain.style.opacity = (vhsNorm * 0.11).toFixed(3);

    const animateInterlace = currentSettings.animate && scanNorm > 0;
    const animateTracking = currentSettings.animate && vhsNorm > 0.12;
    els.scanlines.classList.toggle('animating', animateInterlace);
    els.sweep.style.opacity = animateInterlace ? '1' : '0';
    els.sweep.classList.toggle('animating', animateInterlace);
    els.vhsTracking.style.setProperty('--nh-track-op', (vhsNorm * 0.85).toFixed(2));
    els.vhsTracking.style.opacity = animateTracking ? (vhsNorm * 0.85).toFixed(2) : '0';
    els.vhsTracking.classList.toggle('animating', animateTracking);

    // Draw one initial static noise frame when animation is off but vhs > 0
    if (vhsNorm > 0 && !currentSettings.animate) {
      const data = grainImg.data;
      for (let i = 0; i < data.length; i += 4) {
        const l = ((i * 37) % 255);
        data[i] = l;
        data[i + 1] = l;
        data[i + 2] = l;
        data[i + 3] = l > 180 ? 80 : 20;
      }
      grainCtx.putImageData(grainImg, 0, 0);
    }

    syncAnimationLoop();
  }

  function scheduleResizeReflow() {
    if (rafResizeId) return;
    rafResizeId = requestAnimationFrame(() => {
      rafResizeId = 0;
      if (isEffectivelyActive(currentSettings)) {
        applySettings(currentSettings);
      }
    });
  }

  async function init() {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      applySettings(data[STORAGE_KEY] || DEFAULT_SETTINGS);
    } catch (_) {
      applySettings(DEFAULT_SETTINGS);
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
    applySettings(changes[STORAGE_KEY].newValue);
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'NH_PREVIEW_SETTINGS' && msg.settings) {
      applySettings(msg.settings);
    }
  });

  window.addEventListener('resize', scheduleResizeReflow, { passive: true });
  document.addEventListener('visibilitychange', syncAnimationLoop);

  if (document.documentElement) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  }
})();
