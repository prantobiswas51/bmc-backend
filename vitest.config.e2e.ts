import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    testTimeout: 15_000,
    // Set before src/data-source.ts loads .env, so these win.
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://bm:bm@localhost:5432/bm_central_test',
      MQTT_HOOK_SECRET: 'hook-secret',
      MQTT_USERNAME: 'bm-central',
      MQTT_PASSWORD: 'service-pass',
      COMMAND_TTL: '1',
      JWT_SECRET: 'test-secret',
      MQTT_URL: '',
    },
  },
});
