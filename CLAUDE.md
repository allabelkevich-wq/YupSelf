# YupSelf — Правила проекта

## О проекте

YupSelf — сервис AI-генерации изображений по натальной карте. Telegram-бот (@YupSelf_bot) + веб-страница (Mini App).

## АБСОЛЮТНЫЕ ЗАПРЕТЫ (нарушение = баг)

### 1. Название проекта
- **YupSelf** — именно так, с большой S
- НЕ "YuPself", НЕ "YuPSelf", НЕ "Yupself"

### 2. "Натальная карта" в пользовательском тексте
- ЗАПРЕЩЕНО в UI, сообщениях бота, описаниях
- РАЗРЕШЕНО только в системных промтах для DeepSeek
- ЗАМЕНА: "персональный расклад", "дата рождения"

### 3. Астрологические термины в промтах для Gemini
- ЗАПРЕЩЕНО: названия планет, знаков, домов, аспектов в промте для генерации изображения
- Gemini получает только визуальные описания: цвета, текстуры, свет, композиция

### 4. Удаление данных пользователей
- ЗАПРЕЩЕНО удалять генерации, профили, сохранённые лица
- Только `UPDATE ... SET status = 'deleted'`

### 5. Деплой без проверки
- ЗАПРЕЩЕНО: пушить в main без `node --check bot/index.js`
- ПОСЛЕ КАЖДОГО деплоя: `curl https://yupself-bot.onrender.com/healthz` → HTTP 200

### 6. НИКОГДА не пушить в main без явной команды
- Все изменения сначала проверяются
- Пуш только по команде

### 7. ЗАПРЕЩЕНО говорить "готово" без проверки
- Перед "готово": проверить curl-ом или preview
- Если frontend — скриншот preview

### 8. Render API: НИКОГДА не PUT env-vars без полного списка
- `PUT /v1/services/{id}/env-vars` **заменяет ВСЕ переменные**
- ОБЯЗАТЕЛЬНЫЙ порядок: (1) GET → (2) modify → (3) PUT с полным массивом

### 9. Данные анкеты сохраняются навсегда
- Имя, дата, время, место, пол — сохраняются при первом вводе
- Аккордеон показывает сводку, кнопка "Изменить" для редактирования
- `formReset()` ЗАПРЕЩЁН

### 10. Показывать текст, не путь к файлу
- ТЗ, промты, инструкции — показывать прямо в ответе для копирования

### 11. НЕ маскировать симптомы — искать корневые причины
- "Мы не заклеиваем пластырями, а устраняем корневые причины"
- Каждый фикс = архитектурно верное решение на перспективу

### 12. НЕ ставить под сомнение слова пользователя
- Если пользователь говорит что загрузил фото — значит загрузил
- Если говорит что ошибка есть — значит есть
- Искать баг в коде, не в действиях пользователя

## СТАНДАРТЫ БЕЗОПАСНОСТИ

### Сравнение секретов
- `crypto.timingSafeEqual` для токенов, паролей

### Ошибки
- User-facing: "Ошибка генерации" без деталей
- Логи: полная ошибка в console.error

### Случайные значения
- `crypto.randomBytes()` для кодов, токенов, ID

## АРХИТЕКТУРА

### Стек технологий
- **Runtime**: Node.js (ESM, `"type": "module"`)
- **Telegram бот**: grammY
- **HTTP**: Express 5
- **AI изображения**: laozhang.ai (primary) → OpenRouter (fallback)
- **AI промты**: DeepSeek (deepseek-chat)
- **Астрология**: Simplified JS chart (без swisseph на Render)
- **Голос**: Groq Whisper (whisper-large-v3-turbo)
- **БД**: Supabase (uersovccoomwukrdzodd)
- **Хостинг**: Render.com (auto-deploy из main)

### Ключевые файлы
| Файл | Назначение |
|------|-----------|
| `bot/index.js` | Бот + Express API + статика |
| `bot/openrouter.js` | Генерация + редактирование изображений |
| `bot/astro-worker.js` | Pipeline: geocode → карта → DeepSeek → Gemini |
| `bot/groq.js` | Транскрипция голоса |
| `bot/db.js` | Supabase: пользователи, генерации, токены |
| `bot/darai-pay.js` | Платежи в DARAI (NEAR Protocol) |
| `bot/sessions.js` | Сессии, Face Memory |
| `bot/prompts/astro-visual-prompt.txt` | Маппинг астро → визуал (15KB) |
| `bot/public/index.html` | Веб-страница (SPA) |

### Среды
| | Production |
|---|---|
| Ветка | `main` |
| URL | https://yupself-bot.onrender.com |
| Render Service | `srv-d78f997fte5s7391fn10` |
| Бот | @YupSelf_bot |
| Supabase | `uersovccoomwukrdzodd` |

### Админы
- Алла (619065619) и Ярослав (454371494)
- ADMIN_TELEGRAM_IDS=619065619,454371494

## API ENDPOINTS

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET | /healthz | Health check |
| POST | /api/generate | Генерация (async, возвращает jobId) |
| GET | /api/job/:id | Поллинг результата |
| GET | /api/download/:id | Скачивание изображения |
| POST | /api/edit | Редактирование по референсу (async) |
| POST | /api/astro/generate | Астро-генерация (async) |
| GET | /api/places?q= | Автокомплит городов |
| POST | /api/transcribe | Голос → текст |
| POST | /api/auth | Авторизация |
| GET | /api/profile/:id | Профиль + статистика |
| GET | /api/history/:id | История генераций |
| POST | /api/face/save | Сохранить лицо |
| GET | /api/faces/:id | Список сохранённых лиц |
| POST | /api/payment/create | Создать платёж DARAI |
| GET | /api/payment/check/:id | Проверить платёж |
| GET | /api/packages | Пакеты токенов |

## ПАТТЕРНЫ КОДА

- Async генерация: POST → jobId → polling `/api/job/:id` каждые 3 сек
- localStorage обёрнут в try/catch (Telegram WebView блокирует)
- Фото сжимается до 1024x1024 JPEG перед отправкой
- Face передаётся как base64 в JSON (не через faceId)
- Geocoding: Nominatim → Photon → hardcoded cities
- laozhang.ai = primary API, OpenRouter = fallback
- Cache-bust: `/?v=timestamp` при каждом деплое

## ENV ПЕРЕМЕННЫЕ

```
BOT_TOKEN              # @YupSelf_bot
OPENROUTER_API_KEY     # OpenRouter (fallback)
LAOZHANG_API_KEY       # laozhang.ai (primary, дешевле)
DEEPSEEK_API_KEY       # Промты
GROQ_API_KEY           # Голос
SUPABASE_URL           # БД
SUPABASE_SERVICE_KEY   # БД
ADMIN_TELEGRAM_IDS     # Админы
WEBHOOK_URL            # Webhook URL
PORT                   # 3000
```
