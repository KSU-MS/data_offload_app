# Multi-stage build for Next.js (Node 20 LTS)

FROM node:20-alpine AS deps
WORKDIR /app
# Install system deps sometimes needed by Next native modules
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
# Install ALL dependencies (dev included) for building
RUN npm ci && npm cache clean --force

FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Install only production deps for the runner image
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache libc6-compat
# Next.js output for next start
# Copy the standalone server output and static assets
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Expose default Next.js port
EXPOSE 3000

# Environment defaults (can be overridden by compose)
ENV BASE_DIR=/recordings
ENV SCRIPT_PATH=/recordings/mcap_recover.sh

# Run the compiled Next.js server
CMD ["node", "server.js"]



