---
title: 'DESIGN.md — Papa Parade'
status: final
created: 2026-10-26
updated: 2026-10-26
sources:
  - ../../gdds/gdd-papa-parade-2026-10-26/gdd.md
  - ../../game-architecture.md
  - ../../epics.md
  - ../../implementation-readiness-report-2026-10-26.md
name: Papa Parade
description: 'Visual identity for Papa Parade: a warm, chunky, sticker-and-crayon domestic register for menus and HUD, cut by short bursts of action-trailer Epic register. Mirrored 1:1 in src/client/ui/styles/tokens.css.'
colors:
  cream: '#FFF4E3'
  paper: '#FFFFFF'
  fridge: '#E9EEF2'
  ink: '#2A2140'
  ink-soft: '#6B6283'
  scrim: 'rgba(42,33,64,0.62)'
  ring-track: 'rgba(42,33,64,0.40)'
  vignette: 'rgba(42,33,64,0.35)'
  primary: '#6D3FE0'
  primary-press: '#5329C2'
  on-primary: '#FFFFFF'
  parry: '#1F6BFF'
  dodge: '#F0353D'
  alert: '#FFC21A'
  smell: '#7CC243'
  gauge-calm: '#1F9E73'
  gauge-warn: '#E06A00'
  gauge-track: '#FFFFFF'
  mama-laugh: '#1F9E73'
  mama-sigh: '#8A80A8'
  mama-scream: '#E06A00'
  star: '#FFB800'
typography:
  display:
    fontFamily: 'Baloo 2'
    fontSize: 56px
    fontWeight: '800'
    lineHeight: '1.0'
  heading:
    fontFamily: 'Baloo 2'
    fontSize: 28px
    fontWeight: '700'
    lineHeight: '1.1'
  verb:
    fontFamily: 'Baloo 2'
    fontSize: 40px
    fontWeight: '800'
    lineHeight: '1.0'
  verb-compact:
    fontFamily: 'Baloo 2'
    fontSize: 32px
    fontWeight: '800'
    lineHeight: '1.0'
  combo:
    fontFamily: 'Baloo 2'
    fontSize: 28px
    fontWeight: '800'
    lineHeight: '1.0'
  epic:
    fontFamily: 'Anton'
    fontSize: 64px
    fontWeight: '400'
    lineHeight: '0.95'
    letterSpacing: 0.04em
  body:
    fontFamily: 'Nunito'
    fontSize: 18px
    fontWeight: '700'
    lineHeight: '1.35'
  label:
    fontFamily: 'Nunito'
    fontSize: 16px
    fontWeight: '800'
    lineHeight: '1.2'
  numeric:
    fontFamily: 'Nunito'
    fontSize: 22px
    fontWeight: '900'
  numeric-compact:
    fontFamily: 'Nunito'
    fontSize: 18px
    fontWeight: '900'
  countdown:
    fontFamily: 'Baloo 2'
    fontSize: 112px
    fontWeight: '800'
    lineHeight: '1.0'
