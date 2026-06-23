# ─── STAGE 1: BUILDER ───────────────────────────────────────────────────
# Pinned to specific digest for reproducible builds (node:20 Debian Bookworm)
FROM node:20@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5 AS builder

WORKDIR /app

# Skip chromium download in builder stage — system Chromium is used at runtime
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Copy package descriptors — package-lock.json must be committed to the repo
COPY package*.json ./

# Use npm ci (respects package-lock.json for reproducible installs)
# --foreground-scripts ensures native addon postinstall scripts run correctly as root
RUN --mount=type=cache,target=/root/.npm \
    npm ci --foreground-scripts

# Copy source files and static assets
COPY src/ ./src
COPY public/ /app/public

# Build the frontend assets
RUN npm run build

# ─── STAGE 2: RUNTIME ───────────────────────────────────────────────────
# Pinned to specific digest for reproducible builds (node:20-slim Debian Bookworm)
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS runner

WORKDIR /app

# Set production environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    # Tell Puppeteer to skip its own Chromium download and use the system binary
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install Chromium and system dependencies for Puppeteer + yt-dlp + ffmpeg
# Note: libasound2 was renamed to libasound2t64 in Debian Bookworm
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y \
    chromium \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2t64 \
    python3 \
    python3-pip \
    ffmpeg \
    --no-install-recommends \
    && pip3 install yt-dlp --break-system-packages \
    && rm -rf /root/.cache/pip

# Create a non-root user for security
RUN groupadd -r agentsg && useradd -r -m -g agentsg agentuser

# Copy built artifacts from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/src/ ./src
COPY --from=builder /app/public/ ./public

# Create writable data directories and set ownership only on those dirs
# Avoids slow chown -R over thousands of node_modules files
RUN mkdir -p data logs && \
    chown -R agentuser:agentsg /app/data /app/logs

# Declare persistent volumes so data survives container restarts
VOLUME ["/app/data", "/app/logs"]

# Switch to non-root user for execution
USER agentuser

# Expose HTTP dashboard port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
