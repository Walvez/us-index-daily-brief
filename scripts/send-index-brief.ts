import "./_env";

import { sendBrief } from "../lib/index-brief/mail";
import { markEmailed, readEmailHtml } from "../lib/index-brief/state";

async function main() {
  const marketDate = process.argv[2] || process.env.MARKET_DATE;
  if (!marketDate || !/^\d{4}-\d{2}-\d{2}$/.test(marketDate)) {
    throw new Error("market date argument must be YYYY-MM-DD");
  }
  const outputRoot = process.env.REPORT_OUTPUT_DIR || "daily_reports";
  const html = readEmailHtml(outputRoot, marketDate);
  const result = await sendBrief({
    subject: `${marketDate} 美股指数每日简报`,
    html,
  });
  markEmailed(outputRoot, marketDate);
  console.log(
    `[send-index-brief] sent ${result.messageId} to ${result.recipientCount} recipient(s)`,
  );
}

main().catch((error) => {
  console.error(
    "[send-index-brief] failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
