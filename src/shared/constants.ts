/** Number of log entries (level `info` and above) kept by the logger's ring buffer. */
export const LOG_BUFFER_SIZE = 200;

/** Milliseconds in a second: converts a duration in ms to a speed in m/s. */
export const MS_PER_S = 1000;

/** Seconds in a minute: the timer shows `m:ss`. */
export const SECONDS_PER_MINUTE = 60;

/** Length of one simulation step, in sim ms. Every `sim.step()` advances exactly this much. */
export const STEP_MS = 10;

/**
 * Technical floor of `timeScale`: pause is never `timeScale = 0`, and a scale near 0 would stall
 * the client loop. Not a GDD value (the slowest one is far above).
 */
export const MIN_TIME_SCALE = 0.05;

/** sfc32 outputs discarded after seeding, so that close seeds do not give close first outputs. */
export const RNG_WARMUP_ROUNDS = 15;

/** 2**32: the number of distinct `uint32` values. */
export const UINT32_RANGE = 4294967296;

/** Most sim steps one client frame may run; a longer stall drops the backlog instead of spiralling. */
export const MAX_STEPS_PER_FRAME = 10;

/** Real time between a resume request and the game going on (the "3, 2, 1" of the pause panel). */
export const RESUME_COUNTDOWN_MS = 3000;

/** How many digits the resume countdown shows (« 3 », « 2 », « 1 »), one tick of feedback each. */
export const RESUME_COUNTDOWN_DIGITS = 3;

/** How far back, in real ms, `timeMap` can convert a timestamp to sim time. */
export const TIME_MAP_HISTORY_MS = 2000;

/** Records the `timeMap` ring holds; far above what `TIME_MAP_HISTORY_MS` needs at 240 Hz. */
export const TIME_MAP_CAPACITY = 1024;

/**
 * The caps the renderer's pixel ratio steps down through, widest first: the ratio is
 * `min(devicePixelRatio, cap)` and starts at the first cap (architecture › Performance).
 */
export const PIXEL_RATIO_STEPS = [2, 1.5, 1] as const;

/** The first (widest) cap of the pixel ratio: `min(devicePixelRatio, MAX_PIXEL_RATIO)` at boot. */
export const MAX_PIXEL_RATIO = PIXEL_RATIO_STEPS[0];

/** Real time over which the adaptive pixel ratio averages the frame interval, in ms. */
export const PIXEL_RATIO_WINDOW_MS = 2000;

/** A window whose mean frame interval is above this is slow, in ms. */
export const PIXEL_RATIO_SLOW_FRAME_MS = 18;

/**
 * Slow windows in a row that step the pixel ratio down one cap: one hitch (a garbage collection, a
 * shader compile) must not cost the picture its sharpness for good.
 */
export const PIXEL_RATIO_SLOW_WINDOWS = 2;

/** Budget: at most this many draw calls in a frame (architecture › Performance). */
export const DRAW_CALLS_MAX = 100;

/** Budget: at most this many triangles in a frame (architecture › Performance). */
export const TRIANGLES_MAX = 100_000;

/** Budget: the p95 frame interval of a full level on the CI machine, in ms (`perf.spec.ts`). */
export const FRAME_P95_MAX_MS = 20;

/** `perf.spec.ts` checks that the measure really ran: at least this many frames per second of level. */
export const PERF_MIN_FPS_SAMPLED = 30;

/** Width of one bucket of the frame-interval histogram (`perfMeter`), in ms: its p95 is exact to this. */
export const PERF_BUCKET_MS = 0.1;

/** Frame intervals above this fall in the histogram's overflow bucket, in ms. */
export const PERF_HISTOGRAM_MAX_MS = 250;

/** The FPS counter rewrites its text at most this often, in real ms. */
export const PERF_HUD_REFRESH_MS = 250;

/** The debug overlay's panels (performance, world inspector) rewrite their text at most this often, in real ms (story 2.1). */
export const DEBUG_PANEL_REFRESH_MS = 250;

/** The debug timing timeline keeps this many responses, the newest on top (story 2.1). */
export const DEBUG_TIMELINE_ROWS = 10;

/** « Skip to the end » runs this many sim steps per frame, so the page stays responsive (story 2.1). */
export const DEBUG_SKIP_CHUNK_STEPS = 200;

/** This many touch pointers down at once toggle the debug overlay on a phone (story 2.1). */
export const DEBUG_THREE_FINGER_COUNT = 3;

/** The dev server's `feel-writer` endpoint: the only path the plugin answers (story 2.1). */
export const FEEL_WRITER_ENDPOINT = '/__pp/feel-writer';

