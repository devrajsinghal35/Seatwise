# syntax=docker/dockerfile:1

# Stage 1: Build & Dependencies
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Stage 2: Production Runtime
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source and migrations from builder
COPY --from=builder /app/src ./src
COPY --from=builder /app/migrations ./migrations

# Use non-root node user provided by node:alpine
RUN chown -R node:node /app
USER node

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/index.js"]
