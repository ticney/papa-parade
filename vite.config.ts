import { defineConfig } from 'vite';

// The `feel-writer` dev plugin arrives in story 2.1.
// Aliases come from tsconfig.json `paths`: it is the single source (no resolve.alias).
export default defineConfig({
  base: './',
  resolve: { tsconfigPaths: true },
  server: { host: true },
  // `dist/.vite/manifest.json` lists the entry and dynamic-entry chunks with their source module
  // (not every module): `dist:check` reads it to catch a `src/debug` or `src/bots` chunk in a store
  // build; a debug module merged into another chunk is caught by the text markers instead.
  build: { manifest: true },
});