rounded:
  sm: 8px
  md: 14px
  lg: 22px
  xl: 32px
  full: 9999px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 24px
  '6': 32px
  '7': 48px
  screen-margin: 'max(16px, env(safe-area-inset-*))'
  hud-inset: 'max(12px, env(safe-area-inset-*))'
  touch-target-min: 44pt
  focus-ring-width: 4px
  focus-ring-offset: 3px
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    backgroundColorPressed: '{colors.primary-press}'
    textColor: '{colors.on-primary}'
    typography: '{typography.label}'
    rounded: '{rounded.full}'
    borderColor: '{colors.ink}'
    borderWidth: 3px
    shadow: '0 4px 0 {colors.ink}'
    pressed: 'shadow 0, translateY 4px'
    minHeight: '{spacing.touch-target-min}'
    focusRing: '{spacing.focus-ring-width} {colors.primary}, offset {spacing.focus-ring-offset}'
  button-secondary:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.full}'
    borderColor: '{colors.ink}'
    borderWidth: 3px
    shadow: '0 4px 0 {colors.ink}'
    pressed: 'shadow 0, translateY 4px'
    minHeight: '{spacing.touch-target-min}'
    focusRing: '{spacing.focus-ring-width} {colors.primary}, offset {spacing.focus-ring-offset}'
    armedBackground: '{colors.ink}'
    armedText: '{colors.paper}'
    lockedText: '{colors.ink-soft}'
    lockedShadow: none
  button-tertiary:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.full}'
    borderColor: '{colors.ink}'
    borderWidth: 3px
    shadow: none
    minHeight: '{spacing.touch-target-min}'
    focusRing: '{spacing.focus-ring-width} {colors.primary}, offset {spacing.focus-ring-offset}'
  button-icon:
    backgroundColor: '{colors.paper}'
    iconColor: '{colors.ink}'
    rounded: '{rounded.full}'
    borderColor: '{colors.ink}'
    borderWidth: 3px
    shadow: '0 4px 0 {colors.ink}'
    size: '{spacing.touch-target-min}'
    focusRing: '{spacing.focus-ring-width} {colors.primary}, offset {spacing.focus-ring-offset}; plus 2px {colors.paper} inner ring over the scene'
  hud-gauge:
    backgroundColor: '{colors.paper}'
    borderColor: '{colors.ink}'
    rounded: '{rounded.full}'
    padding: '{spacing.2}'
    fill: '{colors.gauge-calm}'
    fillWarn: '{colors.gauge-warn}'
    track: '{colors.gauge-track}'
    segments: 10
    segmentOutline: '2px {colors.ink}'
    layout: 'one horizontal pill for all gauges, left to right Bruit · Fatigue · Envie'
    fillMethod: 'single scaleX fill under a segment mask'
    warnIconPulse: true
    idleOpacity: 0.7
    iconColor: '{colors.ink}'
  hud-timer:
    backgroundColor: '{colors.paper}'
    borderColor: '{colors.ink}'
    rounded: '{rounded.full}'
    padding: '{spacing.2}'
    textColor: '{colors.ink}'
    typography: '{typography.numeric}'
    typographyCompact: '{typography.numeric-compact}'
    heightCompact: 32px
  sequence-bar:
    backgroundColor: '{colors.paper}'
    borderColor: '{colors.ink}'
    rounded: '{rounded.full}'
    track: '{colors.gauge-track}'
    segmentOutline: '2px {colors.ink}'
    fillOpponent: '{colors.gauge-warn}'
    fillPlayer: '{colors.gauge-calm}'
    typography: '{typography.label}'
  combo-badge:
    textColor: '{colors.paper}'
    strokeColor: '{colors.ink}'
    strokeWidth: 5px
    paintOrder: stroke
    typography: '{typography.combo}'
  breath-ring:
    strokeWidth: 5px
    progress: '{colors.paper}'
    track: '{colors.ring-track}'
    outerOutline: '2px {colors.ink}'
    durationMs: 6000
  attention-meter:
    pips: 5
    fill: '{colors.gauge-calm}'
    fillWarn: '{colors.gauge-warn}'
    track: '{colors.gauge-track}'
    pipOutline: '2px {colors.ink}'
    idleOpacity: 0.7
  verb-label:
    typography: '{typography.verb}'
    typographyCompact: '{typography.verb-compact}'
    minFontSize: 28px
    textTransform: uppercase
    textColor: '{colors.paper}'
    strokeColor: '{colors.ink}'
    strokeWidth: 5px
    paintOrder: stroke
    shadow: 'hard, {colors.ink}'
  threat-icon:
    parryColor: '{colors.parry}'
    parryShape: circle
    dodgeColor: '{colors.dodge}'
    dodgeShape: triangle
    haloColor: '{colors.alert}'
    halo: 'soft pulsing glow'
    outlineColor: '{colors.ink}'
    sizeCompact: 56px
    sizeRegular: 64px
  hold-ring:
    strokeWidth: 5px
    progress: '{colors.paper}'
    track: '{colors.ring-track}'
    outerOutline: '2px {colors.ink}'
    closed: 'solid {colors.paper} + pop'
    durationMs: 400
  glyph-chip:
    backgroundColor: '{colors.paper}'
    borderColor: '{colors.ink}'
    rounded: '{rounded.full}'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
  target-highlight:
    outline: '4px solid {colors.alert}'
    chevronColor: '{colors.alert}'
    chevronOutline: '{colors.ink}'
  silence-bubble:
    backgroundColor: '{colors.alert}'
    glyphColor: '{colors.ink}'
    borderColor: '{colors.ink}'
    maxFlashHz: 3
    reducedMotionPulseHz: 1
  tap-marker:
    ringColor: '{colors.paper}'
    outlineColor: '{colors.ink}'
    scale: '0.6 → 1.2'
    fadeMs: 300
  instinct-vignette:
    tint: '{colors.vignette}'
    form: 'radial edge darkening'
  countdown:
    typography: '{typography.countdown}'
    textColor: '{colors.paper}'
    strokeColor: '{colors.ink}'
  epic-stamp:
    typography: '{typography.epic}'
    textTransform: uppercase
    textColor: '{colors.paper}'
    strokeColor: '{colors.ink}'
    maxDurationMs: 900
  polaroid:
    backgroundColor: '{colors.paper}'
    rounded: '{rounded.sm}'
    borderColor: '{colors.ink}'
    borderWidth: 3px
    shadow: '0 4px 0 {colors.ink}'
    tilt: '±3deg random'
    captionTypography: '{typography.label}'
    captionColor: '{colors.ink}'
    lockedCaptionColor: '{colors.ink-soft}'
    lockedGlyph: 'crayon "?" in {colors.ink-soft}'
    newLabelColor: '{colors.primary}'
    magnetColor: '{colors.primary}'
  star:
    fill: '{colors.star}'
    outlineColor: '{colors.ink}'
    surface: '{colors.cream}'
    scope: 'Result and Fridge only; never in play'
    lost: 'dashed {colors.ink-soft} empty star'
    lostChip: '« −1 » chip in {colors.mama-scream}'
  mum-bubble:
    backgroundColor: '{colors.paper}'
    borderColor: '{colors.ink}'
    borderWidth: 3px
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    accentLaugh: '{colors.mama-laugh}'
    accentSigh: '{colors.mama-sigh}'
    accentScream: '{colors.mama-scream}'
  score-row:
    textColor: '{colors.ink}'
    labelTypography: '{typography.label}'
    valueTypography: '{typography.numeric}'
    accentLaugh: '{colors.mama-laugh}'
    accentSigh: '{colors.mama-sigh}'
    accentScream: '{colors.mama-scream}'
  panel:
    backgroundColor: '{colors.paper}'
    borderColor: '{colors.ink}'
    borderWidth: 3px
    shadow: '0 4px 0 {colors.ink}'
    rounded: '{rounded.lg}'
    padding: '{spacing.5}'
    backdrop: '{colors.scrim}'
    popInMaxMs: 220
  settings-toggle:
    onTrack: '{colors.primary}'
    onThumb: '{colors.paper}'
    offTrack: '{colors.paper}'
    offThumb: '{colors.ink-soft}'
    borderColor: '{colors.ink}'
    labelTypography: '{typography.label}'
    minHeight: '{spacing.touch-target-min}'
  settings-slider:
    fill: '{colors.primary}'
    track: '{colors.paper}'
    trackOutline: '{colors.ink}'
    thumbColor: '{colors.paper}'
    thumbBorder: '{colors.ink}'
    labelTypography: '{typography.label}'
    minHeight: '{spacing.touch-target-min}'
  settings-segmented:
    selectedBackground: '{colors.primary}'
    selectedText: '{colors.on-primary}'
    unselectedBackground: '{colors.paper}'
    unselectedText: '{colors.ink}'
    borderColor: '{colors.ink}'
    rounded: '{rounded.full}'
    typography: '{typography.label}'
    hintTypography: '{typography.label}'
    hintColor: '{colors.ink-soft}'
    minHeight: '{spacing.touch-target-min}'
  calibration-pulse:
    surface: '{colors.ink}'
    textColor: '{colors.paper}'
    audioPhase: 'ring pop, {colors.paper}'
    visualPhase: 'disc flash, {colors.paper}, 100 BPM (1.67Hz)'
  loading-indicator:
    surface: '{colors.cream}'
    textColor: '{colors.ink}'
    form: 'baby bottle outline'
    outlineColor: '{colors.ink}'
    fill: '{colors.gauge-calm}'
