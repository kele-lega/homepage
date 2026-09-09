# 维护文档

给后续维护者（可能是未来的自己）看的架构说明和故障排查手册。
部署环境差异（Windows/云端）见 `DEPLOYMENT-NOTES.md`；日常使用说明见 `README.md`。
这份文档只讲「东西是怎么接起来的」和「坏了怎么查」。

---

## 1. 整体架构

```
浏览器
  │
  ├─ 生产：https://kelelega.dpdns.org/*
  │     │
  │   Caddy + auth-service（多用户会话认证）
  │     ├─ /calendar/*      → ical-proxy:8089 + X-Authenticated-User
  │     ├─ /fund-monitor/*  → fund-monitor:8090 + X-Authenticated-User
  │     └─ 其余              → homepage:3000 + X-Authenticated-User
  │                                  └─ 日历服务端代理再转发用户头到 ical-proxy
  │
  └─ 本地：http://localhost:3000（override 里 caddy 不启动）
        homepage:3000 直接对外，fund-monitor 额外映射到宿主机 8090，使用 local 用户
```

生产环境的认证用户名只由 Caddy 注入，浏览器自行提交的同名 header 不应被信任。基金服务按 `fund-monitor/data/users/<用户名>/` 分区；iCal 服务按 `ical-proxy/data/users.json` 选择上游并按用户缓存。登录后可在设置入口的「日历」板块保存或清除当前用户地址，在「账号」板块查看当前用户名并退出登录；日历 API 路径为 `/calendar/api/calendar`，账号 API 为 `/auth/me` 和 `/auth/logout`。退出登录会清除当前浏览器的 session cookie；由于 session 是无服务器状态签名令牌，复制出的旧令牌仍可在 TTL 内有效。

homepage 本身是社区镜像（gethomepage），项目自身代码只有：
- `config/custom.js` / `config/custom.css` —— 注入到 homepage 页面里的自定义 UI（基金卡片、农历等）
- `fund-monitor/` —— 独立的 Python 标准库服务，与 homepage 完全解耦，只通过 HTTP 交互
- `ical-proxy/` —— 另一个独立的小服务（日历代理），与基金监控无关
- `Caddyfile` / `docker-compose*.yml` —— 编排与路由

**关键点：fund-monitor 不依赖 homepage 的任何内部机制**，即使以后 homepage 镜像升级或替换，基金监控这块也不会受影响，只要 Caddy 路由和前端注入脚本还在。

---

## 2. 基金监控数据流

```
fund-monitor 容器启动
  │
  ├─ StoreManager 按首次请求的认证用户懒加载独立 Store
  │     ├─ users/<用户名>/funds.json
  │     └─ users/<用户名>/cache.json
  │
  ├─ 后台线程 refresher()：遍历已加载用户，分别抓取和保存
  │     Store.refresh() → data_source.fetch_funds(codes)
  │       → fetch_raw()：请求天天基金移动端接口，拿原始 bytes
  │       → parse_payload()：JSON 校验、Success 校验、逐行 parse_row()
  │       → 估算 vs 正式净值取舍（见下）
  │     Store._merge()：新数据不能让净值日期倒退
  │     写 cache.json（临时文件 + os.replace 原子替换）
  │
  └─ HTTP 线程（ThreadingHTTPServer）：处理 GET/POST/DELETE，读的是 Store 内存里
        的 self.entries，不会每次请求都现抓，抓取和响应完全解耦

浏览器端 custom.js
  │
  ├─ resolveBase()：探测 /fund-monitor、:8090、window.FUND_MONITOR_BASE，
  │     用 /healthz 返回 JSON 且 ok=true 判定成功，结果缓存到 resolvedBase
  │
  ├─ 挂载卡片：MutationObserver 监听 #footer 出现/移动，避免被 React 重渲染冲掉
  │
  └─ 每 30 秒 poll 一次 GET /api/funds（前端轮询间隔比后端抓取间隔短，
        只是为了尽快反映后端已经拿到的新数据，不会触发额外抓取）
```

