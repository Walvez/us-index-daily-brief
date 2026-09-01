# 个人每日简报部署

## 1. 创建 GitHub 仓库

将生产分支推送到私有 GitHub 仓库，并设为默认分支。进入仓库的 **Settings → Actions → General**，允许 GitHub Actions 运行。

## 2. 架构概览

单一 GitHub Actions 工作流、单封中文 HTML 邮件、私有 `gh-pages` 归档：

| 组件 | 职责 |
| --- | --- |
| `lib/daily-brief` | 编排层：`editionDate`、模块状态、统一渲染与发送标记 |
| `market` 模块 | 复用 `lib/index-brief`：纳指/标普、估值、定投观察、市场新闻 |
| `tech-news` 模块 | 3–5 条近期 AI/科技动态；AI 摘要失败则回退原文摘录 |
| `.emailed` | 按 **editionDate（台北日历日）** 防重复，而非仅 marketDate |

模块状态：`success` / `degraded` / `skipped` / `failed`。模块彼此独立失败；科技模块失败不阻断市场邮件。

## 3. 私有报告存储

仓库保持私有，不需要启用公开 GitHub Pages，也不需要配置 `REPORT_BASE_URL`。邮件正文就是完整报告。

工作流使用：

| 存储 | 职责 |
| --- | --- |
| 私有 `gh-pages` | 报告 HTML/JSON、估值历史等完整归档（`keep_files: false` 全量发布） |
| 私有 `brief-delivery` | **仅**非密钥发送标记（`<editionDate>/.emailed` + `sent.json`） |

`brief-delivery` 与归档分支分离：SMTP 成功后**立即** checkpoint 发送标记；即使后续 `gh-pages` 发布失败，下次运行仍会从 `brief-delivery` 恢复标记并跳过重复发送。

### 定时重试与发送策略（单工作流 / 单邮件）

| 尝试 | 纽约时间（周一至周五） | 夏令时北京时间 | 冬令时北京时间 | 策略 |
| --- | --- | --- | --- | --- |
| early | 16:05 / 16:35 / 17:05 | 04:05 / 04:35 / 05:05 | 05:05 / 05:35 / 06:05 | 市场模块启用且市场失败时**不发送**，等待后续重试生成 |
| final | 17:35 | 05:35 | 06:35 | 仍优先市场；若市场仍失败且科技有可信内容，可 tech-only 降级发送 |
| manual | `workflow_dispatch` | - | - | 与 final 相同（操作者主动触发） |

`editionDate` 幂等：成功发送并 checkpoint 后，同日后续尝试 `skip`。

### 状态迁移（phase 1）

| 旧布局（index-brief） | 新布局（daily-brief） |
| --- | --- |
| `daily_reports/<marketDate>/` | `daily_reports/<editionDate>/` |
| `<date>.json` 为 `IndexBriefReport` | `<date>.json` 为 `DailyBriefReport`（`version: 1`） |
| `.emailed` 表示该美股交易日已发送 | `.emailed` + `sent.json` 表示该版简报已发送 |

- 历史 `<marketDate>` 目录会保留在 `gh-pages` 上（`build-site` 仍会索引带 HTML 的日期目录）。
- `editionDate` 使用 `REPORT_TZ`（默认 `Asia/Taipei`），与美股 `marketDate` 可能不同；市场区块会标注「最近交易日」。
- 上线首日：若旧系统已按 `marketDate` 发过信，而新系统 `editionDate` 不同，可能再发一封新格式邮件（预期最多一次）。若要抑制，可在 `brief-delivery` / `gh-pages` 上手动创建对应 `<editionDate>/.emailed`。
- 当 `editionDate === marketDate` 且未启用 tech-news 时，编排器会识别旧路径上的 `.emailed` 并跳过，避免同日重复。

**发送标记规则：** 仅在 SMTP 成功后写入本地 `.emailed`，并立即推到 `brief-delivery`。`gh-pages` 归档失败不再导致重复发信。

**不可消除的崩溃窗口：** SMTP 已返回成功，但进程在写入本地 `.emailed` 或 `brief-delivery` checkpoint 完成前崩溃。该窗口内下一次运行可能再发一封。无数据库时无法完全消除。

