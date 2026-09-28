# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

个人主页仪表盘：gethomepage v2.4.0 原生登录 + 多账号适配 + 自研基金、日历和 Steam 服务。

## 产品原则

- 管理员只有 `kele`。kele 可见丁组（Glances/Docker）并可管理普通账号；普通用户不可见丁。
- 乙组基金净值按账号可选；关闭后整组移除，其余组自动重排栏数。
- 基金只展示行情，不加份额、金额、盈亏。代码增删在设置「面板」，不在卡片上。
- 主题仅暗/亮，无调色盘。默认暗色 `theme-slate`，亮色 `theme-white`。不要在 `settings.yaml` 写 `theme:` / `color:`，不要为主题改 Homepage 编译产物。
- 明暗壁纸路径写在 `settings.yaml` 的 `wallpapers.light` / `wallpapers.dark`，文件放 `public/`，不要把路径写死在 CSS。
- 乙组卡片必须与甲丙丁原生 `service-card` 同一套底、圆角、阴影、悬停；顶边对齐靠原生组头 + 列表 `mt-3`，不要锁像素高度。
- 设置弹窗切 tab 时尺寸不变（约 `min(34rem, calc(100% - 2rem))`）。设置含日历 / 面板 / Steam / 账号 /（admin）账号管理。
- 游戏组由 `custom.js` 合成，默认插在乙和丙之间；移位只改 `PLACE_AFTER` / `PLACE_BEFORE` 和 `settings.yaml` layout，不要为游戏组锁列宽。

## 架构边界

- 自有代码：`homepage-image/`、`config/custom.js|css`、`auth-service/`、`fund-monitor/`、`steam-monitor/`、`ical-proxy/`、`Caddyfile`、compose。`login-page/` 仅保留历史源码，不部署。
- Homepage 固定 v2.4.0 源码提交和校验和，在 `homepage-image/apply-patches.mjs` 做源码适配后构建。不要改运行中的 `.next`；补丁目标不匹配必须拒绝构建。`entrypoint.sh` 已无编译产物补丁，也不再挂载。
- 登录、CSRF、JWT Cookie 和退出统一用上游 NextAuth。原生页面仅增加多账号用户名输入，凭据在内网 `/internal/verify` 校验。不要恢复旧自签 Cookie 或自定义登录/退出 UI；重复的搜索联想也使用上游实现。
- `auth-service` 经内网 `/api/auth/session` 校验原生身份，并核对当前账号的 credentialVersion；删号、改密后旧会话失效。`/internal/verify` 不能暴露到 Caddy 公网路由。
- 生产用户名只信 Caddy 注入的 `X-Authenticated-User`，不信浏览器自带同名头。
- 日历身份只转发到 `HOMEPAGE_CALENDAR_ORIGIN` 指定的内网源，不转发给外部 iCal 提供方。仅挂载自有 `public/images` 和 favicon，不覆盖上游整个 public 目录。
- `fund-monitor` / `steam-monitor` / `ical-proxy` 按用户隔离，不依赖 Homepage 内部机制。空乙组、空游戏组会被 `/api/services` 滤掉，宿主由 `custom.js` 合成。
- `real-time-fund/` 是独立项目（已 gitignore），不要当成本仓一部分。

## 开发规则

- 未经用户明确说提交 / push，不要 git commit 或 push。
- 不要提交 `.env`、用户哈希、`users.json`、运行日志、原暗色 `background.png`、真实基金列表。
- 本地 `docker compose up -d`（带 override，无 Caddy）。生产必须 `docker compose -f docker-compose.yml`，忽略 override。
- 数据源成功判定：内容校验优先于 HTTP 状态码。

## 完成前检查

- 认证：`cd auth-service && python3 -m unittest discover -p 'test_*.py'`
- 基金：`cd fund-monitor && python3 -m unittest discover -p 'test_*.py'`
- Steam：`cd steam-monitor && python3 -m unittest discover -p 'test_*.py'`
- 日历：`cd ical-proxy && python3 -m unittest discover -p 'test_*.py'`
- `custom.js`：`node --check config/custom.js`
- compose：`docker compose config --quiet`
- 原生登录适配：`docker compose -f docker-compose.yml build homepage`（构建含上游和适配层的 78 项测试）。
- 上线前用隔离账号验证登录、退出、管理员权限、基金/Steam/日历隔离；生产变更后复查 HTTPS 与 Homepage healthcheck。维护及回滚见 `docs/UPGRADE-2026-09-28.md`。

阶段完成或出现新的架构/产品决定时，覆盖更新本文件和 `docs/CURRENT_STATE.md`，不要追加 changelog。
