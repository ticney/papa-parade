/** Number of log entries (level `info` and above) kept by the logger's ring buffer. */
export const LOG_BUFFER_SIZE = 200;

/** Milliseconds in a second: converts a duration in ms to a speed in m/s. */
export const MS_PER_S = 1000;

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

/** Ceiling of the renderer's pixel ratio: `min(devicePixelRatio, MAX_PIXEL_RATIO)`. */
export const MAX_PIXEL_RATIO = 2;

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

/**
 * `timeMap.realToSim` extrapolates at most this far past its newest record, in real ms: a hidden
 * tab leaves a rate-1 record behind, and an input before the next frame could otherwise land
 * seconds in the sim's future.
 */
export const TIME_MAP_MAX_EXTRAPOLATION_MS = 100;

/** Sound-wave rings the level scene can show at once; a fifth wave reuses the oldest (they cost no draw call at rest). */
export const SOUND_WAVE_POOL_SIZE = 4;

/** A window modifier that changes nothing: fatigue and instinct (stories 1.19 and 2.9) stay at it until their systems exist. */
export const NEUTRAL_WINDOW_MODIFIER = 1;

/**
 * XORed with the run's seed to seed a bot's own RNG: a bot that drew from the world's stream would
 * change the game it plays, and the same seed must not give the bot the world's sfc32 stream.
 */
export const BOT_SEED_SALT = 0xb07b07b0;

/** How long `npm run sim` plays a game by default, in sim ms: the GDD's 3-minute level (until a level has its own duration). */
export const SIM_CLI_DEFAULT_UNTIL_MS = 180_000;

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