抓取失败时 `last_error` 会被设置，`entries` 保持上一次成功的值不变——**卡片永远不会显示误导性的
0 或空白**，只会在状态栏提示错误文字。

---

## 3. 两个容易忘记的设计决策

### 3.1 判断数据源成功，不能只看 HTTP 状态码

旧的 `fundgz.1234567.com.cn/js/{code}.js` 端点已失效，但它返回的是 **HTTP 200**，body 是一个
东方财富网的 HTML 404 页面。如果只判断 `resp.ok`，会把失效端点误判为「成功」，进而把 HTML
当 JSON 解析失败，且这个失败会被误认为是网络问题而不是端点失效。

现在的做法（`data_source.parse_payload`）：先 `json.loads`，失败直接判定为数据源异常；再检查
`Success` 字段和 `Datas` 是否为空。**以后换数据源，这个「内容校验优先于状态码」的原则必须保留**，
否则会重新踩到这个坑而且很难从日志看出来（HTTP 层面看起来一切正常）。

前端探测后端地址（`resolveBase`）用的也是同一个原则：`/healthz` 必须解析成 JSON 且
`ok === true`，homepage 自己的 HTML 404 页面会在 `resp.json()` 这一步直接抛错，从而被正确排除。

### 3.2 估算净值 vs 正式净值的切换规则

```python
use_estimate = (
    est_nav is not None and est_chg is not None and est_date is not None
    and (official_date is None or est_date > official_date)
)
```

只有当「估值日期」比「已发布的正式净值日期」更新时才用估算值。正式净值发布后，`PDATE` 会追上
`GZTIME`，估算值自动停止覆盖。`Store._merge()` 还加了一层保护：同一天内正式净值优先于估算净值，
且净值日期不允许倒退——即使数据源某次返回了过期数据，也不会让卡片上的净值"退回"到更早的状态。

这两层规则合起来保证了计划里要求的「不能把盘中估算当成正式净值」。

---

## 4. 常见故障排查

- **生产认证用户不生效**：确认 `.env` 使用 `AUTH_USERS`，每个用户一行“用户名 + Caddy 哈希”，然后重建 Caddy；不要继续使用旧的 `AUTH_USER` / `AUTH_HASH`。
- **某用户日历为空**：确认 Homepage 卡片的「日历设置」中已保存地址，或检查 `ical-proxy/data/users.json` 中存在完全相同的用户名，并检查 Homepage 容器启动日志中是否出现 `Patched calendar proxy identity forwarding`。
- **Homepage 镜像升级后拒绝启动**：这是刻意的安全保护，表示 `entrypoint.sh` 找不到日历代理补丁目标。检查新镜像的 `httpProxy(integration.url, options)` 调用位置后再适配，不要删除该检查。

按 `custom.js` 里 `candidates()` 的顺序逐个排查：

1. **`fund-monitor` 容器没起**：`docker compose ps` 看它是不是 `running`。
2. **本地直连但端口对不上**：确认 `docker-compose.override.yml` 里确实映射了 `8090:8090`，
   且浏览器访问的域名/IP 和 homepage 是同一个（探测用的是 `location.hostname`）。
3. **生产环境 Caddy 路由没生效**：`curl -u user:pass https://域名/fund-monitor/healthz`，
   如果这条都 404，检查 `Caddyfile` 里 `handle_path /fund-monitor/*` 是否在 `handle` 之前
   （Caddy 的 `handle` 块互斥且按书写顺序匹配，顺序反了会被裸 `reverse_proxy homepage:3000` 抢走）。
4. **手动强制指定地址调试**：浏览器控制台执行 `window.FUND_MONITOR_BASE = "http://ip:8090"`
   然后刷新（注意这个变量不会持久化，只对当次页面加载生效）。

排查时留意：`resolveBase()` 探测成功后会把结果缓存在 `resolvedBase` 变量里，同一次页面加载内
不会重新探测。如果中途改了容器状态，需要刷新页面才会重新走一遍探测逻辑（`api()` 里请求失败且
响应非 JSON 时会主动清空 `resolvedBase` 触发下次重新探测，但网络层面的失败不一定总能命中这个分支）。

### 4.2 添加基金代码失败