/** The biggest body the `feel-writer` accepts, in bytes: a feel patch is a few hundred, this is a typo guard. */
export const FEEL_WRITER_MAX_BODY_BYTES = 65_536;

/** The dist e2e server's port is the dev e2e port plus this, so the two never collide. */
export const DIST_PORT_OFFSET = 1000;

/** `npm run deploy:check` gives up on a host that has not answered a request after this long. */
export const DEPLOY_FETCH_TIMEOUT_MS = 15_000;

/** Horizontal angle of the isometric camera around the vertical axis, in degrees. */
export const ISO_YAW_DEG = 45;

/** Elevation of the isometric camera above the floor plane, in degrees: `atan(1/√2)`, true isometric. */
export const ISO_PITCH_DEG = 35.264;

/** Distance from the camera to the centre of the room, in metres; far enough that nothing is clipped. */
export const ISO_CAMERA_DISTANCE_M = 40;

/** Breathing room added around the room when the camera is fitted to the window, in percent. */
export const ISO_FIT_MARGIN_PCT = 4;

/** Near plane of the isometric camera, in metres: the room is ~`ISO_CAMERA_DISTANCE_M` away, so nothing is ever this close. */
export const ISO_CAMERA_NEAR_M = 0.1;

/** Warnings raised from the frame loop are rate-limited to one per this much real time, in ms. */
export const LOOP_WARN_INTERVAL_MS = 1000;

/** A landscape screen whose short side is under this is the "compact" surface, in CSS px. */
export const COMPACT_SURFACE_MAX_PX = 430;

/** Smallest side of any tappable UI element, in CSS px (DESIGN.md writes it `44pt`: points = px). */
export const TOUCH_TARGET_MIN_PX = 44;

/** The HUD band is at most this share of the room height, in percent. */
export const HUD_BAND_MAX_PCT = 12;

/** The HUD layer has at most this many DOM nodes. */
export const HUD_MAX_DOM_NODES = 40;

/** A panel pops in within this much real time, in ms (a plain fade under reduced motion). */
export const PANEL_POP_MAX_MS = 220;

/** How long the app waits for its fonts before it starts with the fallback fonts, in ms. */
export const FONT_LOAD_TIMEOUT_MS = 3000;

/** Side of one cell of a level's navigation grid, in metres (the extractor writes it, story 1.7's A* reads it). */
export const NAV_CELL_M = 0.25;

/**
 * A stick that is already pushed stays pushed until it falls below this share of the deadzone, so a
 * resting hand on the edge of the deadzone does not send a command every frame (hysteresis).
 */
export const STICK_RELEASE_RATIO = 0.8;

/**
 * A pushed stick keeps its rounded angle until the raw angle is this many angle steps past the
 * boundary to the next one (half a step is the boundary itself), against flicker on a boundary.
 */
export const STICK_TURN_HYSTERESIS_STEPS = 0.25;

/**
 * Fastest Papa may walk, in metres per second: one sim step then covers at most half a navigation
 * cell, so testing the end point of a step cannot jump over a wall (the feel schema enforces it).
 */
export const MAX_WALK_SPEED_MPS = (NAV_CELL_M * 1000) / (2 * STEP_MS);

/** Widest Papa may be, in metres: past this the clearance would close every cell of a room (feel schema). */
export const MAX_PAPA_RADIUS_M = 1;

/** Fastest the baby may crawl, in metres per second: the same per-step bound as Papa's walk (feel schema). */
export const MAX_CRAWL_SPEED_MPS = MAX_WALK_SPEED_MPS;

/** Widest the baby may be, in metres: past this the clearance would close every cell of a room (feel schema). */
export const MAX_BABY_RADIUS_M = 1;

/** A level's shipped payload (the optimised `.glb`) is at most this many bytes (NFR3: 3 MB). */
export const LEVEL_PAYLOAD_MAX_BYTES = 3 * 1024 * 1024;

/** The level the prototype loads, until story 1.10 gives the level JSON its own `id`. */
export const DEFAULT_LEVEL_ID = 'salon_crawler';

/** How long one flavour line of the loading screen stays up before the next, in real ms. */
export const LOADING_LINE_INTERVAL_MS = 2000;

/** How long the fetch of a level's `.glb` may take before it counts as failed (« Oups »), in real ms. */
export const LEVEL_FETCH_TIMEOUT_MS = 20_000;

/** Longest the loading screen waits for the level's sounds (fetch and decode together), in real ms; the level then starts without them. */
export const AUDIO_LOAD_TIMEOUT_MS = 5000;

