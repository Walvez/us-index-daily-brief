import "./_env";

import fs from "node:fs";
import { loadDailyBriefConfig } from "../lib/daily-brief/config";
import { runDailyBrief } from "../lib/daily-brief/orchestrator";
import {
  decideSendability,
  resolveScheduleAttempt,
} from "../lib/daily-brief/send-policy";
import { readEditionReport } from "../lib/daily-brief/state";

function writeGithubOutputs(result: {
  status: string;
  editionDate: string;
  reportDir: string;
  sendable?: boolean;
  attempt?: string;
  sendReason?: string;
}): void {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  fs.appendFileSync(
    output,
    [
      `status=${result.status}`,
      `edition_date=${result.editionDate}`,
      // Back-compat alias for older step references during transition.
      `market_date=${result.editionDate}`,
      `report_dir=${result.reportDir}`,
      `sendable=${result.sendable === false ? "false" : "true"}`,
      `schedule_attempt=${result.attempt ?? ""}`,
      `send_reason=${result.sendReason ?? ""}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

async function main() {
  const attempt = resolveScheduleAttempt(process.env);
  const config = loadDailyBriefConfig();
  const outputRoot = process.env.REPORT_OUTPUT_DIR || config.outputRoot;
  const result = await runDailyBrief({
    config: {
      outputRoot,
      validationOnly: process.env.VALIDATION_ONLY === "1",
    },
    scheduleAttempt: attempt,
  });

  // Re-read config after generation so BRIEF_MODULES / env stay authoritative.
  const effective = loadDailyBriefConfig();
  let sendable = false;
  let sendReason = "unknown";

  if (result.status === "generated" && result.report) {
    const decision = decideSendability(result.report, {
      marketEnabled: effective.marketEnabled,
      attempt,
    });
    sendable = decision.sendable;
    sendReason = decision.reason;
  } else if (result.status === "email-only") {
    try {
      const existing = readEditionReport(outputRoot, result.editionDate);
      const decision = decideSendability(existing, {
        marketEnabled: effective.marketEnabled,
        attempt,
      });
      sendable = decision.sendable;
      sendReason = decision.reason;
    } catch {
      sendable = false;
      sendReason = "email-only-missing-report";
    }
  } else if (result.status === "skip") {
    sendable = false;
    sendReason = "already-sent";
  }

  // validation_only: fail when an enabled market module failed or is missing.
  // Degraded market (valuation/AI issues) remains acceptable for core validation.
  if (process.env.VALIDATION_ONLY === "1" && result.status === "generated") {
    const report =
      result.report ??
      readEditionReport(outputRoot, result.editionDate);
    if (effective.marketEnabled) {
      const market = report.modules.find(
        (module) => module.moduleId === "market",
      );
      if (!market || market.status === "failed" || market.status === "skipped") {
        writeGithubOutputs({
          status: result.status,
          editionDate: result.editionDate,
          reportDir: result.reportDir,
          sendable: false,
          attempt,
          sendReason: "validation-market-failed",
        });
        console.error(
          `[daily-brief] validation_only failed: market module ${market?.status ?? "missing"} while enabled`,
        );
        process.exitCode = 1;
        return;
      }
    }
  }

  writeGithubOutputs({
    status: result.status,
    editionDate: result.editionDate,
    reportDir: result.reportDir,
    sendable,
    attempt,
    sendReason,
  });
  console.log(
    `[daily-brief] ${result.status}: edition ${result.editionDate} (${result.reportDir}) attempt=${attempt} sendable=${sendable} reason=${sendReason}`,
  );
}

main().catch((error) => {
  console.error(
    "[daily-brief] failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
