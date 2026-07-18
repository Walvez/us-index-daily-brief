/**
 * Git plumbing for the durable brief-delivery ledger branch.
 *
 * Keeps execFile-style argument arrays (no shell interpolation of untrusted
 * strings). Accepts a test-only remote/repository context without weakening
 * production fail-closed semantics.
 *
 * Remote presence uses a typed three-state probe (present | absent | error).
 * `git ls-remote --exit-code --heads <remote> brief-delivery` semantics
 * (verified on this host / git man page):
 *   - exit 0: remote reachable and advertises the ref → present
 *   - exit 2: remote reachable but no matching ref → verified absent
 *   - other nonzero / null status: missing remote, transport, auth, etc. → error
 * Never treat transport/auth failures as clean first-ever absence.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DELIVERY_LEDGER_BRANCH,
  restoreDeliveryMarkersFromLedger,
  writeDeliveryLedgerEntry,
} from "./delivery-ledger";

/** Branch tip on the remote (heads). */
export function deliveryLedgerHeadsRef(): string {
  return `refs/heads/${DELIVERY_LEDGER_BRANCH}`;
}

/**
 * Explicit remote-tracking ref so a shallow single-branch Actions checkout
 * still materializes origin/brief-delivery (plain `git fetch origin BRANCH`
 * only updates FETCH_HEAD and is unreliable for ref creation).
 */
export function deliveryLedgerRemoteTrackingRef(remote = "origin"): string {
  return `refs/remotes/${remote}/${DELIVERY_LEDGER_BRANCH}`;
}

/** Safe refspec: heads → remotes tracking ref. */
export function deliveryLedgerFetchRefspec(remote = "origin"): string {
  return `${deliveryLedgerHeadsRef()}:${deliveryLedgerRemoteTrackingRef(remote)}`;
}

/**
 * git ls-remote --exit-code returns 2 when the remote is reachable but no
 * matching refs are found (see git-ls-remote(1) --exit-code).
 */
export const LS_REMOTE_NO_MATCH_STATUS = 2;

export interface GitRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
}

export interface DeliveryLedgerGitContext {
  /** Local clone / Actions workspace root. */
  repoRoot: string;
  /** Remote name (default origin). Tests may point this at a bare path remote. */
  remote?: string;
  /** Optional env overrides for git (HOME, GIT_CONFIG_*, etc.). */
  env?: NodeJS.ProcessEnv;
}

/** Typed remote probe: only "absent" is a verified clean first-ever skip. */
export type DeliveryLedgerRemoteProbe =
  | { status: "present" }
  | { status: "absent" }
  | { status: "error"; message: string; exitCode: number | null };

function gitEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // Avoid interactive prompts; never print credentials.
    GIT_TERMINAL_PROMPT: "0",
    ...extra,
  };
}

/**
 * Strip credential-bearing material and remote URLs from git diagnostics so
 * fail-closed errors never echo tokens or password-in-URL remotes.
 */
export function sanitizeGitDiagnostic(text: string): string {
  let out = text;
  // user:password@host (with or without scheme)
  out = out.replace(
    /(?:[a-z][a-z0-9+.-]*:\/\/)?[^\s/'"]+:[^\s/'"]+@[^\s'")\]]+/gi,
    "[redacted-remote]",
  );
  // Common remote URL forms
  out = out.replace(
    /\b(?:https?|git|ssh|file):\/\/[^\s'")\]]+/gi,
    "[redacted-remote]",
  );
  out = out.replace(/\bgit@[^\s'")\]]+/gi, "[redacted-remote]");
  // Absolute bare-repo / path remotes that appear in fatal lines
  out = out.replace(
    /'\/[^']+\.git'/g,
    "'[redacted-remote]'",
  );
  out = out.replace(
    /"\/[^"]+\.git"/g,
    '"[redacted-remote]"',
  );
  // Bearer / token-ish fragments if git ever surfaces them
  out = out.replace(
    /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]+\b/g,
    "[redacted-token]",
  );
  out = out.replace(
    /\b(?:xox[baprs]-|sk-|api[_-]?key[=:]\s*)[A-Za-z0-9._-]+\b/gi,
    "[redacted-token]",
  );
  return out;
}

