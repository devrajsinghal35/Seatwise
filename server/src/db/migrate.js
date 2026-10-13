import { runner } from 'node-pg-migrate';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '../../migrations');

export const runMigrations = async ({
  databaseUrl = config.databaseUrl,
  schema = 'public',
  direction = 'up',
  verbose = false,
  noLock = schema !== 'public',
} = {}) => {
  return runner({
    databaseUrl,
    dir: migrationsDir,
    direction,
    schema,
    migrationsTable: 'pgmigrations',
    verbose,
    noLock,
  });
};
