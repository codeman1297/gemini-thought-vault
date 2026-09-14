# ============================================================================
# Stage 1: Build & Bundle Stage
# ============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package manifests
COPY package.json package-lock.json ./

# Deterministic dependency installation including devDependencies for compilation
RUN npm ci

# Copy full application source
COPY . .

# Compile client SPA and bundle Express backend to dist/server.cjs
ENV NODE_ENV=production
RUN npm run build

# ============================================================================
# Stage 2: Production Container Runtime Stage
# ============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

# Cloud Run runtime environment defaults
ENV NODE_ENV=production
ENV PORT=3000

# Install strictly production dependencies to keep image minimal
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy pre-compiled production artifacts from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Enforce non-root execution boundary
USER node

# Container listener port (Cloud Run dynamically sets PORT at runtime)
EXPOSE 3000

# Production startup command
CMD ["node", "dist/server.cjs"]
