FROM node:22-slim
WORKDIR /app
COPY package.json index.mjs mirrorRules.mjs ./
COPY db ./db
RUN npm install --omit=dev --no-audit --no-fund
CMD ["node", "index.mjs"]
