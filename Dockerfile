FROM node:26-alpine AS builder
RUN apk add --no-cache openssl ca-certificates
WORKDIR /app

# Build-time public vars (baked into the client bundle)
ARG NEXT_PUBLIC_CLIENT_MODE=false

# Dependency layer — cache-friendly: only rerun when package*.json changes
COPY package*.json ./
COPY patches ./patches/
COPY prisma ./prisma/
RUN --mount=type=cache,target=/root/.npm npm ci --legacy-peer-deps

# Source & build (Next cache persistido entre builds)
COPY . .
RUN --mount=type=cache,target=/app/.next/cache npx prisma generate && npm run build
ENV NEXT_TELEMETRY_DISABLED=1

# Strip devDeps from node_modules after build
# tsx needed at runtime, kept explicitly
RUN npm prune --omit=dev && npm install --no-save tsx typescript

# Production image
FROM node:26-alpine AS runner
RUN apk add --no-cache openssl ca-certificates
WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/scripts ./scripts

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push && (if [ -n \"$ADMIN_EMAIL\"] && [ -n \"$ADMIN_PASSWORD\"]; then node scripts/setup-admin.js \"$ADMIN_EMAIL\" \"$ADMIN_PASSWORD\"; fi) && node node_modules/tsx/dist/cli.mjs src/server/index.ts"]
