FROM node:22-alpine
WORKDIR /worker
COPY worker/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY worker/index.js ./
CMD ["node", "index.js"]
