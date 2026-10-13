import { Router } from 'express';
import { db } from '../db/index.js';
import { authenticate, signToken } from '../lib/auth.js';
import { ApiError, conflict } from '../lib/http.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';

import { authLimiter } from '../lib/rateLimit.js';
import { loginSchema, registerSchema, validateBody } from '../lib/validation.js';

export const authRoutes = Router();

authRoutes.post('/register', authLimiter, validateBody(registerSchema), async (req, res, next) => {
  try {
    const { email, password, name, role = 'customer' } = req.body;

    const normalised = email.toLowerCase();
    const existing = await db.query('SELECT 1 FROM users WHERE email = $1', [normalised]);
    if (existing.rows.length > 0) {
      throw conflict('An account with that email already exists.', 'email_taken');
    }

    const insertRes = await db.query(
      'INSERT INTO users (email, name, password, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [normalised, name, hashPassword(password), role]
    );
    const id = insertRes.rows[0].id;

    const user = { id, email: normalised, name, role };
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    next(err);
  }
});

authRoutes.post('/login', authLimiter, validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const recordRes = await db.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const record = recordRes.rows[0];
    // Same response either way, so the endpoint does not reveal which emails exist.
    if (!record || !verifyPassword(password, record.password)) {
      throw new ApiError(401, 'invalid_credentials', 'That email and password do not match.');
    }

    const user = { id: record.id, email: record.email, name: record.name, role: record.role };
    res.json({ token: signToken(user), user });
  } catch (err) {
    next(err);
  }
});

authRoutes.get('/me', authenticate, (req, res) => res.json({ user: req.user }));
