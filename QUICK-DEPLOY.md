# 最简部署

两台都不需要，同一台 Linux 服务器装好 Docker 即可。总共三条命令。

## 0. 前置

- 一台有公网 IP 的 Linux 服务器，安装 Docker（含 compose 插件）
- 域名 `kelelega.dpdns.org` 的 A 记录指向服务器 IP（用于 Caddy 自动 HTTPS）
- 开放安全组 / 防火墙的 80、443 端口（3000 不用开，real-time-fund 走公网 IP 直连或自行加防护）

## 1. 部署 homepage（含 Caddy + 基金监控）

```bash
git clone https://github.com/kele-lega/homepage.git
cd homepage

# 唯一需要改的文件：.env（已被 .gitignore 忽略，不会提交）
cat > .env <<'EOF'
AUTH_USER=admin
AUTH_HASH=<哈希>
ICAL_UPSTREAM=<你的日历订阅地址>
EOF
# 哈希生成：docker run --rm caddy:2-alpine caddy hash-password --plaintext '你的密码'

# 生产用主文件启动（不要带 override，本地开发才用）
docker compose -f docker-compose.yml up -d --build
```

完成后访问 `https://kelelega.dpdns.org`，输入 Basic Auth 用户名密码进入。

包含的服务：homepage 本体、glances（系统监控）、ical-proxy（日历中转）、
fund-monitor（基金净值，页面卡片自动出现）、caddy（HTTPS + 认证）。

## 2. 部署 real-time-fund（基金详情站）

```bash
git clone https://github.com/kele-lega/real-time-fund.git
cd real-time-fund
docker compose up -d --build
```

默认不需要 `.env.local`（Supabase 等留空即可，估算净值会自动在
天天基金/新浪之间降级取数）。占用宿主机 3000 端口。

## 3. 日常更新

```bash
cd homepage && git pull && docker compose -f docker-compose.yml up -d --build
cd ../real-time-fund && git pull && docker compose up -d --build
```

## 数据在哪（备份这几个就够）

| 路径 | 内容 |
|---|---|
| `homepage/config/` | homepage 全部配置（services.yaml 等） |
| `homepage/fund-monitor/data/funds.json` | 监控的基金列表 |
| Docker 卷 `caddy_data` | HTTPS 证书（丢了会自动重新签，无所谓） |

## 常见问题

- **改了 `config/` 或 `Caddyfile` 不生效**：`docker compose -f docker-compose.yml restart`
- **80/443 被占用**：`docker ps` 查是谁占了端口，先停掉
- **更多细节**：`DEPLOYMENT-NOTES.md`（环境差异）、`MAINTENANCE.md`（架构与排障）
