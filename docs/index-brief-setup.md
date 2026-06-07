# 美股指数日报部署

## 1. 创建 GitHub 仓库

将 `codex/us-index-daily-brief` 分支推送到一个 GitHub 仓库，并把该分支合并为默认分支。进入仓库的 **Settings → Actions → General**，允许 GitHub Actions 运行。

## 2. 配置 GitHub Pages

进入 **Settings → Pages**：

1. Source 选择 **Deploy from a branch**。
2. Branch 选择 `gh-pages`，目录选择 `/ (root)`。
3. 第一次工作流成功后，Pages 地址通常是 `https://<用户名>.github.io/<仓库名>/`。

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
| `OPENAI_API_KEY` | 可选；所选 LLM 的 API Key |

如果使用其他模型服务，可改用 `ANTHROPIC_API_KEY`、`DEEPSEEK_API_KEY`、`MINIMAX_API_KEY`、`ZHIPU_API_KEY` 或通用的 `LLM_API_KEY`。

## 4. 配置 Variables

在 **Settings → Secrets and variables → Actions → Variables** 添加：

| 名称 | 示例 |
| --- | --- |
| `GMAIL_USER` | 发件 Gmail 地址 |
| `REPORT_RECIPIENT` | 收件邮箱 |
| `REPORT_BASE_URL` | `https://<用户名>.github.io/<仓库名>` |
| `LLM_BACKEND` | `openai` |
| `LLM_MODEL` | 可选模型名称 |
| `LLM_BASE_URL` | 可选兼容接口地址 |

收件邮箱虽然不是密码，也不要硬编码进仓库。若未配置 LLM Key，报告仍会生成，但新闻解释会使用确定性降级文本。

## 5. 首次验证

进入 **Actions → US Index Daily Brief → Run workflow** 手动运行一次，依次确认：

1. Actions 日志显示最新美股交易日。
2. `gh-pages` 分支出现对应日期目录。
3. Pages 首页可在手机浏览器打开。
4. 邮件中的指数涨跌、新闻链接和定投观察结论正常。
5. 再手动运行一次，同一交易日不会重复发信。

定时任务设置为每天北京时间约 08:05。GitHub Actions 的计划任务可能延迟数分钟；周末和美国休市日会识别到已处理的最新交易日并跳过。
