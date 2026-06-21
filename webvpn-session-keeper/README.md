# 河北医科大学 WebVPN 登录状态自动续期

这是一个 ScriptCat 定时脚本。用户已经主动登录河北医科大学 WebVPN 后，脚本每 3 小时访问一次已验证的 WebVPN 内部图书馆页面，尽量让现有登录会话保持活跃。

## 安装

1. 安装 ScriptCat。
2. 在 ScriptCat 中新建脚本，选择定时脚本或直接导入 `hebmu-webvpn-session-keeper.user.js`。
3. 确认脚本元数据里有这些关键声明：

```js
// @crontab      0 */3 * * *
// @grant        GM_xmlhttpRequest
// @connect      webvpn.hebmu.edu.cn
```

4. 先手动打开并登录 `https://webvpn.hebmu.edu.cn/`。
5. 保持浏览器和 ScriptCat 扩展运行，脚本会按计划访问探针页面。

## 工作方式

脚本访问的探针 URL 是：

```text
https://webvpn.hebmu.edu.cn/https/77726476706e69737468656265737421fcfe43d22f356a5d6b468ca88d1b203b/?wrdrecordvisit=1782040210000
```

这个 URL 是一个 WebVPN 内部图书馆页面。此前测试中，每 10 分钟访问一次该地址可以持续保持 WebVPN 登录态；当前发布版为了减少请求频率，默认改为每 3 小时访问一次。

## 边界

- 不自动登录。
- 不填写账号密码。
- 不绕过验证码、短信、动态口令或双重认证。
- 不读取或保存 Cookie。
- 不引入外部脚本代码。
- 如果服务端设置了绝对有效期、账号风控、IP 变化限制，或者浏览器/扩展被关闭，仍然可能失效。

## 调试

打开 ScriptCat 的脚本运行日志，查看以 `[HebMU WebVPN Session Keeper]` 开头的日志。

常见状态：

- `Keepalive request accepted.`：本次访问看起来仍处于已登录状态。
- `WebVPN session may be expired.`：响应像登录页，建议手动打开 WebVPN 检查。
- `Keepalive request timed out.` 或 `Keepalive request failed.`：网络或浏览器扩展请求失败，不能直接判断登录态已经失效。

## 发布检查

发布到 GitHub 或 ScriptCat 脚本站前，确认：

- 脚本源码未压缩、未混淆。
- 没有 `@require`、`@resource` 等外部执行代码。
- `@description` 说明了脚本用途。
- `@grant` 和 `@connect` 与实际行为一致。
- 说明文档明确写出不会自动登录、不会绕过验证码。
