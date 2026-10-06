import { existsSync } from 'node:fs';

// Imported first by every entry point (main.ts, data-source.ts for the TypeORM CLI), so
// modules that read process.env at import time (mqtt.config.ts) see .env values.
// Already-set variables win over .env (lets tests and CI override).
if (existsSync('.env')) {
  process.loadEnvFile();
}
