# Observability setup — YupSelf

Одноразовая настройка внешних сервисов. Всё бесплатное.

## 1. Sentry (уже интегрирован в код)

**Цель:** видеть каждую unhandled ошибку и падение fetch к AI-провайдерам в реальном времени.

### Шаги

1. Открой https://sentry.io → Create Organization (если нет).
2. **Create Project** → выбери платформу **Node.js** → назови `yupself-bot`.
3. Sentry выдаст DSN в формате `https://xxx@o123456.ingest.sentry.io/123456`.
4. В Render Dashboard → `yupself-bot` сервис → **Environment** → добавь:
   - `SENTRY_DSN` = (DSN из шага 3)
   - `SENTRY_ENVIRONMENT` = `production` (по желанию)
5. Save — Render сам перезапустит pod.

В логах при старте должно появиться: `[sentry] initialised env=production`.

### Проверка что работает

Через `/start` в боте отправь заведомо-ломающий запрос (например, `/api/astro/generate` с неверной датой). В Sentry Issues должна появиться запись в течение ~30 секунд.

### Рекомендуемые алерты (Sentry → Alerts)

| Условие | Действие |
|---|---|
| `any issue` with tag `area: yuppay/webhook` | Email/Telegram админу мгновенно |
| `event count > 20` за 5 минут | Email админу |
| New issue (первое появление) | Email админу |

## 2. UptimeRobot — аптайм `/healthz`

**Цель:** узнать за 1 минуту, если Render положил pod или ответ `/healthz` перестал быть 200.

### Шаги

1. Регистрация на https://uptimerobot.com (free plan — 50 мониторов, чек раз в 5 минут).
2. **Add New Monitor** → тип **HTTP(s)**.
3. Параметры:
   - **URL:** `https://yupself-bot.onrender.com/healthz`
   - **Monitoring Interval:** 5 minutes
   - **Monitor Timeout:** 30 seconds
   - **Alert Contacts:** email Аллы + email Ярослава (оба — добавь через My Settings → Alert Contacts)
4. **Advanced:**
   - **Keyword Monitoring**: tick, keyword = `"status":"ok"` — чтобы мониторить НЕ просто 200, но и что `jobsTable: true`.
5. Save.

Дашборд сразу покажет зелёный статус. Если сервис упадёт — письмо прилетит в течение ~6 минут (5 мин проверка + 1 мин на алерт).

### Альтернатива (платная, но быстрее): Better Stack Uptime

Чек раз в 30 секунд, Telegram-бот для алертов, удобнее визуал. Стоит ~$9/мес.

## 3. Render dashboard → логи

Sentry ловит ошибки, но для диагностики нужна история логов. Render Starter держит логи **24 часа**.

Если нужно дольше — включи Log Streams в Render на Papertrail (free 50MB/мес) или Loggly. Это решается без правок кода — через Render Dashboard → Settings → Log Streams.

## 4. Метрики продукта (опционально, следующий шаг)

Когда будешь готова — добавь PostHog / Amplitude для продуктовой аналитики:
- событие `generate_started` / `generate_completed` / `generate_failed`
- событие `payment_succeeded` по каналам (DARAI / Stars)
- retention когорты
- воронка `/start → first_generate → paid`

Без этого сейчас нельзя ответить на вопрос "какой % юзеров покупает Искры".
