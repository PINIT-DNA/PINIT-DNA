# PINIT-DNA backend — multi-stage build, for ECS Fargate / any container host.
#
# Builds only the API server. The Vercel-hosted frontend (client/) is a
# separate deploy target and is not baked into this image.
#
# Intentionally does NOT run the historical `npm run start:prod` /
# `render:start` boot chain (26 sequential ensure-*.cjs schema-patch scripts).
# That chain re-runs on every container start, including every horizontal
# scale-out event, not just deploys. Real schema changes belong in
# `npm run db:migrate:prod` (prisma migrate deploy), run once as a pre-deploy
# step outside this image's boot path — see docs/PINIT-DNA_ECS_Production_Readiness_Audit.pdf, §4.

FROM node:20-slim AS builder
WORKDIR /app

# Toolchain some npm packages fall back to at install time if no prebuilt
# native binary matches this platform (defensive; sharp/ffmpeg-static/
# @ffprobe-installer normally ship prebuilt binaries and won't need this).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop devDependencies from the already-installed, already-`prisma generate`d
# node_modules instead of a second install in the runtime stage — keeps the
# generated Prisma client without regenerating it.
RUN npm prune --omit=dev

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/false pinit

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json ./

# ./vault/encrypted is only used when Supabase/S3 storage is not configured
# (local-dev fallback path); ./tmp/uploads is genuinely used in every
# environment as request-scoped multer temp storage.
RUN mkdir -p ./vault/encrypted ./tmp/uploads && chown -R pinit:pinit /app
USER pinit

EXPOSE 4000
CMD ["node", "dist/server.js"]
