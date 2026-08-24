import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { ApiError } from './http.js';

export const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.tokenTtl });

const findUser = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?');

const readUser = (req) => {
  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return null;

  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret);
    return findUser.get(payload.sub) || null;
  } catch {
    return null;
  }
};

/** Rejects the request unless a valid token is present. */
export const authenticate = (req, res, next) => {
  const user = readUser(req);
  if (!user) return next(new ApiError(401, 'unauthenticated', 'Sign in to continue.'));
  req.user = user;
  next();
};

/** Attaches req.user when a token is present but lets anonymous callers through. */
export const optionalAuth = (req, res, next) => {
  req.user = readUser(req);
  next();
};

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new ApiError(403, 'forbidden', `This action is limited to: ${roles.join(', ')}.`));
  }
  next();
};
