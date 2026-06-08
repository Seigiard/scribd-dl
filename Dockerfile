FROM node:22-alpine

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    CI=true

RUN apk add --no-cache \
    chromium \
    ca-certificates \
    freetype \
    harfbuzz \
    nss \
    ttf-freefont

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY config.ini run.js ./
COPY src ./src

RUN mkdir -p output

ENTRYPOINT ["node", "run.js"]
