import type { ContentSource } from '@content/contentSource';
import { err, ok } from '@shared/result';

// The one place of `src` that touches the content folder. In a build the files are inlined in the
// bundle (no request, offline start); in dev Vite serves each one as a module.
const RAW_CONTENT = import.meta.glob<string>(
  ['../../../content/**/*.json', '!../../../content/_schemas/**'],
  { eager: true, query: '?raw', import: 'default' },
);

const CONTENT_DIR = '/content/';

/** Content files by path relative to `content/` (`feel.json`, `threats/outlet.json`). */
function indexByRelativePath(raw: Record<string, string>): Map<string, string> {
  const files = new Map<string, string>();
  for (const [path, text] of Object.entries(raw)) {
    files.set(path.slice(path.lastIndexOf(CONTENT_DIR) + CONTENT_DIR.length), text);
  }
  return files;
}

export function createBrowserContentSource(): ContentSource {
  const files = indexByRelativePath(RAW_CONTENT);
  return {
    read(file) {
      const text = files.get(file);
      if (text === undefined) {
        return Promise.resolve(err({ kind: 'content', message: `content/${file} is not bundled` }));
      }
      return Promise.resolve(ok(text));
    },
  };
}