/** The longest delay `setTimeout` can hold, in ms: a longer one overflows and fires at once. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** The tap marker fades out over this long, in real ms (DESIGN.md › tap-marker `fadeMs`). */
export const TAP_MARKER_FADE_MS = 300;

/** The tap marker starts at this scale of its ring (DESIGN.md › tap-marker `scale: 0.6 → 1.2`). */
export const TAP_MARKER_SCALE_FROM = 0.6;

/** ...and has grown to this scale when it is gone (DESIGN.md › tap-marker `scale: 0.6 → 1.2`). */
export const TAP_MARKER_SCALE_TO = 1.2;

/** The combo badge floats this far above the top of Papa's body, in metres (story 4.2; the threat icons use the same). */
export const COMBO_BADGE_OFFSET_M = 0.3;

/** The combo badge pops for this long when the multiplier rises, in real ms (story 4.2). */
export const COMBO_BADGE_POP_MS = 220;

/** ...from this scale up to its size. */
export const COMBO_BADGE_POP_SCALE_FROM = 1.5;

/** The hold-ring's progress band is this wide, in CSS px (DESIGN.md › hold-ring `strokeWidth`). */
export const HOLD_RING_STROKE_PX = 5;

/** ...and its outer ink outline is this wide, in CSS px (DESIGN.md › hold-ring `outerOutline`). */
export const HOLD_RING_OUTLINE_PX = 2;

/** A threat's verb never shrinks under this font size, in CSS px (DESIGN.md › verb-label `minFontSize`). */
export const VERB_MIN_FONT_PX = 28;

/** The verb's visible ink outline is this wide, in CSS px (DESIGN.md › verb-label `strokeWidth`). */
export const VERB_STROKE_PX = 5;

/**
 * A verb is at most this share of the world layer's width, in percent; a longer one shrinks to fit
 * (down to `VERB_MIN_FONT_PX`). `[ASSUMPTION]`: neither DESIGN nor EXPERIENCE gives one; tune after the playtest.
 */
export const VERB_MAX_WIDTH_PCT = 45;

/**
 * The gap kept between two stacked verbs, in CSS px, when the verbs of simultaneous threats would overlap.
 * `[ASSUMPTION]`: tune after the playtest.
 */
export const VERB_STACK_GAP_PX = 4;

/**
 * `timeMap.realToSim` extrapolates at most this far past its newest record, in real ms: a hidden
 * tab leaves a rate-1 record behind, and an input before the next frame could otherwise land
 * seconds in the sim's future.
 */
export const TIME_MAP_MAX_EXTRAPOLATION_MS = 100;

/** Sound-wave rings the level scene can show at once; one more reuses the oldest (they cost no draw call at rest). Room for a 3-pulse telegraph and a response a moment later. */
export const SOUND_WAVE_POOL_SIZE = 8;

/**
 * The shortest time between the start of two screen flashes, in real ms: a flash asked for sooner
 * is skipped, so nothing flashes faster than 3 Hz (EXPERIENCE.md › Reduced motion, DESIGN.md
 * `maxFlashHz: 3`). An accessibility rule, not a feel value: it is not in `feel.json`.
 */
export const SCREEN_FLASH_MIN_INTERVAL_MS = 334;

/** A window modifier that changes nothing: fatigue's, when Papa is not tired, and instinct's until story 2.9 builds it. */
export const NEUTRAL_WINDOW_MODIFIER = 1;

/**
 * XORed with the run's seed to seed a bot's own RNG: a bot that drew from the world's stream would
 * change the game it plays, and the same seed must not give the bot the world's sfc32 stream.
 */
export const BOT_SEED_SALT = 0xb07b07b0;

/** The longest game `npm run sim --until-ms` accepts, in sim ms (one hour): a larger value is a typo, not a test. */
export const SIM_CLI_MAX_UNTIL_MS = 3_600_000;

/** The most games one `npm run sim` batch plays: their recorded games are kept in memory until the end. */
export const SIM_CLI_MAX_RUNS = 10_000;

/**
 * The fastest `?speed=` a debug build accepts: a dimensionless multiplier of the real time the loop
 * measures. The loop's cap on steps per frame grows with it (`MAX_STEPS_PER_FRAME` times `speed`),
 * so a slow frame does not drop the speed-up.
 */
export const PLAY_SPEED_MAX = 4;

/** The most steps one `advance` of the test API runs: one hour of sim time. A larger value is a typo, not a test. */
export const ADVANCE_MAX_STEPS = 360_000;

/** The test API keeps this many sim events of the current level; beyond, the oldest are dropped (with a warning). */
export const TEST_API_EVENT_LOG_MAX = 50_000;

