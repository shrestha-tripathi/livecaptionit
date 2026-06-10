# LiveCaptionIt — Design System (v0.1)

Visual contract. Tokens, type, spacing, anti-patterns. Companion to AGENTS.md.

## Design philosophy

- **Vercel-lite aesthetic.** Geist + Geist Mono, monochrome palette, shadow-as-border (no `border-*` utilities), subtle elevation. Match the worksoffline.in family.
- **Cyan brand exception.** A single accent color (`oklch(70% 0.14 200)` light, `oklch(78% 0.14 200)` dark) is the ONLY non-monochrome surface. Reserved for active/recording states + the primary CTA.
- **Light default, dark via toggle.** First paint = light theme. localStorage persists user choice. Both must pass WCAG AA — verify with DOM measurement, not vision.

## Color tokens (defined in `src/styles/global.css` `@theme`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-bg` | `#ffffff` | `#0a0a0a` | Page background |
| `--color-surface` | `#f5f5f5` | `#151515` | Card / panel background |
| `--color-surface-strong` | `#ebebeb` | `#1e1e1e` | Hovered card / pressed button |
| `--color-fg` | `#0a0a0a` | `#fafafa` | Primary text |
| `--color-fg-muted` | `#525252` | `#a3a3a3` | Body text muted |
| `--color-fg-subtle` | `#737373` | `#737373` | Captions, meta |
| `--color-line` | `#e5e5e5` | `#262626` | Shadow-as-border |
| `--color-line-strong` | `#d4d4d4` | `#404040` | Active-state border |
| `--color-brand` | `oklch(70% 0.14 200)` | `oklch(78% 0.14 200)` | Brand accent (cyan) |
| `--color-brand-strong` | `oklch(60% 0.16 200)` | `oklch(85% 0.15 200)` | Hovered brand |
| `--color-brand-soft` | `oklch(96% 0.04 200)` | `oklch(20% 0.08 200)` | Brand pill background |
| `--color-brand-glow` | `oklch(70% 0.14 200 / 0.25)` | `oklch(78% 0.14 200 / 0.30)` | Halo animation |
| `--color-rec` | `oklch(60% 0.22 25)` | `oklch(70% 0.22 25)` | "LIVE" recording indicator |

## Typography

- **Geist Sans** for UI (`font-family: var(--font-sans)`)
- **Geist Mono** for caption stream + code (`font-family: var(--font-mono)`)
  - Captions in mono = "live terminal" feel, more readable when text streams in
- Sizes: defaults are Tailwind's standard scale (`text-sm`, `text-base`, `text-lg`...). Don't add custom sizes without a reason.

## Layout

- Max widths:
  - Hero / FAQ: `max-w-3xl mx-auto`
  - Tool + 3-step grid: `max-w-4xl mx-auto`
- Horizontal padding: `px-4 sm:px-6`
- Vertical rhythm: `pt-10 sm:pt-16 pb-16` page, `mt-20` section break

## Brand mark

Speech bubble (rounded square with tail) + PiP mini-bubble in the lower-right corner. Caption lines inside the main bubble visually riff on what the tool does. Lives in `src/components/BrandIcon.astro`. Reused in `public/favicon.svg` with the same path data.

## Anti-patterns (DO NOT)

1. ❌ Use `border-*` utilities — use `shadow-line` / `shadow-line-strong` instead
2. ❌ Stack opacity on muted text tokens — fails WCAG on light theme (already-tuned)
3. ❌ Use rainbow / multi-color gradients — that's screencolorpicker's brand language, not LiveCaptionIt's
4. ❌ Add cyan accent anywhere outside the "active recording" + "primary CTA" + "brand pill" surfaces — the wedge dilutes if it's everywhere
5. ❌ Use `text-xs` for body-flow content — minimum `text-sm` for muted text (else fails WCAG)
6. ❌ Use animation without `prefers-reduced-motion` respect (already handled globally)
7. ❌ Hardcode hex colors in components — always reference `var(--color-*)` tokens
