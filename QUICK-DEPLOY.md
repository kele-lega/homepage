# 最简部署

同一台 Linux 服务器即可运行。支持多个登录账号，每个账号有独立的基金列表、基金缓存、日历和 Steam 绑定。管理员只有 `kele`，可以管理其他账号并查看丁组；普通用户看不到丁组。乙组基金面板可在设置里开关。Caddy 负责 HTTPS；Homepage v2.4.0 原生 NextAuth 签发会话 Cookie，`auth-service` 校验账号并把当前用户名桥接给内部服务。

## 0. 前置

- 一台有公网 IP 的 Linux 服务器，安装 Docker（含 compose 插件）
- 域名 `kelelega.dpdns.org` 的 A 记录指向服务器 IP
- 开放安全组 / 防火墙的 80、443 端口

## 1. 部署 homepage

```bash
git clone https://github.com/kele-lega/homepage.git
cd homepage

# 生成普通账号 wzj 的初始密码哈希（密码只在服务器上输入，不要提交或发到聊天）
# 之后也可由 kele 在设置页直接添加普通账号
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'wzj 的密码'
```

创建 `.env`（该文件已被 `.gitignore` 忽略）：

```dotenv
# 多个用户各占一行，用户名和哈希之间用空格分隔
AUTH_USERS="kele <kele 的现有哈希>
wzj <wzj 的新哈希>"
SESSION_SECRET=<使用 openssl rand -hex 32 生成的随机值>
ICAL_UPSTREAM=<管理员日历订阅地址>
```

`SESSION_SECRET` 是必填项，至少 32 字符，且不要提交；可在服务器上运行 `openssl rand -hex 32` 生成。已有部署应保留原值。

# 页面登录后，设置 →「日历」可以保存或清除当前账号的地址。
# 也可预先手工创建配置文件；真实 token 不要提交 Git。

启动生产配置（不要带 override）：

```bash
docker compose -f docker-compose.yml up -d --build
```

完成后访问 `https://kelelega.dpdns.org`，自动进入原生 `/auth/signin`。使用现有用户名和密码登录；退出登录使用页面底部的原生按钮。

## 2. 日常更新

Homepage 固定为 v2.4.0，通过 `homepage-image/` 构建多账号和日历兼容补丁。升级上游版本需要同步提交号、源码校验和、镜像标签及补丁断言；不要直接切回 `latest`。详见 `docs/UPGRADE-2026-09-28.md`。

```bash
cd homepage && git pull && docker compose -f docker-compose.yml up -d --build
```

## 数据在哪

| 路径 | 内容 |
|---|---|
| `config/` | Homepage 配置和页面脚本 |
| `fund-monitor/data/users/<用户名>/funds.json` | 该用户的基金列表 |
| `fund-monitor/data/users/<用户名>/cache.json` | 该用户的行情缓存 |
| `ical-proxy/data/users.json` | 用户到日历地址的映射，含私有 token，不入 Git |
| Docker 卷 `caddy_data` | HTTPS 证书 |

旧版本的 `fund-monitor/data/funds.json` 和 `cache.json` 首次启动时会自动复制到 `admin` 用户目录，原文件保留不删除。

## 本地开发

本地 `docker compose up -d` 会使用 override，自动使用固定的 `local` 用户；本地不启动 Caddy，也不具备多账号认证。生产环境必须使用 `-f docker-compose.yml`。

## 常见问题

- **改了 `config/` 或 `Caddyfile` 不生效**：`docker compose -f docker-compose.yml restart`
- **镜像构建提示补丁目标不匹配**：检查新版源码并更新 `homepage-image/apply-patches.mjs`，不要跳过断言。现在不再修改 `.next` 编译文件。
- **80/443 被占用**：`docker ps` 查是谁占了端口，先停掉
- **更多细节**：`DEPLOYMENT-NOTES.md`、`MAINTENANCE.md`
