(() => {
  'use strict';

  function t(key, substitutions, fallback) {
    try {
      if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getMessage === 'function') {
        const msg = chrome.i18n.getMessage(key, substitutions);
        if (msg) return msg;
      }
    } catch (_) {}
    if (typeof fallback === 'string' && fallback.length > 0) return fallback;
    return key;
  }

  function getUILanguage() {
    try {
      if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getUILanguage === 'function') {
        return chrome.i18n.getUILanguage() || 'en';
      }
    } catch (_) {}
    return (typeof navigator !== 'undefined' && navigator.language) || 'en';
  }

  function applyI18n(root = document) {
    if (root === document && document.documentElement) {
      document.documentElement.lang = getUILanguage();
    }

    for (const el of root.querySelectorAll('[data-i18n]')) {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key, undefined, el.textContent);
    }

    for (const el of root.querySelectorAll('[data-i18n-title]')) {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.setAttribute('title', t(key, undefined, el.getAttribute('title') || ''));
    }

    for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.setAttribute('placeholder', t(key, undefined, el.getAttribute('placeholder') || ''));
    }

    for (const el of root.querySelectorAll('[data-i18n-aria-label]')) {
      const key = el.getAttribute('data-i18n-aria-label');
      if (key) el.setAttribute('aria-label', t(key, undefined, el.getAttribute('aria-label') || ''));
    }
  }

  globalThis.NeonHorizonI18n = Object.freeze({
    t,
    getUILanguage,
    applyI18n
  });
})();