---

# DESIGN.md — Papa Parade

Visual identity only: how the game looks. Behaviour, flows and states live in [EXPERIENCE.md](./EXPERIENCE.md). Every facilitator decision is tagged `[ASSUMPTION]` (Geo delegated them; they await his review). Source-inherited constraints cite their story and are not tagged. Tokens here are mirrored 1:1 in `src/client/ui/styles/tokens.css` (`pp-` classes, ARCH ADR-008).

**Visual references.** Four key-screen mockups illustrate this spec: [`./mockups/key-hud-level.html`](./mockups/key-hud-level.html), [`./mockups/key-fridge.html`](./mockups/key-fridge.html), [`./mockups/key-result.html`](./mockups/key-result.html) and [`./mockups/key-pause.html`](./mockups/key-pause.html). Each one is linked at the section it illustrates. **The spines win on any conflict with a mockup.**

## Brand & Style

Two registers mirror the GDD's epic/mundane contrast. `[ASSUMPTION]`

- **Domestic** (default): menus, Fridge, results, settings, HUD. Warm, round, chunky, sticker-and-crayon, like a family kitchen. Hand-made, never glossy.
- **Epic** (burst only): perfect-response stamps, the REPLAY banner, the final celebration, special-sequence framings. Action-movie trailer parody: condensed caps, hard contrast. Epic is a short burst and never owns a whole screen.