function failClosedProbeError(
  remoteName: string,
  result: GitRunResult,
): Error {
  const code =
    result.status === null ? "indeterminate" : String(result.status);
  // Do not echo remote URLs, raw stderr paths, or credentials — only remote
  // *name* (configured shortname) and sanitized, non-URL classification.
  const raw = `${result.stderr} ${result.stdout}`.toLowerCase();
  let kind = "transport or authentication failure";
  if (
    /does not appear to be a git repository|no such remote|remote .* does not exist|not a git repository|no remote configured/i.test(
      raw,
    )
  ) {
    kind = "missing or invalid remote";
  } else if (/authentication|access rights|permission denied|could not read from remote/i.test(raw)) {
    kind = "authentication or access failure";
  } else if (/unable to access|could not resolve|connection|network|ssl|tls|timed out|timeout/i.test(raw)) {
    kind = "unreachable remote or network failure";
  } else if (result.status === null) {
    kind = "indeterminate git status";
  }
  return new Error(
    `delivery ledger remote probe failed for remote '${remoteName}' (${kind}; git exit ${code}); refusing send (duplicate status unknown)`,
  );
}

/**
 * Run git with an argument array. Never builds a shell string.
 * Thrown messages are sanitized so credential-bearing URLs never leak.
 */
export function runGit(
  cwd: string,
  args: readonly string[],
  options: { allowFail?: boolean; env?: NodeJS.ProcessEnv } = {},
): GitRunResult {
  try {
    const stdout = execFileSync("git", [...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: gitEnv(options.env),
    });
    return {
      ok: true,
      stdout: (stdout ?? "").trim(),
      stderr: "",
      status: 0,
    };
  } catch (error) {
    const err = error as {
      status?: number | null;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    const result: GitRunResult = {
      ok: false,
      stdout: String(err.stdout ?? "").trim(),
      stderr: String(err.stderr ?? err.message ?? "").trim(),
      status: typeof err.status === "number" ? err.status : null,
    };
    if (options.allowFail) return result;
    // Sanitize both the command summary and diagnostics: args may include a
    // path/URL remote in tests; never re-echo credentials.
    const safeArgs = args
      .map((a) => sanitizeGitDiagnostic(a))
      .join(" ");
    const detail = sanitizeGitDiagnostic(
      result.stderr || result.stdout || "git command failed",
    );
    throw new Error(`git ${safeArgs} failed: ${detail}`);
  }
}

/**
 * Probe whether the remote advertises brief-delivery.
 *
 * Three-state only — never collapse transport failure into absence.
 * Uses `git ls-remote --exit-code --heads <remote> brief-delivery`:
 * present (0) | absent (2) | error (else).
 */
export function probeDeliveryLedgerRemote(
  ctx: DeliveryLedgerGitContext,
): DeliveryLedgerRemoteProbe {
  const remote = ctx.remote ?? "origin";
  const result = runGit(
    ctx.repoRoot,
    ["ls-remote", "--exit-code", "--heads", remote, DELIVERY_LEDGER_BRANCH],
    { allowFail: true, env: ctx.env },
  );
  if (result.ok && result.status === 0) {
    return { status: "present" };
  }
  // git-ls-remote(1): --exit-code → status 2 when no matching refs, after a
  // successful talk with the remote repository.
  if (result.status === LS_REMOTE_NO_MATCH_STATUS) {
    return { status: "absent" };
  }
  const err = failClosedProbeError(remote, result);
  return {
    status: "error",
    message: err.message,
    exitCode: result.status,
  };
}

/**
 * Convenience boolean: true only when the remote verifiably advertises
 * brief-delivery. Verified absence → false. Probe error → throws.
 *
 * Do not use this for restore/checkpoint safety decisions; those must branch
 * on {@link probeDeliveryLedgerRemote} (present | absent | error).
 */
export function remoteHasDeliveryLedger(
  ctx: DeliveryLedgerGitContext,
): boolean {
  const probe = probeDeliveryLedgerRemote(ctx);
  if (probe.status === "present") return true;
  if (probe.status === "absent") return false;
  throw new Error(probe.message);
}

/**
 * Fetch brief-delivery with an explicit refspec into refs/remotes/<remote>/…
 * so subsequent checkout/rev-parse of origin/brief-delivery works on fresh
 * single-branch checkouts.
 */
export function fetchDeliveryLedger(
  ctx: DeliveryLedgerGitContext,
  options: { depth?: number; allowFail?: boolean } = {},
): GitRunResult {
  const remote = ctx.remote ?? "origin";
  const depth = options.depth ?? 20;
  const args = [
    "fetch",
    remote,
    deliveryLedgerFetchRefspec(remote),
    `--depth=${depth}`,
  ];
  return runGit(ctx.repoRoot, args, {
    allowFail: options.allowFail,
    env: ctx.env,
  });
}

/**
 * Whether the local remote-tracking ref exists after fetch.
 */
export function hasLocalDeliveryLedgerTrackingRef(
  ctx: DeliveryLedgerGitContext,
): boolean {
  const remote = ctx.remote ?? "origin";
  const result = runGit(
    ctx.repoRoot,
    ["rev-parse", "--verify", deliveryLedgerRemoteTrackingRef(remote)],
    { allowFail: true, env: ctx.env },
  );
  return result.ok && result.stdout.length > 0;
}

export interface RestoreDeliveryLedgerOptions extends DeliveryLedgerGitContext {
  ledgerDir: string;
  reportsRoot: string;
  /** Fetch depth (default 1 for restore). */
  fetchDepth?: number;
}

export interface RestoreDeliveryLedgerResult {
  /** Remote had no brief-delivery branch — first-ever run is fine. */
  skippedAbsentRemote: boolean;
  restored: string[];
}

/**
 * Fetch + materialize ledger markers into reportsRoot.
 *
 * Fail-closed three-state probe:
 * - verified absent (ls-remote exit 2): successful clean skip (first-ever)
 * - present: fetch/checkout/restore must succeed or throw
 * - probe error (missing remote, unreachable URL, auth/transport, indeterminate):
 *   throw before SMTP; never treat as first-ever absence
 */
export function restoreDeliveryLedgerFromRemote(
  options: RestoreDeliveryLedgerOptions,
): RestoreDeliveryLedgerResult {
  const remote = options.remote ?? "origin";
  fs.mkdirSync(options.ledgerDir, { recursive: true });
  fs.mkdirSync(options.reportsRoot, { recursive: true });

  const presence = probeDeliveryLedgerRemote(options);
  if (presence.status === "error") {
    throw new Error(presence.message);
  }
  if (presence.status === "absent") {
    return { skippedAbsentRemote: true, restored: [] };
  }

  // Branch exists remotely → every subsequent step must succeed (fail closed).
  const fetch = fetchDeliveryLedger(options, {
    depth: options.fetchDepth ?? 1,
    allowFail: true,
  });
  if (!fetch.ok) {
    const detail = sanitizeGitDiagnostic(
      fetch.stderr || fetch.stdout || "fetch failed",
    );
    throw new Error(
      `delivery ledger exists on remote '${remote}' but fetch failed; refusing send (duplicate status unknown): ${detail}`,
    );
  }

  if (!hasLocalDeliveryLedgerTrackingRef(options)) {
    throw new Error(
      `delivery ledger exists on remote '${remote}' but ${deliveryLedgerRemoteTrackingRef(remote)} was not created after fetch; refusing send`,
    );
  }

  // Sparse checkout of ledger tree into ledgerDir (not a full worktree switch).
  const tracking = deliveryLedgerRemoteTrackingRef(remote);
  try {
    runGit(
      options.repoRoot,
      ["--work-tree", options.ledgerDir, "checkout", tracking, "--", "."],
      { env: options.env },
    );
  } catch (error) {
    const detail = sanitizeGitDiagnostic(
      error instanceof Error ? error.message : String(error),
    );
    throw new Error(
      `delivery ledger exists on remote '${remote}' but checkout/restore failed; refusing send (duplicate status unknown): ${detail}`,
    );
  }

  const restored = restoreDeliveryMarkersFromLedger(
    options.ledgerDir,
    options.reportsRoot,
  );
  return { skippedAbsentRemote: false, restored };
}

export interface CheckpointDeliveryOptions extends DeliveryLedgerGitContext {
  editionDate: string;
  reportsRoot: string;
  /** Max push attempts with rebase (default 3). */
  pushAttempts?: number;
}

export interface CheckpointDeliveryResult {
  pushed: boolean;
  alreadyPresent: boolean;
  editionDate: string;
}

/**
 * Immediately after SMTP: write non-secret markers onto brief-delivery and push.
 *
 * First commit path uses orphan + read-tree --empty so the ledger tree never
 * inherits the repository index (package.json, source, secrets, etc.).
 *
 * First-ever orphan creation is allowed only after a successful remote probe
 * proves the branch absent (ls-remote exit 2). Probe/fetch failures after SMTP
 * fail the checkpoint — never misclassify unknown remote state as first creation.
 */
export function checkpointDeliveryToRemote(
  options: CheckpointDeliveryOptions,
): CheckpointDeliveryResult {
  const remote = options.remote ?? "origin";
  const editionDate = options.editionDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(editionDate)) {
    throw new Error("edition date must be YYYY-MM-DD");
  }

  // Typed probe before any orphan/push work. Only verified absence may take
  // the first-ever branch path; errors fail the checkpoint (fail closed).
  const presence = probeDeliveryLedgerRemote(options);
  if (presence.status === "error") {
    throw new Error(presence.message);
  }

  let hasRemote = false;
  if (presence.status === "present") {
    const fetch = fetchDeliveryLedger(options, {
      depth: 20,
      allowFail: true,
    });
    if (!fetch.ok) {
      const detail = sanitizeGitDiagnostic(
        fetch.stderr || fetch.stdout || "fetch failed",
      );
      throw new Error(
        `delivery ledger exists on remote '${remote}' but checkpoint fetch failed; refusing to create orphan or push (duplicate status unknown): ${detail}`,
      );
    }
    if (!hasLocalDeliveryLedgerTrackingRef(options)) {
      throw new Error(
        `delivery ledger exists on remote '${remote}' but ${deliveryLedgerRemoteTrackingRef(remote)} was not created after checkpoint fetch; refusing to create orphan or push`,
      );
    }
    hasRemote = true;
  }
  // presence.status === "absent" → first-ever orphan path below.

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brief-delivery-"));
  const repoRoot = options.repoRoot;

  try {
    if (hasRemote) {
      runGit(
        repoRoot,
        [
          "worktree",
          "add",
          "--detach",
          work,
          deliveryLedgerRemoteTrackingRef(remote),
        ],
        { env: options.env },
      );
    } else {
      // First checkpoint: orphan branch with an empty index — never the
      // start-tree from HEAD (checkout --orphan retains index entries).
      // Only reached after probe status === "absent".
      runGit(repoRoot, ["worktree", "add", "--detach", work, "HEAD"], {
        env: options.env,
      });
      runGit(work, ["checkout", "--orphan", DELIVERY_LEDGER_BRANCH], {
        env: options.env,
      });
      // Critical: empty the index so the first commit cannot ship the repo.
      runGit(work, ["read-tree", "--empty"], { env: options.env });
      // Drop leftover worktree files from the detached HEAD checkout.
      for (const name of fs.readdirSync(work)) {
        if (name === ".git") continue;
        fs.rmSync(path.join(work, name), { recursive: true, force: true });
      }
    }

    writeDeliveryLedgerEntry(work, options.reportsRoot, editionDate);

    runGit(work, ["add", "--", editionDate], { env: options.env });
    const staged = runGit(work, ["diff", "--cached", "--name-only"], {
      allowFail: true,
      env: options.env,
    });
    if (!staged.stdout) {
      return { pushed: false, alreadyPresent: true, editionDate };
    }

    runGit(
      work,
      [
        "-c",
        "user.name=github-actions[bot]",
        "-c",
        "user.email=41898282+github-actions[bot]@users.noreply.github.com",
        "commit",
        "-m",
        `delivery checkpoint ${editionDate}`,
      ],
      { env: options.env },
    );

    // Safety: commit tree must only contain date-keyed ledger paths.
    assertLedgerCommitTreeIsClean(work, options.env);

    const attempts = options.pushAttempts ?? 3;
    let pushed = false;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        if (attempt > 1) {
          fetchDeliveryLedger(options, { depth: 20, allowFail: true });
          if (hasLocalDeliveryLedgerTrackingRef(options)) {
            runGit(
              work,
              ["rebase", deliveryLedgerRemoteTrackingRef(remote)],
              { allowFail: true, env: options.env },
            );
          }
        }
        runGit(
          work,
          ["push", remote, `HEAD:${deliveryLedgerHeadsRef()}`],
          { env: options.env },
        );
        pushed = true;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!pushed) {
      throw lastError instanceof Error
        ? lastError
        : new Error("failed to push delivery checkpoint");
    }

    return { pushed: true, alreadyPresent: false, editionDate };
  } finally {
    try {
      runGit(repoRoot, ["worktree", "remove", "--force", work], {
        allowFail: true,
        env: options.env,
      });
    } catch {
      // ignore cleanup failures
    }
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Assert the current HEAD tree only has YYYY-MM-DD/.emailed and optional
 * YYYY-MM-DD/sent.json paths — never source files, configs, or secrets.
 */
export function assertLedgerCommitTreeIsClean(
  worktreeOrRepo: string,
  env?: NodeJS.ProcessEnv,
): string[] {
  const listed = runGit(worktreeOrRepo, ["ls-tree", "-r", "--name-only", "HEAD"], {
    env,
  });
  const paths = listed.stdout
    ? listed.stdout.split("\n").map((line) => line.trim()).filter(Boolean)
    : [];
  const allowed = /^(\d{4}-\d{2}-\d{2})\/(\.emailed|sent\.json)$/;
  const bad = paths.filter((p) => !allowed.test(p));
  if (bad.length > 0) {
    throw new Error(
      `brief-delivery commit tree is contaminated with non-ledger paths: ${bad.join(", ")}`,
    );
  }
  if (paths.length === 0) {
    throw new Error("brief-delivery commit tree is empty after checkpoint");
  }
  return paths;
}

/**
 * List blob paths on a remote branch tip (for tests / diagnostics).
 * Uses ls-remote + fetch into a temp remote-tracking-free object read when needed.
 */
export function listRemoteLedgerTreePaths(
  ctx: DeliveryLedgerGitContext,
): string[] {
  const remote = ctx.remote ?? "origin";
  fetchDeliveryLedger(ctx, { depth: 20, allowFail: false });
  const tracking = deliveryLedgerRemoteTrackingRef(remote);
  const listed = runGit(
    ctx.repoRoot,
    ["ls-tree", "-r", "--name-only", tracking],
    { env: ctx.env },
  );
  return listed.stdout
    ? listed.stdout.split("\n").map((l) => l.trim()).filter(Boolean)
    : [];
}
