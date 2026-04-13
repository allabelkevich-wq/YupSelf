# YupSelf Design System

Справочник по стилю Mini App YupSelf. Все значения — **без привязки к цветам** (цвета вынесены в CSS-переменные, легко заменяются).

---

## Шрифт

- **Семейство:** `'Manrope', sans-serif`
- **Подключение:** Google Fonts — `wght@400;500;600;800`
- **Начертания:**
  - 400 — тело текста, placeholder, описания
  - 500 — chip, навигация
  - 600 — кнопки, промт-текст, result-bar
  - 700 — заголовки, имена, секции, cab-name, label (uppercase)
  - 800 — логотип, gen-btn, cab-balance-num, badge, cab-login-btn

---

## Кнопки

### Главная кнопка (`.gen-btn`)
```css
width: 100%;
padding: 16px;
border-radius: 9999px;           /* pill-shaped */
border: none;
font-size: 16px;
font-weight: 800;
box-shadow: 0 8px 25px rgba(0,0,0,0.3);
transition: all 0.3s;
/* hover */
transform: translateY(-2px);
box-shadow: 0 12px 35px rgba(0,0,0,0.45);
/* active */
transform: translateY(0);
/* disabled */
opacity: 0.5; cursor: not-allowed;
```

### Вторичная кнопка (`.cab-topup`)
```css
padding: 10px 24px;
border-radius: 9999px;
border: 1px solid;               /* accent border */
background: transparent;
font-size: 13px;
font-weight: 700;
/* hover */
background: rgba(0,0,0,0.1);
```

### Кнопка действия (`.rbtn`)
```css
flex: 1;
padding: 11px 14px;
border-radius: 12px;
border: 1px solid;
backdrop-filter: blur(10px);
font-size: 13px;
font-weight: 600;
text-align: center;
transition: all 0.2s;
/* hover */
color: white;
```

### Кнопка-акцент (`.rbtn.accent`)
```css
border-color: transparent;
font-weight: 600;
box-shadow: 0 2px 10px rgba(0,0,0,0.3);
```

### Кнопка логина (`.cab-login-btn`)
```css
padding: 14px 28px;
border-radius: 9999px;
border: none;
font-size: 15px;
font-weight: 700;
```

### Копировать (`.cab-referral-copy`)
```css
padding: 6px 14px;
border-radius: 9999px;
border: none;
font-size: 11px;
font-weight: 700;
```

---

## Chip / Tag (`.chip`)

```css
padding: 7px 14px;
border-radius: 9999px;
border: 1px solid;
font-size: 12px;
font-weight: 500;
white-space: nowrap;
transition: all 0.2s;
/* hover */
transform: translateY(-1px);
/* active state (.on) */
border-color: transparent;
font-weight: 600;
box-shadow: 0 2px 10px rgba(0,0,0,0.3);
```

### Мобильный chip (< 600px)
```css
flex-shrink: 0;
font-size: 11px;
padding: 6px 12px;
```

---

## Glass Panel (`.glass`)

```css
width: 100%;
max-width: 820px;
backdrop-filter: blur(40px);
-webkit-backdrop-filter: blur(40px);
border: 1px solid;
border-radius: 28px;
padding: 36px;
box-shadow:
    0 0 0 1px rgba(255,255,255,0.03) inset,
    0 30px 80px -20px rgba(0,0,0,0.7),
    0 0 40px -10px rgba(0,0,0,0.25);
```

### Мобильный glass (< 600px)
```css
padding: 16px 12px;
border-radius: 18px;
width: 100%;
max-width: 100%;
```

---

## Input / Textarea

### Textarea
```css
width: 100%;
min-height: 110px;
background: rgba(0,0,0,0.3);
border: 1px solid;
border-radius: 16px;
padding: 18px 52px 18px 18px;    /* right padding for voice btn */
font-size: 16px;
line-height: 1.5;
resize: none;
outline: none;
transition: border-color 0.3s, box-shadow 0.3s;
/* focus */
box-shadow: 0 0 0 3px rgba(0,0,0,0.15), 0 0 20px rgba(0,0,0,0.15);
```