Menus are diegetic where it helps and plain where usability wins. `[ASSUMPTION]` The home screen is the family Fridge, under a small « Le frigo » header: the 5 ages are captioned polaroids held by magnets, stars are sticker magnets, and a locked age is an empty slot with a crayon "?". The result screen centres on the frozen photo as a polaroid, with Mama's line as a speech bubble. Settings, pause and errors are plain panels.

There is no dark theme. `[ASSUMPTION]` The game owns its look and ignores the OS colour scheme. Night play is a real case, so menus sit on `{colors.cream}`, never pure white; the start screen is mostly the dim nursery scene; and calibration runs on an `{colors.ink}` background.

The 3D world's rendering (toon, outlines, low-poly, fixed iso) is owned by the architecture (ARCH "Rendu", story 1.4). This file covers the DOM/CSS layer drawn over it, including world-anchored CSS2D elements.

## Colors

`[ASSUMPTION]` for all values. The reserved-signal rule (blue = parry, red = dodge, an alert hue for dangers, shape doubling) is inherited (FR53/FR54, story 2.2, story 7.3).

| Group | Token | Value | Use | Never |
|---|---|---|---|---|
| Surface | `cream` | #FFF4E3 | Menu background, star surface | — |
| Surface | `paper` | #FFFFFF | Cards, polaroids, panels, HUD pills, gauge track, verb fill, ring progress | Full-screen backgrounds |
| Surface | `fridge` | #E9EEF2 | Fridge door (home) | — |
| Surface | `ink` | #2A2140 | Text, outlines, hard shadows, verb stroke, calibration background, armed-quit fill | — |
| Surface | `ink-soft` | #6B6283 | Secondary text, hints, locked "?", locked labels, toggle-off thumb | Primary actions |
| Overlay | `scrim` | rgba(42,33,64,0.62) | Pause dim over the scene | Blur (no `backdrop-filter`) |
| Overlay | `ring-track` | rgba(42,33,64,0.40) | hold-ring / breath-ring track (ink at 40%) | — |
| Overlay | `vignette` | rgba(42,33,64,0.35) | Instinct radial edge darkening (ink at 35%) | Red tint (red = dodge) |
| Brand | `primary` | #6D3FE0 | Primary buttons, focus ring, selected and "on" states | Any threat |
| Brand | `primary-press` | #5329C2 | Pressed primary | — |
| Brand | `on-primary` | #FFFFFF | Text on primary | — |
| Signal | `parry` | #1F6BFF | Parryable threat (with circle) | Menus |
| Signal | `dodge` | #F0353D | Dodge threat (with triangle) | Menus, vignette |
| Signal | `alert` | #FFC21A | Telegraph halo, target-highlight, "…" silence bubble; play only | Menus |
| Signal | `smell` | #7CC243 | Green smell trail; diegetic only | DOM UI |
| Gauge | `gauge-calm` | #1F9E73 | Gauge fill below 70%; player-resource sequence bars; loading bottle fill | — |
| Gauge | `gauge-warn` | #E06A00 | Gauge fill at ≥ 70%; opponent "health" sequence bars | — |
| Gauge | `gauge-track` | #FFFFFF | Gauge track (paper) with 2px ink segment outlines | — |
| Mama | `mama-laugh` | #1F9E73 | Laugh reaction accent | Body-text background |
| Mama | `mama-sigh` | #8A80A8 | Sigh reaction accent | Body-text background |
| Mama | `mama-scream` | #E06A00 | Scream reaction accent | Body-text background |
| Reward | `star` | #FFB800 | Earned stars on Result and the Fridge magnets, on cream with ink outline | Any play-time UI |

Rules `[ASSUMPTION]`:

- Brand grape never appears on a threat.
- Blue, red and alert yellow never decorate a menu.
- `star` and `alert` are both yellow, but they never coexist: alert is play-only, and stars appear only on results and the Fridge.
- The gauge warning state also pulses its icon chip, so it never relies on hue alone.

**Contrast.** Targets: WCAG AA, which is 4.5:1 for text, and 3:1 for large text (≥ 24px, or ≥ 18.66px bold) and for non-text graphics (WCAG 1.4.11). Approximate ratios:

