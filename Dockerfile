# AutoSD — static SPA production image (multi-stage, no secrets in layers)
# Build:  docker build -t autosd .
# Run:    docker run --rm -p 8080:8080 autosd

# ---- Stage 1: build ---------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Install first for layer caching. `npm ci` requires a clean lockfile.
COPY package.json package-lock.json ./
RUN npm ci

# Copy sources and produce the static bundle in dist-app/.
# NOTE: .dockerignore excludes .env* so local secrets can never enter the
# build context or the image layers.
COPY . .
RUN npm run build

# ---- Stage 2: serve ----------------------------------------------------------
FROM nginx:1.27-alpine AS serve

# Hardened SPA config: security headers, no server tokens, immutable asset cache.
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Static bundle only — no node_modules, no source maps, no env files.
COPY --from=build /app/dist-app /usr/share/nginx/html

# Run as the unprivileged nginx user (present in the alpine image).
RUN chown -R nginx:nginx /usr/share/nginx/html \
 && chmod -R a=rX,u+w /usr/share/nginx/html \
 && chown -R nginx:nginx /var/cache/nginx \
 && chown -R nginx:nginx /var/run

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1

USER nginx

CMD ["nginx", "-g", "daemon off;"]
