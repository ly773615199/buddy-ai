# Buddy 部署指南

## 目录

- [环境要求](#环境要求)
- [Docker 部署（推荐）](#docker-部署推荐)
  - [Linux 服务器](#linux-服务器)
  - [Windows 11](#windows-11)
  - [macOS](#macos)
- [传统部署（npm）](#传统部署npm)
- [配置说明](#配置说明)
- [常见问题](#常见问题)

---

## 环境要求

| 方式 | 最低要求 |
|------|----------|
| Docker | Docker 24+ / Docker Compose v2+ |
| npm | Node.js 22+, npm 10+ |
| 硬盘 | ≥ 2GB（镜像 + 依赖） |
| 内存 | ≥ 512MB |
| 端口 | 80（HTTP）、8765（WS，容器内部） |

---

## Docker 部署（推荐）

### Linux 服务器

```bash
# 1. 克隆项目
git clone https://github.com/ly773615199/buddy.git
cd buddy

# 2. 创建配置文件
cat > .env << 'EOF'
NODE_ENV=production
BUDDY_WS_PORT=8765
# 按需填写 API Key
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
BRAVE_API_KEY=
SERPER_API_KEY=
EOF

# 3. 构建并启动
docker compose up --build -d

# 4. 验证
docker compose ps
curl http://localhost/api/status
```

### Windows 11

**前置条件：**
- 安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- Settings → General → 勾选 **Use WSL 2 based engine**
- 安装 Git

**步骤（PowerShell）：**

```powershell
# 1. 克隆项目
git clone https://github.com/ly773615199/buddy.git
cd buddy

# 2. 创建 .env 文件
@"
NODE_ENV=production
BUDDY_WS_PORT=8765
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
"@ | Out-File -Encoding utf8 .env

# 3. 构建并启动
docker compose up --build -d

# 4. 验证
docker compose ps
curl http://localhost/api/status
```

**Win11 注意事项：**
- 如果端口 80 被占用（如 IIS），修改 `docker-compose.yml` 中 `ports: "8080:80"`
- 首次构建较慢（需下载 node:22-slim 基础镜像）
- Docker Desktop 已配置国内镜像源可加速

### macOS

与 Linux 步骤相同。安装 [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/) 后执行相同的命令即可。

> Apple Silicon (M1/M2) 用户：`node:22-slim` 支持 arm64，无需额外配置。

---

## 传统部署（npm）

适用于开发环境或无 Docker 的场景。

```bash
# 1. 克隆项目
git clone https://github.com/ly773615199/buddy.git
cd buddy

# 2. 安装依赖
npm run install:all

# 3. 启动（开发模式）
npm run dev:all        # 后端 WS + 前端 Vite 同时启动
# 浏览器打开 http://localhost:5173

# 4. 生产构建
npm run build:all      # 编译后端 + 构建前端
npm start              # 启动后端
npm run start:frontend # 启动前端预览
```

---

## 配置说明

### 统一模型池（推荐）

系统采用统一模型池架构：只需配置 API Key，模型自动发现、智能选择。

`.env` 文件中按需填写 API Key：

| 变量 | 说明 | 必填 |
|------|------|------|
| `OPENAI_API_KEY` | OpenAI API 密钥 | 按需 |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | 按需 |
| `SILICONFLOW_API_KEY` | 硅基流动密钥（聚合平台，一个 key 挂 100+ 模型） | 按需 |
| `ANTHROPIC_API_KEY` | Anthropic / Claude 密钥 | 按需 |
| `GOOGLE_API_KEY` | Google / Gemini 密钥 | 按需 |

> 至少配置一个 Provider 的 API Key。配置多个时系统自动选择最优模型（Thompson Sampling 学习）。

### 其他变量

| 变量 | 说明 | 必填 |
|------|------|------|
| `NODE_ENV` | 运行环境 | 否（默认 `production`） |
| `BUDDY_WS_PORT` | WebSocket 端口 | 否（默认 `8765`） |
| `BRAVE_API_KEY` | Brave Search 密钥 | 否 |
| `SERPER_API_KEY` | Serper 搜索密钥 | 否 |
| `AZURE_SPEECH_KEY` | Azure TTS 密钥 | 否 |
| `AZURE_SPEECH_REGION` | Azure TTS 区域 | 否 |

### 高级配置

启动后通过 Web UI 的「设置 → 模型池」管理：
- 查看自动发现的模型列表
- 排除不想用的模型
- 切换调度策略（任务匹配 / 成本优先 / 质量优先）
- 设置每小时预算上限

---

## 常用命令

```bash
# 查看状态
docker compose ps

# 查看日志
docker compose logs -f

# 重启服务
docker compose restart

# 停止服务
docker compose down

# 重新构建并启动
docker compose up --build -d

# 查看数据卷
docker volume inspect buddy_buddy-data
```

---

## 常见问题

### Q: 构建时报 `electron` 下载超时？
A: Electron 仅用于桌面端打包，不影响 Docker 部署。Dockerfile 不包含 Electron。

### Q: `better-sqlite3` 报错找不到 `.node` 文件？
A: 确保使用最新 Dockerfile，生产阶段需要 `npm rebuild better-sqlite3`。

### Q: 前端构建报 `sharp` / `tesseract.js` 找不到？
A: 这些是可选依赖，`vite.config.ts` 中已标记为 external。如需图片处理功能，单独安装 `sharp`。

### Q: Win11 上 80 端口被占用？
A: 修改 `docker-compose.yml`：
```yaml
ports:
  - "8080:80"
```
然后访问 `http://localhost:8080`。

### Q: 数据丢失？
A: 数据持久化在 Docker volume `buddy-data` 中，容器重建不会丢失。用 `docker volume inspect buddy_buddy-data` 查看实际路径。

### Q: 如何更新？
A:
```bash
git pull
docker compose up --build -d
```
数据 volume 不受影响。
