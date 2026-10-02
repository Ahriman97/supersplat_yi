# SuperSplat Yi

Форк [SuperSplat Editor](https://github.com/playcanvas/supersplat) v2.32.3
с расширенным выделением по глубине, preview-логикой, автоматизацией
локального запуска и интеграцией локального SAM-сервера.

## Что добавлено к оригиналу

### Управление глубиной выбора

- **Selection Depth (N)** — переключение между управляемой и
  неуправляемой глубиной выбора.
- **Selection Footprint (J)** — переключение метода выбора гауссов:
  по центрам или по кругам (эллипсам на экране).
- **Cut Depth** — максимальная глубина выбора в юнитах сцены:
  - `0` — выбор насквозь (без ограничения).
  - `> 0` — выбор только в пределах N юнитов от ближайшего
    выделенного гаусса.
- **Ctrl+wheel** — изменение Cut Depth на 1 юнит в большую и
  меньшую стороны.

### Preview и фиксация

- **Preview** — live-обновление выделения при изменении Cut Depth
  (debounce 80 мс).
- **Apply (кнопка)** — фиксация preview в истории (можно откатить
  через `Ctrl+Z`).
- **Enter** — то же, что Apply, но горячей клавишей.
- **Ctrl+Z** — отмена preview (если активен) или последнего op из
  истории.
- **Ctrl+Shift+Z** — возврат отменённого.

### Раскладка

Все горячие клавиши привязаны к физическим клавишам (`e.code`),
поэтому работают в любой раскладке (русская, английская и т.д.).

### SAM (Segment Anything Model)

Локальный SAM-сервер для сегментации объектов по клику. Разворачивается
в Docker-контейнере вместе с редактором. Это **наше новшество** —
в оригинальном SuperSplat такого нет.

## Установка

### Требования

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
  (с поддержкой GPU, если хотите ускорение через CUDA)
- [Git for Windows](https://git-scm.com/download/win) (с Git Bash)
- [Node.js](https://nodejs.org/) 18+
- Microsoft Edge
- NVIDIA GPU (опционально, но рекомендуется для SAM)

### Вариант 1 — быстрый запуск через .bat-лаунчер (Windows)

1. Скопируйте проект в одну из папок:
   - `%USERPROFILE%\Documents\work\supersplat_yi` (приоритет)
   - `%USERPROFILE%\Documents\supersplat_yi` (fallback)

2. Запустите `supersplat_launcher.bat` (двойной клик).

3. Лаунчер спросит, обновлять ли проект из git:
   - **Y** — `git pull` + пересборка Docker-образа SAM (если файлы
     сервера изменились по хешу).
   - **N** — запуск со старой версией.

4. Что произойдёт автоматически:
   - Поиск свободного порта для SAM-сервера (диапазон:
     8000, 8001, 8002, 8003, 8010, 8080, 8090, 9000).
   - Запуск Docker-контейнера `sam-server`.
   - Ожидание готовности `/health` (до 60 секунд).
   - **Smoke-тест SAM-сервера**.
   - Запуск dev-сервера SuperSplat (`npm run develop`).
   - Открытие Microsoft Edge с изолированным профилем.

5. Если smoke-тест не пройдёт — лаунчер сообщит об ошибке и не
   запустит редактор.

### Вариант 2 — ручная установка (Node.js, без SAM)

Требуется Node.js 18+.

```sh
git clone https://github.com/Ahriman97/supersplat_yi.git
cd supersplat_yi
npm install
npm run develop
```

Откройте http://localhost:3000

При изменениях в исходниках проект пересобирается автоматически.
SAM-сервер при этом **не** запускается — редактор работает без
сегментации.

## Архитектура

```
supersplat_yi/
├── src/                          # исходники редактора
│   ├── editor.ts                 # логика выделения и preview
│   ├── edit-history.ts           # история с поддержкой preview
│   ├── tools/
│   │   └── selection-depth-tool.ts  # UI панели Cut Depth
│   └── shortcut-manager.ts       # реестр горячих клавиш
├── server_sam/                   # SAM-сервер (FastAPI + Docker)
│   ├── sam_server.py             # FastAPI-приложение
│   ├── download_model.py         # загрузка чекпоинта SAM
│   ├── Dockerfile                # NVIDIA CUDA + Python 3.11 + PyTorch
│   ├── docker-compose.yml        # запуск контейнера
│   ├── requirements.txt          # зависимости Python
│   ├── models/
│   │   └── sam_vit_b_01ec64.pth  # чекпоинт SAM ViT-B (~375 МБ)
│   └── tests/
│       ├── test_smoke.sh         # smoke-тест сервера
│       └── test_image.jpg        # тестовое изображение
├── supersplat_launcher.bat       # диспетчер (Y/N → update или core)
├── supersplat_update.bat         # git pull + пересборка образа
├── supersplat_core.bat           # Docker + SAM + smoke-тест + Edge
└── README.md
```

## SAM-сервер

SAM (Segment Anything Model) — нейросеть от Meta для сегментации
объектов по клику. В этом форке SAM разворачивается локально
в Docker-контейнере.

### Модель

По умолчанию используется **SAM ViT-B** (`vit_b`) — самая лёгкая
версия (~375 МБ, ~5–10 секунд загрузки в VRAM). Для более точной
сегментации можно поменять на `vit_l` или `vit_h` в
`docker-compose.yml` (переменная `SAM_MODEL_TYPE`), но потребуется
больше VRAM и другой чекпоинт.

### API

- `GET /health` — статус сервера.
  ```json
  {
    "status": "ok",
    "model": "vit_b",
    "device": "cuda",
    "cuda_available": true
  }
  ```

- `POST /segment` — сегментация по изображению + координатам клика.
  - `image` (form-data): PNG-скриншот сцены.
  - `x` (form-data): нормализованная X-координата (0..1).
  - `y` (form-data): нормализованная Y-координата (0..1).
  - Ответ: PNG с RGBA-маской (альфа-канал = маска).
  - Заголовки: `X-SAM-Score` (уверенность), `X-SAM-Time` (секунды).

### Smoke-тест

`server_sam/tests/test_smoke.sh` — Bash-скрипт, проверяющий:

- `/health` → 200 + `status:ok`.
- `/segment` → 200 + непустая маска.
- `X-SAM-Score ≥ 0.7` — уверенность.
- `X-SAM-Time ≤ 10s` — скорость.

Запускается автоматически через `supersplat_core.bat`. Если тест
падает — редактор не запускается.

## Горячие клавиши (наши дополнения)

| Клавиша | Действие |
|---|---|
| `N` | Selection Depth вкл/выкл |
| `J` | Selection Footprint (центры/круги) |
| `Ctrl+wheel` | Cut Depth ±1 |
| `Enter` | Apply (фиксация preview) |
| `Ctrl+Z` | Отмена preview или последнего op |
| `Ctrl+Shift+Z` | Возврат отменённого |

## Известные ограничения

- Cut Depth считается от 5-го перцентиля глубин выделенных гауссов
  (отсекает floater'ы у камеры).
- Очень большие PLY (8+ ГБ) могут упираться в лимит `ArrayBuffer`
  браузера.
- SAM на CPU работает медленно (~10–30 секунд на кадр); для
  интерактивности нужна NVIDIA GPU с CUDA.
- Docker-контейнер SAM требует NVIDIA Container Toolkit для GPU.

## Лицензия

MIT. См. LICENSE.

## Благодарности

- [PlayCanvas SuperSplat](https://github.com/playcanvas/supersplat) —
  оригинальный редактор.
- [Segment Anything](https://github.com/facebookresearch/segment-anything) —
  модель SAM от Meta.