| Pair | Ratio | Status |
|---|---|---|
| `ink` on `cream` | 13.9:1 | Pass (text) |
| `ink` on `paper` | 15.1:1 | Pass (text) |
| `ink` on `fridge` | 12.9:1 | Pass (text) |
| `ink-soft` on `cream` / `paper` / `fridge` | 5.2 / 5.7 / 4.9:1 | Pass (text) |
| `on-primary` on `primary` | 6.1:1 | Pass (text) |
| `on-primary` on `primary-press` | 8.5:1 | Pass (text) |
| `paper` on `ink` (calibration text, armed-quit label) | 15.1:1 | Pass (text) |
| `ink` "…" on `alert` | 9.3:1 | Pass (text) |
| Verb: `paper` fill against `ink` stroke | 15.1:1 | Pass; the 5px stroke carries the verb over any room colour |
| `ink` outline around `star` | 8.7:1 | Pass; `star` on `cream` alone is 1.6:1, so the ink outline is mandatory |
| `parry` / `dodge` on `paper` | 4.6 / 4.0:1 | Pass as non-text (≥ 3:1); the shape carries the colour-blind read |
| `gauge-calm` / `gauge-warn` fill on `paper` track | 3.4 / 3.4:1 | Pass as non-text (≥ 3:1); ink segment outlines add an edge |
| `ink` on `gauge-calm` / `gauge-warn` | 4.5 / 4.5:1 | Large text and graphics only; no body text on gauge fills |
| `ink` on `mama-sigh` | 4.1:1 | Large text and graphics only |
| `paper` ring progress against its 2px `ink` outer outline | ≈ 15:1 | Pass; the outline keeps the ring readable over a light room (progress on `ring-track` alone is ≈ 2.4:1 over white) |

## Typography

`[ASSUMPTION]` Three families, all SIL OFL, self-hosted woff2 (no network in Capacitor; works offline on the web).

| Token | Family | Weight | Size / line | Use |
|---|---|---|---|---|
| `display` | Baloo 2 | 800 | 56px / 1.0 | Title |
| `heading` | Baloo 2 | 700 | 28px / 1.1 | Panel and screen headings ("Pause", "Maman s'est réveillée !") |
| `verb` | Baloo 2 | 800 | 40px / 1.0, uppercase | World-anchored verbs (regular surface) |
| `verb-compact` | Baloo 2 | 800 | 32px / 1.0, uppercase | Verbs on the compact surface |
| `combo` | Baloo 2 | 800 | 28px / 1.0 | combo-badge multiplier |
| `epic` | Anton | 400 | 64px / 0.95, uppercase, +0.04em | Epic register only |
| `body` | Nunito | 700 | 18px / 1.35 | Body copy, Mama line, loading flavour lines |
| `label` | Nunito | 800 | 16px / 1.2 | Buttons, gauge and settings labels, polaroid captions, hints |
| `numeric` | Nunito | 900 | 22px, `tabular-nums` | Timer, score values |
| `numeric-compact` | Nunito | 900 | 18px, `tabular-nums` | Timer while a sequence bar is shown |
| `countdown` | Baloo 2 | 800 | 112px / 1.0 | Resume countdown digits « 3 » « 2 » « 1 » `[ASSUMPTION]` |

Rules `[ASSUMPTION]`:

- **16px is the absolute text floor.** Story 1.22 requires a minimum text size in `tokens.css`; the 16px value is facilitator-set.
- Verbs never go below **28px**, even on the smallest compact surface.
- The "Grands verbes" setting scales `verb` and `verb-compact` by +25%.
- Numbers that change in place use `tabular-nums`, so digits do not jitter.
- Anton appears only in the Epic register: never in menus, never for body text.

## Layout & Spacing

`[ASSUMPTION]` 4px base: `{spacing.1}` 4 · `{spacing.2}` 8 · `{spacing.3}` 12 · `{spacing.4}` 16 · `{spacing.5}` 24 · `{spacing.6}` 32 · `{spacing.7}` 48.

- **Margins** `[ASSUMPTION]`: screen margin `{spacing.screen-margin}` = `max(16px, env(safe-area-inset-*))`; HUD inset `{spacing.hud-inset}` = `max(12px, safe-area)`. The safe-area insets themselves (with `viewport-fit=cover`) are locked by story 1.4.
- **Targets**: every interactive target is at least `{spacing.touch-target-min}` (44×44pt), per stories 1.5 and 1.21.
- **HUD zones** (locked, story 1.5): gauges top-left, timer top-centre, pause top-right. The bottom third stays free as the thumb zone. No HUD element covers more than 12% of the room height. `[ASSUMPTION]` The whole HUD band fits that 12% on a 375px-tall phone.
- **Surfaces** `[ASSUMPTION]`: compact means a landscape short side under 430px (phones); regular means a short side of 430px or more (tablets, desktop). On compact, verbs switch to `{typography.verb-compact}` and threat icons to 56px (64px on regular). The HUD corners never move between surfaces.
- **Compact timer** `[ASSUMPTION]`: while a sequence bar is shown, the timer pill drops to 32px tall with `{typography.numeric-compact}`.
- **String length** `[ASSUMPTION]`: landscape only (story 1.5). Any label must fit at +30% length without truncation (see Localization in EXPERIENCE.md).

