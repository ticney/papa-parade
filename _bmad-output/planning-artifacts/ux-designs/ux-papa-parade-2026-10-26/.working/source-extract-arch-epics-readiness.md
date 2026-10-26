# Source extract — Architecture, Epics, Readiness report (UX-relevant)

Sources (all dated 2026-10-26, written in French; translated/paraphrased here):
- **ARCH** = `_bmad-output/planning-artifacts/game-architecture.md` (v1.0, status complete)
- **EPICS** = `_bmad-output/planning-artifacts/epics.md` (status complete; 78 stories after renumbering)
- **IRR** = `_bmad-output/planning-artifacts/implementation-readiness-report-2026-10-26.md`

Note: IRR's body cites story numbers from **before** the E1 renumbering (IRR "Corrections appliquées"). Old 1.9 → new 1.9 + 1.10; old 1.10 → new 1.11 + 1.12; old 1.11–1.21 → new 1.13–1.23. This extract uses the **new** numbers from EPICS unless quoting IRR.

---

## 1. Engine, UI framework/system, rendering approach, resolution/aspect handling, safe areas

**Engine / stack**
- Three.js r186 (`three@0.186.1`) + Vite 8.3 + TypeScript 7.0; no community starter ("starters impose structures (React Three Fiber, for example) that would hinder sim/render separation"). (ARCH, "Moteur retenu"; "Initialisation du projet")
- Rejected: Babylon.js, Godot 4 web export. (ARCH, "Moteur retenu")
- Physics: Rapier 0.21 deterministic-compat, props only. (ARCH, "Physique")

**UI system**
- Decision: "DOM overlay in vanilla TS + CSS; world-anchored elements via `CSS2DRenderer`" — rationale: "readable by Playwright, easy for AI to write, no framework." (ARCH, "Synthèse des décisions", row "UI et HUD"; ADR-008 "UI en DOM")
- File layout: `src/client/ui/hud/` (gaugesHud.ts, timerHud.ts, pauseButton.ts); `src/client/ui/world/` (verbLabel.ts, threatIcon.ts, silenceBubble.ts — CSS2DRenderer); `src/client/ui/screens/` (loadingScreen, menuScreen, calibrationScreen, pauseScreen, resultScreen, oopsScreen); `src/client/ui/styles/` (ui.css, tokens.css). (ARCH, "Arborescence")
- `index.html` = "canvas + DOM UI root". (ARCH, "Arborescence")
- CSS naming: kebab-case classes prefixed `pp-` (e.g. `pp-hud-gauge`). (ARCH, "Conventions de nommage > Fichiers")
- Debug panel uses Tweakpane 4 (dev / `?debug=1` only). (ARCH, "Contenu et feeling")

**Rendering**
- `WebGLRenderer`, `MeshToonMaterial` (3-tone ramp), inverted-hull outlines, no heavy post-process; WebGPU re-evaluated in E7. (ARCH, "Synthèse des décisions" row "Rendu"; ADR-008)
- Fixed isometric view, low-poly 3D, one room per level. (ARCH, "Vue d'ensemble")
- Story 1.4: orthographic isometric fixed camera; "when the window is resized, framing keeps the whole room visible in landscape." (EPICS, Story 1.4)
- Dynamic camera: zoom/rotation on perfect slow-mo, returning to iso framing (EPICS, Story 2.5); replay camera with tight framing and "REPLAY" banner (ARCH, P7); photo camera + "photo" filter (ARCH, P7; EPICS 3.6).
- Outlines only on characters, active threats and salient props; blob shadows; no shadow map in E1. (ARCH, "Performances")

**Resolution / aspect**
- GDD did not specify resolution; fixed in ARCH: DPR = `min(devicePixelRatio, 2)`, stepping down 2 → 1.5 → 1 if mean frame time > 18 ms for 2 s. (ARCH, "Exigences techniques"; "Performances")
- Landscape orientation: locked by Capacitor config on native; on web, a "Tourne ton téléphone" ("Turn your phone") screen shows in portrait. (ARCH, "Architecture de déploiement")
- Story 1.4: in portrait, that screen covers the game and the game stays paused while portrait. (EPICS, Story 1.4)
- Playwright config: "landscape mobile viewport". (ARCH, "Arborescence", playwright.config.ts)
- Explicit aspect-ratio targets: Not stated.

**Safe areas**
- ARCH: Not stated.
- EPICS Story 1.4 (added after IRR U1): "all margins integrate `env(safe-area-inset-*)` (viewport `viewport-fit=cover`), so that no element is hidden by an iPhone notch in landscape (verified by a Playwright test with an iPhone 12 landscape viewport)."

