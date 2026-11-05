import type { SimEvent } from '@sim';
import { describe, expect, it, vi } from 'vitest';
import { createTestCooking } from '../../../tests/support/testContent.ts';
import { choreCueOf } from './choreFeedback.ts';
import type { FeedbackDirector } from './feedbackDirector.ts';
import { type FeedbackSource, playSimEventFeedback } from './simEventFeedback.ts';

// The cues of a house chore come from its def (story 9.4), like a threat's (the model: threatFeedback).

const cooking = createTestCooking();
const planned = [{ def: cooking, objectId: 'stove' }];

const telegraphed: SimEvent = {
  type: 'ChoreBeatTelegraphed',
  t: 10,
  choreIndex: 0,
  beatIndex: 0,
  windowOpenAt: 2010,
} as SimEvent;
const judged = (
  quality: 'perfect' | 'success' | 'fail',
  reason: 'early' | 'late' | null = null,
): SimEvent =>
  ({
    type: 'ChoreBeatJudged',
    t: 10,
    choreIndex: 0,
    beatIndex: 0,
    quality,
    reason,
    offsetMs: 0,
  }) as SimEvent;

describe('choreCueOf', () => {
  it('names the cue of each chore event from the def', () => {
    expect(choreCueOf(telegraphed, planned)).toBe(cooking.feedback.telegraph);
    expect(choreCueOf(judged('perfect'), planned)).toBe(cooking.feedback.perfect);
    expect(choreCueOf(judged('success'), planned)).toBe(cooking.feedback.success);
    expect(choreCueOf(judged('fail', 'late'), planned)).toBe(cooking.feedback.miss);
    expect(
      choreCueOf(
        { type: 'ChoreCompleted', t: 10, choreIndex: 0, homePoints: 7.5 } as SimEvent,
        planned,
      ),
    ).toBe(cooking.feedback.completed);
  });

  it('plays nothing for the other events, and for a chore the level does not have', () => {
    expect(
      choreCueOf({ type: 'ObjectTapped', t: 1, objectId: 'stove' } as SimEvent, planned),
    ).toBeNull();
    expect(
      choreCueOf(
        { type: 'ChoreRefused', t: 1, objectId: 'stove', reason: 'carrying' } as SimEvent,
        planned,
      ),
    ).toBeNull();
    expect(choreCueOf({ ...telegraphed, choreIndex: 3 } as SimEvent, planned)).toBeNull();
    expect(choreCueOf(telegraphed, [])).toBeNull();
  });
});

describe('the routing of a chore event', () => {
  const world = { threats: [], papa: { xM: 0, zM: 0 }, baby: {} } as never;
  function route(event: SimEvent, chores = planned) {
    const handle = vi.fn();
    const playCue = vi.fn();
    const director = { handle, playCue } as unknown as FeedbackDirector;
    const active = {
      sim: { world, chores },
      level: { threats: {}, level: { objects: [] }, disruptions: {}, sequences: {} },
    } as unknown as FeedbackSource;
    playSimEventFeedback(event, active, director);
    return { handle, playCue };
  }

  it('plays the def’s cue on the station, at the very call that receives the event', () => {
    const { playCue } = route(judged('perfect'));
    expect(playCue).toHaveBeenCalledWith(cooking.feedback.perfect, world, null, 'stove');
    expect(route(telegraphed).playCue).toHaveBeenCalledWith(
      cooking.feedback.telegraph,
      world,
      null,
      'stove',
    );
  });

  it('lets the table play the refusal, and plays no def cue for it', () => {
    const { handle, playCue } = route({
      type: 'ChoreRefused',
      t: 1,
      objectId: 'stove',
      reason: 'carrying',
    } as SimEvent);
    expect(handle).toHaveBeenCalledWith('ChoreRefused', world);
    expect(playCue).not.toHaveBeenCalled();
  });

  it('plays nothing of a chore in a level with none', () => {
    expect(route(judged('fail', 'late'), []).playCue).not.toHaveBeenCalled();
  });
});
