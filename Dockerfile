FROM node:22-alpine AS base

WORKDIR /app

RUN apk add --no-cache git openssh-client \
  && git config --system --add safe.directory /srv/codex/repos/grid_trading \
  && git config --system --add safe.directory /servers/150/wangge_api2_repo

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/runner/package.json apps/runner/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY . .
ENV API_INTERNAL_URL=http://api:4000
RUN npm run build
ENV NODE_ENV=production

EXPOSE 3000 4000
