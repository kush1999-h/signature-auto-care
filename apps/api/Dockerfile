FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json

ENV npm_config_cache=/tmp/.npm-cache
RUN rm -rf /root/.npm && npm install --workspaces --include-workspace-root=false

COPY packages/shared/src ./packages/shared/src
COPY apps/api/src ./apps/api/src

RUN npm run build --workspace packages/shared && npm run build --workspace apps/api

FROM node:20-alpine AS runner
ENV NODE_ENV=production
ENV PATH="/app/node_modules/.bin:$PATH"
WORKDIR /app/apps/api

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/apps/api/dist /app/apps/api/dist
COPY --from=builder /app/apps/api/package.json /app/apps/api/package.json
COPY --from=builder /app/packages/shared /app/packages/shared

# Ensure shared package is available at runtime via symlink
RUN mkdir -p /app/node_modules/@signature-auto-care && \
    rm -rf /app/node_modules/@signature-auto-care/shared && \
    ln -s /app/packages/shared /app/node_modules/@signature-auto-care/shared

EXPOSE 3001
CMD ["node", "dist/main.js"]
