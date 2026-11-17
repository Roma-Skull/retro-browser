(() => {
  'use strict';

  const SLIDER_KEYS = Object.freeze(['curvature', 'scanlines', 'bloom', 'vhs', 'sweep', 'vignette']);

  const DEFAULT_QUICK_LINKS = Object.freeze([
    { title: 'Google', url: 'https://www.google.com' },
    { title: 'YouTube', url: 'https://www.youtube.com' },
    { title: 'GitHub', url: 'https://github.com' },
    { title: 'Gmail', url: 'https://mail.google.com' }
  ]);

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

  const DEFAULT_NEWTAB_SETTINGS = Object.freeze({
    enabled: true,
    syncWithSites: false,
    animateBg: true,
    preset: 'vhs',
    curvature: PRESETS.vhs.curvature,
    scanlines: PRESETS.vhs.scanlines,
    bloom: PRESETS.vhs.bloom,
    vhs: PRESETS.vhs.vhs,
    sweep: PRESETS.vhs.sweep,
    vignette: PRESETS.vhs.vignette,
    animate: PRESETS.vhs.animate
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
    disabledHosts: [],
    newTab: DEFAULT_NEWTAB_SETTINGS
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
    const ntRaw = src.newTab && typeof src.newTab === 'object' ? src.newTab : {};

    return {
      ...normalizeProfile(src, DEFAULT_SETTINGS),
      disabledHosts: hosts,
      newTab: {
        ...normalizeProfile(ntRaw, DEFAULT_NEWTAB_SETTINGS),
        syncWithSites: typeof ntRaw.syncWithSites === 'boolean'
          ? ntRaw.syncWithSites
          : DEFAULT_NEWTAB_SETTINGS.syncWithSites,
        animateBg: typeof ntRaw.animateBg === 'boolean'
          ? ntRaw.animateBg
          : DEFAULT_NEWTAB_SETTINGS.animateBg
      }
    };
  }

  function resolveNewTabProfile(settings) {
    const normalized = normalizeSettings(settings);
    if (!normalized.newTab.syncWithSites) {
      return normalized.newTab;
    }
    return {
      ...normalized.newTab,
      enabled: normalized.enabled,
      preset: normalized.preset,
      curvature: normalized.curvature,
      scanlines: normalized.scanlines,
      bloom: normalized.bloom,
      vhs: normalized.vhs,
      sweep: normalized.sweep,
      vignette: normalized.vignette,
      animate: normalized.animate
    };
  }

  globalThis.NeonHorizonDefaults = Object.freeze({
    STORAGE_KEY: 'nhCrtSettings',
    QUICK_LINKS_KEY: 'nhQuickLinks',
    SEARCH_ENGINE_KEY: 'nhSearchEngine',
    SLIDER_KEYS,
    DEFAULT_QUICK_LINKS,
    DEFAULT_SETTINGS,
    DEFAULT_NEWTAB_SETTINGS,
    PRESETS,
    normalizeSettings,
    resolveNewTabProfile
  });
})();
