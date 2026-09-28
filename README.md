# Homepage

个人主页仪表盘，基于 [gethomepage](https://gethomepage.dev) v2.4.0 + Caddy HTTPS 反代。
登录页、会话 Cookie 和退出登录使用 Homepage 原生 NextAuth；`auth-service` 保留现有多账号密码校验、账号管理和内部服务身份桥接。

当前镜像由 `homepage-image/` 固定上游提交并构建，登录地址为 `/auth/signin`，旧 `/login`、`/login-v2/` 自动跳转。
现有账号密码和用户数据不需要迁移，升级后重新登录一次即可。退出登录使用页面底部原生按钮。
构建、验证及回滚步骤见 [升级说明](docs/UPGRADE-2026-09-28.md)。

## 域名管理

- [Cloudflare DNS](https://dash.cloudflare.com/0de2dffd05dcafe24d44085b7469b3a2/kelelega.dpdns.org/dns/settings) — 日常 DNS 解析、代理开关、SSL 配置都在这里。
- [DigitalPlat 域名注册](https://dashboard.digitalplat.org/domains/kelelega.dpdns.org) — 域名注册地，定期来续期防止过期回收。

## 基金净值监控

首页信息栏下方的基金卡片，数据来自 `fund-monitor` 服务（Python 标准库，无第三方依赖）。
后端常驻抓取并缓存，关掉页面也在跑；卡片只显示净值和涨跌，不涉及金额、份额、盈亏。

- 添加、删除：在设置 →「面板」管理 6 位基金代码，名称自动获取。
- 持久化：基金列表和缓存按登录用户分开保存在 `fund-monitor/data/users/<用户名>/`。
- 数据口径：盘中显示估算净值标「估算」，正式净值发布后自动切「正式」；
  正式净值不会被当天的旧估算覆盖。
- 抓取失败时保留上次成功数据并在卡片上显示状态，不会显示误导性的 0 值。

刷新间隔默认 60 秒，可用 `FUND_REFRESH_SEC` 调整。详见 `DEPLOYMENT-NOTES.md`。
