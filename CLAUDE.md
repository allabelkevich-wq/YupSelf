# YupSelf — Правила проекта

## О проекте

YupSelf — сервис AI-генерации изображений. Telegram-бот (@YupSelf_bot) + веб-страница (https://yupself-bot.onrender.com).

## АРХИТЕКТУРА

### Структура проекта
```
YupSelf/
├── bot/
│   ├── index.js          # Бот (grammY) + Express API + статика
│   ├── openrouter.js     # OpenRouter API: генерация + редактирование изображений
│   ├── groq.js           # Groq Whisper: транскрипция голоса
│   └── public/
│       └── index.html    # Веб-страница (SPA)
├── docs/
│   └── tz-web-page.md    # ТЗ на веб-страницу
├── .env                  # Ключи (не в git)
├── .env.example
├── package.json
└── render.yaml           # Конфиг деплоя
```

### Стек технологий
- **Runtime**: Node.js (ESM, `"type": "module"`)
- **Telegram бот**: grammY
- **HTTP**: Express 5
- **AI изображения**: OpenRouter → Gemini 3 Pro Image (NanoBanana Pro)
- **AI промты**: DeepSeek (deepseek-chat)
- **Голос**: Groq Whisper (whisper-large-v3)
- **Хостинг**: Render.com (auto-deploy из main)

### Ключевые API
| API | Назначение | Модель |
|-----|-----------|--------|
| DeepSeek | Улучшение промтов | deepseek-chat |
| OpenRouter | Генерация изображений | google/gemini-3-pro-image-preview |
| laozhang.ai | Fallback генерация | gemini-3-pro-image-preview-c |
| Groq | Транскрипция голоса | whisper-large-v3 |

## СРЕДЫ

| | Production |
|---|---|
| Ветка | `main` |
| URL | https://yupself-bot.onrender.com |
| Render Service | `srv-d78f997fte5s7391fn10` |
| Бот | @YupSelf_bot |

## АБСОЛЮТНЫЕ ПРАВИЛА

### 1. Название проекта
- **YupSelf** — именно так, с большой S
- НЕ "YuPself", НЕ "YuPSelf", НЕ "Yupself"

### 2. Админы
- ADMIN_TELEGRAM_IDS=619065619,454371494
- Алла (619065619) и Ярослав (454371494)
- При старте бота — уведомление админам с датой обновления

### 3. Render API: НИКОГДА не PUT env-vars без полного списка
- `PUT /v1/services/{id}/env-vars` **заменяет ВСЕ переменные**
- ОБЯЗАТЕЛЬНЫЙ порядок: (1) GET → (2) modify → (3) PUT с полным массивом

### 4. Экономия токенов
- Один запрос = одна картинка
- Кнопка "Повторить" для повторной генерации
- DeepSeek для промтов (дешевле чем Gemini для текста)

### 5. Промт-система
- Негативные промты обязательны (анти-клише, анти-stock)
- Если пользователь просит текст на изображении — сохранять в промте
- Длинные тексты → извлечь ключевую идею как визуальную метафору
- `sanitize` — никаких имён реальных художников в промтах

### 6. Генерация изображений
- Формат ответа Gemini: `message.images[0].image_url.url` (base64)
- Fallback chain: OpenRouter → laozhang.ai
- Поддержка `image_config`: aspect_ratio + image_size

### 7. Показывать текст, не путь к файлу
- Когда пользователь просит ТЗ, текст, инструкцию — показывать ТЕКСТ прямо в ответе
- Путь к файлу бесполезен для копирования

## КОМАНДЫ

### Разработка
```bash
cd bot && node --watch index.js    # Dev mode (polling)
```

### Деплой
```bash
git push origin main               # Auto-deploy на Render
curl https://yupself-bot.onrender.com/healthz  # Проверка
```

## API ENDPOINTS

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET | /healthz | Health check |
| POST | /api/generate | Генерация (prompt + style + aspectRatio + imageSize) |
| POST | /api/edit | Редактирование (images[] + prompt) |
| POST | /api/transcribe | Голос → текст (audio file) |

## ENV ПЕРЕМЕННЫЕ

```
BOT_TOKEN              # Telegram bot token (@YupSelf_bot)
OPENROUTER_API_KEY     # OpenRouter (генерация изображений)
LAOZHANG_API_KEY       # Fallback генерация
DEEPSEEK_API_KEY       # Улучшение промтов
GROQ_API_KEY           # Транскрипция голоса
ADMIN_TELEGRAM_IDS     # ID админов через запятую
PORT                   # Порт (default 3000)
WEBHOOK_URL            # URL для webhook (production)
```
