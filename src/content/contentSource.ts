import type { Result } from '@shared/result';

/**
 * Where content text comes from. `src/content` never touches `fs` or `fetch`: the Node tools and
 * the browser each hand `loadContent` their own source. The source returns the raw text so that
 * `parseContentFile` produces the same errors everywhere.
 */
export interface ContentSource {
  /** `file` is relative to `content/` (`'feel.json'`, later `'threats/outlet.json'`). */
  read(file: string): Promise<Result<string>>;
}
