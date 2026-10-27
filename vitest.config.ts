import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
      exclude: ['tests/e2e/**', 'tests/architecture/fixtures/**', 'node_modules/**'],
      coverage: {
        provider: 'v8',
        // Only the sim is gated (project-context: src/sim >= 90 %).
        include: ['src/sim/**/*.ts'],
        exclude: ['**/*.test.ts'],
        thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
      },
    },
  }),
);