---

## 2. Target platforms, form-factor, performance budgets affecting UI

**Platforms**
- Primary: browser (mobile and desktop), playtest via link. Secondary: iOS and Android via Capacitor 8.5 (haptics, landscape); Steam possibly later via a wrapper. (ARCH, "Périmètre technique")
- NFR13: compatible with mobile and desktop browsers (Chromium, Safari/WebKit) and Capacitor WebView. (EPICS, NFR13)
- Hosting: static build (Cloudflare Pages or Netlify, chosen at first deploy), relative base `./`. (ARCH, "Synthèse"; "Architecture de déploiement")
- Native (E8): orientation locked landscape, native haptics replace `navigator.vibrate`, auto-pause via `appStateChange`, save via `@capacitor/preferences`. (EPICS, Story 8.1)
- Reference devices: iPhone 12, Android 2021. (ARCH, "Exigences techniques")

**Form factor**
- Landscape (FR13). Phone in landscape is the explicit test case for HUD and result screen (EPICS 1.4, 1.21). Desktop with mouse/keyboard/gamepad also supported.

**Performance budgets (ARCH, "Performances")**
- Frame ≤ 16.6 ms; sim ≤ 2 ms per frame; render ≤ 10 ms.
- Draw calls ≤ 100; on-screen triangles ≤ 100,000.
- Textures: one shared 256 px palette or vertex colors; no texture > 1024 px.
- DPR capped at 2, adaptive (see §1).
- Level weight ≤ 3 MB compressed (glb + level audio) → < 5 s on 4G.
- Memory ≤ 300 MB JS heap + GPU on mobile.
- **Tap → visual latency ≤ 50 ms**: feedback from `pointerdown` (highlight + glide start in the next frame), "no heavy work in event handlers."
- Practices: no allocation in hot loop (pools), shared materials.
- `perf.spec.ts`: bot `human` plays a full 5-min level; fails if p95 frame time > 20 ms on CI; draw calls > 100 or triangles > 100,000 also fail (EPICS 1.23).
- NFR1: stable 60 FPS on mid-range mobile; NFR2: ≤ 50 ms tap → visual; NFR3: level load < 5 s on 4G. (EPICS, NFRs)
- Story 1.10: `tests/e2e/tapLatency.spec.ts` asserts ≤ 50 ms between `performance.mark('press')` and `performance.mark('highlightRendered')`. (EPICS 1.10)
- Story 1.23: real-device measurements (FPS p95, tap→visual filmed at 240 fps, ≥10 taps) logged in `docs/playtest/device-measurements.md`; playtest only starts if NFR1/NFR2 are met. (EPICS 1.23)
- Story 2.5: effects (particles pooled, no per-frame allocation) must keep `perf.spec.ts` within budget. (EPICS 2.5)
- UI-specific memory/draw-call budget for DOM HUD: Not stated.

---

## 3. Input system and modalities, remapping, glyph handling

**Modalities**: touch, keyboard, gamepad (ARCH, "Périmètre technique"); also mouse ("jouable à la souris, au tactile, au clavier et à la manette" — EPICS, Epic 1 description).

**Input chain (ARCH, "Chaîne d'entrées")**
1. Capture: Pointer Events on canvas, keyboard, Gamepad API polled each frame; timestamp = `event.timeStamp`.
2. Mapping (`InputMapper`): screen position projected onto floor plane; hit-test priority **threat > interactive object > floor**, with a generous touch radius in screen px set in `feel.json`. Keyboard/gamepad: auto-targets the most urgent threat in aimed direction.
3. Typed commands: `PressThreat`, `Release`, `TapFloor`, `TapObject`, `Swipe` (plus `Move`/`MoveStop` in EPICS 1.6, `TapBaby` in 4.1, `HoldAnywhere` in 4.9, `SetFeel`).
4. Judgement at press time; tap vs hold decided at release or at 400 ms (`holdMinMs`). Release < 400 ms = Parry; ≥ 400 ms = Firmness (ADR-010). Input buffer 100 ms.
- "One tap, several intentions": movement, threat response, or object interaction; iso hit-test then automatic glide before response. (ARCH, "Facteurs de complexité")

