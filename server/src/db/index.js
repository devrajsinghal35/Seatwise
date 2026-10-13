import pg from 'pg';
import { config } from '../config.js';

// Parse PostgreSQL BIGINT (type ID 20) as safe JavaScript integer numbers.
// Safe for epoch millisecond timestamps up to year 287396.
pg.types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));

// Parse PostgreSQL NUMERIC/DECIMAL (type ID 1700) as floating point numbers.
pg.types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

export let pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 25,
});

export const setPool = (newPool) => {
  pool = newPool;
};

export const getPool = () => pool;

export const closePool = async () => {
  if (pool) {
    await pool.end();
  }
};

/**
 * Translates SQLite-style '?' parameter placeholders to PostgreSQL '$1, $2, ...'.
 */
export const toPgSql = (sql) => {
  let idx = 1;
  return sql.replace(/\?/g, () => `$${idx++}`);
};

/**
 * Runs a callback inside a PostgreSQL transaction with a pooled client.
 *
 * Implements bounded retries on serialization failures (40001) and deadlock
 * detection (40P01), ensuring atomic multi-seat operations recover gracefully.
 */
export const withTransaction = async (fn, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      const isRetryable = err.code === '40001' || err.code === '40P01';
      if (isRetryable && attempt < maxRetries) {
        const jitter = Math.floor(Math.random() * 25) + 10;
        await new Promise((resolve) => setTimeout(resolve, jitter));
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
};

/**
 * Wraps a service function so it executes inside a managed transaction.
 * Usage: const myAction = writeTxn(async (client, arg1, arg2) => { ... });
 */
export const writeTxn = (fn) => (...args) => withTransaction((client) => fn(client, ...args));

export const db = {
  get pool() {
    return pool;
  },
  query: (text, params) => pool.query(toPgSql(text), params),
  queryRow: async (text, params) => {
    const res = await pool.query(toPgSql(text), params);
    return res.rows[0] || null;
  },
  queryRows: async (text, params) => {
    const res = await pool.query(toPgSql(text), params);
    return res.rows;
  },
  prepare: (sql) => {
    const pgSql = toPgSql(sql);
    return {
      get: async (...params) => {
        const res = await pool.query(pgSql, params.flat());
        return res.rows[0] || null;
      },
      all: async (...params) => {
        const res = await pool.query(pgSql, params.flat());
        return res.rows;
      },
      run: async (...params) => {
        let queryText = pgSql;
        if (/^\s*INSERT\s+INTO\b/i.test(queryText) && !/\bRETURNING\b/i.test(queryText)) {
          queryText += ' RETURNING id';
        }
        const res = await pool.query(queryText, params.flat());
        return { changes: res.rowCount, lastInsertRowid: res.rows[0]?.id };
      },
    };
  },
};
