import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { outProblem } from '../../tools/outputFile.ts';

const root = mkdtempSync(join(tmpdir(), 'pp-outfile-'));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('outProblem', () => {
  it('accepts a new file in an existing folder', async () => {
    expect(await outProblem(join(root, 'report.md'))).toBeNull();
  });

  it('says when the folder does not exist', async () => {
    expect(await outProblem(join(root, 'nope', 'report.md'))).toBe(
      `the folder ${join(root, 'nope')} does not exist`,
    );
  });

  it('says when the parent is a file, and when the target is a folder', async () => {
    const file = join(root, 'file.txt');
    writeFileSync(file, 'x');
    expect(await outProblem(join(file, 'report.md'))).toBe(`${file} is not a folder`);
    expect(await outProblem(root)).toBe(`${root} is a folder, not a file`);
  });
});
