# Build and runtime share Debian/glibc so sharp and optional TensorFlow native bindings work.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/public/models ./public/models
COPY server ./server
COPY scripts/diagnose-ml.js ./scripts/diagnose-ml.js
COPY src/logic.js ./src/logic.js
RUN mkdir -p /data/models /data/jobs && chown -R node:node /app /data
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