**Bindings named**
- Move: tap floor (touch), ZQSD or arrows (keyboard), left stick (gamepad). (EPICS FR10, Story 1.6)
- Parry: tap threat; Space or A. (FR11)
- Contextual interaction (coffee, pick up phone): tap object; Space or A near the object when no threat is active. (FR12; Story 1.16)
- Tap baby (outside a threat) = pick up / find (silence); **hold 1 s on baby = sniff** [V1]. (FR12, GDD v2.1; IRR "Corrections" G1)
- Firmness: hold ≥ 0.4 s on threat. (FR3, Story 1.22)
- Dodge: swipe (touch); Shift + direction (keyboard); B + direction (gamepad); 250 ms window. (Story 5.1)
- Hold breath (`HoldAnywhere`, stealth only): hold anywhere (touch); hold E (keyboard); hold RT (gamepad). (Story 4.9)
- Auto-target cone: `autoTargetConeDeg` = 60° default in `feel.json`; without direction → most urgent overall; currently targeted threat is continuously highlighted. (Story 1.16)
- Gamepad hot-plug supported without reload. (Story 1.16)
- Debug overlay: F1 or a 3-finger tap. (ARCH, "Outils de debug")
- Replay skip: tap screen skips current moment; second tap skips whole replay. (Story 3.9)
- Start screen accepts tap, click or key. (Story 1.4)

**Calibration (ARCH, P5; EPICS 2.7)**: first launch, redoable in settings; audio phase (8 beeps at 100 BPM, tap in rhythm) then visual phase (8 flashes); median, outliers > ±150 ms rejected, clamped [−50, 250] ms; phase re-proposed if < 5 valid taps; stored `save.calibration`.

**Remapping**: Not stated.
**Glyph handling (button prompts per device)**: Not stated.
Note: ZQSD implies an AZERTY layout assumption; no QWERTY (WASD) mapping is stated.

---

## 4. UI architecture

**Scene/screen structure & app flow**
- Client app FSM `appFsm.ts`: "boot → calibration → menu → level → result"; `pauseController.ts`. (ARCH, "Arborescence"; "Correspondance systèmes", row "Flux de l'app")
- Architecture decision item 9 listed "Scenes and game states (menu, calibration, level, end of level, replay)". (ARCH, "Décisions d'architecture restantes")
- appFsm follows same explicit FSM pattern as sim (`enter…State`). (ARCH, "Patterns d'état")
- Level flow FSM (sim) `levelFlow.ts`: "intro → waves → door → final rush → photo → result" (ARCH, "Arborescence"); states named in EPICS: `ended`, `finalRush`, `photo`, `sequence` (4.4), `prep` (6.3).
- Client events emitter (UI/app): `PauseRequested`, `SettingsChanged`, `CalibrationDone`. (ARCH, "Système d'événements")
- Start screen "Touche pour commencer" gets the first gesture, which unlocks audio (1.8) and launches calibration (2.7). (EPICS 1.4)
- Loading: per level, full preload behind a loading screen; no loading during play. (ARCH, "Gestion des assets")

**Pause**
- Loop stops stepping; on return a 3 s real-time countdown precedes resume; exact resume. (ARCH, "Boucle de jeu")
- Auto-pause on `visibilitychange` / app background; `PauseRequested` emitted; AudioContext suspended then resumed at end of countdown. (EPICS 1.4, 1.8)

**Error screens**
- Level load failure → "Oups" screen, light tone, "Réessayer" (Retry) button. Uncaught exception → log + "Oups" screen + level restart. Invalid content: detailed error screen in dev only. (ARCH, "Gestion des erreurs"; EPICS 1.2, 1.5)

**Save system**
- `StoragePort` (localStorage web / `@capacitor/preferences` native), async get/set/remove, JSON. Single save `save.v{n}`: calibration, settings, tier, stars per level, Mama memory; migrations; invalid data set aside and replaced by defaults with a `warn`. Key `papa-parade.save`. (ARCH, "Persistance"; "Architecture des données")
- Player settings layer: calibration, tier, volumes, haptics enabled. (ARCH, "Configuration")

**Localization system**: Not stated. (Facts only: docs and on-screen strings in examples are French — e.g. threat `verb: "SOULÈVE !"` is stored in the threat JSON; Mama lines `text` in `content/mama-lines.json`; screen names "Tourne ton téléphone", "Touche pour commencer", "Oups", "Réessayer", "Rejouer", "Copier le journal". (ARCH P1, P7; EPICS 1.4, 1.5, 1.21))

