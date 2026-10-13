/** An error carrying the status code and machine-readable code to send back. */
export class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, code = 'invalid_request', details = null) =>
  new ApiError(400, code, message, details);
export const notFound = (message, code = 'not_found') => new ApiError(404, code, message);
export const conflict = (message, code = 'conflict') => new ApiError(409, code, message);

/** Pulls required fields off a body, rejecting blanks in one place. */
export const requireFields = (body, fields) => {
  const out = {};
  for (const field of fields) {
    const value = body?.[field];
    if (value === undefined || value === null || value === '') {
      throw badRequest(`Field "${field}" is required.`);
    }
    out[field] = typeof value === 'string' ? value.trim() : value;
  }
  return out;
};

export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err instanceof ApiError) {
    const payload = { error: err.code, message: err.message };
    if (err.details) payload.details = err.details;
    return res.status(err.status).json(payload);
  }

  // A constraint we deliberately rely on tripping is still a conflict, not a crash.
  if (err?.code?.startsWith?.('SQLITE_CONSTRAINT')) {
    return res.status(409).json({ error: 'conflict', message: 'That change collided with an existing record.' });
  }

  console.error('Unhandled error:', err);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
};
