import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
      exclude: ['tests/e2e/**', 'tests/architecture/fixtures/**', 'node_modules/**'],
    },
  }),
);
