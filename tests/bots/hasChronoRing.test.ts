import { HAS_CHRONO_RING } from '@bots/threatTiming';
import { hasChronoRing } from '@client/ui/world/chronoRing';
import { describe, expect, it } from 'vitest';

// Story 3.14 D1: the bots keep their own table of the responses that show a chrono-ring (they may
// not import `client`); this test is what keeps it equal to the one the game draws from.
describe("the bots' chrono-ring table", () => {
  it('says the same as the client for every response', () => {
    const responses = Object.keys(HAS_CHRONO_RING);
    expect(responses.length).toBeGreaterThan(0);
    for (const response of responses) {
      expect(HAS_CHRONO_RING[response as keyof typeof HAS_CHRONO_RING], response).toBe(
        hasChronoRing(response),
      );
    }
  });
});
