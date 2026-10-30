import { JOURNAL_PHONE_MAX_SHORT_SIDE_PX } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { type DeviceProbe, describeDevice } from './describeDevice.ts';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
// iPadOS 13+ reports a Mac user-agent.
const IPAD_AS_MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
const CROS_UA =
  'Mozilla/5.0 (X11; CrOS x86_64 16093.57.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function probe(overrides: Partial<DeviceProbe>): DeviceProbe {
  return {
    userAgent: '',
    uaDataPlatform: null,
    maxTouchPoints: 0,
    isCoarsePointer: false,
    shortSidePx: 800,
    ...overrides,
  };
}

describe('describeDevice (story 3.3)', () => {
  it('an iPhone is a phone on ios', () => {
    expect(
      describeDevice(
        probe({ userAgent: IPHONE_UA, maxTouchPoints: 5, isCoarsePointer: true, shortSidePx: 390 }),
      ),
    ).toEqual({ type: 'phone', platform: 'ios' });
  });

  it('an iPad that reports a Mac user-agent is a tablet on ios', () => {
    expect(
      describeDevice(
        probe({
          userAgent: IPAD_AS_MAC_UA,
          maxTouchPoints: 5,
          isCoarsePointer: true,
          shortSidePx: 820,
        }),
      ),
    ).toEqual({ type: 'tablet', platform: 'ios' });
  });

  it('a Mac with a single touch point (or none) stays macos and desktop', () => {
    expect(describeDevice(probe({ userAgent: IPAD_AS_MAC_UA, maxTouchPoints: 0 }))).toEqual({
      type: 'desktop',
      platform: 'macos',
    });
    expect(describeDevice(probe({ userAgent: IPAD_AS_MAC_UA, maxTouchPoints: 1 }))).toEqual({
      type: 'desktop',
      platform: 'macos',
    });
  });

  it('an Android phone and an Android tablet', () => {
    const touch = { userAgent: ANDROID_UA, maxTouchPoints: 5, isCoarsePointer: true };
    expect(describeDevice(probe({ ...touch, shortSidePx: 412 }))).toEqual({
      type: 'phone',
      platform: 'android',
    });
    expect(describeDevice(probe({ ...touch, shortSidePx: 800 }))).toEqual({
      type: 'tablet',
      platform: 'android',
    });
  });

  it('the phone bound is exclusive: exactly the bound is a tablet', () => {
    const touch = { userAgent: ANDROID_UA, maxTouchPoints: 5, isCoarsePointer: true };
    expect(
      describeDevice(probe({ ...touch, shortSidePx: JOURNAL_PHONE_MAX_SHORT_SIDE_PX - 1 })).type,
    ).toBe('phone');
    expect(
      describeDevice(probe({ ...touch, shortSidePx: JOURNAL_PHONE_MAX_SHORT_SIDE_PX })).type,
    ).toBe('tablet');
  });

  it('Windows, macOS and Linux with a fine pointer are desktop', () => {
    expect(describeDevice(probe({ userAgent: WINDOWS_UA }))).toEqual({
      type: 'desktop',
      platform: 'windows',
    });
    expect(describeDevice(probe({ userAgent: IPAD_AS_MAC_UA }))).toEqual({
      type: 'desktop',
      platform: 'macos',
    });
    expect(describeDevice(probe({ userAgent: LINUX_UA }))).toEqual({
      type: 'desktop',
      platform: 'linux',
    });
  });

  it('a touch-screen laptop (fine primary pointer) is desktop, not a tablet', () => {
    expect(
      describeDevice(probe({ userAgent: WINDOWS_UA, maxTouchPoints: 10, isCoarsePointer: false })),
    ).toEqual({ type: 'desktop', platform: 'windows' });
  });

  it('an unknown or empty user-agent is other', () => {
    expect(describeDevice(probe({ userAgent: '' }))).toEqual({
      type: 'desktop',
      platform: 'other',
    });
    expect(describeDevice(probe({ userAgent: 'SomeBrowser/1.0' })).platform).toBe('other');
    expect(describeDevice(probe({ userAgent: CROS_UA })).platform).toBe('other');
  });

  it('prefers the platform the browser reports (user-agent client hints) over the user-agent', () => {
    expect(describeDevice(probe({ userAgent: LINUX_UA, uaDataPlatform: 'Android' })).platform).toBe(
      'android',
    );
    expect(describeDevice(probe({ userAgent: '', uaDataPlatform: 'Windows' })).platform).toBe(
      'windows',
    );
    expect(describeDevice(probe({ userAgent: '', uaDataPlatform: 'macOS' })).platform).toBe(
      'macos',
    );
    expect(describeDevice(probe({ userAgent: '', uaDataPlatform: 'Linux' })).platform).toBe(
      'linux',
    );
    expect(describeDevice(probe({ userAgent: '', uaDataPlatform: 'iOS' })).platform).toBe('ios');
    expect(describeDevice(probe({ userAgent: '', uaDataPlatform: 'Chrome OS' })).platform).toBe(
      'other',
    );
  });

  it('a client-hints macOS with several touch points is ios, like the user-agent case', () => {
    expect(
      describeDevice(probe({ userAgent: '', uaDataPlatform: 'macOS', maxTouchPoints: 5 })).platform,
    ).toBe('ios');
  });

  it('an empty or unrecognised client-hints platform falls back on the user-agent', () => {
    expect(describeDevice(probe({ userAgent: WINDOWS_UA, uaDataPlatform: '' })).platform).toBe(
      'windows',
    );
    expect(
      describeDevice(probe({ userAgent: WINDOWS_UA, uaDataPlatform: 'Unknown' })).platform,
    ).toBe('windows');
  });

  it('answers with the type and the platform only, none of the probe', () => {
    const described = describeDevice(
      probe({
        userAgent: IPHONE_UA,
        uaDataPlatform: 'iOS',
        maxTouchPoints: 5,
        isCoarsePointer: true,
      }),
    );
    expect(Object.keys(described).sort()).toEqual(['platform', 'type']);
    const text = JSON.stringify(described);
    expect(text).not.toContain('Mozilla');
    expect(text).not.toContain('18_5');
  });
});
