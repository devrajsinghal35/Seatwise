export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'SeatWise API',
    version: '1.0.0',
    description:
      'High-concurrency ticket booking engine with compare-and-swap (CAS) row locking, auto-expiring holds, distributed SSE real-time fan-out, and FIFO waitlists.',
    contact: {
      name: 'SeatWise Engineering',
      url: 'https://github.com/devrajsinghal35/SeatWise',
    },
  },
  servers: [
    {
      url: '/api',
      description: 'Current environment API base',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Provide a JWT returned from /api/auth/login or /api/auth/register',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        required: ['error', 'message'],
        properties: {
          error: {
            type: 'string',
            example: 'invalid_request',
          },
          message: {
            type: 'string',
            example: 'Field "seatIds" is required.',
          },
          details: {
            type: 'object',
            additionalProperties: {
              type: 'string',
            },
            example: { seatIds: 'Select at least one seat.' },
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          email: { type: 'string', format: 'email', example: 'priya@example.com' },
          name: { type: 'string', example: 'Priya Sharma' },
          role: { type: 'string', enum: ['customer', 'organiser', 'admin'], example: 'customer' },
        },
      },
      RegisterRequest: {
        type: 'object',
        required: ['email', 'password', 'name'],
        properties: {
          email: { type: 'string', format: 'email', example: 'priya@example.com' },
          password: { type: 'string', minLength: 8, example: 'Password123' },
          name: { type: 'string', minLength: 1, maxLength: 100, example: 'Priya Sharma' },
          role: { type: 'string', enum: ['customer', 'organiser'], default: 'customer' },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'priya@example.com' },
          password: { type: 'string', example: 'Password123' },
        },
      },
      VenueCreateRequest: {
        type: 'object',
        required: ['name', 'city', 'categories', 'rows'],
        properties: {
          name: { type: 'string', example: 'Grand IMAX Orion' },
          city: { type: 'string', example: 'Bengaluru' },
          categories: {
            type: 'array',
            items: { type: 'string' },
            example: ['Recliner', 'Prime', 'Standard'],
          },
          rows: {
            type: 'array',
            items: {
              type: 'object',
              required: ['label', 'seats', 'category'],
              properties: {
                label: { type: 'string', example: 'A' },
                seats: { type: 'integer', minimum: 1, maximum: 40, example: 12 },
                category: { type: 'string', example: 'Recliner' },
              },
            },
          },
        },
      },
      EventCreateRequest: {
        type: 'object',
        required: ['title', 'kind'],
        properties: {
          title: { type: 'string', example: 'Interstellar IMAX Experience' },
          kind: { type: 'string', enum: ['movie', 'concert'], example: 'movie' },
          description: { type: 'string', example: 'Christopher Nolan epic in 70mm IMAX format.' },
          language: { type: 'string', example: 'English' },
          runtimeMin: { type: 'integer', nullable: true, example: 169 },
        },
      },
      ShowCreateRequest: {
        type: 'object',
        required: ['eventId', 'venueId', 'startsAt', 'prices'],
        properties: {
          eventId: { type: 'integer', example: 1 },
          venueId: { type: 'integer', example: 1 },
          startsAt: { type: 'string', format: 'date-time', example: '2026-11-20T19:30:00Z' },
          prices: {
            type: 'object',
            additionalProperties: { type: 'number' },
            example: { '1': 450, '2': 300, '3': 200 },
          },
        },
      },
      HoldRequest: {
        type: 'object',
        required: ['seatIds'],
        properties: {
          seatIds: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 1,
            maxItems: 8,
            example: [1, 2],
          },
        },
      },
      BookingCreateRequest: {
        type: 'object',
        required: ['showId', 'guestName', 'guestMobile', 'guestEmail'],
        properties: {
          showId: { type: 'integer', example: 1 },
          guestName: { type: 'string', example: 'Priya Sharma' },
          guestMobile: { type: 'string', example: '+91 98765 43210' },
          guestEmail: { type: 'string', format: 'email', example: 'priya@example.com' },
          idempotencyKey: { type: 'string', nullable: true, example: 'b94e35da-95a9-4623-a5c4-72fe889980d1' },
        },
      },
      WaitlistJoinRequest: {
        type: 'object',
        required: ['categoryId'],
        properties: {
          categoryId: { type: 'integer', example: 1 },
        },
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded'], example: 'ok' },
          postgres: { type: 'string', enum: ['ok', 'down'], example: 'ok' },
          redis: { type: 'string', enum: ['ok', 'disabled', 'down'], example: 'ok' },
          holdTtlSeconds: { type: 'integer', example: 120 },
          offerTtlSeconds: { type: 'integer', example: 180 },
          mail: { type: 'string', enum: ['brevo', 'outbox'], example: 'outbox' },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        description: 'Reports health status of PostgreSQL connection pool and Redis connection.',
        tags: ['System'],
        responses: {
          '200': {
            description: 'System operational',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
          },
          '503': {
            description: 'Service degraded or down',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
          },
        },
      },
    },
    '/auth/register': {
      post: {
        summary: 'Register a new user',
        description: 'Creates a customer or organiser account with hashed password.',
        tags: ['Auth'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } } },
        },
        responses: {
          '201': {
            description: 'User registered successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    user: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '409': { description: 'Email already registered', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '429': { description: 'Too many registration requests from IP' },
        },
      },
    },
    '/auth/login': {
      post: {
        summary: 'Sign in to an existing account',
        tags: ['Auth'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
        },
        responses: {
          '200': {
            description: 'Successfully authenticated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    user: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '401': { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '429': { description: 'Rate limit exceeded' },
        },
      },
    },
    '/auth/me': {
      get: {
        summary: 'Get current user profile',
        tags: ['Auth'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { content: { 'application/json': { schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } } } } },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/venues': {
      get: {
        summary: 'List venues',
        tags: ['Venues'],
        responses: {
          '200': { description: 'List of all registered venues and seat counts' },
        },
      },
      post: {
        summary: 'Create a venue layout (Admin only)',
        tags: ['Venues'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/VenueCreateRequest' } } },
        },
        responses: {
          '201': { description: 'Venue created' },
          '400': { description: 'Validation error' },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Forbidden (requires admin role)' },
        },
      },
    },
    '/events': {
      get: {
        summary: 'Browse upcoming events',
        tags: ['Events'],
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search keywords' },
          { name: 'kind', in: 'query', schema: { type: 'string', enum: ['movie', 'concert'] } },
          { name: 'city', in: 'query', schema: { type: 'string' } },
          { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: {
          '200': { description: 'List of matching event listings with next showtimes' },
        },
      },
      post: {
        summary: 'Create an event (Organiser only)',
        tags: ['Events'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/EventCreateRequest' } } },
        },
        responses: {
          '201': { description: 'Event created' },
          '403': { description: 'Forbidden (requires organiser role)' },
        },
      },
    },
    '/events/{id}': {
      get: {
        summary: 'Get event details with scheduled showings',
        tags: ['Events'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Event details and showings' },
          '404': { description: 'Event not found' },
        },
      },
    },
    '/cities': {
      get: {
        summary: 'List cities with venues',
        tags: ['Events'],
        responses: {
          '200': { description: 'Array of unique city names' },
        },
      },
    },
    '/shows': {
      post: {
        summary: 'Schedule a showing (Organiser only)',
        tags: ['Shows'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ShowCreateRequest' } } },
        },
        responses: {
          '201': { description: 'Showing scheduled and seat rows instantiated' },
          '400': { description: 'Validation error' },
          '403': { description: 'Forbidden' },
        },
      },
    },
    '/shows/{id}': {
      get: {
        summary: 'Get showing details',
        tags: ['Shows'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Showing details' },
          '404': { description: 'Show not found' },
        },
      },
    },
    '/shows/{id}/seats': {
      get: {
        summary: 'Get real-time seating map',
        description: 'Returns all seat rows with prices, categories, and current status (available, held, booked).',
        tags: ['Shows'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Seating map and live hold data' },
        },
      },
    },
    '/shows/{id}/stream': {
      get: {
        summary: 'Real-time Server-Sent Events (SSE) seat change stream',
        description: 'Subscribes client to live seat status changes broadcast across instances via Redis Pub/Sub.',
        tags: ['Shows'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'SSE stream',
            content: { 'text/event-stream': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/shows/{id}/hold': {
      post: {
        summary: 'Reserve seats with a time-limited hold (CAS row lock)',
        tags: ['Holds & Checkout'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/HoldRequest' } } },
        },
        responses: {
          '200': { description: 'Seats held successfully' },
          '400': { description: 'Validation error' },
          '409': { description: 'Seat already held or booked' },
          '429': { description: 'Rate limit exceeded' },
        },
      },
      delete: {
        summary: 'Release active seat hold',
        tags: ['Holds & Checkout'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '204': { description: 'Hold released' },
        },
      },
    },
    '/bookings': {
      get: {
        summary: 'List user tickets and booking history',
        tags: ['Holds & Checkout'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'List of confirmed and cancelled bookings' },
        },
      },
      post: {
        summary: 'Confirm booking and convert held seats into tickets',
        tags: ['Holds & Checkout'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description: 'Unique key preventing duplicate bookings on network retry',
          },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/BookingCreateRequest' } } },
        },
        responses: {
          '201': { description: 'Booking confirmed and ticket emailed' },
          '400': { description: 'Validation error' },
          '409': { description: 'Hold expired or seat conflict' },
        },
      },
    },
    '/bookings/{id}': {
      get: {
        summary: 'Get ticket booking details',
        tags: ['Holds & Checkout'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Booking detail with seat labels and QR reference' },
          '404': { description: 'Booking not found' },
        },
      },
    },
    '/bookings/{id}/cancel': {
      post: {
        summary: 'Cancel booking and cascade seats to waitlist',
        tags: ['Holds & Checkout'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Booking cancelled; seats offered to waitlist or returned to general sale' },
        },
      },
    },
    '/bookings/{id}/qr': {
      get: {
        summary: 'Generate QR code data URL for ticket verification',
        tags: ['Holds & Checkout'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'QR Code Base64 Data URL' },
        },
      },
    },
    '/shows/{id}/waitlist': {
      post: {
        summary: 'Join waitlist for a sold-out seat category',
        tags: ['Waitlist & Offers'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/WaitlistJoinRequest' } } },
        },
        responses: {
          '201': { description: 'Joined FIFO waitlist queue' },
          '409': { description: 'Category still has seats or user already queued' },
        },
      },
    },
    '/waitlist': {
      get: {
        summary: 'Get user active waitlist entries',
        tags: ['Waitlist & Offers'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'List of queued and offered waitlist entries' },
        },
      },
    },
    '/waitlist/{id}': {
      delete: {
        summary: 'Leave waitlist queue',
        tags: ['Waitlist & Offers'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '204': { description: 'Removed from waitlist' },
        },
      },
    },
    '/offers/{token}': {
      get: {
        summary: 'View waitlist offer details',
        tags: ['Waitlist & Offers'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Offer details with countdown timer' },
          '404': { description: 'Offer expired or invalid' },
        },
      },
    },
    '/offers/{token}/claim': {
      post: {
        summary: 'Claim waitlist offer and turn into booking',
        tags: ['Waitlist & Offers'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Offer claimed; booking created' },
          '409': { description: 'Offer expired or already claimed' },
        },
      },
    },
    '/organiser/events': {
      get: {
        summary: 'List events created by authenticated organiser',
        tags: ['Organiser'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'List of organiser events with revenue summary' },
          '403': { description: 'Forbidden (organiser only)' },
        },
      },
    },
    '/organiser/events/{id}/summary': {
      get: {
        summary: 'Get revenue and occupancy breakdown for event',
        tags: ['Organiser'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Event revenue and showing occupancy breakdown' },
          '403': { description: 'Forbidden' },
        },
      },
    },
  },
};
