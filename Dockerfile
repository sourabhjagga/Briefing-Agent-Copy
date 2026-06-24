FROM node:20@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5 AS builder

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

COPY package.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/dashboard/package.json ./apps/dashboard/package.json

RUN npm install --foreground-scripts

COPY apps/dashboard ./apps/dashboard
RUN npm run build --prefix apps/dashboard

COPY apps/api ./apps/api
RUN cp -r apps/dashboard/out apps/api/public

RUN npm run build --prefix apps/api

FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && \
    apt-get install -y \
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
        python3 \
        python3-pip \
        ffmpeg \
        --no-install-recommends && \
    (apt-get install -y libasound2t64 || apt-get install -y libasound2) && \
    pip3 install yt-dlp --break-system-packages && \
    rm -rf /var/lib/apt/lists/* /root/.cache/pip

RUN groupadd -r agentsg && useradd -r -m -g agentsg agentuser

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/package.json ./package.json
COPY --from=builder /app/apps/api/src ./src
COPY --from=builder /app/apps/api/public ./public

RUN mkdir -p data logs && \
    chown -R agentuser:agentsg /app/data /app/logs

VOLUME ["/app/data", "/app/logs"]

USER agentuser

EXPOSE 3000

CMD ["node", "src/index.js"]