### Input (астро-форма)
```css
width: 100%;
padding: 12px;
border-radius: 12px;
background: rgba(0,0,0,0.25);
border: 1px solid;
font-size: 14px;
outline: none;
```

### Select
```css
flex: 1;
padding: 10px;
border-radius: 12px;
background: rgba(0,0,0,0.25);
border: 1px solid;
font-size: 13px;
```

---

## Карточки

### Stat Card (`.cab-stat`)
```css
padding: 14px;
border-radius: 14px;
border: 1px solid;
```
- Число: `font-size: 20px; font-weight: 800`
- Label: `font-size: 11px; margin-top: 2px`

### Balance Card (`.cab-balance`)
```css
text-align: center;
padding: 20px;
border: 1px solid;
border-radius: 20px;
margin-bottom: 20px;
```
- Число: `font-size: 36px; font-weight: 800` (mobile: 28px)
- Label: `font-size: 12px; margin-top: 4px`

### Referral Card (`.cab-referral`)
```css
padding: 14px;
border-radius: 14px;
border: 1px solid;
display: flex;
align-items: center;
gap: 10px;
```
- Code: `font-size: 13px; font-family: monospace; word-break: break-all`

### History Item (`.cab-history-item`)
```css
aspect-ratio: 1;
border-radius: 10px;
overflow: hidden;
border: 1px solid;
position: relative;
```
- Grid: `grid-template-columns: repeat(3, 1fr); gap: 6px`

---

## Reference Upload Zone (`.ref-zone`)

```css
border: 2px dashed;
border-radius: 16px;
padding: 16px;
text-align: center;
transition: all 0.2s;
/* hover */
border-color: accent;
/* has-files state */
border-style: solid;
```

### Thumbnail
```css
width: 56px;
height: 56px;
border-radius: 10px;
object-fit: cover;
border: 1px solid;
```

---

## Bottom Navigation (`.bottom-nav`)

```css
position: fixed;
bottom: 0; left: 0; right: 0;
display: flex;
z-index: 100;
backdrop-filter: blur(20px);
border-top: 1px solid;
padding: 8px 0 env(safe-area-inset-bottom, 8px);
```

### Tab (`.nav-tab`)
```css
flex: 1;
display: flex;
flex-direction: column;
align-items: center;
padding: 8px 0;
gap: 4px;
font-size: 10px;
font-weight: 600;
border: none;
background: none;
```
- Icon: `width: 22px; height: 22px`

---

## Avatar (`.cab-avatar`)

```css
width: 52px;
height: 52px;
border-radius: 50%;
display: flex;
align-items: center;
justify-content: center;
font-size: 22px;
font-weight: 800;
```

---

## Loading Animation

### Orb (`.loading-orb`)
```css
width: 64px;
height: 64px;               /* mobile: 48px */
border-radius: 50%;
animation: spin 2s linear infinite, pulse 1.5s ease-in-out infinite;
```

### Text
```css
font-size: 14px;
```

### Progress Dots
```css
width: 6px;
height: 6px;
border-radius: 50%;
opacity: 0.3;                /* .done: opacity: 1 */
```

---

## Result Image

```css
width: 100%;
border-radius: 20px;
box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 30px rgba(0,0,0,0.25);
```

---

## Aurora Background

3 блоба с `filter: blur(120px)`, `opacity: 0.3`, `border-radius: 50%`.
Размеры: 600px, 500px, 400px.
Анимация: `ease-in-out infinite alternate`, 18-25s.

```css
@keyframes aurora-drift {
    0%   { transform: translate(0, 0) scale(1); }
    33%  { transform: translate(60px, -40px) scale(1.1); }
    66%  { transform: translate(-40px, 30px) scale(0.95); }
    100% { transform: translate(20px, -20px) scale(1.05); }
}
```

