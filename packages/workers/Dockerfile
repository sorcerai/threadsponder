# Threadsponder Workers - Cloud Run Dockerfile
# Multi-stage build for BullMQ job processors

# ============================================
# Stage 1: Build
# ============================================
FROM node:20-slim AS builder

# Install pnpm
RUN npm install -g pnpm@9

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./

# Copy packages needed for workers
COPY packages/shared/package.json packages/shared/
COPY packages/workers/package.json packages/workers/

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared/src packages/shared/src
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/workers/src packages/workers/src
COPY packages/workers/tsconfig.json packages/workers/

# Build shared package first (workers depends on it)
RUN pnpm --filter @threadsponder/shared build

# Build workers package
RUN pnpm --filter @threadsponder/workers build

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
COPY packages/workers/package.json packages/workers/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts from builder
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/workers/dist packages/workers/dist

# Cloud Run config
ENV PORT=8080
ENV NODE_ENV=production

# Expose port (for Cloud Scheduler HTTP triggers)
EXPOSE 8080

# Workers run continuously processing BullMQ jobs
# Cloud Run will keep the container alive while jobs are running
CMD ["node", "packages/workers/dist/index.js"]
