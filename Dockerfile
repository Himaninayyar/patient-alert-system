FROM node:22-alpine

WORKDIR /app

# install dependencies first: Docker re-uses this step when only the code changed
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
USER node

EXPOSE 3000 8080
CMD ["node", "index.js"]