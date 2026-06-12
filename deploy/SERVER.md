# 单机服务器部署指南

适用于不跑 Kubernetes、直接在一台 Linux 服务器上用 Docker Compose 部署 Loop。

与 K8s 部署对比见 [K8S.md](./K8S.md)；镜像构建细节见 [DOCKER.md](./DOCKER.md)。

---

## 架构

```
浏览器 ──► :3002 Web (Next.js)
         ──► :3000 Orchestrator (API + Agent)
         ──► :3001 Gateway (WebSocket)

Orchestrator ──► MySQL（公司托管 或 compose 内置）
              └──► /data/workspaces（Git 工作区 PVC）
```

可选 Nginx 反代统一域名，见 `deploy/server/nginx.loop.conf.example`。

---

## 环境要求

| 项目 | 要求 |
|------|------|
| 系统 | Linux x86_64（推荐 Ubuntu 22.04+ / CentOS 8+） |
| Docker | Engine 24+，含 `docker compose` v2 |
| 内存 | 建议 ≥ 8GB（Dev Agent 编译较吃资源） |
| 磁盘 | ≥ 50GB（工作区 + 镜像 + 日志） |
| MySQL | 8.0+（外部实例或 compose `--profile local-db`） |

---

## 快速开始

在**仓库根目录**克隆代码后：

```bash
cd deploy/server

# 1. 初始化（生成 .env、data 目录）
chmod +x install.sh deploy.sh
./install.sh

# 2. 编辑配置
vim .env
# 必填：DATABASE_URL、PM/DEV/OPS_MODEL_API_KEY
# 必填：NEXT_PUBLIC_ORCHESTRATOR_URL、NEXT_PUBLIC_WS_URL（浏览器可访问的地址）

# 3. 一键部署（使用 .env 中的外部 MySQL）
./deploy.sh all

# 或使用 compose 内置 MySQL（开发/演示）
./deploy.sh all --local-db
```

浏览器访问：`http://<服务器IP>:3002`

---

## 常用命令

```bash
cd deploy/server

./deploy.sh build          # 仅重新构建镜像
./deploy.sh migrate        # 仅跑数据库迁移
./deploy.sh up             # 启动
./deploy.sh down           # 停止
./deploy.sh restart        # 重启
./deploy.sh logs orchestrator
```

**修改 `NEXT_PUBLIC_*` 后必须重新构建 web：**

```bash
./deploy.sh build
docker compose up -d web
```

---

## 配置说明

配置文件：`deploy/server/.env`（由 `.env.example` 复制）

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | MySQL 连接串 |
| `DB_TIMEZONE` | 默认 `+08:00` |
| `PM/DEV/OPS_MODEL_API_KEY` | 模型密钥 |
| `WORKSPACE_HOST_PATH` | 宿主机工作区目录，默认 `./data/workspaces` |
| `GIT_SSH_KEY_HOST_PATH` | Deploy Key 目录，挂载到容器 `/secrets/git` |
| `NEXT_PUBLIC_ORCHESTRATOR_URL` | 前端访问 API 的地址（**构建时**写入） |
| `NEXT_PUBLIC_WS_URL` | 前端 WebSocket 地址（**构建时**写入） |

Git Deploy Key：

```bash
cp ~/.ssh/loop_deploy_key deploy/server/data/git-secrets/id_ed25519
chmod 600 deploy/server/data/git-secrets/id_ed25519
```

---

## 使用外部 MySQL

1. 创建数据库：`CREATE DATABASE loop CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
2. 首次可导入全量脚本：`mysql -h HOST -u USER -p loop < deploy/mysql-init.sql`
3. `.env` 中设置 `DATABASE_URL=mysql://user:pass@host:3306/loop`
4. `./deploy.sh migrate` 应用增量迁移

---

## 使用内置 MySQL（可选）

```bash
./deploy.sh all --local-db
```

`.env` 中建议使用：

```env
DATABASE_URL=mysql://loop:loop@mysql:3306/loop
```

数据目录：`deploy/server/data/mysql`

---

## Nginx 反代（生产推荐）

1. 复制 `deploy/server/nginx.loop.conf.example` 到 nginx 配置目录
2. 修改 `server_name` 与 SSL
3. `.env` 改为公网 URL 后重新 `build` web
4. 仅暴露 80/443，可不对外暴露 3000–3002

---

## 升级发布

```bash
cd /path/to/loop
git pull
cd deploy/server
./deploy.sh build
./deploy.sh migrate
./deploy.sh restart
```

---

## 故障排查

| 现象 | 处理 |
|------|------|
| 前端连不上 API | 检查 `NEXT_PUBLIC_*` 是否为浏览器可达地址，改后需 rebuild web |
| 迁移失败 | 确认 `DATABASE_URL`、MySQL 网络与账号权限 |
| Dev Agent Git 失败 | 检查 `data/git-secrets/id_ed25519` 权限与 GitHub Deploy Key |
| 容器反复重启 | `./deploy.sh logs orchestrator` 查看缺少的环境变量 |

---

## 目录结构

```
deploy/server/
├── install.sh              # 首次初始化
├── deploy.sh               # 构建 / 迁移 / 启停
├── docker-compose.yml
├── .env.example
├── nginx.loop.conf.example
├── dockerfiles/            # 单机专用 Dockerfile（不依赖 Harbor 基础镜像）
│   ├── orchestrator.Dockerfile
│   ├── gateway.Dockerfile
│   └── web.Dockerfile
└── data/                   # 运行时数据（gitignore）
    ├── workspaces/
    ├── git-secrets/
    └── mysql/              # local-db 时使用
```
