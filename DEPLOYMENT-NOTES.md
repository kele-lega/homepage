# 部署注意事项：云端 Linux 服务器 vs 本地 Windows 10 调试

本文档记录在同一套 docker-compose 配置下，云端服务器和本地 Windows 10 开发机部署时的关键差异。
所有差异项均无需改代码，只改环境配置即可。

---

## 1. .env 文件 — 云端手动创建

当前部署使用 Homepage v2.4.0 原生登录及多账号适配：管理员只有 `kele`，其余账号都是普通用户。Homepage NextAuth 签发 HttpOnly、Secure 会话 Cookie；`auth-service` 保留 bcrypt 账号存储和账号管理，通过内网查询原生会话。Caddy 清除客户端的 `X-Authenticated-User` 后注入已校验身份。基金、日历和 Steam 仍按原用户名隔离。只有 `kele` 能管理普通账号并看到丁组；乙组基金面板仍可按账号开关。

当前构建和回滚流程见 `docs/UPGRADE-2026-09-28.md`。生产入口为 `/auth/signin`，旧 `/login-v2/` 自动跳转；旧登录容器不再部署。

`.env` 不在 git 中（`.gitignore` 已忽略）。每个账号占一行，格式为“用户名 + bcrypt 哈希”：

```dotenv
AUTH_USERS="kele <kele 的现有 bcrypt 哈希>
wzj <wzj 的新 bcrypt 哈希>"
SESSION_SECRET=<使用 openssl rand -hex 32 生成的随机值>
ICAL_UPSTREAM=https://calendar.google.com/calendar/ical/管理员token/public/basic.ics
STEAM_API_KEY=<https://steamcommunity.com/dev/apikey 申请的 Web API Key>
```

不要把真实密码、哈希、`SESSION_SECRET` 或日历 token 写入 Git，也不要发到聊天中。`SESSION_SECRET` 是必填项；可在服务器上执行 `openssl rand -hex 32` 生成。推荐在服务器上执行：

```bash
read -rsp 'wzj password: ' WZJ_PASSWORD; echo
docker run --rm caddy:2-alpine caddy hash-password --plaintext "$WZJ_PASSWORD"
unset WZJ_PASSWORD
```

把命令输出的 bcrypt 哈希填入服务器上的 `.env`，保留 `kele` 原有哈希。普通账号也可以稍后由 `kele` 在设置页添加，不必写进 `.env`。然后重启认证服务：

```bash
docker compose -f docker-compose.yml up -d --build auth-service caddy
```

如 `.env` 当前还使用旧的 `AUTH_USER`/`AUTH_HASH`，迁移到 `AUTH_USERS` 前请先保留原值备份；服务仍兼容旧变量，但多账号配置必须使用 `AUTH_USERS`。

---

## 2. HOMEPAGE_ALLOWED_HOSTS — 必须改为本机 IP/域名

修改 `docker-compose.yml` 中的 `HOMEPAGE_ALLOWED_HOSTS`，域名需和 Caddy 站点、`HOMEPAGE_EXTERNAL_URL` 保持一致：

```yaml
HOMEPAGE_ALLOWED_HOSTS: localhost:3000,127.0.0.1:3000,kelelega.dpdns.org
HOMEPAGE_EXTERNAL_URL: https://kelelega.dpdns.org
```

- 云端服务器：把 `103.79.186.22` 改成云端公网 IP（或域名）
- Windows 本地调试：override 使用 `http://localhost:3000` 并关闭原生认证，不需要公网 IP

如果改了 IP 忘了改这里，页面会返回 Host validation failed。

---

## 3. Docker Socket 路径 — Windows 需要改两处

### 3.1 docker-compose.yml 挂载路径

Linux（云端）：
```yaml
- /var/run/docker.sock:/var/run/docker.sock:ro
```

Windows 10（Docker Desktop + WSL2 后端）：
```yaml
- //var/run/docker.sock:/var/run/docker.sock:ro
```

双斜杠是 Docker Desktop 的约定，不能省。如果不改，homepage 容器内 docker.sock 挂载失败，
日志会报 `connect ENOENT /var/run/docker.sock`，Docker 容器监控 widget 无法显示。

