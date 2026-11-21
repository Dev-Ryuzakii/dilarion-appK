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
# The platform runs the container as a non-root user, so nginx must not write
# anywhere root-owned. It also refuses opening /dev/stderr as a file, so errors
# use nginx's "stderr" keyword (writes to the inherited stream) and access logs
# are off. The pid file and temp directories live in /tmp. There is no "user" directive, because a non-root
# process cannot switch users.
RUN printf '%s\n' \
  'worker_processes auto;' \
  'pid /tmp/nginx.pid;' \
  'error_log stderr warn;' \
  'events { worker_connections 1024; }' \
  'http {' \
  '  include /etc/nginx/mime.types;' \
  '  default_type application/octet-stream;' \
  '  access_log off;' \
  '  sendfile on;' \
  '  client_body_temp_path /tmp/client_temp;' \
  '  proxy_temp_path /tmp/proxy_temp;' \
  '  fastcgi_temp_path /tmp/fastcgi_temp;' \
  '  uwsgi_temp_path /tmp/uwsgi_temp;' \
  '  scgi_temp_path /tmp/scgi_temp;' \
  '  server {' \
  '    listen 8080;' \
  '    root /usr/share/nginx/html;' \
  '    location /assets/ { try_files $uri =404; add_header Cache-Control "public, max-age=31536000, immutable"; }' \
  '    location = /sw.js { add_header Cache-Control "no-cache"; try_files $uri =404; }' \
  '    location / { try_files $uri /index.html; add_header Cache-Control "no-cache"; }' \
  '  }' \
  '}' > /etc/nginx/nginx.conf \
  && rm -f /etc/nginx/conf.d/default.conf
EXPOSE 8080
# Start nginx directly: the stock entrypoint scripts try to edit files in
# /etc/nginx, which a non-root user cannot do. "-e stderr" keeps nginx from
# opening its built-in /var/log/nginx/error.log path before it reads the config.
ENTRYPOINT []
CMD ["nginx", "-e", "stderr", "-g", "daemon off;"]
