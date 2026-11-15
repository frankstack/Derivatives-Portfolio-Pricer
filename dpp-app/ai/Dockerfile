# DPP AI service. Build from this folder: docker build -t dpp-ai:local .
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY *.mjs ./
RUN mkdir -p /data && chown node:node /data
USER node
# Listens on every interface of the container only; deploy.sh publishes the port on the server's loopback.
ENV DPP_AI_STATE_DIR=/data DPP_AI_HOST=0.0.0.0
EXPOSE 5024
CMD ["node", "server.mjs"]
