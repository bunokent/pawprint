# PawPrint frontend — Vite dev server (hot reload) for `docker compose up`.
FROM node:24-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5173
# --host 0.0.0.0 so the published port is reachable from the host machine.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]