## Elevation & Depth

`[ASSUMPTION]` No soft shadows. **Sticker depth** is the only elevation language, and it matches the 3D inverted-hull outlines:

- **Raised element**: 3px `{colors.ink}` outline plus a hard offset shadow, `0 4px 0` in `{colors.ink}`.
- **Pressed**: the shadow collapses to 0 and the element moves 4px down.
- **World-anchored text** (verbs, combo): `{colors.paper}` fill plus a 5px `{colors.ink}` stroke (`paint-order: stroke`) and a hard shadow, so it reads over any room colour.
- **HUD chips** sit on `{colors.paper}` pills with an ink outline, never bare over the scene.
- **Focus ring**: `{spacing.focus-ring-width}` `{colors.primary}` at a `{spacing.focus-ring-offset}` offset. Over the 3D scene, a 2px `{colors.paper}` inner ring is added.
- **Layering**: 3D scene → world-anchored CSS2D layer → HUD → overlays (pause `{colors.scrim}` + panel). During Pause and the countdown, the HUD stays visible under the scrim, dimmed and inert. `[ASSUMPTION]` No `backdrop-filter` blur, for mobile performance. Overlays never stack (see EXPERIENCE.md › Information Architecture).

## Shapes

`[ASSUMPTION]` Toy-like rounded corners echo the round low-poly characters.

| Token | Value | Assigned to |
|---|---|---|
| `{rounded.sm}` | 8px | Polaroids, with a random ±3° tilt |
| `{rounded.md}` | 14px | Defined, no use assigned yet |
| `{rounded.lg}` | 22px | Panels, the repeated-failure card |
| `{rounded.xl}` | 32px | Defined, no use assigned yet |
| `{rounded.full}` | 9999px | Buttons (pills), HUD pills, glyph chips, segmented controls |

In play, shape carries meaning: circle = parry, triangle = dodge (story 2.2, NFR8). No other UI element uses a bare circle or triangle in a threat colour. The target-highlight differs from the telegraph halo by shape (a solid outline plus a chevron, versus a soft glow), not by colour.

## Components

These are visual specs. The behaviour of each component is in EXPERIENCE.md › Component Patterns, under the same name. Every row is `[ASSUMPTION]` unless it cites a story.

**Menu and panel surfaces**: see [`./mockups/key-pause.html`](./mockups/key-pause.html) for the panel, buttons, armed quit and countdown.

- **button-primary**: a `{colors.primary}` pill with a `{colors.on-primary}` label in `{typography.label}`, in sticker depth. Pressed, the fill turns `{colors.primary-press}` and the button moves down. Min height `{spacing.touch-target-min}`. Focus ring as defined in Elevation & Depth.
- **button-secondary**: a `{colors.paper}` pill with a `{colors.ink}` label; same sticker depth and press as the primary.
  - Armed state ("Quitter vers le frigo" after the first tap): `{colors.ink}` fill, `{colors.paper}` label.
  - Locked state ("Âge suivant" under 2★): `{colors.ink-soft}` label, no shadow, with a hint in `{typography.label}` below it.
- **button-tertiary**: a transparent pill with a 3px `{colors.ink}` outline and a `{colors.ink}` label in `{typography.label}`, with no lift (no shadow). Used for "Frigo" on Result and other lowest-priority actions. Min height `{spacing.touch-target-min}`; same focus ring as the other buttons. `[ASSUMPTION]`
- **button-icon**: the pause button (HUD top-right), the Fridge magnet that opens Réglages, and the close control on the repeated-failure card. A `{colors.paper}` round pill with a `{colors.ink}` icon and ink outline, at least 44×44pt (story 1.5).
- **panel**: `{colors.paper}`, 3px ink outline, sticker shadow, `{rounded.lg}`, `{spacing.5}` padding. Used for pause, settings and errors; over the scene it sits on a `{colors.scrim}` dim. The repeated-failure card on Result is a smaller panel with a button-secondary and a close button-icon.
- **settings-toggle**: on is a `{colors.primary}` track with a `{colors.paper}` thumb; off is a `{colors.paper}` track with a `{colors.ink-soft}` thumb. Both have an ink outline. Label in `{typography.label}`.
- **settings-slider**: a `{colors.primary}` fill on a `{colors.paper}` track with an ink outline, and a `{colors.paper}` thumb with an ink outline. One slider per audio bus.
- **settings-segmented**: a pill group with an ink outline. The selected segment is `{colors.primary}` / `{colors.on-primary}`; the others are `{colors.paper}` / `{colors.ink}`. The description of the selected tier shows below in `{typography.label}`, `{colors.ink-soft}`.
- **calibration-pulse**: the calibration screen has an `{colors.ink}` background (dim, night-friendly) with `{colors.paper}` text. The audio phase shows a `{colors.paper}` ring pop on each beat. The visual phase shows a `{colors.paper}` disc flash at 100 BPM (1.67Hz, under the 3Hz limit).
- **loading-indicator**: a baby-bottle outline in `{colors.ink}` that fills with `{colors.gauge-calm}`, on `{colors.cream}`. Under reduced motion the fill is static. Flavour lines are set in `{typography.body}` in `{colors.ink}`.

