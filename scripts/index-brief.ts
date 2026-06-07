import "./_env";

import fs from "node:fs";
import { runIndexBrief } from "../lib/index-brief/run";

function writeGithubOutputs(result: {
  status: string;
  marketDate: string;
  reportDir: string;
}): void {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  fs.appendFileSync(
    output,
    [
      `status=${result.status}`,
      `market-date=${result.marketDate}`,
      `report-dir=${result.reportDir}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

async function main() {
  const result = await runIndexBrief({
    outputRoot: process.env.REPORT_OUTPUT_DIR || "daily_reports",
    reportBaseUrl: process.env.REPORT_BASE_URL,
  });
  writeGithubOutputs(result);
  console.log(
    `[index-brief] ${result.status}: ${result.marketDate} (${result.reportDir})`,
  );
}

main().catch((error) => {
  console.error(
    "[index-brief] failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
