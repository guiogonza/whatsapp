# Base: Node 18 (Debian slim)
FROM node:18-slim

# ---- Ambiente Puppeteer/Chromium ----
# Evita que Puppeteer descargue Chromium propio
ENV PUPPETEER_SKIP_DOWNLOAD=true
# Dile a Puppeteer dónde está el Chromium del sistema
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# (opcional pero útil para logs y horarios)
ENV TZ=America/Bogota

# ---- Sistema y Chromium ----
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc1 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    tzdata \
    wget \
    dumb-init \
  && rm -rf /var/lib/apt/lists/*

# ---- App ----
WORKDIR /app

# Instala deps primero para aprovechar cache
COPY package*.json ./
# Si usas dev deps en build, quita --only=production
RUN npm install --omit=dev && npm cache clean --force

# Copia el resto del código
COPY . .

# Crea carpetas con permisos correctos
RUN mkdir -p /app/whatsapp-sessions /app/logs \
 && chown -R node:node /app \
 && chmod -R 755 /app \
 && chmod 775 /app/whatsapp-sessions

# Usuario no root
USER node

# Puerto
EXPOSE 3010

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3010/health || exit 1

# Entrypoint para señales limpias
ENTRYPOINT ["dumb-init", "--"]

# Arranque (usar la versión optimizada)
CMD ["node", "server-new.js"]
