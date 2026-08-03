# Design system

Buildable source of truth: `src/presentation/styles/tokens.css` (raw CSS variables) mapped into Tailwind utilities in `src/presentation/styles/index.css` via `@theme inline`. Keep this doc and those files in sync.

## Principles (research-backed — Linear/Vercel productivity aesthetic)
- Quiet cool-neutral base carries the UI; content leads. Never pure black/white.
- **One** trustworthy primary (indigo) + **one** restrained accent (teal). Accent = "currently tracking" only, so a running timer visibly pops.
- Semantic colors **never** double as brand.
- WCAG AA for text/interactive in both themes. Durations use **tabular figures** (`.tabular`).

## Palette

| Role | Light | Dark |
|---|---|---|
| canvas (page bg) | `#F6F7F9` | `#0E1015` |
| surface (card) | `#FFFFFF` | `#161922` |
| elevated (surface-2) | `#EEF0F4` | `#1E222D` |
| hairline (border) | `#DDE1E8` | `#2A2F3B` |
| ink (text) | `#1A1D24` | `#E7EAF0` |
| muted | `#5B6472` | `#9AA3B2` |
| primary (indigo) | `#4F46E5` (hover `#4338CA`) | `#6366F1` (hover `#818CF8`) |
| accent (teal) | `#14B8A6` | `#2DD4BF` |
| success / warning / danger / info | `#22C55E` / `#F59E0B` / `#EF4444` / `#0EA5E9` | lighter variants |

## Tailwind utility names (semantic)
`bg-canvas`, `bg-surface`, `bg-elevated`, `border-hairline`, `text-ink`, `text-muted`, `bg-primary`/`text-on-primary`/`hover:bg-primary-hover`, `bg-primary-soft`/`text-primary-soft-text`, `bg-accent`/`text-accent-strong`, `bg-accent-soft`/`text-accent-soft-text`, `text-success|warning|danger|info`.

## Theme resolution
`data-theme="light|dark"` on `<html>` always wins; otherwise `prefers-color-scheme` (unless user pinned light). Managed by `src/presentation/state/theme.ts` (`bootstrapTheme()` runs before render to avoid flash).

## Other
- Font: Inter / grotesk system stack (`--font-sans`). Radii: `--radius-sm|--radius|--radius-lg`. Card shadow: `--shadow-card`.
- Per-project / analytics colors use a **separate** WCAG-validated categorical palette (generate via the `dataviz` skill at build) — never the semantic hues.
- Logo: `public/hourglass.svg` (indigo tile + teal hourglass). Not Grain's mark.
