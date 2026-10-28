# Changelog

本文档记录 AI 辅助变更。日期格式使用 `YYYY-MM-DD`（Asia/Shanghai）。

## 2026-10-29

### fix

- 修复最近雷纹罗盘缺少 `fragCompass` DOM 缓存，导致运行时报错且方位无法更新的问题。影响：`js/tg/hud.js`。
- 为小屏视口补充紧凑 HUD 布局，消除顶部面板、字幕、键盘提示与罗盘的重叠。影响：`index.html`。

### chore

- 新增发布用忽略规则，排除本地环境文件、依赖、构建产物与部署元数据。影响：`.gitignore`。