**Audio system hooks for UI**
- Home-made Web Audio engine with buses **music / sfx / voice / ui**, pre-decoded buffers, synced stems, unlock on first tap. (ARCH, "Synthèse", row "Audio")
- Audio file category `ui` in naming `<category>_<name>.m4a`. (ARCH, "Assets de jeu > Audio")
- Settings include volume per bus. (EPICS 2.8)
- `FeedbackDirector` maps sim events to `audio`, `visual`, `haptic`, optional `camera` via `content/feedback.json`; test enforces every `audio` entry has `visual` and `haptic`. (ARCH, "Retours multimodaux"; ADR-006)
- Time-altering effects (hitstop, slow-mo) are decided in sim from `feel.json`, not by FeedbackDirector. (ARCH, "Retours multimodaux")
- P3: response sound + haptic fire at judgement; response animation queued and played on papa's arrival. (ARCH, P3)

---

## 5. Every screen / menu / HUD element named

**Screens / menus**
| Surface | Source |
|---|---|
| Start screen "Touche pour commencer" | EPICS 1.4 |
| Loading screen (until all assets ready) | ARCH Assets; `loadingScreen.ts`; EPICS 1.5 |
| Menu screen | ARCH `menuScreen.ts`, appFsm; EPICS 2.8 (settings reachable from menu) |
| Calibration screen (audio phase + visual phase) | ARCH P5, `calibrationScreen.ts`; EPICS 2.7 |
| Pause screen + 3 s resume countdown | ARCH `pauseScreen.ts`; EPICS 1.4 |
| Settings screen (tier, volume per bus, haptics toggle, "Recalibrer") — from menu and pause | EPICS 2.7, 2.8 |
| Result screen (4 score components, stars, "Rejouer", "Copier le journal" hidden until E3; mamaWoke reason + lost star; next-age unlocked; replay or next age) | ARCH `resultScreen.ts`; EPICS 1.21, 3.2, 3.3, 3.11 |
| "Copier / Télécharger le journal" button | ARCH "Télémétrie"; EPICS 3.3 |
| "Oups" screen + "Réessayer" / relaunch level | ARCH `oopsScreen.ts`; EPICS 1.5 |
| Dev content-error screen | ARCH "Contenu et feeling"; EPICS 1.2 |
| "Tourne ton téléphone" portrait screen | ARCH Deployment; EPICS 1.4 |
| Level / age selection menu (created 3.11, enriched 6.9; locked/unlocked ages) | EPICS 3.11, 6.9 |
| End-of-level sequence: door opens → final rush → frozen photo → Mama reactions (laugh, sigh, scream) → score + stars → replay → replay/next age [V1] | EPICS FR35, 3.5–3.9 |
| Frozen photo (frame, flash, camera sound) [V1] | EPICS 3.6; ARCH P7 |
| Mama reactions + Mama line text [V1] | EPICS 3.7, 3.8 |
| Highlights replay with "REPLAY" banner [V1] | ARCH P7; EPICS 3.9 |
| Debug overlay (FPS, frame times, draw calls, timing timeline, World inspector, nav/collider viz, time controls, cheats, feel panel) — dev / `?debug=1` only | ARCH "Outils de debug"; EPICS 2.1 |
| Debug sequence launcher (before 4.10) | EPICS 4.4 |

**HUD (fixed zones per EPICS 1.4)**
| Element | Source |
|---|---|
| Gauges zone top-left — fatigue gauge | EPICS 1.4, 1.18; ARCH `gaugesHud.ts` |
| Noise gauge (progressive color code; visual + haptic cue above 80 %; hidden in "return" variant) | EPICS 3.1, 3.10 |
| Bladder gauge [P2] | EPICS 4.3 |
| Combo multiplier x1–x8 [P2] | EPICS 4.2 |
| Breath gauge 6000 ms (stealth) [P2] | EPICS 4.9 |
| Calm gauge (disarm) [V1] | EPICS 6.2 (gauge named; HUD display not stated) |
| Attention gauge (toddler) [V1] | EPICS 6.4 (HUD display not stated) |
| Diaper "health bar" (boss) [V1] | EPICS FR42, 5.7 |
| Timer top-center (countdown) | EPICS 1.4, 1.17; ARCH `timerHud.ts` |
| Pause button top-right (≥ 44×44 pt) | EPICS 1.4; ARCH `pauseButton.ts` |

