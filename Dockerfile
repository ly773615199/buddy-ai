# ---- Stage 1: Build ----
FROM node:22-slim AS builder

WORKDIR /app

# 后端依赖 + 构建
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src/ ./src/
RUN npx tsc -p tsconfig.build.json

# 前端依赖 + 构建
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci --ignore-scripts
COPY frontend/ ./frontend/
RUN cd frontend && npx vite build

# ---- Stage 2: Production ----
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    fonts-liberation \
    fontconfig \
    && fc-cache -fv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 生产依赖
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm rebuild better-sqlite3 && npm cache clean --force

# 构建产物
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/frontend/dist/ ./frontend/dist/

# nginx 配置
COPY nginx.conf /etc/nginx/sites-available/default

# 启动脚本
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENV NODE_ENV=production
ENV BUDDY_WS_PORT=8765

EXPOSE 80

CMD ["/docker-entrypoint.sh"]
