FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmjs.org/ \
  && npm ci --no-audit --no-fund
COPY src ./src
COPY scripts ./scripts
ENV PORT=3000
EXPOSE 3000
CMD ["npm","run","start"]