**World-anchored / in-scene UI**
| Element | Source |
|---|---|
| Verb label (one word, large, above threat; offset if overlapping; most urgent in front; e.g. "SOULÈVE !", "POSE-LE D'ABORD !") | ARCH `verbLabel.ts`; EPICS FR53, 2.2, 4.1, 4.3 |
| Threat icon (color + shape: blue circle = parry; red triangle = dodge) | ARCH `threatIcon.ts`; EPICS FR54, 2.2 |
| Silence bubble "…" blinking at screen edge on zone's side | ARCH P4, `silenceBubble.ts`; EPICS FR19, 1.20 |
| Tap marker at tapped floor point (next frame after pointerdown) | EPICS 1.6 |
| Threat highlight on press; continuous highlight of auto-targeted threat | EPICS 1.10, 1.16 |
| Telegraph visuals: lightning icon + halo (outlet), halo on step (stairs), object icon (coffee table), visual waves around phone, eyelids drooping (microsleep), eye half-opening (fake sleep), green trail (smell) | EPICS 1.10, 1.15, 1.18, 1.19, 4.7, 5.3 |
| Baby gaze indicator (sphere) | EPICS 1.7 |
| Instinct vignette (light vignetting) + heartbeat sound | EPICS 2.9 |
| Visual equivalents: waves, bubbles, flash, icon | EPICS 2.4 |

---

## 6. Stories/ACs specifying UI behavior, feedback, juice, or accessibility

- **1.1** — `npm run dev` shows a full-screen canvas page with no console errors.
- **1.2** — Invalid content: error displayed on screen in dev; `feel.json` includes touch radius in px.
- **1.4** — Iso view keeps whole room visible on resize (landscape), DPR cap; pause on background/pause button → 3 s countdown → exact resume; portrait → "Tourne ton téléphone" overlay, stays paused; start screen "Touche pour commencer"; HUD fixed zones (gauges TL, timer TC, pause TR; bottom third free = thumb zone; no HUD element covers the room beyond 12 % of height); safe-area insets with `viewport-fit=cover`, iPhone 12 landscape Playwright test; all UI buttons ≥ 44×44 pt.
- **1.5** — Loading screen visible until all assets ready; "Oups" screen with light tone and "Réessayer"; global handler → "Oups" offers level restart.
- **1.6** — Visual marker at tapped floor point in the frame following `pointerdown`.
- **1.7** — Baby sphere with gaze indicator, interpolated position, gaze follows walking direction.
- **1.8** — Audio unlock on first gesture of start screen; AudioContext suspended on pause; babble loop + calm music; feedback director plays audio/visual/haptic(/camera); haptics no-op on Safari iOS (`capabilities.haptics = false`).
- **1.10** — Telegraph: lightning icon + halo + telegraph sound; on press: threat highlighted, glide starts next frame; response sound/vibration immediate, animation at arrival; gag: lamp off, papa's hair stands up; tap→highlight ≤ 50 ms test.
- **1.13** — Hitstop 80 ms real-time freeze (render continues); perfect → ×0.3 slow-mo 1200 ms, glide in slow-mo; deterministic overlap rule.
- **1.14** — Props rendered from view pools with interpolation.
- **1.15** — Stairs: baby accelerates + halo on step + sound; coffee table: object icon appears.
- **1.16** — Targeted threat highlighted continuously when aiming (keyboard/gamepad); gamepad hot-plug.
- **1.17** — Visible countdown timer in top-center HUD zone; last threat of a wave → ×0.2 slow-mo 1500 ms.
- **1.18** — Fatigue gauge in top-left HUD zone; microsleep telegraph (drooping eyelids, muffled sound).
- **1.19** — Phone rings with sound, visual waves around `ANCHOR_phone`, vibration.
- **1.20** — Silence: music cuts, "…" bubble blinks at screen edge on zone's side, short vibration; music/babble resume on `SilenceEnded`.
- **1.21** — Result screen: 4 score components, stars, "Rejouer", "Copier le journal" (hidden until E3); buttons ≥ 44×44 pt, text readable without zoom (min size in `tokens.css`); "Rejouer" restarts with new seed without reload.
- **1.23** — `?debug=1` shows FPS/frame time counter; prod bundle contains no debug/Tweakpane.
- **2.1** — Debug overlay (F1 / 3-finger tap) contents; timing timeline for last 10 responses (signed ms offset, quality); Tweakpane feel panel.
- **2.2** — Verb shown large above threat via CSS2DRenderer, readable on landscape phone; icon color+shape (blue/circle parry, red/triangle dodge); overlapping verbs offset, most urgent in front; content:check fails if `verb`/`iconShape`/`color` missing. (NFR6, NFR8)
- **2.3** — Distinct telegraph sounds; cult response sound (toy squeak); baby laugh on perfect; gag sounds; sound fired same loop tick as judgement.
- **2.4** — Every audio feedback has visual (waves, bubbles, flash, icon) + haptic (light/medium/heavy); telegraph = light vibration + visual waves from sound source; perfect = heavy vibration + visual flash; `mute.spec.ts` verifies visual cues with audio muted. (NFR7)
- **2.5** — Success: short screen shake + particles from response point; perfect: camera zoom + slight rotation toward action, back to iso; gag: comic "pouf" particles + shake; intensities in `feel.json`.
- **2.6** — Adaptive music: calm/tense stems, tense fades in on telegraph; slow-mo effect (low-pass + playbackRate); cut on silence.
- **2.7** — Calibration screen: audio phase (8 beeps, 100 BPM) then visual (8 flashes); phase re-proposed if < 5 valid taps; "Recalibrer" in settings.
- **2.8** — Settings screen (from menu and pause): difficulty tier (Assistance / Normal / Papa expérimenté, applied next game), volume per bus, haptics toggle, "Recalibrer".
- **2.9** — Instinct: dedicated audio/visual/haptic cue (light vignetting, heartbeat sound).
- **3.1** — Visible noise gauge with progressive color code; visual + haptic cue above 80 %.
- **3.2** — Result screen shows Mama-woke reason with dedicated cue (door slam sound, visual, vibration) and visible lost star.
- **3.3** — Result screen "Copier / Télécharger le journal" button, one gesture.
- **3.5** [V1] — Door animates with key sound, visual, vibration at final rush; tap floor objects to tidy.
- **3.6** [V1] — Photo filter (frame, flash, camera sound), adjustable camera.
- **3.7** [V1] — Papa's look degrades visibly; Mama reacts in order Laugh, Sigh, Scream, each with animation, sound and value, then score and stars.
- **3.8** [V1] — Most specific Mama line chosen.
- **3.9** [V1] — Replay camera + "REPLAY" banner; tap skips moment, second tap skips all.
- **3.10** [V1] — Noise gauge not displayed in "return" variant.
- **3.11** [V1] — Result screen announces next age unlocked; level-select menu shows it playable; exit result → replay or next age.
- **4.1** — Verb indicates firmness impossible while carrying ("POSE-LE D'ABORD !").
- **4.2** — Combo multiplier shown in HUD; cash-in slow-mo with audio/visual/haptic cue.
- **4.3** — Bladder gauge in HUD; verb displayed when carrying baby and trying toilets.
- **4.4** — Client applies sequence camera framing and music.
- **4.5** — Each successful step: sound, visual, vibration; music/beat sync ≤ 10 ms after slow-mo/pause.
- **4.6** — Wait signal (eyes closing) with visual, sound and haptic cue.
- **4.7** — Fake-out telegraph: one eye half-opens.
- **4.8** — Bomb-drop: thriller music, sweat on brow, slow-mo.
- **4.9** — Creaking board: sound, visual, vibration; breath gauge 6000 ms.
- **5.1** — Red/triangle threat (projectile vomit).
- **5.3** — Green trail follows baby (haptic equivalent when papa is near).
- **5.4** — Each cry type has sound and visual signature.
- **5.7** — Diaper life bar decreases on each success.
- **6.9** — Menu: unlocked ages playable, others locked; first level: one threat at a time, verb shown, no explanatory text. (NFR6)
- **7.3** — Dangers have a reserved alert tint.
- **7.4** — Final celebration (opera choir, fireworks) with visual + haptic equivalents; parodic per-sequence visual grammar defined in JSON.