/** The test API keeps this many played cues (`__PP__.cueLog()`, story 2.4); beyond, the oldest are dropped. */
export const TEST_API_CUE_LOG_MAX = 200;

/** A prop whose lowest point is within this of the floor (y = 0) lies on it, in metres (`World.mess`, story 1.15). */
export const PROP_ON_FLOOR_TOLERANCE_M = 0.02;

/**
 * A prop whose own up axis points less than this up (its y component, the cosine of 45°) is tipped
 * over: its lowest point is then approximated with its largest half extent. `Math.SQRT1_2` is a
 * constant of the language, not a computation, so it is the same on every JS engine.
 */
export const PROP_TIPPED_UP_Y_MAX = Math.SQRT1_2;

/** Thickness of the floor cuboid the physics world adds under a level (the geometry has no floor collider), in metres. */
export const PHYSICS_FLOOR_THICKNESS_M = 1;

/**
 * Thickness of each of the four invisible walls on the level bounds' x and z faces, and of the
 * ceiling above their top, in metres. The floor and the ceiling extend this far past the bounds. A
 * prop cannot leave the room, as long as it moves less than half of this in one step
 * (`content:check` holds `feel.physics.maxPushImpulseNs` to that).
 */
export const PHYSICS_BOUNDS_WALL_THICKNESS_M = 1;

/**
 * How far a unit quaternion's length may be from 1 and still be one: a pose read back from Rapier
 * (float32 inside) and stored as a double is not exactly unit. The snapshot check uses it.
 */
export const QUATERNION_LENGTH_TOLERANCE = 1e-4;

/**
 * Closer than this to a threat's anchor, in metres, the baby has no direction from it (the vector
 * would be float noise): the stairs slide then goes against the baby's gaze instead.
 */
export const SLIDE_DIRECTION_MIN_M = 0.001;

/**
 * Closer than this to Papa, in metres, a threat has no direction from him (the vector would be
 * float noise): the auto-target counts it in every cone (story 1.17).
 */
export const AUTO_TARGET_ON_PAPA_M = 1e-3;

/**
 * Rounding slack of the auto-target's cone test, in metres of projected distance: a threat exactly
 * at the half-angle is in the cone even though `cos` and `sqrt` round (story 1.17, « inclusive »).
 */
export const AUTO_TARGET_EDGE_EPSILON_M = 1e-9;

/** `threatPress` ids of the presses that do not come from a pointer; pointer ids are >= 0 (story 1.17). */
export const KEYBOARD_PRESS_ID = -1;
export const GAMEPAD_PRESS_ID = -2;

/**
 * A pad's own timestamp older than this, in real ms, is not trusted for a press: the press is
 * stamped with the time it is read instead (story 1.17).
 */
export const PAD_STAMP_MAX_AGE_MS = 100;

/** Buttons of the W3C « standard » gamepad layout the game reads (story 1.17). */
export const PAD_BUTTON_CONFIRM = 0;
export const PAD_BUTTON_BACK = 1;
export const PAD_BUTTON_START = 9;
export const PAD_BUTTON_DPAD_UP = 12;
export const PAD_BUTTON_DPAD_DOWN = 13;
export const PAD_BUTTON_DPAD_LEFT = 14;
export const PAD_BUTTON_DPAD_RIGHT = 15;

/**
 * The `anchorId` of the threat the sim spawns on Papa himself (the micro-sleep, story 1.19): it is
 * no anchor of the level geometry, it follows him.
 */
export const PAPA_TARGET_ANCHOR_ID = 'papa';

/**
 * How long a HUD gauge stays at full opacity after it changed, in real ms (story 1.19 D11): a
 * value that crossed a 10-point segment boundary or jumped by 5 points or more. A feel to tune: it
 * lives here, not in `feel.json`, until the HUD has a `feel.hud` block (the segment and jump sizes
 * and the 50 % / 70 % display thresholds in `gaugesHud.ts` are the same kind of value).
 */
export const GAUGE_CHANGE_HOLD_MS = 1500;

/** Every gauge runs from 0 to this many points (story 1.19: fatigue; noise and need follow). */
export const GAUGE_MAX_POINTS = 100;

/** Mama's note is out of this many points (GDD › economy, story 1.22); `MamaSchema` makes its four maxima add up to it. */
export const MAMA_SCORE_MAX_POINTS = 100;

/** Mama gives at most this many stars: one per `feel.mama.starThresholdPoints` (story 1.22). */
export const STAR_COUNT_MAX = 5;

/** How often a count-up of the Result screen redraws its number, in real ms (about one frame). */
export const COUNT_UP_FRAME_MS = 16;

