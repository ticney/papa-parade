import { JOURNAL_PHONE_MAX_SHORT_SIDE_PX } from '@shared/constants';

/**
 * What the browser says about the device, read once by the playtest journal (story 3.3). Only
 * `describeDevice` reads it: nothing of it, the user-agent least of all, reaches the exported file.
 */
export interface DeviceProbe {
  userAgent: string;
  /** `navigator.userAgentData.platform` where the browser has client hints, else `null`. */
  uaDataPlatform: string | null;
  maxTouchPoints: number;
  /** `matchMedia('(pointer: coarse)')`: the primary pointer is a finger. */
  isCoarsePointer: boolean;
  /** The shorter side of the viewport, in CSS px. */
  shortSidePx: number;
}

export type DeviceType = 'phone' | 'tablet' | 'desktop';
export type DevicePlatform = 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'other';

export interface DeviceDescription {
  type: DeviceType;
  platform: DevicePlatform;
}

function platformFromHints(hint: string | null): DevicePlatform | null {
  switch (hint?.toLowerCase()) {
    case 'android':
      return 'android';
    case 'ios':
      return 'ios';
    case 'macos':
      return 'macos';
    case 'windows':
      return 'windows';
    case 'linux':
      return 'linux';
    case 'chrome os':
    case 'chromium os':
      return 'other';
    default:
      return null;
  }
}

function platformFromUserAgent(userAgent: string): DevicePlatform {
  // Order matters: an iPhone says « like Mac OS X » and an Android says « Linux ».
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  if (/CrOS/.test(userAgent)) return 'other';
  if (/Windows/.test(userAgent)) return 'windows';
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'macos';
  if (/Linux|X11/.test(userAgent)) return 'linux';
  return 'other';
}

/**
 * The type and the platform of a device, and nothing else (NFR14). iPadOS reports a Mac, so a Mac
 * with more than one touch point is an iPad: `ios`. The type comes from the primary pointer and the
 * size: a finger on a short side under `JOURNAL_PHONE_MAX_SHORT_SIDE_PX` is a phone, a finger on a
 * larger screen a tablet, and a mouse a desktop (a touch-screen laptop included).
 */
export function describeDevice(probe: DeviceProbe): DeviceDescription {
  let platform = platformFromHints(probe.uaDataPlatform) ?? platformFromUserAgent(probe.userAgent);
  if (platform === 'macos' && probe.maxTouchPoints > 1) platform = 'ios';
  let type: DeviceType = 'desktop';
  if (probe.isCoarsePointer) {
    type = probe.shortSidePx < JOURNAL_PHONE_MAX_SHORT_SIDE_PX ? 'phone' : 'tablet';
  }
  return { type, platform };
}