**Fridge and result**: see [`./mockups/key-fridge.html`](./mockups/key-fridge.html) (locked slots, polaroid drop-in, focus) and [`./mockups/key-result.html`](./mockups/key-result.html) (≥ 2★ with an unlock; Mama woke with < 2★).

- **polaroid**: a `{colors.paper}` card, `{rounded.sm}`, with an ink outline and sticker shadow, tilted at random by ±3°. On the Fridge it holds an age and shows the age name in `{typography.label}` on its bottom strip; it hangs from a `{colors.primary}` magnet, and a new unlock carries a « Nouveau ! » label in `{colors.primary}`. On Result it frames the frozen end photo. A locked age is an empty slot with a crayon "?" in `{colors.ink-soft}`; its age name stays visible in `{colors.ink-soft}`, to build anticipation. `[ASSUMPTION]`
- **star**: a `{colors.star}` sticker with an `{colors.ink}` outline, on `{colors.cream}`. Only for earned results on Result and the Fridge magnets; never during play. A lost star (Mama woke early) is a dashed `{colors.ink-soft}` empty star with a « −1 » chip in `{colors.mama-scream}`. `[ASSUMPTION]`
- **mum-bubble**: Mama's line as a speech bubble: `{colors.paper}` with an ink outline, text in `{typography.body}`, `{colors.ink}`. The bubble accent takes the colour of the active reaction: `{colors.mama-laugh}`, `{colors.mama-sigh}` or `{colors.mama-scream}`.
- **score-row**: one row per score component (4 rows, story 1.22). The label is in `{typography.label}` and the value in `{typography.numeric}` (tabular). Each row shows points earned out of its maximum, so the rows add up to the score: « Rires » /40, « État du bébé » /30, « Sans soupir » /15, « Sans hurlement » /15. The Rires, Sans soupir and Sans hurlement rows carry their matching `mama-*` accent; the État du bébé row has no accent. `[ASSUMPTION]`
- **epic-stamp**: "PARADE PARFAITE" and the "REPLAY" banner. Set in `{typography.epic}`, uppercase, with a `{colors.paper}` fill and `{colors.ink}` stroke for hard contrast. The stamp shows for at most 900ms.

**HUD (screen-anchored)**: see [`./mockups/key-hud-level.html`](./mockups/key-hud-level.html) (touch parry, keyboard auto-target, suspicious silence).

- **hud-gauge**: the three gauges sit side by side in **one horizontal `{colors.paper}` pill** with an ink outline, ordered left to right Bruit · Fatigue · Envie. Each gauge is an icon plus a 10-segment bar. Stacking is rejected because the ≤ 12% band is only about 45px on a 375px phone. Each bar is a single `scaleX` fill under a segment mask. `[ASSUMPTION]`
  - The track is `{colors.gauge-track}` (paper), and every segment has a 2px ink outline.
  - The fill is `{colors.gauge-calm}`, switching to `{colors.gauge-warn}` at 70% or above. In the warning state the icon chip also pulses.
  - When idle, the gauge sits at 70% opacity.
  - The noise gauge's "progressive colour code" (story 3.1) uses the calm→warn pair.
- **hud-timer**: a `{colors.paper}` pill with `{typography.numeric}` in `{colors.ink}` and one icon per variant (sleeping Mama for Sieste, a door for Retour). It switches to its compact form (32px tall, `{typography.numeric-compact}`) while a sequence bar is shown.
- **sequence-bar**: a boss-bar parody directly under the timer: a `{colors.paper}` container with an ink outline and a segmented `{colors.gauge-track}` track. Opponent "health" (the diaper boss) fills with `{colors.gauge-warn}`; player resources (calme, souffle) fill with `{colors.gauge-calm}`. Label in `{typography.label}`.
- **countdown**: the 3s resume digits in `{typography.countdown}` (112px), `{colors.paper}` with an `{colors.ink}` stroke, over the scrim-dimmed scene. `[ASSUMPTION]`