### 3.2 config/docker.yaml

Linux（云端）：
```yaml
my-docker:
  socket: /var/run/docker.sock
```

Windows 10：
```yaml
my-docker:
  host: tcp://host.docker.internal:2375
```

注意：Windows 用 `host.docker.internal` 而非 socket 文件。需要在 Docker Desktop 设置中
开启 "Expose daemon on tcp://localhost:2375 without TLS"。

> 如果 Windows 端不想开 TCP daemon，也可以用 `socket: //var/run/docker.sock`（双斜杠），
> 但稳定性不如 TCP 方式，部分 Docker Desktop 版本有兼容问题。

---

## 4. glances 的 pid: host / network_mode: host — Windows 不支持

docker-compose.yml 中 glances 同时使用 `pid: host` 和 `network_mode: host`，才能采到宿主机
CPU/内存/进程和宿主机网卡（本机是 `ens17`，对应 `services.yaml` 的 `metric: network:ens17`）。
只开 `pid: host` 时网卡仍是容器里的 `eth0`，流量会一直接近 0。

API 绑定 `172.17.0.1:61208`（docker0），不监听公网。Homepage 用 `extra_hosts: glances:host-gateway`
继续访问 `http://glances:61208`。

- 云端 Linux：正常工作，glances 看到的是宿主机的 CPU/内存/网络
- Windows 10：`pid: host` 和 `network_mode: host` 在 Docker Desktop 下无效（WSL2 隔离），
  glances 只能看到容器自身的数据

本地调试时可以注释掉这两项，不影响其他功能，只是监控数据不准确。这是 Docker Desktop
的已知限制，不是 bug。

---

## 5. Google Calendar 可达性 — 国内 Windows 需要代理

- 云端香港服务器：直连 Google Calendar 无障碍，ical-proxy 正常工作
- Windows 10 国内开发机：Google Calendar 被墙，需要：

  方案 A：开全局 VPN/代理，Docker Desktop 走宿主机代理
  方案 B：在 ical-proxy.py 中加 HTTPS 代理（在 urlopen 前加 ProxyHandler）

  方案 B 示例（仅 Windows 调试时临时加，不要提交到 git）：
  ```python
  from urllib.request import ProxyHandler, build_opener
  proxy = ProxyHandler({"https": "http://127.0.0.1:7890"})
  opener = build_opener(proxy)
  data = opener.open(req, timeout=10).read()
  ```

  注意：云端部署时不需要代理，加了反而会失败。

---

## 6. 防火墙/端口 — 云端需开放，Windows 自动放行

云端服务器只需在安全组/防火墙放行 80、443。生产 Homepage、认证、基金、Steam 和日历不映射公网端口；Glances 仅绑定 docker0，不对外放行 61208。

Windows 10 Docker Desktop 默认自动放行所有端口映射，无需手动配置防火墙。

---

## 7. 行尾符（CRLF vs LF）

git 默认在 Windows 上 checkout 时会把 LF 转成 CRLF。以下文件受影响：

- `entrypoint.sh` — shell 脚本，CRLF 会导致 Linux 容器内执行报 `bad interpreter` 错误
- `ical-proxy/ical-proxy.py` — Python 对 CRLF 容忍度高，但建议保持 LF

解决：项目根目录已有 .gitignore，建议追加 .gitattributes：
```
*.sh text eol=lf
*.py text eol=lf
*.yaml text eol=lf
```

或者在 clone 后手动转换：
```powershell
# Windows
dos2unix entrypoint.sh ical-proxy/ical-proxy.py
```

> 如果云端是从 git 直接 clone 的，entrypoint.sh 是 LF，无此问题。
> 只有 Windows 端 checkout 后再传到 Linux 才会出问题。

---

## 8. 快速验证清单（两端通用）

部署完成后依次检查：

