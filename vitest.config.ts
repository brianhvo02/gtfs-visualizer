import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*_test.ts', 'scripts/**/*_test.ts'],
    environment: 'node',
  },
});
