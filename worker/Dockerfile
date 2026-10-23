# O build usa context "." (raiz do repositório) — ver services.worker no docker-compose.prod.yml
FROM node:22-alpine
WORKDIR /app
COPY worker/package.json ./package.json
RUN npm install --omit=dev
COPY worker/index.js ./index.js
CMD ["node", "index.js"]
