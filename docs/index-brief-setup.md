# 美股指数日报部署

## 1. 创建 GitHub 仓库

将 `codex/us-index-daily-brief` 分支推送到一个 GitHub 仓库，并把该分支合并为默认分支。进入仓库的 **Settings → Actions → General**，允许 GitHub Actions 运行。

## 2. 私有报告存储

仓库保持私有，不需要启用 GitHub Pages，也不需要配置 `REPORT_BASE_URL`。邮件正文就是完整报告。

工作流仍使用私有 `gh-pages` 分支保存报告、估值历史和 `.emailed` 防重复标记。该分支只是内部存储，不是公开网站。

## 3. 配置 Gmail

发件 Gmail 必须开启两步验证：

1. 打开 Google 账号的安全设置。
2. 启用两步验证。
3. 创建一个应用专用密码，名称可填 `US Index Daily Brief`。
4. 不要把应用专用密码写进代码、Issue、聊天或普通 GitHub Variable。

在 **Settings → Secrets and variables → Actions → Secrets** 添加：

| 名称 | 内容 |
| --- | --- |
| `GMAIL_APP_PASSWORD` | Gmail 应用专用密码 |

中文新闻使用 GitHub Models 和工作流自带的 `GITHUB_TOKEN`，不需要 OpenAI 或其他模型 API Key。

## 4. 配置 Variables

在 **Settings → Secrets and variables → Actions → Variables** 添加：

| 名称 | 示例 |
| --- | --- |
| `GMAIL_USER` | 发件 Gmail 地址 |
| `REPORT_RECIPIENT` | 收件邮箱 |
| `GITHUB_MODELS_MODEL` | 可选；默认 `openai/gpt-4.1` |

收件邮箱虽然不是密码，也不要硬编码进仓库。GitHub Models 调用失败时，报告仍会生成，并明确标注中文翻译暂不可用。

## 5. 首次验证

进入 **Actions → US Index Daily Brief → Run workflow** 手动运行一次，依次确认：

1. Actions 日志显示最新美股交易日。
2. `gh-pages` 分支出现对应日期目录。
3. 邮件正文中没有“查看完整报告”按钮。
4. 新闻标题和解释为中文，原文链接可以打开。
5. 估值区块显示预期 PE、10 年均值、偏离、温度和官方数据日期。
6. 再手动运行一次，同一交易日不会重复发信。

定时任务设置为每天北京时间约 08:05。GitHub Actions 的计划任务可能延迟数分钟；周末和美国休市日会识别到已处理的最新交易日并跳过。

## 6. 常见诊断

- 中文翻译失败：检查工作流是否包含 `models: read`，并查看 GitHub Models HTTP 状态；不要在日志中输出令牌。
- 估值不可用：检查 Nasdaq 官方文档是否仍可下载、`pdftotext` 安装步骤是否成功，以及资料的 `as of` 日期是否超过 45 天。
- PE 数值过期：不要手工把旧数值复制进报告。系统会隐藏过期值，并等待官方资料更新。
