import { defineConfig } from 'vite';

// The `feel-writer` dev plugin arrives in story 2.1.
// Aliases come from tsconfig.json `paths`: it is the single source (no resolve.alias).
export default defineConfig({
  base: './',
  resolve: { tsconfigPaths: true },
  server: { host: true },
  // `dist/.vite/manifest.json` lists the source modules of every chunk: `dist:check` reads it to
  // prove that a store build holds no `src/debug` or `src/bots` module.
  build: { manifest: true },
});