- **400「基金代码必须是 6 位数字」**：前端和后端都用 `^\d{6}$` 校验，纯格式问题，换个代码试。
- **网络错误提示**：说明探测到的后端地址实际上访问不通，回到 4.1 排查。
- **添加成功但净值一直是"待获取"（pending）**：后台还没抓到这只代码的数据，等一个
  `FUND_REFRESH_SEC` 周期；如果一直不变，看 `docker compose logs fund-monitor` 有没有报错，
  可能是这个代码在数据源里查不到（代码打错，或者是已清盘/合并的老基金）。

### 4.3 卡片布局错位、溢出、或者出现两份

- **两份基金卡片/请求量翻倍**：`init()` 函数有幂等保护（`inited` 标志位），正常情况下
  `DOMContentLoaded` 只会初始化一次。如果看到重复，检查 `custom.js` 是否被别的脚本重复注入，
  或者 `inited` 保护被后续修改误删。
- **卡片跟甲乙丙丁分组宽度不对齐**：卡片的左右 margin 需要和分组容器完全一致——
  当前是 `1rem`（<640px）/ `2rem`（≥640px），对应 Tailwind 的 `m-4`/`m-8`。如果 homepage
  升级后分组的 margin class 变了，这里也要跟着改，不能想当然用页面顶部信息栏的 margin
  （那个是 `m-5`/`m-9`，会造成 4px 的偏差）。
- **基金卡片位置/折叠**：自定义基金净值卡片应插在乙组服务列表末尾，并始终展开；`insertionPoint()` 依赖 `#footer` 及服务组标题查找逻辑，Homepage 升级后若 DOM 结构变化，需要同步更新选择器。

---

## 5. 如何扩展

- **改抓取间隔**：环境变量 `FUND_REFRESH_SEC`（`docker-compose.yml`），最小 10 秒
  （代码里有 `max(..., 10)` 兜底，防止误设成 0 或负数打爆数据源）。
- **换数据源**：只需改 `data_source.py` 的 `fetch_raw` + `parse_row`，`parse_payload` 的
  异常契约（非法响应必须抛 `ValueError`）和 `app.py` 的调用方式不用动。记得保留「内容校验优先
  于状态码」的原则（见 3.1）。
- **加新字段（如份额、持仓金额）**：**当前版本计划明确排除**这些字段（净值监控卡的初始需求是
  只看行情、不涉及资产），如果以后要加，需要先确认这不再是纯行情展示卡，而是要接入用户的持仓
  数据，安全和存储方式都要重新设计（持仓金额属于敏感信息，不能像行情数据一样明文存 JSON）。
- **加通知/阈值提醒**：本轮范围明确排除，`Store.refresh()` 目前只更新缓存不做任何副作用，
  加提醒的话建议在 `refresh()` 里新增一个「新旧对比 → 触发条件 → 通知」的钩子，不要塞进
  `parse_row()`（那一层只管解析，不该管业务逻辑）。

---

## 6. 快速命令

```bash
# 单元测试
cd fund-monitor && python3 -m unittest discover -p "test_*.py"
cd ../ical-proxy && python3 -m unittest discover -p "test_*.py"

# 本地直连调试（override 使用 local 用户）
curl -H 'X-Authenticated-User: local' localhost:8090/healthz
curl -H 'X-Authenticated-User: local' localhost:8090/api/funds

# 生产经 Caddy（用户名决定返回哪一份数据）
curl -u admin:密码 https://kelelega.dpdns.org/fund-monitor/api/funds
curl -u wzj:密码 https://kelelega.dpdns.org/fund-monitor/api/funds
curl -u admin:密码 https://kelelega.dpdns.org/calendar/api/calendar

# 数据文件直接查看/备份
find fund-monitor/data/users -maxdepth 2 -type f -print
cat ical-proxy/data/users.json
```

环境变量完整列表：`FUND_DATA_DIR`、`FUND_REFRESH_SEC`、`FUND_HOST`、`FUND_PORT`、
`FUND_ALLOW_ORIGIN`（仅本地开发多来源 CORS 用，生产留空）。
