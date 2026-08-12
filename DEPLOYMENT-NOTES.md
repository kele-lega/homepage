# 部署注意事项：云端 Linux 服务器 vs 本地 Windows 10 调试

本文档记录在同一套 docker-compose 配置下，云端服务器和本地 Windows 10 开发机部署时的关键差异。
所有差异项均无需改代码，只改环境配置即可。

---

## 1. .env 文件 — 两端都要手动创建，内容相同

.env 不在 git 中（.gitignore 已忽略），每台机器需手动创建：

```bash
# Linux
cat > .env << 'EOF'
ICAL_UPSTREAM=https://calendar.google.com/calendar/ical/你的token/public/basic.ics
EOF
```

```powershell
# Windows PowerShell
Set-Content -Path .env -Value "ICAL_UPSTREAM=https://calendar.google.com/calendar/ical/你的token/public/basic.ics"
```

两端内容完全一样，都是 Google Calendar 的 basic.ics URL。

---

## 2. HOMEPAGE_ALLOWED_HOSTS — 必须改为本机 IP/域名

docker-compose.yml 第 15 行，当前写死了 IP：

```yaml
HOMEPAGE_ALLOWED_HOSTS: localhost:3001,127.0.0.1:3001,103.79.186.22:3001
```

- 云端服务器：把 `103.79.186.22` 改成云端公网 IP（或域名）
- Windows 本地调试：改成 `localhost:3001,127.0.0.1:3001` 即可，不需要公网 IP

如果改了 IP 忘了改这里，页面会返回 403 Forbidden。

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

## 4. glances 的 pid: host — Windows 不支持

docker-compose.yml 中 glances 服务使用了 `pid: host` 来采集宿主机真实进程数据：

```yaml
glances:
  pid: host
```

- 云端 Linux：正常工作，glances 看到的是宿主机的 CPU/内存/网络
- Windows 10：`pid: host` 在 Docker Desktop 下无效（WSL2 隔离），glances 只能看到容器自身的数据

本地调试时可以注释掉 `pid: host`，不影响其他功能，只是监控数据不准确。这是 Docker Desktop
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

云端服务器需在安全组/防火墙放行：
- 3001（homepage 主界面）
- 61208（glances API，可选 — 仅调试时外部访问需要）

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
# 1. 三个容器都在跑
docker ps

# 2. ical-proxy 健康检查
docker exec ical-proxy python -c "from urllib.request import urlopen; print(urlopen('http://localhost:8089/health').read())"

# 3. homepage 能拉到 iCal 数据
docker exec homepage wget -qO- http://ical-proxy:8089/basic.ics | head -5
# 应看到 BEGIN:VCALENDAR

# 4. 页面可访问
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001
# 应返回 200
```

---

## 总结对照表

| 项目 | 云端 Linux | Windows 10 本地 |
|------|-----------|----------------|
| .env | 手动创建 | 手动创建 |
| ALLOWED_HOSTS | 改公网 IP | localhost 即可 |
| docker.sock 挂载 | `/var/run/docker.sock` | `//var/run/docker.sock` |
| docker.yaml | socket 方式 | TCP host.docker.internal |
| pid: host | 正常 | 无效，注释掉 |
| Google Calendar | 直连 | 需代理/VPN |
| 防火墙 | 手动开放端口 | 自动放行 |
| 行尾符 | LF（无问题） | 注意 CRLF 问题 |
