# Homepage × real-time-fund 集成执行计划

## 1. 目标

当前已有：

- Homepage：日常入口，已有基金实时估值，但数据不够准确。
- fund-monitor：Homepage 的基金数据服务。
- real-time-fund：已独立部署，用于查看详细基金信息。

目标架构：

```text
Homepage
   │
   ├─ 基金摘要 → fund-monitor → 第三方基金数据源
   │
   └─ 详细查看 → real-time-fund
```

原则：

- Homepage 不直接读取或爬取 real-time-fund 页面。
- fund-monitor 参考 real-time-fund 当前的数据源和解析逻辑重新获取估值。
- real-time-fund 第一阶段不改源码。
- 先本地完成开发、Debug、测试，再部署云端。

---

## 2. 本地环境

先确认三个服务：

```text
Homepage        :3001
real-time-fund  :3000
fund-monitor    :8090
```

Agent 先检查：

```bash
docker ps
ss -lntp

curl -I http://127.0.0.1:3001
curl -I http://127.0.0.1:3000
curl http://127.0.0.1:8090/healthz
curl http://127.0.0.1:8090/api/funds
```

先输出：

- 当前端口和启动方式
- Homepage → fund-monitor 当前调用链
- fund-monitor 当前数据源
- real-time-fund 当前实时估值数据源
- 最小修改方案

确认后直接实施。

---

## 3. 修正基金估值

重点修改：

```text
fund-monitor 的 data_source / provider / fetch_funds
```

不要重写整个服务。

Agent 阅读当前 real-time-fund 源码，确认其实际使用的：

- 实时估值接口
- 请求参数
- 字段映射
- 正式 NAV
- 估值时间
- 错误处理

然后让 fund-monitor **直接请求相同或等价的上游数据源**。

不要：

```text
fund-monitor → real-time-fund HTML
Homepage → real-time-fund localStorage
```

基金数据至少区分：

```text
nav             正式净值
nav_date        正式净值日期

estimate        实时估值
estimate_pct    今日估值涨跌
estimate_time   估值时间
```

继续保留现有：

- refresher
- Store
- cache.json
- last-known-good
- 抓取失败保留旧值

任何失败或空字段都不能变成 `0`。

---

## 4. Homepage 改造

Homepage 基金卡片只展示简单信息：

```text
基金名称
今日估值涨跌
估算净值
最新正式净值
净值日期
更新时间
```

例如：

```text
纳斯达克基金

今日估值   +1.26%
估值       1.8234
最新净值   1.8011
更新       14:52

[详细查看]
```

Homepage 仍只请求 fund-monitor。

增加一个统一配置：

```text
REAL_TIME_FUND_URL
```

本地：

```text
http://127.0.0.1:3000
```

云端：

```text
暂时留空，让云端agent自动判断
```

点击“详细查看”直接打开 real-time-fund。

V1 不要求自动跳到具体基金。

---

## 5. 本地测试与 Debug

Agent 必须负责完整 Debug，不只是写代码。

### 数据不对时

按链路检查：

```text
第三方数据源
    ↓
fund-monitor Provider
    ↓
Store
    ↓
/api/funds
    ↓
Homepage
```

先看：

```bash
curl http://127.0.0.1:8090/api/funds
```

如果 API 已经错，修 fund-monitor。

如果 API 正确但页面错，修 Homepage。

对同一只基金比较：

```text
Homepage
real-time-fund
```

重点比较：

- code
- estimate
- estimate_pct
- estimate_time
- nav
- nav_date

允许有少量刷新时间差。

### 必须测试

- Homepage 正常打开
- fund-monitor 正常
- real-time-fund 正常
- 基金估值基本一致
- 抓取失败仍显示旧数据
- 不出现 0 / NaN / 空白
- Homepage 能跳 real-time-fund
- 三个服务分别重启后仍正常

---

## 6. Git 和本地 → 云端流程

所有修改先本地确认好，等待我确认一个最终版本没有问题之后再进入 Git，这一步让我自己操作。

Agent 必须说明：

- 修改了哪些文件
- 为什么修改
- 如何测试
- 是否还有风险

流程固定为：

```text
本地开发
  ↓
本地测试没有问题
  ↓
git commit
  ↓
git push
  ↓
云服务器 git pull
  ↓
Docker Compose 部署
```

不要直接在云服务器边改边试。



---

## 第一轮直接给 Agent 的任务

```text
请按本计划执行。

当前本地已有：
- Homepage
- fund-monitor
- real-time-fund

目标：
1. 先审计三个服务当前状态和调用关系。
3. 阅读当前 real-time-fund 源码，确认它当前使用的实时估值数据源和解析方式。
4. 调整 fund-monitor，使其直接使用相同或等价的数据源。
5. 保留现有 refresher、Store、cache 和 last-known-good。
6. Homepage 继续只读取 fund-monitor。
7. Homepage 增加“详细查看”，本地跳转到 real-time-fund。
8. 完成后自行运行测试、查看日志、Debug 并修复。
9. 本地全部通过后，再生成云端 Docker Compose、环境变量和反向代理部署方案。
10. 不修改 real-time-fund 源码，不做无关重构。

先输出当前架构和最小修改方案，然后直接实施。
```

---

## V1 完成标准

最终做到：

```text
Homepage
   │
   ├─ 能正确看到今日基金大概涨跌
   │
   └─ 点击详细查看
          ↓
     real-time-fund
```

并且：

- 本地可重复启动和调试
- 数据错误可定位
- 上游失败不会清空旧数据
- Git 可追踪
- 云端可重复部署
- 三个服务可独立升级和回滚
