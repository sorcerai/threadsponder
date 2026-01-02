FROM node:20-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Setup workspace
WORKDIR /app

# Copy root package.json and lockfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

# Copy packages
COPY packages ./packages

# Install dependencies (frozen lockfile for reproducibility)
RUN pnpm install --frozen-lockfile

# Build everything
RUN pnpm build

# --- API Run Stage ---
FROM base AS api
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3008

EXPOSE 3008
CMD ["pnpm", "--filter", "@threadsponder/api", "start"]

# --- Workers Run Stage ---
FROM base AS workers
WORKDIR /app
ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@threadsponder/workers", "start"]
