import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { ApiError } from './http.js';

export const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.tokenTtl });

const readUser = async (req) => {
  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return null;

  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret);
    const res = await db.query('SELECT id, email, name, role FROM users WHERE id = $1', [payload.sub]);
    return res.rows[0] || null;
  } catch {
    return null;
  }
};

/** Rejects the request unless a valid token is present. */
export const authenticate = async (req, res, next) => {
  try {
    const user = await readUser(req);
    if (!user) return next(new ApiError(401, 'unauthenticated', 'Sign in to continue.'));
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

/** Attaches req.user when a token is present but lets anonymous callers through. */
export const optionalAuth = async (req, res, next) => {
  try {
    req.user = await readUser(req);
    next();
  } catch (err) {
    next(err);
  }
};

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new ApiError(403, 'forbidden', `This action is limited to: ${roles.join(', ')}.`));
  }
  next();
};
