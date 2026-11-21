# syntax=docker/dockerfile:1.7
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY examples/data /data
USER node
# MCP over stdio: run with `docker run -i --rm -v "$PWD:/data:ro" mcp-server-toolkit`
ENTRYPOINT ["node", "dist/index.js", "--root", "/data"]
