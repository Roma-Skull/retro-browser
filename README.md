# Neon Horizon — Retro Synthwave Browser Kit

Комплект ретро-оформления в эстетике Synthwave / Outrun 84 и аналогового CRT/VHS-шейдера, организованный по браузерам. Сейчас полностью реализована версия для **Google Chrome** (Manifest V3), а структура репозитория подготовлена для добавления **Mozilla Firefox** и **Microsoft Edge**.

---

## Структура репозитория

```text
retro-browser/
├── assets/                          # Общие исходные арт-ассеты (ntp_source.jpg)
└── browsers/
    ├── chrome/                      # Готовая реализация для Google Chrome (MV3)
    │   ├── theme/                   # Тема оформления браузера (manifest.json + 12 PNG)
    │   ├── extension/               # Расширение CRT & VHS Shader + живая WebGL2 новая вкладка
    │   ├── scripts/
    │   │   ├── generate_assets.ps1  # Генератор 12 PNG-ассетов из assets/ntp_source.jpg
    │   │   └── package.ps1          # Валидатор и сборщик ZIP-архивов в dist/chrome/
    │   └── preview.html             # Локальное превью интерфейса Chrome-темы
    ├── firefox/                     # Задел под Mozilla Firefox
    └── edge/                        # Задел под Microsoft Edge
```

---

## Google Chrome (`browsers/chrome/`)

Состоит из двух взаимодополняющих Manifest V3 пакетов:

1. **Тема оформления ([`browsers/chrome/theme/`](browsers/chrome/theme/))** — стилизует окно Chrome, вкладки, панель инструментов, адресную строку, закладки, режим Инкогнито и стандартные цвета интерфейса.
2. **Расширение CRT & VHS Shader ([`browsers/chrome/extension/`](browsers/chrome/extension/))**:
   - **На веб-сайтах (`http://`, `https://`):**
     - реальный CRT barrel-изгиб контента внутри сглаженной векторной ЭЛТ-рамки с мягкой тенью трубки (`buildRoundedBarrelPath` + `backdrop-filter` со сглаживанием кромки без выхода за пределы экрана);
     - чересстрочный сканлайн и субпиксельная RGB-решётка с привязкой к `devicePixelRatio` (без муара на `100%`, `125%`, `150%`, `200%`);
     - оптическое свечение люминофора (**Bloom**) через SVG `backdrop-filter`;
     - **VHS-лента и хроматика** (краевой цианово-маджентовый сдвиг, плёночное зерно и полоса трекинга);
     - **Стекло и виньетка**;
     - быстрое включение/выключение по `Alt + Shift + V` и исключения по доменам.
   - **Живая Новая вкладка (`newtab.html`):**
     - оптимизированный многопроходный **WebGL2 GLSL-шейдер (24 FPS)**: процедурная анимированная синтвейв-сцена в масштабе `60%` с кэшем дальнего фона (`bgCacheFbo`, обновление раз в 4 кадра), вынесенным низкоразрешённым проходом **Bloom** (`1/9` разрешения сцены, пропуск при `0%`), скоростью сетки `50%` и нативным проходом CRT/VHS с тригонометрически-свободными сканлайнами (`+50%` ширины) и виньеткой;
     - строка поиска (`Google`, `Яндекс`, `DuckDuckGo`, `Bing` или прямой ввод URL), часы и плитки быстрых сайтов (`topSites` + пользовательские закладки);
     - отдельный профиль настроек для новой вкладки с переключателями **«Синхр. с сайтами»** и **«Живой фон (полёт над сеткой)»** как в попапе расширения, так и в кнопке **CRT / VHS** на самой новой вкладке.

### Установка в Google Chrome

1. Откройте `chrome://extensions/` и включите **Режим разработчика** (*Developer mode*).
2. Нажмите **Загрузить распакованное расширение** (*Load unpacked*) и выберите папку **`browsers/chrome/theme`**.
3. Нажмите **Загрузить распакованное расширение** ещё раз и выберите папку **`browsers/chrome/extension`**.
4. При открытии новой вкладки (`Ctrl + T`) подтвердите сохранение новой вкладки, если Chrome покажет баннер.

---

## Пересборка и упаковка (Chrome)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File browsers\chrome\scripts\generate_assets.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File browsers\chrome\scripts\package.ps1 -Release
```

Готовые архивы сохраняются в `dist/chrome/` (`neon-horizon-synthwave-theme.zip`, `neon-horizon-crt-vhs-shader.zip`) и релизные пакеты (`.zip`, `.crx`, `SHA256SUMS.txt`) в `dist/chrome/releases/`.
