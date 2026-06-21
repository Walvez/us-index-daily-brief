// ==UserScript==
// @name         河北医科大学 WebVPN 登录状态自动续期
// @namespace    https://github.com/Walvez/us-index-daily-brief/tree/master/webvpn-session-keeper
// @version      0.1.0
// @description  用户主动登录河北医科大学 WebVPN 后，每 3 小时访问一次已验证的内部页面以保持现有会话活跃。
// @author       Walve
// @license      MIT
// @crontab      0 */3 * * *
// @grant        GM_xmlhttpRequest
// @connect      webvpn.hebmu.edu.cn
// ==/UserScript==

/* global GM_xmlhttpRequest */

const SCRIPT_NAME = "HebMU WebVPN Session Keeper";
const KEEPALIVE_URL =
  "https://webvpn.hebmu.edu.cn/https/77726476706e69737468656265737421fcfe43d22f356a5d6b468ca88d1b203b/?wrdrecordvisit=1782040210000";
const REQUEST_TIMEOUT_MS = 60 * 1000;
const LOGIN_PATH_PATTERN = /\/login(?:[/?#]|$)/i;
const LOGIN_TEXT_PATTERNS = [
  /WebVPN\s*登录/i,
  /remember_cookie/i,
  /name=["']?remember_cookie/i,
  /统一身份认证/,
  /账号登录/,
];

function timestamp() {
  return new Date().toISOString();
}

function log(level, message, details) {
  const prefix = `[${SCRIPT_NAME}] ${timestamp()} ${message}`;
  const payload = details === undefined ? "" : details;

  if (level === "error") {
    console.error(prefix, payload);
    return;
  }

  if (level === "warn") {
    console.warn(prefix, payload);
    return;
  }

  console.log(prefix, payload);
}

function responseFinalUrl(response) {
  return response && response.finalUrl ? response.finalUrl : KEEPALIVE_URL;
}

function finalUrlLooksLikeLogin(response) {
  try {
    const url = new URL(responseFinalUrl(response));
    return LOGIN_PATH_PATTERN.test(url.pathname);
  } catch (_error) {
    return false;
  }
}

function bodyLooksLikeLogin(response) {
  const body = response && typeof response.responseText === "string" ? response.responseText : "";
  return LOGIN_TEXT_PATTERNS.some((pattern) => pattern.test(body));
}

function responseLooksLikeLogin(response) {
  return finalUrlLooksLikeLogin(response) || bodyLooksLikeLogin(response);
}

function classifyResponse(response) {
  const status = Number(response && response.status ? response.status : 0);

  if (status === 401 || status === 403) {
    return {
      ok: false,
      expired: true,
      reason: `server returned HTTP ${status}`,
    };
  }

  if (responseLooksLikeLogin(response)) {
    return {
      ok: false,
      expired: true,
      reason: "response looks like the WebVPN login page",
    };
  }

  if (status >= 200 && status < 400) {
    return {
      ok: true,
      expired: false,
      reason: "keepalive request accepted",
    };
  }

  return {
    ok: false,
    expired: false,
    reason: `unexpected HTTP status ${status || "unknown"}`,
  };
}

function summarizeResponse(response) {
  return {
    status: response && response.status,
    statusText: response && response.statusText,
    finalUrl: responseFinalUrl(response),
  };
}

function runKeepalive() {
  return new Promise((resolve) => {
    GM_xmlhttpRequest({
      method: "GET",
      url: KEEPALIVE_URL,
      timeout: REQUEST_TIMEOUT_MS,
      nocache: true,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      onload(response) {
        const result = classifyResponse(response);
        const details = {
          ...summarizeResponse(response),
          reason: result.reason,
        };

        if (result.ok) {
          log("info", "Keepalive request accepted.", details);
        } else if (result.expired) {
          log("warn", "WebVPN session may be expired. Please open WebVPN and log in manually.", details);
        } else {
          log("warn", "Keepalive request finished with an unknown state.", details);
        }

        resolve(result);
      },
      ontimeout() {
        const result = {
          ok: false,
          expired: false,
          reason: "request timed out",
        };
        log("warn", "Keepalive request timed out.", result);
        resolve(result);
      },
      onerror(error) {
        const result = {
          ok: false,
          expired: false,
          reason: "request failed",
        };
        log("error", "Keepalive request failed.", {
          ...result,
          error: error && (error.error || error.message || error.details),
        });
        resolve(result);
      },
    });
  });
}

return runKeepalive();
