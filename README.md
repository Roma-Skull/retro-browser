# Neon Horizon — Retro Synthwave Browser Kit

Комплект ретро-оформления в эстетике Synthwave / Outrun 84 и аналогового CRT/VHS-шейдера, организованный по браузерам. Сейчас полностью реализована версия для **Chromium-браузеров** (**Google Chrome**, **Яндекс Браузер**, Edge, Brave, Opera — Manifest V3), а структура репозитория подготовлена для добавления **Mozilla Firefox** и **Microsoft Edge**.

---

## Структура репозитория

```text
retro-browser/
├── assets/                          # Общие исходные арт-ассеты (ntp_source.jpg)
└── browsers/
    ├── chrome/                      # Готовая реализация для Chromium (Chrome, Яндекс Браузер и др., MV3)
    │   ├── theme/                   # Тема оформления браузера (manifest.json + 12 PNG)
    │   ├── extension/               # Расширение CRT & VHS Shader для веб-страниц
    │   ├── scripts/
    │   │   ├── generate_assets.ps1  # Генератор PNG-ассетов из assets/ntp_source.jpg
    │   │   └── package.ps1          # Валидатор и сборщик ZIP/CRX-архивов в dist/chrome/
    │   └── preview.html             # Локальное превью интерфейса Chrome-темы
    ├── firefox/                     # Задел под Mozilla Firefox
    └── edge/                        # Задел под Microsoft Edge
```

---

## Google Chrome и Яндекс Браузер (`browsers/chrome/`)

Состоит из двух взаимодополняющих Manifest V3 пакетов:

1. **Тема оформления ([`browsers/chrome/theme/`](browsers/chrome/theme/))** — стилизует окно браузера, вкладки, панель инструментов, адресную строку, закладки, режим Инкогнито и стандартные цвета интерфейса.
2. **Расширение CRT & VHS Shader ([`browsers/chrome/extension/`](browsers/chrome/extension/))**:
   - **На веб-сайтах (`http://`, `https://`):**
     - реальный CRT barrel-изгиб контента внутри сглаженной векторной ЭЛТ-рамки с мягкой тенью трубки (`buildRoundedBarrelPath` + `backdrop-filter` со сглаживанием кромки без выхода за пределы экрана);
     - чересстрочный сканлайн и субпиксельная RGB-решётка с привязкой к `devicePixelRatio` (без муара на `100%`, `125%`, `150%`, `200%`);
     - оптическое свечение люминофора (**Bloom**) через SVG `backdrop-filter`;
     - **VHS-лента и хроматика** (краевой цианово-маджентовый сдвиг, плёночное зерно и полоса трекинга);
     - **Стекло и виньетка**;
     - быстрое включение/выключение по `Alt + Shift + V`, 4 пресета (**Мягкий CRT**, **Outrun 84**, **VHS-кассета**, **Минимум**), 6 живых ползунков и исключения по доменам.
   - **Совместимость с Яндекс Браузером и Opera:** расширение не использует `chrome_url_overrides` и не подменяет Новую вкладку/Табло, поэтому без ошибок устанавливается напрямую из Chrome Web Store в Google Chrome, Яндекс Браузер, Microsoft Edge, Brave и Opera.

### Локальная установка (Chrome / Яндекс Браузер)

1. Откройте `chrome://extensions/` (или `browser://extensions/` в Яндекс Браузере) и включите **Режим разработчика** (*Developer mode*).
2. Для темы нажмите **Загрузить распакованное расширение** (*Load unpacked*) и выберите папку **`browsers/chrome/theme`**.
3. Для шейдера нажмите **Загрузить распакованное расширение** ещё раз и выберите папку **`browsers/chrome/extension`**.

---

## Пересборка и упаковка (Chrome / Chromium)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File browsers\chrome\scripts\generate_assets.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File browsers\chrome\scripts\package.ps1 -Release
```

Готовые архивы сохраняются в `dist/chrome/` (`neon-horizon-synthwave-theme.zip`, `neon-horizon-crt-vhs-shader.zip`) и релизные пакеты (`.zip`, `.crx`, `SHA256SUMS.txt`) в `dist/chrome/releases/`.
