FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001 DB_PATH=/data/board.sqlite
COPY --from=build /app/dist ./dist
COPY server ./server
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3001
VOLUME ["/data"]
CMD ["node","server/index.mjs"]
