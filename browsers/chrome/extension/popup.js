(() => {
  'use strict';

  const {
    STORAGE_KEY,
    DEFAULT_SETTINGS,
    DEFAULT_NEWTAB_SETTINGS,
    normalizeSettings,
    resolveNewTabProfile
  } = globalThis.NeonHorizonDefaults;
  const { createShaderProfileController } = globalThis.NeonHorizonControls;
  const { t, applyI18n } = globalThis.NeonHorizonI18n;

  let state = normalizeSettings(DEFAULT_SETTINGS);
  let activeScope = 'sites'; // 'sites' | 'newtab'
  let activeTabId = null;
  let activeHostname = '';
  let activeProtocol = '';
  let activeIsExtensionNewTab = false;
  let saveTimer = 0;

  const panel = document.getElementById('popup-panel');
  const scopeSitesBtn = document.getElementById('scope-sites');
  const scopeNewTabBtn = document.getElementById('scope-newtab');
  const siteRow = document.getElementById('site-row');
  const toggleSiteBtn = document.getElementById('toggle-site');
  const siteLabel = document.getElementById('site-label');
  const newTabSyncRow = document.getElementById('newtab-sync-row');
  const syncCheckbox = document.getElementById('popup-sync-sites');
  const copySitesBtn = document.getElementById('popup-copy-sites');
  const newTabAnimBgRow = document.getElementById('newtab-animbg-row');
  const animBgCheckbox = document.getElementById('popup-animate-bg');
  const curvatureLabel = document.getElementById('label-curvature');

  let profileCtrl = null;

  function renderUI() {
    const isNewTabScope = activeScope === 'newtab';
    scopeSitesBtn.classList.toggle('active', !isNewTabScope);
    scopeSitesBtn.setAttribute('aria-selected', isNewTabScope ? 'false' : 'true');
    scopeNewTabBtn.classList.toggle('active', isNewTabScope);
    scopeNewTabBtn.setAttribute('aria-selected', isNewTabScope ? 'true' : 'false');

    siteRow.hidden = isNewTabScope;
    newTabSyncRow.hidden = !isNewTabScope;
    newTabAnimBgRow.hidden = !isNewTabScope;
    curvatureLabel.textContent = isNewTabScope
      ? t('labelCurvatureWebgl', undefined, 'Screen curvature (WebGL2)')
      : t('labelCurvatureCrt', undefined, 'Screen curvature (CRT)');

    const profile = profileCtrl ? profileCtrl.render() : state;
    document.body.classList.toggle('is-disabled', !profile.enabled);

    syncCheckbox.checked = Boolean(state.newTab.syncWithSites);
    animBgCheckbox.checked = Boolean(state.newTab.animateBg);
    copySitesBtn.disabled = Boolean(state.newTab.syncWithSites);

    if (!activeHostname) {
      toggleSiteBtn.disabled = true;
      toggleSiteBtn.classList.remove('is-excluded');
      if (activeIsExtensionNewTab) {
        siteLabel.textContent = t('siteInfoOpenWebpage', undefined, 'Website settings (open a webpage tab)');
      } else if (activeProtocol === 'file:') {
        siteLabel.textContent = t('siteInfoLocalFile', undefined, 'Local file (file://)');
      } else {
        siteLabel.textContent = t('siteInfoInternalPage', undefined, 'Chrome internal page (no website active)');
      }
    } else {
      const excluded = state.disabledHosts.includes(activeHostname);
      toggleSiteBtn.disabled = false;
      toggleSiteBtn.classList.toggle('is-excluded', excluded);
      siteLabel.textContent = excluded
        ? t('enableForHost', [activeHostname], `Enable for ${activeHostname}`)
        : t('disableForHost', [activeHostname], `Disable for ${activeHostname}`);
    }
  }

  function sendLivePreview() {
    if (activeTabId == null) return;
    chrome.tabs.sendMessage(activeTabId, {
      type: 'NH_PREVIEW_SETTINGS',
      settings: state
    }).catch(() => {});
  }

  function persistImmediate() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = 0;
    }
    chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  function persistDebounced() {
    sendLivePreview();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = 0;
      chrome.storage.local.set({ [STORAGE_KEY]: state });
    }, 50);
  }

  function commitUpdate(immediate) {
    renderUI();
    if (immediate) {
      sendLivePreview();
      persistImmediate();
    } else {
      persistDebounced();
    }
  }

  profileCtrl = createShaderProfileController({
    root: panel,
    getProfile: () => (activeScope === 'newtab' ? resolveNewTabProfile(state) : state),
    onPatch: (patch, immediate) => {
      if (activeScope === 'newtab' && !state.newTab.syncWithSites) {
        state = normalizeSettings({
          ...state,
          newTab: { ...state.newTab, ...patch }
        });
      } else {
        state = normalizeSettings({ ...state, ...patch });
      }
      commitUpdate(immediate);
    },
    onReset: () => {
      if (activeScope === 'newtab' && !state.newTab.syncWithSites) {
        state = normalizeSettings({
          ...state,
          newTab: { ...DEFAULT_NEWTAB_SETTINGS, syncWithSites: false }
        });
      } else {
        state = normalizeSettings({
          ...DEFAULT_SETTINGS,
          disabledHosts: state.disabledHosts,
          newTab: state.newTab
        });
      }
      commitUpdate(true);
    }
  });

  scopeSitesBtn.addEventListener('click', () => {
    activeScope = 'sites';
    renderUI();
  });

  scopeNewTabBtn.addEventListener('click', () => {
    activeScope = 'newtab';
    renderUI();
  });

  syncCheckbox.addEventListener('change', () => {
    state = normalizeSettings({
      ...state,
      newTab: { ...state.newTab, syncWithSites: syncCheckbox.checked }
    });
    commitUpdate(true);
  });

  animBgCheckbox.addEventListener('change', () => {
    state = normalizeSettings({
      ...state,
      newTab: { ...state.newTab, animateBg: animBgCheckbox.checked }
    });
    commitUpdate(true);
  });

  copySitesBtn.addEventListener('click', () => {
    state = normalizeSettings({
      ...state,
      newTab: {
        enabled: state.enabled,
        preset: state.preset,
        curvature: state.curvature,
        scanlines: state.scanlines,
        bloom: state.bloom,
        vhs: state.vhs,
        sweep: state.sweep,
        vignette: state.vignette,
        animate: state.animate,
        syncWithSites: false
      }
    });
    commitUpdate(true);
  });

  toggleSiteBtn.addEventListener('click', () => {
    if (!activeHostname) return;
    const hosts = [...state.disabledHosts];
    const idx = hosts.indexOf(activeHostname);
    if (idx >= 0) {
      hosts.splice(idx, 1);
    } else {
      hosts.push(activeHostname);
    }
    state = normalizeSettings({ ...state, disabledHosts: hosts });
    commitUpdate(true);
  });

  async function init() {
    applyI18n();
    const [tabData, stored] = await Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      chrome.storage.local.get(STORAGE_KEY)
    ]);

    state = normalizeSettings(stored[STORAGE_KEY] || DEFAULT_SETTINGS);

    const tab = tabData && tabData[0];
    if (tab) {
      activeTabId = tab.id;
      const tabUrl = tab.url || '';
      const ownNewTabUrl = chrome.runtime?.getURL ? chrome.runtime.getURL('newtab.html') : '';
      if ((ownNewTabUrl && tabUrl.startsWith(ownNewTabUrl)) || tabUrl.startsWith('chrome://newtab')) {
        activeIsExtensionNewTab = true;
        activeScope = 'newtab';
      }
      try {
        const parsed = new URL(tabUrl);
        activeProtocol = parsed.protocol;
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          activeHostname = parsed.hostname;
        }
      } catch (_) {}
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
      state = normalizeSettings(changes[STORAGE_KEY].newValue);
      renderUI();
    });

    renderUI();
  }

  init();
})();