```bash
# 1. 三个核心容器都在跑
docker compose ps

# 2. iCal 代理健康检查
docker compose exec ical-proxy python -c "from urllib.request import Request, urlopen; print(urlopen(Request('http://localhost:8089/basic.ics', headers={'X-Authenticated-User':'admin'})).read(80))"

# 3. 生产接口需先在浏览器用 /auth/signin 登录；不再支持 curl -u Basic Auth。
# 登录后在开发者工具中确认 /auth/me、/fund-monitor/api/funds、
# /calendar/api/calendar 和 /steam-monitor/api/steam 分别返回当前账号数据。
```

---

## 9. fund-monitor 基金监控服务

只用 Python 标准库，`docker compose build fund-monitor` 即可，无需 pip 依赖。

### 9.1 生产 vs 本地的访问路径不同

生产由 Caddy 校验会话后剥掉 `/fund-monitor` 前缀，再反代到 `fund-monitor:8090`，
浏览器同源访问，不需要 CORS，服务也不对公网开端口。

本地 `docker-compose.override.yml` 里 caddy 不启动、直接访问 `localhost:3000`，所以 override 额外做了两件事：把 8090 映射到宿主机，并设 `FUND_ALLOW_ORIGIN=http://localhost:3000` 只放开这一个来源。当前本地服务使用固定的 `FUND_DEFAULT_USER=local`；生产环境不要设置该变量，必须由 Caddy 注入认证用户名。

如需手动指定后端地址，在浏览器控制台设 `window.FUND_MONITOR_BASE`。

### 9.2 数据持久化

`./fund-monitor/data` 挂到容器 `/app/data`，现在按用户保存：

- `users/<用户名>/funds.json` — 该用户的监控基金代码列表
- `users/<用户名>/cache.json` — 该用户最近一次成功抓取结果、刷新时间和错误状态
- 旧根目录 `funds.json` / `cache.json` — 首次启动自动复制给 `admin`，原文件保留

`ical-proxy/data/users.json` 保存用户到日历 URL 的映射，不入 Git。写入基金 JSON 使用「临时文件 + 原子替换」，容器重启或并发读不会读到半写入的 JSON。
备份整个 `fund-monitor/data` 和 `ical-proxy/data/users.json` 即可。

### 9.3 数据源说明

用天天基金移动端 `fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo`，一次请求批量拿多只基金。

注意：旧的 `fundgz.1234567.com.cn/js/{code}.js` 已失效，它返回 **HTTP 200 但 body 是 HTML 404 页**。
所以判断成功必须校验响应内容，不能只看状态码 —— 代码里已按这个前提处理，换源时别踩回去。

### 9.4 验证

```bash
# 单元测试（53 项，不依赖网络）
cd fund-monitor && python3 -m unittest discover -p "test_*.py"

# 健康检查（生产走 Caddy；先通过会话 Cookie 登录）
curl -u "$AUTH_USER:密码" https://kelelega.dpdns.org/fund-monitor/healthz

# 本地直连
curl localhost:8090/healthz
curl -X POST -H 'Content-Type: application/json' -d '{"code":"000001"}' localhost:8090/api/funds
curl localhost:8090/api/funds
curl -X DELETE localhost:8090/api/funds/000001

# 确认后台在持续抓取（看时间戳在变）
docker compose logs -f fund-monitor
```

环境变量：`FUND_REFRESH_SEC`（默认 60，最小 10）、`FUND_PORT`、`FUND_HOST`、
`FUND_DATA_DIR`、`FUND_ALLOW_ORIGIN`。

---

## 总结对照表

| 项目 | 云端 Linux | Windows 10 本地 |
|------|-----------|----------------|
| .env | 手动创建 | 手动创建 |
| ALLOWED_HOSTS | 改公网 IP | localhost 即可 |
| docker.sock 挂载 | `/var/run/docker.sock` | `//var/run/docker.sock` |
| docker.yaml | socket 方式 | TCP host.docker.internal |
| pid: host / network_mode: host | 正常 | 无效，注释掉 |
| Google Calendar | 直连 | 需代理/VPN |
| 防火墙 | 手动开放端口 | 自动放行 |
| 行尾符 | LF（无问题） | 注意 CRLF 问题 |
| fund-monitor 访问 | Caddy `/fund-monitor/*` 同源 | 直连 `localhost:8090` + CORS |
