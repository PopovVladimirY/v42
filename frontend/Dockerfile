# Stage 1: build the React/Vite app
FROM node:22-alpine AS builder

WORKDIR /app

# Install deps first -- cached unless package files change
COPY package.json package-lock.json ./
RUN npm install --prefer-offline

# Copy source and build
COPY . .
# vite transpiles TS; strict tsc checks run separately in CI
RUN npx vite build

# Stage 2: serve with nginx
FROM nginx:1.27-alpine

# SPA config: fallback to index.html + proxy /api/* to backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Static files from Vite build
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
