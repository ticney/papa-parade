import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { log } from '@shared/log';

export interface DistE2eStep {
  label: string;
  command: string;
  args: string[];
}

const PLAYWRIGHT = ['playwright', 'test', '-c', 'playwright.dist.config.ts'];

/**
 * The commands `npm run e2e:dist` runs, in order. Against the local `dist/`: the playtest check
 * first (a missing or prod `dist/` fails here with a clear message), the dist specs on both
 * browsers, then the perf spec alone, so the measure never shares the CPU with other specs. Against
 * a deployed build (`PP_DIST_URL`): the dist specs only.
 */
export function distE2eSteps(isLive: boolean): DistE2eStep[] {
  const specs: DistE2eStep = {
    label: 'dist specs',
    command: 'npx',
    args: [...PLAYWRIGHT, '--project', 'dist-chromium', '--project', 'dist-webkit'],
  };
  if (isLive) return [specs];
  return [
    {
      label: 'dist:check (playtest)',
      command: 'npm',
      args: ['run', 'dist:check', '--', '--flavor', 'playtest'],
    },
    specs,
    { label: 'perf', command: 'npx', args: [...PLAYWRIGHT, '--project', 'perf', '--workers=1'] },
  ];
}

function main(): void {
  const liveUrl = process.env.PP_DIST_URL;
  const steps = distE2eSteps(liveUrl !== undefined && liveUrl !== '');
  for (const step of steps) {
    log.info('assets', `e2e:dist › ${step.label}`);
    const run = spawnSync(step.command, step.args, { stdio: 'inherit' });
    if (run.error !== undefined) {
      log.error('assets', `e2e:dist cannot start "${step.label}"`, run.error);
    }
    if (run.status !== 0) {
      log.error('assets', `e2e:dist stopped at "${step.label}"`);
      process.exitCode = run.status ?? 1;
      return;
    }
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
