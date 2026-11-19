(() => {
  'use strict';

  const SLIDER_KEYS = Object.freeze(['curvature', 'scanlines', 'bloom', 'vhs', 'sweep', 'vignette']);

  const PRESETS = Object.freeze({
    soft: Object.freeze({
      curvature: 14,
      scanlines: 28,
      bloom: 32,
      vhs: 22,
      sweep: 35,
      vignette: 35,
      animate: true
    }),
    outrun: Object.freeze({
      curvature: 24,
      scanlines: 45,
      bloom: 58,
      vhs: 38,
      sweep: 55,
      vignette: 55,
      animate: true
    }),
    vhs: Object.freeze({
      curvature: 40,
      scanlines: 52,
      bloom: 36,
      vhs: 75,
      sweep: 60,
      vignette: 48,
      animate: true
    }),
    minimal: Object.freeze({
      curvature: 0,
      scanlines: 18,
      bloom: 22,
      vhs: 8,
      sweep: 0,
      vignette: 18,
      animate: false
    })
  });

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    preset: 'vhs',
    curvature: PRESETS.vhs.curvature,
    scanlines: PRESETS.vhs.scanlines,
    bloom: PRESETS.vhs.bloom,
    vhs: PRESETS.vhs.vhs,
    sweep: PRESETS.vhs.sweep,
    vignette: PRESETS.vhs.vignette,
    animate: PRESETS.vhs.animate,
    disabledHosts: []
  });

  function clampPercent(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(100, Math.round(num)));
  }

  function normalizeProfile(raw, defaults) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      enabled: typeof src.enabled === 'boolean' ? src.enabled : defaults.enabled,
      preset: typeof src.preset === 'string' ? src.preset : defaults.preset,
      curvature: clampPercent(src.curvature, defaults.curvature),
      scanlines: clampPercent(src.scanlines, defaults.scanlines),
      bloom: clampPercent(src.bloom, defaults.bloom),
      vhs: clampPercent(src.vhs, defaults.vhs),
      sweep: clampPercent(src.sweep, defaults.sweep),
      vignette: clampPercent(src.vignette, defaults.vignette),
      animate: typeof src.animate === 'boolean' ? src.animate : defaults.animate
    };
  }

  function normalizeSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const hosts = Array.isArray(src.disabledHosts)
      ? Array.from(new Set(src.disabledHosts.filter((h) => typeof h === 'string' && h.length > 0)))
      : [];

    return {
      ...normalizeProfile(src, DEFAULT_SETTINGS),
      disabledHosts: hosts
    };
  }

  globalThis.NeonHorizonDefaults = Object.freeze({
    STORAGE_KEY: 'nhCrtSettings',
    SLIDER_KEYS,
    DEFAULT_SETTINGS,
    PRESETS,
    normalizeSettings
  });
})();
