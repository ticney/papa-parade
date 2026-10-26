import { defineConfig } from 'vite';

// The `feel-writer` dev plugin arrives in story 2.1.
// Aliases come from tsconfig.json `paths`: it is the single source (no resolve.alias).
export default defineConfig({
  base: './',
  resolve: { tsconfigPaths: true },
  server: { host: true },
});
