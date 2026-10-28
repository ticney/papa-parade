import { defineConfig } from 'vite';
import { feelWriterPlugin } from './tools/vite/feelWriterPlugin.ts';

// Aliases come from tsconfig.json `paths`: it is the single source (no resolve.alias).
// `feel-writer` (story 2.1) is `apply: 'serve'`: the dev server writes `content/feel.json` for the
// feel panel, and no build contains it.
export default defineConfig({
  base: './',
  plugins: [feelWriterPlugin()],
  resolve: { tsconfigPaths: true },
  server: { host: true },
  // `dist/.vite/manifest.json` lists the entry and dynamic-entry chunks with their source module
  // (not every module): `dist:check` reads it to catch a `src/debug` or `src/bots` chunk in a store
  // build; a debug module merged into another chunk is caught by the text markers instead.
  build: { manifest: true },
});
