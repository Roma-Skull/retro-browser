# Chrome Web Store Listing — Neon Horizon — CRT & VHS Shader (Extension v1.0.1)

## Upload Package
- **File to upload:** `dist/chrome/releases/extension-v1.0.1/neon-horizon-crt-vhs-shader-v1.0.1.zip`

## Store Icon & Promotional Graphics (`browsers/chrome/store/extension/`)
- **Store icon (`128x128` 32-bit RGBA PNG, `96x96` visual + `16px` transparent padding):** `store-icon-128.png`
- **Small promo tile (`440x280` 24-bit opaque PNG):** `promo-small-440x280.png`
- **Marquee / large promo tile (`1400x560` 24-bit opaque PNG):** `promo-marquee-1400x560.png`
- **Screenshots (capture from your Chrome window before submitting):** 1–5 full-bleed `1280x800` or `640x400` PNG/JPEG screenshots with square corners (recommended: New Tab WebGL2 scene with the **CRT / VHS** drawer open, popup controls over a website, and **Outrun 84** / **VHS Tape** preset comparisons).

---

## Listing Copy (English)

### Title (`name`, auto-read from `manifest.json`)
`Neon Horizon — CRT & VHS Shader`

### Summary (`132` chars max — auto-read from `manifest.json` `description`)
`Retro CRT curvature, interlaced scanlines, phosphor bloom glow, and analog VHS shader overlay with live intensity controls.`

### Category Recommendation
- **Primary category:** `Lifestyle & Entertainment` → `Fun` (or `Personalization` / `Tools`, depending on Chrome Web Store Dashboard options)
- **Language:** English

### Detailed Description
```text
Transform your browser into an authentic 1980s cathode-ray monitor and analog VHS deck — complete with a live WebGL2 Synthwave New Tab page.

Neon Horizon — CRT & VHS Shader adds a customizable, non-intrusive visual post-processing layer over websites alongside a real-time animated Outrun New Tab experience.

Key Features:
• Real-Time CRT & VHS Website Overlay — Applies smooth barrel screen curvature inside a rounded CRT glass bezel, DPI-locked interlaced scanlines with an RGB subpixel grille (moire-free at 100%, 125%, 150%, and 200% scaling), phosphor bloom glow, analog VHS chromatic edge tint, tape grain, tracking sweep, and curved glass vignette.
• Animated WebGL2 New Tab — Features a two-pass GLSL Synthwave scene (infinite forward-scrolling neon grid, sliced Outrun sun with breathing corona, low-poly wireframe mountains, and twinkling starfield) rendered through hardware-accelerated CRT curvature, bloom, scanlines, and VHS post-processing.
• Ready-to-Use Presets (VHS Tape Default) — Switch instantly between VHS Tape (active by default on install), Soft CRT, Outrun 84, and Minimal, or fine-tune all 6 live sliders independently (Curvature, Scanlines, Bloom, VHS & Chromaticity, Scan Sweep, Glass & Vignette).
• Separate Profiles for Websites & New Tab — Customize your New Tab shader separately or enable "Sync with sites" / "Copy" from either the extension popup or the on-page CRT / VHS dock. You can also toggle the live background animation independently.
• Built-In New Tab Productivity — Clean digital clock & date, multi-engine search bar (Google, Yandex, DuckDuckGo, Bing, or direct URL navigation), and customizable Quick Links seeded from your top sites.
• Instant Controls & Per-Site Exclusions — Toggle the shader globally anytime with Alt+Shift+V or exclude specific domains with one click in the popup.

Privacy-First & Lightweight:
• All rendering runs 100% locally in your browser using CSS, SVG filters, Canvas, and WebGL2.
• Zero external network requests, zero analytics, and zero user tracking.
• Pairs seamlessly with the companion "Neon Horizon — Synthwave" Chrome theme (optional).
```

---

## Privacy Practices & Permission Justifications

- **Single purpose:** Applies a customizable retro CRT & VHS visual shader overlay to web pages and provides an animated WebGL2 Synthwave New Tab page.
- **Permission justifications:**
  - `storage`: Saves shader presets, slider intensities, per-domain exclusion list, selected search engine, and custom Quick Links locally via `chrome.storage.local`.
  - `activeTab`: Reads the active tab's URL/hostname when the user opens the popup so the extension can toggle exclusions for the current site and send live slider preview updates.
  - `topSites`: Reads frequently visited sites locally to populate initial Quick Links on the custom New Tab page when no custom links have been saved yet.
  - Host access (`<all_urls>` content script): Injects a pointer-events-none Shadow DOM overlay (`nh-crt-shader`) on web pages to render the local CRT/VHS visual effect.
- **Data usage certification:** Does not collect, store remotely, sell, or transfer any personal or browsing data. All settings and rendering remain strictly on the user's device.
- **Account status:** Verified contact email required; select **Non-trader** if publishing as an individual/personal project.
