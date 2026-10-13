import { Router } from 'express';
import { db } from '../db/index.js';
import { authenticate, signToken } from '../lib/auth.js';
import { ApiError, badRequest, conflict, requireFields } from '../lib/http.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';

import { authLimiter } from '../lib/rateLimit.js';
import { loginSchema, registerSchema, validateBody } from '../lib/validation.js';

export const authRoutes = Router();

authRoutes.post('/register', authLimiter, validateBody(registerSchema), (req, res) => {
  const { email, password, name, role = 'customer' } = req.body;

  const normalised = email.toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalised)) {
    throw conflict('An account with that email already exists.', 'email_taken');
  }

  const id = Number(
    db.prepare('INSERT INTO users (email, name, password, role) VALUES (?, ?, ?, ?)')
      .run(normalised, name, hashPassword(password), role).lastInsertRowid
  );

  const user = { id, email: normalised, name, role };
  res.status(201).json({ token: signToken(user), user });
});

authRoutes.post('/login', authLimiter, validateBody(loginSchema), (req, res) => {
  const { email, password } = req.body;

  const record = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  // Same response either way, so the endpoint does not reveal which emails exist.
  if (!record || !verifyPassword(password, record.password)) {
    throw new ApiError(401, 'invalid_credentials', 'That email and password do not match.');
  }

  const user = { id: record.id, email: record.email, name: record.name, role: record.role };
  res.json({ token: signToken(user), user });
});

authRoutes.get('/me', authenticate, (req, res) => res.json({ user: req.user }));
