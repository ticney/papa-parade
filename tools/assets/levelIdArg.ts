import { err, ok, type Result } from '@shared/result';

const LEVEL_ID = /^[a-z][a-z0-9_]*$/;

/**
 * The level an asset tool works on, from its command line (`argv` without node and the script). There is
 * no default (story 9.8): a bare run would rewrite the files of a frozen room (7.1), so each tool names
 * its level or refuses with its usage line.
 */
export function levelIdArg(argv: readonly string[], script: string): Result<string, string> {
  const usage = `usage: npm run ${script} -- <levelId>   (a level of content/levels/, e.g. salon_kitchen)`;
  const [id, ...rest] = argv;
  if (id === undefined) return err(`no level given. ${usage}`);
  if (rest.length > 0) return err(`one level at a time, got ${argv.length} arguments. ${usage}`);
  if (!LEVEL_ID.test(id)) return err(`"${id}" is not a level id (lower_snake_case). ${usage}`);
  return ok(id);
}
