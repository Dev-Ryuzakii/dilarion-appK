# Web platform build for Afribase (web.dilarion.xyz). The Tauri desktop app
# does not use this file.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build:test

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
RUN printf '%s\n' \
  'server {' \
  '  listen 8080;' \
  '  root /usr/share/nginx/html;' \
  '  location /assets/ { try_files $uri =404; add_header Cache-Control "public, max-age=31536000, immutable"; }' \
  '  location = /sw.js { add_header Cache-Control "no-cache"; try_files $uri =404; }' \
  '  location / { try_files $uri /index.html; add_header Cache-Control "no-cache"; }' \
  '}' > /etc/nginx/conf.d/default.conf
EXPOSE 8080
