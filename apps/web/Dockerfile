FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/web/tsconfig.json ./apps/web/tsconfig.json
COPY apps/web/next.config.js ./apps/web/next.config.js
COPY apps/web/tailwind.config.ts ./apps/web/tailwind.config.ts
COPY apps/web/postcss.config.js ./apps/web/postcss.config.js

ENV npm_config_cache=/tmp/.npm-cache
RUN rm -rf /root/.npm && npm install --workspaces --include-workspace-root=false

COPY packages/shared/src ./packages/shared/src
COPY apps/web ./apps/web

RUN npm run build --workspace packages/shared
RUN npm run build --workspace apps/web

FROM node:20-alpine AS runner
ENV NODE_ENV=production
ENV PATH="/app/node_modules/.bin:$PATH"
WORKDIR /app/apps/web

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/apps/web/.next ./ .next
COPY --from=builder /app/apps/web/public ./public
COPY --from=builder /app/apps/web/package.json ./package.json
COPY --from=builder /app/packages/shared/package.json ./../packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./../packages/shared/dist

EXPOSE 3000
CMD ["next", "start"]