---

## Typography Scale

| Element | Size | Weight | Extra |
|---------|------|--------|-------|
| Logo | 48px (mobile: 32px) | 800 | letter-spacing: -2px, gradient text |
| Subtitle | 15px | 400 | — |
| Section Label | 10px | 700 | uppercase, letter-spacing: 2px |
| Body text | 16px | 400 | line-height: 1.5 |
| Button primary | 16px (mobile: 15px) | 800 | — |
| Button secondary | 13px | 700 | — |
| Chip | 12px (mobile: 11px) | 500 (active: 600) | — |
| Tab label | 10px | 600 | — |
| Counter | 13px (mobile: 11px) | 400 | — |
| Stat number | 20px | 800 | — |
| Balance number | 36px (mobile: 28px) | 800 | — |
| Name (cabinet) | 18px | 700 | — |
| Tariff badge | 11px | 700 | uppercase, letter-spacing: 1px |
| Footer | 12px | 400 | — |
| Analysis text | 13px | 400 | line-height: 1.6 |

---

## Border Radius Scale

| Element | Radius |
|---------|--------|
| Buttons (primary, secondary, chips, copy, badge) | `9999px` (pill) |
| Glass panel | `28px` (mobile: `18px`) |
| Result image | `20px` |
| Textarea | `16px` |
| Input / Select | `12px` |
| Stat card, referral card, payment card | `14px` |
| Balance card | `20px` |
| Reference thumbnail | `10px` |
| History item | `10px` |
| Result bar button | `12px` |
| Voice button | `10px` |
| Autocomplete dropdown | `12px` |
| Avatar | `50%` |
| Loading orb | `50%` |

---

## Spacing

| Context | Value |
|---------|-------|
| Page padding | `48px 20px 60px` (mobile: `16px 8px 80px`) |
| Glass padding | `36px` (mobile: `16px 12px`) |
| Section gap (chips) | `margin-bottom: 18px` |
| Label → content | `margin-bottom: 10px` |
| Input gap (astro form) | `gap: 10px` |
| Chip gap | `gap: 6px` |
| Result bar gap | `gap: 8px` |
| Bottom nav tab padding | `8px 0` |
| History grid gap | `6px` (mobile: `4px`) |
| Cabinet header gap | `gap: 14px` |
| Stats grid gap | `gap: 10px` (mobile: `6px`) |

---

## Transitions & Animations

| Element | Transition |
|---------|------------|
| All buttons | `transition: all 0.2s` or `0.3s` |
| Hover lift | `transform: translateY(-2px)` |
| Active press | `transform: translateY(0)` |
| Focus glow | `box-shadow: 0 0 0 3px glow, 0 0 20px glow` |
| Result appear | `@keyframes fade-up { from { opacity:0; translateY(20px) } to { opacity:1 } }` duration `0.6s` |
| Loading orb | `spin 2s linear infinite` + `pulse 1.5s ease-in-out infinite` |
| Aurora blobs | `drift 18-25s ease-in-out infinite alternate` |
| Recording pulse | `rec-pulse 1.5s ease-in-out infinite` |

---

## Responsive Breakpoint

Единственный: `@media (max-width: 600px)` — мобильная адаптация.

---

## Паттерны

- **Все кнопки pill-shaped** (`border-radius: 9999px`) — это ключевой визуальный маркер
- **Glass morphism** — `backdrop-filter: blur(40px)`, полупрозрачные фоны
- **Мягкие тени** — `box-shadow` с большим spread и blur
- **Hover = подъём** — `translateY(-2px)` на интерактивных элементах
- **Focus = свечение** — `box-shadow` с accent glow
- **Один шрифт** — Manrope для всего (от 10px до 48px)
- **Dark-first** — все полупрозрачные фоны на тёмной основе
