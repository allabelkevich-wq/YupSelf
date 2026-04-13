# Алгоритм генерации персонального образа по дате рождения

## Источник
Проверенный алгоритм на примере Ольги (Архетип Глубинной Жрицы).
Должен быть интегрирован в DeepSeek промт YupSelf astro-worker.

---

## БЛОК 1: АСТРО-ЯДРО

### 1.1 Доминирующая стихия
- Считаем планеты в каждой стихии (Огонь/Земля/Воздух/Вода)
- Асцендент добавляет внешнюю "оболочку"
- Луна добавляет эмоциональную текстуру

### 1.2 Тип фигуры по планетам
| Комбинация | Тип | Характеристики |
|---|---|---|
| Венера+Лагна в воде | Софт Драматик | Узкие плечи/бёдра, выраженная талия, мягкость, длинная вертикаль |
| Венера в Рыбах | +текучесть | Одежда не обтягивает, а "обтекает" |
| Марс в 8-м доме | +стройность | Внутренняя напряжённость |
| Венера в Козероге | Классик | Структурная элегантность |
| Венера в Тельце | Натурал | Чувственность, земная красота |
| Венера во Льве | Драматик | Выраженные контуры, яркость |

### 1.3 Цветовая палитра по планетам
| Планета | Цвета | Роль |
|---|---|---|
| Лагна (знак) | Глубокие тона знака | Основа образа |
| Солнце | Внутреннее свечение | Акцент |
| Луна | Эмоциональные тона | Мягкие детали |
| Венера | Комфортные тона | Натуральность |
| Марс | Яркие вспышки | Точечные акценты |
| Сатурн | Структурные тона | Дисциплина, каркас |

### 1.4 Фактуры по планетам
| Планета | Фактура | Ткани |
|---|---|---|
| Венера в Рыбах | Мягкая, текучая | Кашемир, шёлк, велюр |
| Сатурн в Водолее | Структурная, чёткая | Шерсть, лён, кожа |
| Лагна в Скорпионе | Плотная, защитная | Бархат, твид, драп |
| Венера в Тельце | Тактильная, природная | Хлопок, лён, замша |
| Венера во Льве | Роскошная, заметная | Атлас, парча, мех |

---

## БЛОК 2: ПСИХОЛОГИЧЕСКИЙ ПРОФИЛЬ

### 2.1 Отношение к телу
- Вода: комфорт > демонстрация, намёки вместо обнажения
- Огонь: уверенность, открытость, выраженные силуэты
- Земля: практичность, натуральность, заземлённость
- Воздух: лёгкость, многослойность, движение

### 2.2 Зона комфорта
- Сатурн в 1 доме → многослойность, защита
- Много воды → натуральные ткани, тактильность
- Много огня → яркие акценты, открытые линии
- Много земли → практичная обувь, структурные силуэты

---

## БЛОК 3: КАРТА СООТВЕТСТВИЙ ДЛЯ ПРОМТА

### Стихия → Личность
| Стихия | Ключевые слова для промта |
|---|---|
| Вода | mysterious, deep, fluid, magnetic, calm intensity |
| Земля | grounded, practical, structured, natural, earthy |
| Огонь | passionate, dynamic, bold, vibrant, intense |
| Воздух | light, ethereal, intellectual, airy, delicate |

### Асцендент → Внешность
| Лагна | Ключевые слова |
|---|---|
| Скорпион | magnetic gaze, powerful presence, controlled vulnerability |
| Рыбы | dreamy eyes, soft features, ethereal quality |
| Телец | sensual, stable, earthy beauty, strong bone structure |
| Стрелец | open expression, athletic build, free-spirited |
| Лев | dramatic features, regal posture, commanding presence |
| Козерог | serious expression, angular features, classic elegance |
| Овен | sharp features, athletic build, energetic stance |
| Близнецы | youthful appearance, expressive eyes, animated |
| Рак | soft, nurturing appearance, round features |
| Дева | refined features, understated elegance, meticulous |
| Весы | balanced features, harmonious proportions, graceful |
| Водолей | unique features, unconventional beauty, distinctive |

### Стихия → Окружение
| Стихия | Окружение | Свет |
|---|---|---|
| Вода | autumnal park, misty forest, waterfront | golden hour, soft overcast |
| Земля | botanical garden, stone path, wheat field | morning light, dappled sun |
| Огонь | sunset beach, red rock canyon, rooftop | dramatic sunset, harsh shadows |
| Воздух | modern architecture, open plaza, hilltop | bright diffused, blue hour |

---

## БЛОК 4: ШАБЛОН ПРОМТА

```
Full body portrait of a woman/man, [NAME]. [PERSONALITY_DESCRIPTION].
She/He has a [BODY_TYPE] figure: [BODY_DETAILS].

**OUTFIT FROM TOP TO BOTTOM:**
- **TOP:** [TYPE] in [COLOR_1] [FABRIC_1]. [DETAIL].
- **BOTTOM:** [TYPE] in [COLOR_2] [FABRIC_2].
- **OUTERWEAR:** [TYPE] in [COLOR_3] [FABRIC_3].
- **SHOES:** [TYPE] in [COLOR_4].
- **ACCESSORIES:** [BAG] in [COLOR_5]. [JEWELRY] in [METAL] with [STONE].
- **HAIR & MAKEUP:** [HAIRSTYLE] in [HAIR_COLOR]. [MAKEUP].

**SCENE & STYLE:**
[LIGHTING]. [MOOD]. Photorealistic, 85mm lens, full body visible.
Color palette: [PALETTE].
```

---

## БЛОК 5: ЧЕК-ЛИСТ КАЧЕСТВА

1. Настроение соответствует доминирующей стихии?
2. Асцендент отражён в "оболочке" (взгляд, осанка)?
3. Есть акцентный цвет от Луны/Марса?
4. Фактуры сочетаются (мягкое + твёрдое)?
5. Есть защита/укрытие (если Сатурн сильный)?
6. Комфорт > демонстрация (для водных)?
7. Фигура видна полностью?
8. Свет глубокий, не плоский?

---

## ПАЙПЛАЙН ДЛЯ ПРИЛОЖЕНИЯ

```
ДАТА РОЖДЕНИЯ
     ↓
АСТРО-РАСЧЁТ (стихии, асцендент, планеты)
     ↓
МАППИНГ → ПАРАМЕТРЫ ОБРАЗА
(тип фигуры, палитра, фактуры, силуэты)
     ↓
DeepSeek: СБОРКА ПРОМТА ПО ШАБЛОНУ
     ↓
NanoBanana Pro + FACE REFERENCE
     ↓
ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЯ
```