**World-anchored (CSS2DRenderer, ARCH ADR-008)**: see [`./mockups/key-hud-level.html`](./mockups/key-hud-level.html). Its state B is a reference composite that shows two threats in one frame.

- **verb-label**: a one-word imperative verb above the threat (story 2.2). Set in `{typography.verb}` (regular) or `{typography.verb-compact}` (compact), uppercase, never below 28px. `{colors.paper}` fill, 5px `{colors.ink}` stroke, `paint-order: stroke`, hard shadow.
- **threat-icon**: a `{colors.parry}` circle or a `{colors.dodge}` triangle (story 2.2, NFR8) with an ink outline. Diameter is 56px on compact and 64px on regular; the touch radius stays in `feel.json`. The telegraph halo is a soft, pulsing `{colors.alert}` glow (story 7.3 reserved alert hue).
- **hold-ring**: a 5px ring around the threat icon. `{colors.paper}` progress fills over a `{colors.ring-track}` track in 400ms (`holdMinMs`, ADR-010). A 2px `{colors.ink}` outer outline keeps it readable over light rooms. When the ring closes (Fermeté) it turns solid `{colors.paper}` with a pop. It is never threat-coloured. The same ring is used for sniff (1s on the baby).
- **breath-ring**: the hold-ring visual (including the ink outer outline) around Papa during stealth, filling over the 6000ms breath gauge (story 4.9).
- **combo-badge**: the multiplier (x2 to x8) above Papa, set in `{typography.combo}` with a `{colors.paper}` fill and a 5px `{colors.ink}` stroke.
- **attention-meter**: 5 pips above the toddler, using the hud-gauge fill rules: `{colors.gauge-calm}`, then `{colors.gauge-warn}` at 70% or above, on a paper track with 2px ink pip outlines, at 70% opacity when idle.
- **glyph-chip**: a single input glyph beside the auto-targeted threat's verb (keyboard and gamepad only). A `{colors.paper}` pill with an ink outline and `{typography.label}` in `{colors.ink}`.
- **target-highlight**: a solid 4px `{colors.alert}` outline on the auto-targeted or pressed threat (stories 1.11 and 1.17), plus a small bouncing `{colors.alert}` chevron with an ink outline above the verb-label.
- **silence-bubble**: a "…" speech bubble at the screen edge, on the side of the silent zone (story 1.21). `{colors.alert}` fill with an `{colors.ink}` "…" and outline. It blinks, never faster than 3Hz; under reduced motion it pulses at 1Hz or slower.
- **tap-marker**: a `{colors.paper}` ring with an `{colors.ink}` outline at the tapped floor point. It appears the frame after `pointerdown` (story 1.7), then scales from 0.6 to 1.2 and fades out over 300ms.
- **instinct-vignette**: a radial edge darkening in `{colors.vignette}` (ink at 35%) during paternal instinct (story 2.9). Never red.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Keep `parry`, `dodge` and `alert` to their signal meaning, everywhere `[ASSUMPTION]` | Decorate a menu with blue, red or alert yellow |
| Double every threat colour with a shape: circle = parry, triangle = dodge (NFR8) | Rely on hue alone for any gameplay read; gauge warnings also pulse `[ASSUMPTION]` |
| Put an ink outline on every `star` (1.6:1 on cream without it) | Put grape (`primary`) on a threat `[ASSUMPTION]` |
| Use sticker depth: 3px ink outline plus a `0 4px 0` ink shadow `[ASSUMPTION]` | Use soft or blurred shadows, or `backdrop-filter` `[ASSUMPTION]` |
| Give world-anchored text a paper fill and a 5px ink stroke `[ASSUMPTION]` | Place a HUD chip bare over the scene `[ASSUMPTION]` |
| Tell target-highlight and telegraph halo apart by shape `[ASSUMPTION]` | Tint the instinct vignette red `[ASSUMPTION]` |
| Keep Epic (Anton) to short bursts; the PARADE PARFAITE stamp lasts at most 900ms `[ASSUMPTION]` | Let Epic own a whole screen, or set body text in Anton `[ASSUMPTION]` |
| Keep text at 16px or more and verbs at 28px or more `[ASSUMPTION]` | Set body text on `mama-sigh`, `gauge-calm` or `gauge-warn` |
| Use `cream` for menu backgrounds and `ink` for calibration, for night play `[ASSUMPTION]` | Use a pure-white full-screen background, or follow the OS dark mode `[ASSUMPTION]` |
| Keep the HUD inside its story 1.5 zones and within 12% of the room height | Put any HUD in the bottom third during play (story 1.5) |