Relevant NFRs (EPICS): NFR6 (immediate pick-up, no long tutorial or explanatory text; ≥ 4/5 testers identify correct response on first encounter), NFR7 (playable without sound), NFR8 (colorblind-accessible via icon shape), NFR9 (all-ages, no injury shown, no game over; failure is funny), NFR10 (short sessions 3–5 min level, 20–60 s sequence).

---

## 7. Readiness report — UX findings (quoted/closely translated)

**Document inventory** (IRR, "Inventaire des documents"): UX row — "Absent (choix assumé pour le prototype)" = "Absent (deliberate choice for the prototype)". Front-matter: `ux: null`.

**EPICS statement** (EPICS, "Exigences de design UX"): "There is no UX document. The prototype's interface requirements (HUD, displayed verbs, icons, '…' bubble, loading screens, menu, calibration, pause, result, 'Oups', 'Tourne ton téléphone') are covered by FR13, FR14, FR19, FR53 to FR56 and the supplementary requirements. A UX specification (`gds-ux`) is recommended before v1." Also EPICS "Vue d'ensemble": "Il n'existe pas encore de document UX."

**IRR, "Évaluation de l'alignement UX"**
- Status: "**Not found.** No `*ux*` file in `planning-artifacts/`."
- "Is UI implied? Yes, clearly." Lists: HUD (fatigue, noise and bladder gauges, timer, combo, pause button); world-anchored elements (verbs, icons, "…" bubble at screen edge); screens (loading, menu, age selection, calibration, pause and countdown, settings, result (score components, stars, log), Mama reactions, replay, "Oups", "Tourne ton téléphone").
- What architecture already covers: UI tech (vanilla DOM, `CSS2DRenderer`, `pp-*` classes, planned `tokens.css`); latency (≤ 50 ms) and Playwright testability; app flow (`appFsm`: boot → calibration → menu → level → result); multimodal equivalents guaranteed by a test.

