import "./_env";

import { sendBrief } from "../lib/daily-brief/mail";
import {
  markEditionEmailed,
  readEditionEmailHtml,
  readEditionReport,
} from "../lib/daily-brief/state";

async function main() {
  const editionDate = process.argv[2] || process.env.EDITION_DATE;
  if (!editionDate || !/^\d{4}-\d{2}-\d{2}$/.test(editionDate)) {
    throw new Error("edition date argument must be YYYY-MM-DD");
  }
  const outputRoot = process.env.REPORT_OUTPUT_DIR || "daily_reports";
  const report = readEditionReport(outputRoot, editionDate);
  const html = readEditionEmailHtml(outputRoot, editionDate);
  const subject =
    report.subject || `${editionDate} 个人每日简报｜市场与 AI 科技`;

  const result = await sendBrief({
    subject,
    html,
  });
  // Mark sent only after SMTP succeeds — never before.
  markEditionEmailed(outputRoot, editionDate, {
    messageId: result.messageId,
  });
  console.log(
    `[send-daily-brief] sent ${result.messageId} to ${result.recipientCount} recipient(s) for ${editionDate}`,
  );
}

main().catch((error) => {
  console.error(
    "[send-daily-brief] failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
