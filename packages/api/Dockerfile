# Threadsponder API - Cloud Run Dockerfile
# Multi-stage build for minimal production image

# ============================================
# Stage 1: Build
# ============================================
FROM node:20-slim AS builder

# Install pnpm
RUN npm install -g pnpm@9

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy packages needed for API
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared/src packages/shared/src
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/api/src packages/api/src
COPY packages/api/tsconfig.json packages/api/

# Build shared package first (API depends on it)
RUN pnpm --filter @threadsponder/shared build

# Build API package
RUN pnpm --filter @threadsponder/api build

# ============================================
# Stage 2: Production
# ============================================
FROM node:20-slim AS production

# Install pnpm for workspace resolution
RUN npm install -g pnpm@9

WORKDIR /app

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy package.json files for workspace resolution
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts from builder
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/api/dist packages/api/dist

# Cloud Run expects PORT env var
ENV PORT=8080
ENV NODE_ENV=production

# Expose port
EXPOSE 8080

# Health check (Cloud Run uses HTTP health checks)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Run the API server
CMD ["node", "packages/api/dist/index.js"]
