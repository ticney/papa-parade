import { describe, expect, it } from 'vitest';
import { distE2eSteps } from '../../../tools/build/runDistE2e.ts';

describe('distE2eSteps', () => {
  it('checks the playtest dist first, then the dist specs, then the perf spec alone', () => {
    const steps = distE2eSteps(false);
    expect(steps.map((step) => step.label)).toEqual([
      'dist:check (playtest)',
      'dist specs',
      'perf',
    ]);
    expect(steps[0]?.args).toEqual(['run', 'dist:check', '--', '--flavor', 'playtest']);
    expect(steps[1]?.args).toContain('dist-chromium');
    expect(steps[1]?.args).toContain('dist-webkit');
    expect(steps[1]?.args).not.toContain('perf');
  });

  it('runs the perf spec on its own project, one worker, so nothing shares its CPU', () => {
    const perf = distE2eSteps(false).at(-1);
    expect(perf?.args).toEqual([
      'playwright',
      'test',
      '-c',
      'playwright.dist.config.ts',
      '--project',
      'perf',
      '--workers=1',
    ]);
  });

  it('against a deployed build runs the dist specs only: no local dist, no perf', () => {
    const steps = distE2eSteps(true);
    expect(steps.map((step) => step.label)).toEqual(['dist specs']);
  });
});
