(() => {
  'use strict';

  const {
    STORAGE_KEY,
    DEFAULT_SETTINGS,
    normalizeSettings
  } = globalThis.NeonHorizonDefaults;
  const { createShaderProfileController } = globalThis.NeonHorizonControls;
  const { t, applyI18n } = globalThis.NeonHorizonI18n;

  let state = normalizeSettings(DEFAULT_SETTINGS);
  let activeTabId = null;
  let activeHostname = '';
  let activeProtocol = '';
  let saveTimer = 0;

  const panel = document.getElementById('popup-panel');
  const toggleSiteBtn = document.getElementById('toggle-site');
  const siteLabel = document.getElementById('site-label');

  let profileCtrl = null;

  function renderUI() {
    const profile = profileCtrl ? profileCtrl.render() : state;
    document.body.classList.toggle('is-disabled', !profile.enabled);

    if (!activeHostname) {
      toggleSiteBtn.disabled = true;
      toggleSiteBtn.classList.remove('is-excluded');
      if (activeProtocol === 'file:') {
        siteLabel.textContent = t('siteInfoLocalFile', undefined, 'Local file (file://)');
      } else {
        siteLabel.textContent = t('siteInfoInternalPage', undefined, 'Browser internal page (no website active)');
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
    getProfile: () => state,
    onPatch: (patch, immediate) => {
      state = normalizeSettings({ ...state, ...patch });
      commitUpdate(immediate);
    },
    onReset: () => {
      state = normalizeSettings({
        ...DEFAULT_SETTINGS,
        disabledHosts: state.disabledHosts
      });
      commitUpdate(true);
    }
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
