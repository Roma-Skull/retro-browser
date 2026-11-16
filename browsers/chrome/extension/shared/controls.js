(() => {
  'use strict';

  /**
   * Binds shared CRT/VHS preset chips, range sliders, animation toggle, and reset button
   * inside a container element for both the extension popup and the New Tab drawer.
   */
  function createShaderProfileController({
    root,
    getProfile,
    onPatch,
    onReset
  }) {
    const { SLIDER_KEYS, PRESETS } = globalThis.NeonHorizonDefaults;

    const toggleEnabled = root.querySelector('[data-role="toggle-enabled"]');
    const toggleAnimate = root.querySelector('[data-role="toggle-animate"]');
    const resetBtn = root.querySelector('[data-role="reset-btn"]');
    const presetBtns = Array.from(root.querySelectorAll('[data-preset]'));

    function render() {
      const profile = getProfile();
      if (toggleEnabled) toggleEnabled.checked = Boolean(profile.enabled);
      if (toggleAnimate) toggleAnimate.checked = Boolean(profile.animate);

      for (const key of SLIDER_KEYS) {
        const input = root.querySelector(`[data-slider="${key}"]`);
        const readout = root.querySelector(`[data-val="${key}"]`);
        const val = profile[key];
        if (input) input.value = String(val);
        if (readout) readout.textContent = `${val}%`;
      }

      for (const btn of presetBtns) {
        btn.classList.toggle('active', btn.dataset.preset === profile.preset);
      }

      return profile;
    }

    if (toggleEnabled) {
      toggleEnabled.addEventListener('change', () => {
        onPatch({ enabled: toggleEnabled.checked }, true);
      });
    }

    if (toggleAnimate) {
      toggleAnimate.addEventListener('change', () => {
        onPatch({ animate: toggleAnimate.checked, preset: 'custom' }, true);
      });
    }

    for (const btn of presetBtns) {
      btn.addEventListener('click', () => {
        const presetId = btn.dataset.preset;
        const preset = PRESETS[presetId];
        if (!preset) return;
        onPatch({ ...preset, enabled: true, preset: presetId }, true);
      });
    }

    for (const key of SLIDER_KEYS) {
      const input = root.querySelector(`[data-slider="${key}"]`);
      if (!input) continue;
      input.addEventListener('input', () => {
        onPatch({ [key]: Number(input.value), preset: 'custom' }, false);
      });
      input.addEventListener('change', () => {
        onPatch({ [key]: Number(input.value), preset: 'custom' }, true);
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        onReset();
      });
    }

    return { render };
  }

  globalThis.NeonHorizonControls = Object.freeze({
    createShaderProfileController
  });
})();
