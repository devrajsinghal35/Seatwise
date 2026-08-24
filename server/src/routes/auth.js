import { Router } from 'express';
import { db } from '../db/index.js';
import { authenticate, signToken } from '../lib/auth.js';
import { ApiError, badRequest, conflict, requireFields } from '../lib/http.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';

export const authRoutes = Router();

// Admins are created by seeding, so nobody can grant themselves that role.
const SELF_SERVE_ROLES = ['customer', 'organiser'];

authRoutes.post('/register', (req, res) => {
  const { email, password, name } = requireFields(req.body, ['email', 'password', 'name']);
  const role = req.body.role || 'customer';

  if (!SELF_SERVE_ROLES.includes(role)) throw badRequest('Role must be "customer" or "organiser".');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('Enter a valid email address.');
  if (password.length < 8) throw badRequest('Use a password of at least 8 characters.');

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

authRoutes.post('/login', (req, res) => {
  const { email, password } = requireFields(req.body, ['email', 'password']);

  const record = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  // Same response either way, so the endpoint does not reveal which emails exist.
  if (!record || !verifyPassword(password, record.password)) {
    throw new ApiError(401, 'invalid_credentials', 'That email and password do not match.');
  }

  const user = { id: record.id, email: record.email, name: record.name, role: record.role };
  res.json({ token: signToken(user), user });
});

authRoutes.get('/me', authenticate, (req, res) => res.json({ user: req.user }));
