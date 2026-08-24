import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config.js';

mkdirSync(dirname(config.databaseFile), { recursive: true });

export const db = new Database(config.databaseFile);

// WAL lets readers work while a writer holds the lock, which is what makes the
// seat map stay responsive during a booking rush.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// If another writer holds the lock, wait rather than failing the request outright.
db.pragma('busy_timeout = 5000');

db.exec(readFileSync(resolve(import.meta.dirname, 'schema.sql'), 'utf8'));

/**
 * Wraps a function in a transaction that takes the write lock up front.
 *
 * BEGIN IMMEDIATE matters here: a deferred transaction only acquires the write
 * lock at its first write, so two seat-hold attempts could both read
 * "available" and one would fail late with SQLITE_BUSY. Taking the lock at the
 * start serialises them cleanly instead.
 */
export const writeTxn = (fn) => {
  const wrapped = db.transaction(fn);
  return (...args) => wrapped.immediate(...args);
};
