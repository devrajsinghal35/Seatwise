import { z } from 'zod';
import { badRequest } from './http.js';

export const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const details = {};
    for (const issue of result.error.issues) {
      const field = issue.path.join('.') || '_root';
      if (!details[field]) {
        details[field] = issue.message;
      }
    }
    const firstMsg = result.error.issues[0]?.message || 'Invalid request body.';
    return next(badRequest(firstMsg, 'invalid_request', details));
  }
  req.body = result.data;
  next();
};

export const registerSchema = z.object({
  email: z
    .string({ required_error: 'Field "email" is required.' })
    .trim()
    .email('Enter a valid email address.')
    .max(255, 'Email cannot exceed 255 characters.'),
  password: z
    .string({ required_error: 'Field "password" is required.' })
    .min(8, 'Use a password of at least 8 characters.')
    .max(128, 'Password cannot exceed 128 characters.'),
  name: z
    .string({ required_error: 'Field "name" is required.' })
    .trim()
    .min(1, 'Field "name" is required.')
    .max(100, 'Name cannot exceed 100 characters.'),
  role: z
    .enum(['customer', 'organiser'], {
      errorMap: () => ({ message: 'Role must be "customer" or "organiser".' }),
    })
    .default('customer')
    .optional(),
});

export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Field "email" is required.' })
    .trim()
    .min(1, 'Field "email" is required.')
    .max(255, 'Email cannot exceed 255 characters.'),
  password: z
    .string({ required_error: 'Field "password" is required.' })
    .min(1, 'Field "password" is required.')
    .max(128, 'Password cannot exceed 128 characters.'),
});

export const venueSchema = z.object({
  name: z
    .string({ required_error: 'Field "name" is required.' })
    .trim()
    .min(1, 'Field "name" is required.')
    .max(100, 'Venue name cannot exceed 100 characters.'),
  city: z
    .string({ required_error: 'Field "city" is required.' })
    .trim()
    .min(1, 'Field "city" is required.')
    .max(100, 'City cannot exceed 100 characters.'),
  categories: z
    .array(
      z.union([
        z.string().trim().min(1, 'Every seat category needs a name.').max(50),
        z.object({ name: z.string().trim().min(1, 'Every seat category needs a name.').max(50) }),
      ]),
      { required_error: 'Give the venue at least one seat category.' }
    )
    .min(1, 'Give the venue at least one seat category.')
    .max(20, 'At most 20 categories allowed.'),
  rows: z
    .array(
      z.object({
        label: z.string().trim().min(1, 'Every row needs a label.').max(10),
        seats: z
          .number({ required_error: 'Seat count is required.' })
          .int('Seat count must be an integer.')
          .min(1, 'Row must hold between 1 and 40 seats.')
          .max(40, 'Row must hold between 1 and 40 seats.'),
        category: z.string().trim().min(1, 'Category is required.').max(50),
      }),
      { required_error: 'Give the venue at least one row of seats.' }
    )
    .min(1, 'Give the venue at least one row of seats.')
    .max(50, 'At most 50 rows allowed.'),
});

export const eventSchema = z.object({
  title: z
    .string({ required_error: 'Field "title" is required.' })
    .trim()
    .min(1, 'Field "title" is required.')
    .max(200, 'Title cannot exceed 200 characters.'),
  kind: z.enum(['movie', 'concert'], {
    errorMap: () => ({ message: 'Kind must be "movie" or "concert".' }),
  }),
  description: z.string().max(2000, 'Description cannot exceed 2000 characters.').default('').optional(),
  language: z.string().max(50, 'Language cannot exceed 50 characters.').default('').optional(),
  runtimeMin: z
    .number()
    .int('Runtime must be an integer.')
    .positive('Runtime must be a positive number.')
    .max(1000, 'Runtime cannot exceed 1000 minutes.')
    .nullable()
    .optional(),
});

export const showSchema = z.object({
  eventId: z
    .number({ required_error: 'Field "eventId" is required.' })
    .int()
    .positive('eventId must be a positive integer.'),
  venueId: z
    .number({ required_error: 'Field "venueId" is required.' })
    .int()
    .positive('venueId must be a positive integer.'),
  startsAt: z
    .string({ required_error: 'Field "startsAt" is required.' })
    .refine((val) => !Number.isNaN(new Date(val).getTime()), {
      message: 'startsAt must be a valid date and time.',
    }),
  prices: z.record(
    z.string(),
    z.number().min(0, 'Price must be non-negative.').max(1_000_000, 'Price cannot exceed 1,000,000.')
  ),
});

export const holdSchema = z.object({
  seatIds: z
    .array(
      z
        .number({ required_error: 'Seat ID must be a number.' })
        .int('Seat ID must be an integer.')
        .positive('Seat ID must be a positive integer.'),
      { required_error: 'Field "seatIds" is required.' }
    )
    .min(1, 'Select at least one seat.')
    .max(8, 'You can hold at most 8 seats at a time.'),
});

const phoneRegex = /^[+]?[\d\s\-().]{3,20}$/;

export const bookingSchema = z.object({
  showId: z
    .number({ required_error: 'Field "showId" is required.' })
    .int()
    .positive('showId must be a positive integer.'),
  guestName: z
    .string({ required_error: 'Field "guestName" is required.' })
    .trim()
    .min(1, 'Field "guestName" is required.')
    .max(100, 'Guest name cannot exceed 100 characters.'),
  guestMobile: z
    .string({ required_error: 'Field "guestMobile" is required.' })
    .trim()
    .regex(phoneRegex, 'Enter a valid mobile number.'),
  guestEmail: z
    .string({ required_error: 'Field "guestEmail" is required.' })
    .trim()
    .email('Enter a valid email address.')
    .max(255, 'Guest email cannot exceed 255 characters.'),
  idempotencyKey: z
    .string()
    .trim()
    .max(255, 'Idempotency key cannot exceed 255 characters.')
    .nullable()
    .optional(),
});

export const waitlistSchema = z.object({
  categoryId: z
    .number({ required_error: 'Field "categoryId" is required.' })
    .int()
    .positive('categoryId must be a positive integer.'),
});
