importScripts('shared/defaults.js');

(() => {
  'use strict';

  const { STORAGE_KEY, DEFAULT_SETTINGS, normalizeSettings } = globalThis.NeonHorizonDefaults;

  function updateBadge(enabled) {
    chrome.action.setBadgeText({ text: enabled ? 'ON' : 'OFF' });
    chrome.action.setBadgeBackgroundColor({
      color: enabled ? '#00C8DF' : '#3A235E'
    });
    chrome.action.setBadgeTextColor({
      color: enabled ? '#0B0718' : '#CEBAF2'
    });
  }

  async function syncBadgeFromStorage() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const settings = normalizeSettings(data[STORAGE_KEY] || DEFAULT_SETTINGS);
    updateBadge(settings.enabled);
  }

  chrome.runtime.onInstalled.addListener(async () => {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    if (!data[STORAGE_KEY]) {
      await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_SETTINGS });
    }
    await syncBadgeFromStorage();
  });

  chrome.runtime.onStartup.addListener(syncBadgeFromStorage);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
    const next = normalizeSettings(changes[STORAGE_KEY].newValue);
    updateBadge(next.enabled);
  });

  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-shader') return;
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const current = normalizeSettings(data[STORAGE_KEY]);
    const updated = { ...current, enabled: !current.enabled };
    await chrome.storage.local.set({ [STORAGE_KEY]: updated });
    updateBadge(updated.enabled);
  });
})();
