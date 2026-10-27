/** Number of log entries (level `info` and above) kept by the logger's ring buffer. */
export const LOG_BUFFER_SIZE = 200;

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

/** A level's shipped payload (the optimised `.glb`) is at most this many bytes (NFR3: 3 MB). */
export const LEVEL_PAYLOAD_MAX_BYTES = 3 * 1024 * 1024;

/** The level the prototype loads, until story 1.10 gives the level JSON its own `id`. */
export const DEFAULT_LEVEL_ID = 'salon_crawler';

/** How long one flavour line of the loading screen stays up before the next, in real ms. */
export const LOADING_LINE_INTERVAL_MS = 2000;

/** How long the fetch of a level's `.glb` may take before it counts as failed (« Oups »), in real ms. */
export const LEVEL_FETCH_TIMEOUT_MS = 20_000;

/** The longest delay `setTimeout` can hold, in ms: a longer one overflows and fires at once. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;
