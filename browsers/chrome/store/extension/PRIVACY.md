# Privacy Policy — Neon Horizon — CRT & VHS Shader

**Effective Date:** November 19, 2026  
**Extension Name:** Neon Horizon — CRT & VHS Shader

## 1. Overview
**Neon Horizon — CRT & VHS Shader** ("the Extension") is a browser customization extension that renders retro CRT and VHS visual effects over web pages. We respect your privacy: the Extension operates **100% locally on your device** and does **not** collect, store remotely, share, or sell any personal or browsing data.

## 2. Information We Do Not Collect
The Extension does **not** collect, log, or transmit:
- Personally identifiable information (name, email address, IP address, identifiers)
- Browsing history, visited URLs, search queries, or webpage content
- Authentication credentials, form inputs, cookies, or financial data
- Usage analytics, crash telemetry, or advertising identifiers

All visual post-processing (SVG filters, CSS overlays, and Canvas grain) executes strictly inside your local browser instance with zero external network requests made by the Extension.

## 3. Local Storage & Browser Permissions
The Extension uses standard Chromium extension APIs solely to deliver its core visual customization features locally on your machine:

- **`storage` (`chrome.storage.local`)**: Stores your shader presets, slider intensities, and per-domain exclusion list (`nhCrtSettings`) locally in your browser. This data never leaves your device.
- **`activeTab`**: Accessed only when you open the Extension popup to read the current tab's URL/hostname (for toggling per-site exclusions) and to send live slider preview updates to that active tab.
- **Host access (`<all_urls>` content script)**: Required to inject a lightweight, non-interactive (`pointer-events: none`) Shadow DOM visual overlay onto web pages so the CRT curvature, scanlines, bloom, and VHS effects appear across websites you visit. The content script does not read, scrape, modify, or transmit webpage text, forms, or user activity.

## 4. Third-Party Sharing & Transfers
Because the Extension collects no user data, **no data is ever sold, transferred, or shared with third parties**.

## 5. Data Retention & Deletion
All preferences remain solely in your browser's local extension storage (`chrome.storage.local`). You can reset settings at any time using the **Reset** button in the Extension UI, or completely remove all locally stored preferences by uninstalling the Extension from your browser.

## 6. Changes to This Privacy Policy
If the Extension's data practices ever change, this Privacy Policy will be updated with a new effective date alongside the corresponding Extension release.

## 7. Contact
If you have questions about this Privacy Policy, please contact the developer via the support / contact email or repository listed on the Chrome Web Store page for **Neon Horizon — CRT & VHS Shader**.