## 4. 配置 Gmail

发件 Gmail 必须开启两步验证：

1. 打开 Google 账号的安全设置。
2. 启用两步验证。
3. 创建一个应用专用密码，名称可填 `Personal Daily Brief`。
4. 不要把应用专用密码写进代码、Issue、聊天或普通 GitHub Variable。

在 **Settings → Secrets and variables → Actions → Secrets** 添加：

| 名称 | 内容 |
| --- | --- |
| `GMAIL_APP_PASSWORD` | Gmail 应用专用密码 |

中文摘要优先使用 GitHub Models 和工作流自带的 `GITHUB_TOKEN`，不需要额外 OpenAI Key。若模型调用失败，市场评论与科技摘要都会降级为确定性/原文内容，邮件仍可发送。

## 5. 配置 Variables

在 **Settings → Secrets and variables → Actions → Variables** 添加：

| 名称 | 示例 |
| --- | --- |
| `GMAIL_USER` | 发件 Gmail 地址 |
| `REPORT_RECIPIENT` | 收件邮箱 |
| `GITHUB_MODELS_MODEL` | 可选；默认 `openai/gpt-4.1` |

收件邮箱虽然不是密码，也不要硬编码进仓库。

工作流内已设置（可按需改为 Variables）：

| 名称 | 默认 |
| --- | --- |
| `BRIEF_MODULES` | `market,tech-news` |
| `TECH_NEWS_ENABLED` | `true`（仅在本私有工作流中显式开启） |
| `TECH_NEWS_LIMIT` | `5`（3–5） |
| `TECH_NEWS_WINDOW_HOURS` | `30`（24–36） |
| `REPORT_TZ` | `Asia/Taipei` |

本地默认 `TECH_NEWS_ENABLED=false`，避免在未配置时意外依赖外部新闻源。参见仓库根目录 `.env.example`。

## 6. 首次验证

进入 **Actions → Personal Daily Brief → Run workflow**。首次可勾选 `validation_only`，它会完整生成并验证结构，但不发邮件、不写入正式归档。验证通过后再不勾选该选项运行一次，依次确认：

1. Actions 日志显示 `editionDate`（台北日历日）。
2. `gh-pages` 分支出现对应 edition 目录与 `.emailed`。
3. 邮件标题类似 `YYYY-MM-DD 个人每日简报｜市场与 AI 科技`。
4. 邮件含市场区块与（启用时）AI/科技区块；无「查看完整报告」或 `github.io` 链接。
5. 市场定投观察与指标仍为确定性规则输出；估值有官方日期。
6. 科技条目链接均可打开，且 URL 来自抓取候选而非模型编造。
7. 再手动运行一次，同一 `editionDate` 不会重复发信。
8. 定时任务在美股收盘后 16:05 / 16:35 / 17:05 / 17:35（纽约时间）最多成功发送一封。

## 7. 本地命令

```bash
npm test
npm run typecheck
# 生成（默认 tech-news 关闭，仅市场）
npm run daily-brief
# 启用科技模块
TECH_NEWS_ENABLED=true npm run daily-brief
# 发送已生成的 edition（不会真实执行于 CI 校验环境以外时请小心）
npm run send-daily-brief -- YYYY-MM-DD
```

兼容入口仍保留：`npm run index-brief` / `npm run send-index-brief`（旧单模块路径，供对照测试）。

## 8. 常见诊断

- 中文翻译/摘要失败：检查工作流是否包含 `models: read`；报告会降级，不应整单失败。
- 估值不可用：检查 Nasdaq 官方文档、`pdftotext`、资料 `as of` 是否超过 45 天。
- 科技新闻为空：部分源失败时模块 `degraded`/`failed`，市场仍应发出。
- 重复发信：检查 `brief-delivery` 与 `daily_reports/<editionDate>/.emailed`；归档在 `gh-pages`。
- early 未发信：属预期（市场滞后）；看 Actions 日志 `sendable=false reason=early-defer-market-failed`。
- Secret 不得出现在日志、报告或异常信息中。
