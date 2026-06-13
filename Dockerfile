# ---- build frontend ----
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:20-slim
WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY server ./server
COPY --from=build /app/dist ./dist

ENV PORT=3001
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 3001

CMD ["node", "server/index.js"]
