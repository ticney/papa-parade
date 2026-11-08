import { defineConfig } from 'vite';
import { feelWriterPlugin } from './tools/vite/feelWriterPlugin.ts';

// Aliases come from tsconfig.json `paths`: it is the single source (no resolve.alias).
// `feel-writer` (story 2.1) is `apply: 'serve'`: the dev server writes `content/feel.json` for the
// feel panel, and no build contains it.
export default defineConfig({
  base: './',
  plugins: [feelWriterPlugin()],
  resolve: { tsconfigPaths: true },
  // The watcher skips `.claude/`: the story worktrees live in `.claude/worktrees/`, and Vite reloads
  // every open page when any `tsconfig.json` under its root is added, changed or deleted. A
  // `story:new` (or a branch switch) in a worktree while the main checkout ran e2e reloaded the
  // pages of the specs under way, which failed on « Execution context was destroyed » (2026-11-08).
  server: { host: true, watch: { ignored: ['**/.claude/**'] } },
  // `dist/.vite/manifest.json` lists the entry and dynamic-entry chunks with their source module
  // (not every module): `dist:check` reads it to catch a `src/debug` or `src/bots` chunk in a store
  // build; a debug module merged into another chunk is caught by the text markers instead.
  build: { manifest: true },
});