/**
 * A ringing phone emits one `PhoneRinging` every this many sim ms (story 1.20 D5), counted from the
 * start of the ring without drift. A contract, not a feel: story 3.1 adds « +2 % par seconde de
 * sonnerie » per event, and that +2 lives in `feel.noise`. Making the period tunable would silently
 * change the noise rate, so it is a constant.
 */
export const PHONE_RINGING_EVERY_MS = 1000;

/**
 * A crying baby emits one `BabyCrying` every this many sim ms (story 3.1 D9), counted from the start
 * of the cry without drift. A contract, not a feel: « +2 % par seconde de pleurs » is `feel.noise`'s
 * per event, so making the period tunable would silently change the noise rate.
 */
export const BABY_CRYING_EVERY_MS = 1000;

/** A feel is a few levels deep; a `SetFeel` patch nested deeper than this is refused (it stops a runaway or cyclic patch). */
export const PATCH_MAX_DEPTH = 8;

/** The custom header the debug panel sends with a feel save and the dev-only feel-writer requires (CSRF guard). */
export const FEEL_WRITER_HEADER = 'x-pp-feel-writer';

/** The value `FEEL_WRITER_HEADER` must carry. */
export const FEEL_WRITER_HEADER_VALUE = '1';

/** Particle instances the pool draws at most (one `InstancedMesh`, one draw call): a perf limit, not a feel. */
export const PARTICLE_POOL_SIZE = 64;

/** Most particles one burst may ask for: bounds `feel.fx.<preset>.particles.count` (half the pool). */
export const PARTICLE_MAX_PER_BURST = 32;

/** Gravity on a spark, in metres per second squared: physics, not a feel. */
export const PARTICLE_GRAVITY_MPS2 = 9.8;

/** UX ceiling of the « PARADE PARFAITE » stamp, in real ms (UX-DR15): never longer, whatever `feel.fx` says. */
export const EPIC_STAMP_MAX_MS = 900;

/** Reduced motion keeps this share of a burst's particles (EXPERIENCE.md: « −60 % »). */
export const REDUCED_MOTION_PARTICLE_KEEP_PCT = 40;

/** Reduced motion caps the perfect's camera zoom and pan at this share of their feel value. */
export const REDUCED_MOTION_ZOOM_CAP_PCT = 50;

/**
 * A touch device whose shorter screen side is under this many CSS px is a phone, else a tablet
 * (story 3.3). A classification bound for the exported journal's `device.type`, not a feel value.
 */
export const JOURNAL_PHONE_MAX_SHORT_SIDE_PX = 600;

/** A string of the exported journal's logs longer than this many chars is cut with `…` (story 3.3). */
export const JOURNAL_LOG_STRING_MAX_CHARS = 500;

/** A log entry's `data` whose JSON is longer than this many chars is replaced by `"[truncated]"` in the exported journal (story 3.3). */
export const JOURNAL_LOG_DATA_MAX_CHARS = 2000;

/** A log entry's `data` nested deeper than this is replaced by `"[truncated]"` in the exported journal (story 3.3). */
export const JOURNAL_LOG_DATA_MAX_DEPTH = 6;

/** The exported journal's blob URL is revoked this many real ms after the download click (story 3.3). */
export const JOURNAL_DOWNLOAD_REVOKE_DELAY_MS = 10_000;

/** A copy that has not settled after this many real ms counts as `'failed'` and frees the button (story 3.3). */
export const JOURNAL_COPY_TIMEOUT_MS = 5000;

/**
 * The music's two stems start this many ms after "now", on the same audio-clock time, so that they
 * can never land in two render quanta (story 2.6). A physical limit of the audio clock, not feel.
 */
export const MUSIC_START_LEAD_MS = 50;

/** Two music stems whose durations differ by more than this, in ms, will drift apart as they loop (story 2.6). */
export const MUSIC_STEM_LENGTH_TOLERANCE_MS = 2;

/** Cut-off of the music's low-pass when the slow-mo effect is off: wide open, under the Nyquist frequency of 44.1 kHz (story 2.6). */
export const MUSIC_FILTER_OPEN_HZ = 20000;

/** The one key of the versioned save in `StoragePort` (story 2.7; architecture › Persistance). */
export const SAVE_KEY = 'papa-parade.save';

/** A save that cannot be read is kept here, untouched, while the game runs on defaults (story 2.7). */
export const SAVE_INVALID_KEY = 'papa-parade.save.invalid';

/** The version of the save the game writes. Every bump adds a migration `v{n-1} → v{n}` (story 2.7). */
export const SAVE_VERSION = 1;
