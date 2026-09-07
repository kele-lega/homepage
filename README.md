# Homepage

个人主页仪表盘，基于 [gethomepage](https://gethomepage.dev) + Caddy 反代 + HTTPS + Basic Auth。

## 域名管理

- [Cloudflare DNS](https://dash.cloudflare.com/0de2dffd05dcafe24d44085b7469b3a2/kelelega.dpdns.org/dns/settings) — 日常 DNS 解析、代理开关、SSL 配置都在这里。
- [DigitalPlat 域名注册](https://dashboard.digitalplat.org/domains/kelelega.dpdns.org) — 域名注册地，定期来续期防止过期回收。

## 基金净值监控

首页信息栏下方的基金卡片，数据来自 `fund-monitor` 服务（Python 标准库，无第三方依赖）。
后端常驻抓取并缓存，关掉页面也在跑；卡片只显示净值和涨跌，不涉及金额、份额、盈亏。

- 添加：在卡片输入 6 位基金代码，点「添加」，名称自动获取。
- 删除：点每行右侧的 × 。
- 持久化：基金列表和缓存按登录用户分开保存在 `fund-monitor/data/users/<用户名>/`。
- 数据口径：盘中显示估算净值标「估算」，正式净值发布后自动切「正式」；
  正式净值不会被当天的旧估算覆盖。
- 抓取失败时保留上次成功数据并在卡片上显示状态，不会显示误导性的 0 值。

刷新间隔默认 60 秒，可用 `FUND_REFRESH_SEC` 调整。详见 `DEPLOYMENT-NOTES.md`。