**Alignment issues (IRR table)**
- **U1** — "**Safe areas (notches) in landscape not handled.** No story imposes `env(safe-area-inset-*)` for the HUD and the '…' bubble. On an iPhone in landscape, the notch may hide a gauge or the bubble." Impact: Prototype (mobile playtest).
- **U2** — "**Touch target sizes and legibility not specified.** The pause button, result-screen buttons and the minimum size of verbs on small screens are not defined. The threat touch radius exists (in `feel.json`), but not that of UI elements." Impact: Prototype; NFR6.
- **U3** — "**No HUD layout.** The placement of gauges and timer, relative to thumb zones and the action, is not described. It risks being decided at random by the agent of story 1.15 or 1.16." Impact: Prototype (cross-story consistency).
- **U4** — "**First-launch journey.** The order audio unlock → calibration → first level is implicit, but no story describes the start screen that obtains the first tap." Impact: Prototype.
- **U5** — "No design system (UI colors, typography, tokens) beyond the alert tint and blue/red." Impact: v1 (E7); "acceptable in cubes."

**Warnings (IRR)**
- "⚠️ **The UX document is missing while UI is implied.** For a prototype 'in cubes', this is acceptable provided U1 to U4 are handled directly in the relevant stories: add criteria to stories 1.4 (safe areas, start screen), 1.15 and 1.16 (HUD layout) and 1.19 (touch targets)." [old numbering]
- "⚠️ **Run `gds-ux` before v1 (E3 `[V1]`, E7)** for end screens, age selection and the design system."

**Major issue Q6** (IRR, "Problèmes majeurs"): "UX: points U1 to U4 are carried by no story (safe areas, touch targets, HUD layout, start screen). Story 1.15 places the timer and story 1.16 the gauge with no common rule." Remediation: add criteria to 1.4, 1.15, 1.16, 1.19. Listed as item 4 of "Problems to address before implementation": "Add minimal UX criteria: landscape safe areas, touch targets, HUD layout, start screen."

**Corrections applied (IRR, "Corrections appliquées")**
- Q6/U1 → safe-area insets + iPhone 12 landscape test — story 1.4.
- Q6/U2 → touch targets ≥ 44×44 pt, minimum text size — stories 1.4, 1.21.
- Q6/U3 → fixed HUD zones — 1.4, used by 1.17 and 1.18.
- Q6/U4 → start screen "Touche pour commencer" (audio unlock, calibration) — 1.4, 1.8.
- G1 (M8) → tap on baby = pick up / find; 1 s hold = sniff — GDD v2.1, FR12, decision log.
- **Still open (non-blocking for prototype):** "U5: design system (v1, `gds-ux`)"; also M7 (ship Firmness in E1 or not), G6 (disarm "glide too fast" mechanic), G5 (response variants), G8 (who produces rigs/animations), age 3–5 catalogs, business model, Adult level tone.
- Final status: "READY for prototype sprint planning (E1, E2, E3 `[P]`)."

**Other UX-adjacent IRR items**
- G1 (original): "The intention of a tap on the baby is not defined" (conflicting uses: pick up, end silence, sniff). Resolved per corrections.
- G4: hold-breath keys E/RT missing from 4.9 — resolved (M4).
- G6 / M10: "No mechanic lets the player choose a slow approach" (glide is automatic ≤ 0.6 s) — design ambiguity to settle before story 6.2. Still open.
- G7: "one new response at a time, first isolated, then mixed" — level-design principle not carried by an FR; should guide E6.
- M5: auto-target cone hard-coded ±60° → moved to `feel.autoTargetConeDeg` (applied).

---

## 8. Constraints the UX spec must respect (locked decisions / technical limits)

