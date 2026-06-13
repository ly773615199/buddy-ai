#!/bin/sh
set -e

# 启动 nginx
nginx

# 启动后端
exec node dist/start-ws.js