- **UI tech locked:** DOM overlay, vanilla TS + CSS, no framework; world-anchored elements via `CSS2DRenderer`; `pp-` prefixed kebab-case classes; `src/client/ui/styles/tokens.css` + `ui.css`. (ARCH Synthèse, ADR-008, naming)
- **Testability:** UI must be readable by Playwright; visual cues verifiable via DOM classes or scene objects exposed by `window.__PP__` (EPICS 2.4). Stable screenshots via `freeze` (EPICS 1.12).
- **Latency:** ≤ 50 ms tap → visual; highlight + glide start in next frame after `pointerdown`; no heavy work in event handlers. (ARCH Performances; NFR2)
- **Performance:** 60 FPS on iPhone 12 / Android 2021; ≤ 100 draw calls; ≤ 100k triangles; ≤ 300 MB memory; DPR ≤ 2 adaptive; level ≤ 3 MB; particles pooled. (ARCH Performances)
- **Orientation:** landscape only; portrait → "Tourne ton téléphone" overlay (web) / locked (native). (ARCH Deployment; EPICS 1.4)
- **HUD layout locked in story 1.4:** gauges top-left, timer top-center, pause top-right; bottom third free (thumb zone); HUD may not cover the room beyond 12 % of height; safe-area insets; buttons ≥ 44×44 pt; min text size in `tokens.css`.
- **Triple equivalence:** every audio feedback must have a visual and haptic equivalent (test-enforced). (ARCH ADR-006)
- **Readability rules:** one-word verb, large, above threat; color doubled by icon shape — blue + circle = parry; red + triangle = dodge. (FR53, FR54)
- **Silence cue:** blinking "…" bubble at screen edge on zone's side + music cut + short vibration. (ARCH P4; FR19)
- **No explanatory text tutorial;** first level teaches implicitly. (NFR6, FR52)
- **Tone:** all-ages, no injury shown, no game over, failure is funny; error screens on a light tone. (NFR9; ARCH Gestion des erreurs)
- **Feedback data-driven:** feedback in `content/feedback.json`; feel values (incl. touch radius, effect intensities, camera params, timings) in `feel.json` — "no GDD numeric value hard-coded." (ARCH Configuration)
- **P3 timing:** result known at press; sound/haptic at judgement; animation at papa's arrival; presentation must not contradict the result. (ARCH P3, ADR-003)
- **Pause:** 3 s real-time countdown before resume; auto-pause on background. (FR14)
- **First-launch order:** start screen first gesture → audio unlock → calibration (if none saved) → (menu) → level. (EPICS 1.4, 1.8, 2.7; ARCH appFsm)
- **Haptics:** `light | medium | heavy` pulses; no-op on unsupported platforms (Safari iOS web). (ARCH Platform interface; EPICS 1.8)
- **Privacy:** no accounts, no backend, no personal data; journal exported manually by tester. (ARCH Security; NFR14)
- **Debug UI absent from store builds** (tree-shaken). (ARCH Outils de debug)
- **Rendering style:** toon, outlines, low-poly, fixed iso; reserved alert tint for dangers (E7). (ARCH; EPICS 7.3)
- **Document language:** French for design docs (exception decided by Geo); code identifiers in English. (ARCH "Statut du document")

---

## 9. Open questions relevant to UX

- Design system (UI colors, typography, tokens) — open, deferred to v1 / `gds-ux` (IRR U5, "Restent ouverts").
- Localization strategy (only French strings appear; no i18n system defined) — Not stated in any source.
- Input remapping and per-device button glyphs/prompts — Not stated.
- Keyboard layout: only ZQSD (AZERTY) + arrows stated; QWERTY handling — Not stated.
- Whether Firmness ships in E1 (affects hold-feedback UI) — open, decided at sprint planning (IRR M7; EPICS 1.22 "optionnelle").
- Disarm "glide too fast" mechanic (no player-controlled slow approach) — open before story 6.2 (IRR G6/M10).
- Response variants (outlet cover, toy distraction) — open (IRR G5).
- Age 3–5 threat catalogs and Adult-level tone — open (EPICS Epic 6 prerequisites; IRR).
- Business model — open, before E8 (ARCH "Points différés"; IRR).
- Who produces rigs/animations — open (IRR G8).
- WebGPU re-evaluation in E7 (ARCH ADR-008).
- Calm / attention gauge display placement — gauges named (6.2, 6.4) but HUD display not stated.
- Menu screen contents (beyond access to settings and level select) — Not stated.
- Settings reachable from pause is stated (2.8); a pause-screen layout/contents beyond that — Not stated.
- Hosting choice (Cloudflare Pages vs Netlify) — open, no UI impact stated.
