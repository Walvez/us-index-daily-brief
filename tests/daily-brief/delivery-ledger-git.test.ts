/**
 * Bare-remote integration tests for the durable brief-delivery ledger.
 *
 * Never touches the real origin. All remotes are temporary bare repos under
 * os.tmpdir(), cleaned up in test after-hooks.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DELIVERY_LEDGER_BRANCH,
} from "../../lib/daily-brief/delivery-ledger";
import {
  assertLedgerCommitTreeIsClean,
  checkpointDeliveryToRemote,
  deliveryLedgerFetchRefspec,
  deliveryLedgerRemoteTrackingRef,
  fetchDeliveryLedger,
  listRemoteLedgerTreePaths,
  LS_REMOTE_NO_MATCH_STATUS,
  probeDeliveryLedgerRemote,
  remoteHasDeliveryLedger,
  restoreDeliveryLedgerFromRemote,
  runGit,
  sanitizeGitDiagnostic,
} from "../../lib/daily-brief/delivery-ledger-git";
import {
  inspectEditionState,
  markEditionEmailed,
  writeEditionReportFiles,
} from "../../lib/daily-brief/state";
import { dailyBriefFixture } from "./fixtures";

const SOURCE_CONTAMINANTS = [
  "package.json",
  "package-lock.json",
  "README.md",
  "src/app.ts",
  "lib/daily-brief/orchestrator.ts",
  "secrets.env",
  ".env",
  "docs/index-brief-setup.md",
] as const;

function git(
  cwd: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "ledger-test",
      GIT_AUTHOR_EMAIL: "ledger-test@example.com",
      GIT_COMMITTER_NAME: "ledger-test",
      GIT_COMMITTER_EMAIL: "ledger-test@example.com",
      ...env,
    },
  }).trim();
}

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Seed a bare remote with a normal default branch containing representative
 * repository files (the contamination surface orphan-checkout must not ship).
 */
function seedBareRemoteWithDefaultBranch(): {
  bare: string;
  cleanup: () => void;
} {
  const root = tempDir("ledger-seed-");
  const bare = path.join(root, "remote.git");
  const seed = path.join(root, "seed-work");
  fs.mkdirSync(seed, { recursive: true });

  git(seed, ["init", "-b", "master"]);
  // Representative files that must NEVER appear on brief-delivery.
  fs.writeFileSync(path.join(seed, "package.json"), '{"name":"daily-brief"}');
  fs.writeFileSync(path.join(seed, "package-lock.json"), "{}");
  fs.writeFileSync(path.join(seed, "README.md"), "# daily brief");
  fs.writeFileSync(path.join(seed, "secrets.env"), "GMAIL_APP_PASSWORD=fake");
  fs.writeFileSync(path.join(seed, ".env"), "TOKEN=secret");
  fs.mkdirSync(path.join(seed, "src"), { recursive: true });
  fs.writeFileSync(path.join(seed, "src", "app.ts"), "export {};");
  fs.mkdirSync(path.join(seed, "lib", "daily-brief"), { recursive: true });
  fs.writeFileSync(
    path.join(seed, "lib", "daily-brief", "orchestrator.ts"),
    "export {};",
  );
  fs.mkdirSync(path.join(seed, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(seed, "docs", "index-brief-setup.md"),
    "# setup",
  );

  git(seed, ["add", "."]);
  git(seed, ["commit", "-m", "seed default branch"]);
  git(seed, ["clone", "--bare", seed, bare]);
  // Ensure bare default branch is master for single-branch clones.
  git(bare, ["symbolic-ref", "HEAD", "refs/heads/master"]);

  return {
    bare,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Fresh single-branch clone of only the default branch — mirrors Actions
 * checkout@v4 with fetch-depth and single-branch defaults (no brief-delivery
 * remote-tracking ref until explicit refspec fetch).
 */
function freshSingleBranchClone(
  bare: string,
  prefix: string,
): { clone: string; cleanup: () => void } {
  const parent = tempDir(prefix);
  const clone = path.join(parent, "work");
  git(parent, [
    "clone",
    "--single-branch",
    "--branch",
    "master",
    "--depth",
    "1",
    bare,
    clone,
  ]);
  return {
    clone,
    cleanup: () => fs.rmSync(parent, { recursive: true, force: true }),
  };
}

function prepareLocalSentEdition(
  clone: string,
  editionDate: string,
  messageId: string,
): string {
  const reports = path.join(clone, "daily_reports");
  writeEditionReportFiles(
    reports,
    dailyBriefFixture({ editionDate }),
  );
  markEditionEmailed(reports, editionDate, { messageId });
  return reports;
}

test("delivery ledger fetch refspec maps heads to remotes tracking ref", () => {
  assert.equal(
    deliveryLedgerFetchRefspec("origin"),
    "refs/heads/brief-delivery:refs/remotes/origin/brief-delivery",
  );
  assert.equal(
    deliveryLedgerRemoteTrackingRef("origin"),
    "refs/remotes/origin/brief-delivery",
  );
  assert.equal(DELIVERY_LEDGER_BRANCH, "brief-delivery");
});

test("bare-remote: first checkpoint, clean tree, restore, second edition, fail-closed", (t) => {
  const seeded = seedBareRemoteWithDefaultBranch();
  t.after(seeded.cleanup);

  // --- 1–3: first delivery checkpoint; remote tree only date markers ---
  const first = freshSingleBranchClone(seeded.bare, "ledger-first-");
  t.after(first.cleanup);

  // Prove plain fetch does not create the tracking ref (Actions pitfall).
  runGit(first.clone, ["fetch", "origin", DELIVERY_LEDGER_BRANCH, "--depth=1"], {
    allowFail: true,
  });
  const plainRev = runGit(
    first.clone,
    ["rev-parse", "--verify", "refs/remotes/origin/brief-delivery"],
    { allowFail: true },
  );
  assert.equal(
    plainRev.ok,
    false,
    "plain fetch must not create origin/brief-delivery on fresh single-branch clone when branch is absent",
  );

  const reports1 = prepareLocalSentEdition(first.clone, "2026-06-06", "msg-1");
  const cp1 = checkpointDeliveryToRemote({
    repoRoot: first.clone,
    remote: "origin",
    editionDate: "2026-06-06",
    reportsRoot: reports1,
  });
  assert.equal(cp1.pushed, true);
  assert.equal(cp1.alreadyPresent, false);
  assert.equal(
    probeDeliveryLedgerRemote({ repoRoot: first.clone }).status,
    "present",
  );
  assert.equal(remoteHasDeliveryLedger({ repoRoot: first.clone }), true);

  // Fresh clone to inspect remote tip without local worktree state.
  const inspect = freshSingleBranchClone(seeded.bare, "ledger-inspect-");
  t.after(inspect.cleanup);
  const tree1 = listRemoteLedgerTreePaths({
    repoRoot: inspect.clone,
    remote: "origin",
  });
  assert.deepEqual(
    tree1.sort(),
    ["2026-06-06/.emailed", "2026-06-06/sent.json"].sort(),
  );
  for (const bad of SOURCE_CONTAMINANTS) {
    assert.ok(
      !tree1.includes(bad),
      `ledger tree must not contain source contaminant ${bad}`,
    );
  }
  // Tracking ref must exist after production fetch refspec.
  assert.equal(
    hasTrackingAfterProductionFetch(inspect.clone),
    true,
  );

  // --- 4: fresh Actions-like checkout restores marker; inspectEditionState sent ---
  const restoreClone = freshSingleBranchClone(seeded.bare, "ledger-restore-");
  t.after(restoreClone.cleanup);

  // Before restore: no tracking ref (single-branch clone of master only).
  const beforeFetch = runGit(
    restoreClone.clone,
    ["rev-parse", "--verify", deliveryLedgerRemoteTrackingRef("origin")],
    { allowFail: true },
  );
  assert.equal(
    beforeFetch.ok,
    false,
    "fresh single-branch clone must not already have origin/brief-delivery",
  );

  const ledgerDir = path.join(restoreClone.clone, ".delivery-ledger");
  const reportsRestore = path.join(restoreClone.clone, "daily_reports");
  const restored = restoreDeliveryLedgerFromRemote({
    repoRoot: restoreClone.clone,
    remote: "origin",
    ledgerDir,
    reportsRoot: reportsRestore,
    fetchDepth: 1,
  });
  assert.equal(restored.skippedAbsentRemote, false);
  assert.deepEqual(restored.restored, ["2026-06-06"]);
  assert.equal(inspectEditionState(reportsRestore, "2026-06-06"), "sent");
  assert.equal(
    hasTrackingAfterProductionFetch(restoreClone.clone),
    true,
    "production restore must leave origin/brief-delivery tracking ref",
  );

  // --- 5: second edition from another fresh clone; both remain; no sources ---
  const second = freshSingleBranchClone(seeded.bare, "ledger-second-");
  t.after(second.cleanup);
  const reports2 = prepareLocalSentEdition(second.clone, "2026-06-07", "msg-2");
  const cp2 = checkpointDeliveryToRemote({
    repoRoot: second.clone,
    remote: "origin",
    editionDate: "2026-06-07",
    reportsRoot: reports2,
  });
  assert.equal(cp2.pushed, true);

  const inspect2 = freshSingleBranchClone(seeded.bare, "ledger-inspect2-");
  t.after(inspect2.cleanup);
  const tree2 = listRemoteLedgerTreePaths({
    repoRoot: inspect2.clone,
    remote: "origin",
  });
  assert.deepEqual(
    tree2.sort(),
    [
      "2026-06-06/.emailed",
      "2026-06-06/sent.json",
      "2026-06-07/.emailed",
      "2026-06-07/sent.json",
    ].sort(),
  );
  for (const bad of SOURCE_CONTAMINANTS) {
    assert.ok(!tree2.includes(bad), `still no contaminant ${bad}`);
  }
  // Also assert via assertLedgerCommitTreeIsClean on tracking tip checkout.
  const track = deliveryLedgerRemoteTrackingRef("origin");
  runGit(inspect2.clone, ["fetch", "origin", deliveryLedgerFetchRefspec("origin"), "--depth=20"]);
  const cleanPaths = assertLedgerCommitTreeIsCleanViaRef(inspect2.clone, track);
  assert.ok(cleanPaths.length >= 4);

  // --- 6: existing remote ledger + fetch/restore failure → fail closed ---
  const failClone = freshSingleBranchClone(seeded.bare, "ledger-fail-");
  t.after(failClone.cleanup);

  assert.equal(
    probeDeliveryLedgerRemote({
      repoRoot: failClone.clone,
      remote: "origin",
    }).status,
    "present",
  );
  assert.equal(
    remoteHasDeliveryLedger({ repoRoot: failClone.clone, remote: "origin" }),
    true,
  );

  // 6a) Materialization failure after successful existence check: ledgerDir is a file.
  const roParent = tempDir("ledger-ro-");
  t.after(() => fs.rmSync(roParent, { recursive: true, force: true }));
  const badLedger = path.join(roParent, "not-a-dir");
  fs.writeFileSync(badLedger, "blocked");

  assert.throws(
    () =>
      restoreDeliveryLedgerFromRemote({
        repoRoot: failClone.clone,
        remote: "origin",
        ledgerDir: badLedger,
        reportsRoot: path.join(failClone.clone, "daily_reports"),
        fetchDepth: 1,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(
        err.message,
        /failed|ENOTDIR|EEXIST|not a directory|file already exists|checkout|delivery ledger/i,
      );
      return true;
    },
  );

  // 6b) Remote advertises brief-delivery but object transfer fails → fail closed.
  // Copy the bare, keep refs/heads/brief-delivery, strip objects so ls-remote
  // still reports the branch while fetch cannot materialize the tip.
  const corruptRoot = tempDir("ledger-corrupt-");
  t.after(() => fs.rmSync(corruptRoot, { recursive: true, force: true }));
  const corruptBare = path.join(corruptRoot, "corrupt.git");
  fs.cpSync(seeded.bare, corruptBare, { recursive: true });
  // Remove pack/objects but leave refs so the branch is still advertised.
  const objectsDir = path.join(corruptBare, "objects");
  for (const entry of fs.readdirSync(objectsDir)) {
    if (entry === "info" || entry === "pack") {
      fs.rmSync(path.join(objectsDir, entry), { recursive: true, force: true });
      fs.mkdirSync(path.join(objectsDir, entry), { recursive: true });
      continue;
    }
    fs.rmSync(path.join(objectsDir, entry), { recursive: true, force: true });
  }

  const corruptCloneParent = tempDir("ledger-corrupt-clone-");
  t.after(() => fs.rmSync(corruptCloneParent, { recursive: true, force: true }));
  const corruptClone = path.join(corruptCloneParent, "work");
  // Clone only master from the *good* bare, then retarget origin to corrupt bare
  // that still advertises brief-delivery (copied refs) without objects.
  git(corruptCloneParent, [
    "clone",
    "--single-branch",
    "--branch",
    "master",
    "--depth",
    "1",
    seeded.bare,
    corruptClone,
  ]);
  git(corruptClone, ["remote", "set-url", "origin", corruptBare]);

  assert.equal(
    probeDeliveryLedgerRemote({
      repoRoot: corruptClone,
      remote: "origin",
    }).status,
    "present",
    "corrupt bare must still advertise brief-delivery via ls-remote",
  );
  assert.equal(
    remoteHasDeliveryLedger({ repoRoot: corruptClone, remote: "origin" }),
    true,
    "corrupt bare must still advertise brief-delivery via ls-remote",
  );
  assert.throws(
    () =>
      restoreDeliveryLedgerFromRemote({
        repoRoot: corruptClone,
        remote: "origin",
        ledgerDir: path.join(corruptClone, ".delivery-ledger"),
        reportsRoot: path.join(corruptClone, "daily_reports"),
        fetchDepth: 1,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      // Must not soft-skip: branch exists, so restore must fail before send.
      assert.doesNotMatch(err.message, /skip/i);
      assert.match(err.message, /failed|fetch|delivery ledger|refusing send/i);
      return true;
    },
  );

  // Missing remote name is NOT a clean skip — fail closed (unknown duplicate state).
  assert.throws(
    () =>
      restoreDeliveryLedgerFromRemote({
        repoRoot: failClone.clone,
        remote: "no-such-remote",
        ledgerDir: path.join(failClone.clone, ".delivery-ledger-missing"),
        reportsRoot: path.join(failClone.clone, "daily_reports-missing"),
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /probe failed|refusing send|duplicate status unknown/i);
      assert.doesNotMatch(err.message, /secret|password|token|@/i);
      return true;
    },
  );
});

function hasTrackingAfterProductionFetch(clone: string): boolean {
  // Either restore already fetched, or call production fetch.
  const existing = runGit(
    clone,
    ["rev-parse", "--verify", deliveryLedgerRemoteTrackingRef("origin")],
    { allowFail: true },
  );
  if (existing.ok) return true;
  const fetched = fetchDeliveryLedger(
    { repoRoot: clone, remote: "origin" },
    { depth: 1, allowFail: true },
  );
  if (!fetched.ok) return false;
  return runGit(
    clone,
    ["rev-parse", "--verify", deliveryLedgerRemoteTrackingRef("origin")],
    { allowFail: true },
  ).ok;
}

function assertLedgerCommitTreeIsCleanViaRef(
  repoRoot: string,
  ref: string,
): string[] {
  const listed = runGit(repoRoot, ["ls-tree", "-r", "--name-only", ref]);
  const paths = listed.stdout
    ? listed.stdout.split("\n").map((l) => l.trim()).filter(Boolean)
    : [];
  const allowed = /^(\d{4}-\d{2}-\d{2})\/(\.emailed|sent\.json)$/;
  const bad = paths.filter((p) => !allowed.test(p));
  assert.deepEqual(bad, [], `non-ledger paths on ${ref}: ${bad.join(", ")}`);
  return paths;
}

test("orphan first commit does not retain start-tree index (read-tree --empty)", (t) => {
  const seeded = seedBareRemoteWithDefaultBranch();
  t.after(seeded.cleanup);
  const first = freshSingleBranchClone(seeded.bare, "ledger-orphan-");
  t.after(first.cleanup);

  // Contaminate the clone working tree further to mirror a full repo checkout.
  fs.writeFileSync(
    path.join(first.clone, "extra-config.json"),
    JSON.stringify({ secret: true }),
  );
  fs.mkdirSync(path.join(first.clone, "node_modules", "x"), { recursive: true });
  fs.writeFileSync(path.join(first.clone, "node_modules", "x", "index.js"), "1");

  const reports = prepareLocalSentEdition(first.clone, "2026-07-01", "msg-orphan");
  checkpointDeliveryToRemote({
    repoRoot: first.clone,
    remote: "origin",
    editionDate: "2026-07-01",
    reportsRoot: reports,
  });

  const inspect = freshSingleBranchClone(seeded.bare, "ledger-orphan-inspect-");
  t.after(inspect.cleanup);
  const tree = listRemoteLedgerTreePaths({
    repoRoot: inspect.clone,
    remote: "origin",
  });
  assert.deepEqual(
    tree.sort(),
    ["2026-07-01/.emailed", "2026-07-01/sent.json"].sort(),
  );
  assert.ok(!tree.some((p) => p.includes("package")));
  assert.ok(!tree.some((p) => p.includes("node_modules")));
  assert.ok(!tree.some((p) => p.includes("secret") || p.includes(".env")));
  assert.ok(!tree.includes("extra-config.json"));
  // Sanity: assertLedgerCommitTreeIsClean API on a worktree of the ledger tip.
  const work = tempDir("ledger-clean-assert-");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  runGit(inspect.clone, [
    "worktree",
    "add",
    "--detach",
    work,
    deliveryLedgerRemoteTrackingRef("origin"),
  ]);
  const clean = assertLedgerCommitTreeIsClean(work);
  assert.ok(clean.every((p) => /^\d{4}-\d{2}-\d{2}\//.test(p)));
});

test("restore skips cleanly when remote has no brief-delivery branch", (t) => {
  const seeded = seedBareRemoteWithDefaultBranch();
  t.after(seeded.cleanup);
  const clone = freshSingleBranchClone(seeded.bare, "ledger-absent-");
  t.after(clone.cleanup);

  // Confirm git exit semantics: reachable remote + no match → status 2.
  const ls = runGit(
    clone.clone,
    ["ls-remote", "--exit-code", "--heads", "origin", DELIVERY_LEDGER_BRANCH],
    { allowFail: true },
  );
  assert.equal(ls.ok, false);
  assert.equal(
    ls.status,
    LS_REMOTE_NO_MATCH_STATUS,
    "git ls-remote --exit-code must return 2 when remote is reachable but brief-delivery is absent",
  );

  assert.equal(
    probeDeliveryLedgerRemote({ repoRoot: clone.clone, remote: "origin" })
      .status,
    "absent",
  );
  assert.equal(
    remoteHasDeliveryLedger({ repoRoot: clone.clone, remote: "origin" }),
    false,
  );
  const result = restoreDeliveryLedgerFromRemote({
    repoRoot: clone.clone,
    remote: "origin",
    ledgerDir: path.join(clone.clone, ".delivery-ledger"),
    reportsRoot: path.join(clone.clone, "daily_reports"),
  });
  assert.equal(result.skippedAbsentRemote, true);
  assert.deepEqual(result.restored, []);
});

test("reachable bare remote with brief-delivery is present and restores markers", (t) => {
  const seeded = seedBareRemoteWithDefaultBranch();
  t.after(seeded.cleanup);
  const writer = freshSingleBranchClone(seeded.bare, "ledger-present-w-");
  t.after(writer.cleanup);
  const reports = prepareLocalSentEdition(writer.clone, "2026-06-15", "msg-p");
  checkpointDeliveryToRemote({
    repoRoot: writer.clone,
    remote: "origin",
    editionDate: "2026-06-15",
    reportsRoot: reports,
  });

  const reader = freshSingleBranchClone(seeded.bare, "ledger-present-r-");
  t.after(reader.cleanup);
  const ls = runGit(
    reader.clone,
    ["ls-remote", "--exit-code", "--heads", "origin", DELIVERY_LEDGER_BRANCH],
    { allowFail: true },
  );
  assert.equal(ls.ok, true);
  assert.equal(ls.status, 0);

  assert.equal(
    probeDeliveryLedgerRemote({ repoRoot: reader.clone, remote: "origin" })
      .status,
    "present",
  );
  const restored = restoreDeliveryLedgerFromRemote({
    repoRoot: reader.clone,
    remote: "origin",
    ledgerDir: path.join(reader.clone, ".delivery-ledger"),
    reportsRoot: path.join(reader.clone, "daily_reports"),
  });
  assert.equal(restored.skippedAbsentRemote, false);
  assert.deepEqual(restored.restored, ["2026-06-15"]);
  assert.equal(
    inspectEditionState(path.join(reader.clone, "daily_reports"), "2026-06-15"),
    "sent",
  );
});

test("configured remote name does not exist → probe error and restore throws", (t) => {
  const seeded = seedBareRemoteWithDefaultBranch();
  t.after(seeded.cleanup);
  const clone = freshSingleBranchClone(seeded.bare, "ledger-noremo-");
  t.after(clone.cleanup);

  const probe = probeDeliveryLedgerRemote({
    repoRoot: clone.clone,
    remote: "no-such-remote",
  });
  assert.equal(probe.status, "error");
  if (probe.status === "error") {
    assert.match(probe.message, /probe failed|refusing send/i);
    assert.doesNotMatch(probe.message, /https?:\/\/|@[^\s]+|secret|password|token/i);
  }
  assert.throws(
    () => remoteHasDeliveryLedger({ repoRoot: clone.clone, remote: "no-such-remote" }),
    /probe failed|refusing send/i,
  );
  assert.throws(
    () =>
      restoreDeliveryLedgerFromRemote({
        repoRoot: clone.clone,
        remote: "no-such-remote",
        ledgerDir: path.join(clone.clone, ".delivery-ledger"),
        reportsRoot: path.join(clone.clone, "daily_reports"),
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /probe failed|refusing send|duplicate status unknown/i);
      return true;
    },
  );
});

test("unreachable remote path/URL → probe error and restore throws", (t) => {
  const seeded = seedBareRemoteWithDefaultBranch();
  t.after(seeded.cleanup);
  const clone = freshSingleBranchClone(seeded.bare, "ledger-unreach-");
  t.after(clone.cleanup);

  const missingBare = path.join(tempDir("ledger-missing-bare-"), "gone.git");
  // Point origin at a path that does not exist (no real network).
  git(clone.clone, ["remote", "set-url", "origin", missingBare]);

  const probe = probeDeliveryLedgerRemote({
    repoRoot: clone.clone,
    remote: "origin",
  });
  assert.equal(probe.status, "error");
  if (probe.status === "error") {
    assert.match(probe.message, /probe failed|refusing send/i);
    // Must not echo the absolute path / credential-looking material.
    assert.doesNotMatch(probe.message, /gone\.git|secret|password|token/i);
  }

  assert.throws(
    () =>
      restoreDeliveryLedgerFromRemote({
        repoRoot: clone.clone,
        remote: "origin",
        ledgerDir: path.join(clone.clone, ".delivery-ledger"),
        reportsRoot: path.join(clone.clone, "daily_reports"),
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /probe failed|refusing send|duplicate status unknown/i);
      assert.doesNotMatch(err.message, /gone\.git/i);
      return true;
    },
  );
});

test("transport failure after previously valid setup throws before send decision", (t) => {
  const seeded = seedBareRemoteWithDefaultBranch();
  t.after(seeded.cleanup);
  // Valid setup first: ledger present on reachable bare.
  const writer = freshSingleBranchClone(seeded.bare, "ledger-transport-w-");
  t.after(writer.cleanup);
  const reports = prepareLocalSentEdition(writer.clone, "2026-06-20", "msg-t");
  checkpointDeliveryToRemote({
    repoRoot: writer.clone,
    remote: "origin",
    editionDate: "2026-06-20",
    reportsRoot: reports,
  });

  const clone = freshSingleBranchClone(seeded.bare, "ledger-transport-r-");
  t.after(clone.cleanup);
  assert.equal(
    probeDeliveryLedgerRemote({ repoRoot: clone.clone, remote: "origin" })
      .status,
    "present",
  );

  // Break transport: retarget origin to unreachable path after valid setup.
  const broken = path.join(tempDir("ledger-broken-url-"), "nope.git");
  git(clone.clone, ["remote", "set-url", "origin", broken]);

  assert.equal(
    probeDeliveryLedgerRemote({ repoRoot: clone.clone, remote: "origin" })
      .status,
    "error",
  );
  assert.throws(
    () =>
      restoreDeliveryLedgerFromRemote({
        repoRoot: clone.clone,
        remote: "origin",
        ledgerDir: path.join(clone.clone, ".delivery-ledger"),
        reportsRoot: path.join(clone.clone, "daily_reports"),
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /probe failed|refusing send|duplicate status unknown/i);
      // Must not soft-skip as first-ever absence.
      assert.doesNotMatch(err.message, /skip/i);
      return true;
    },
  );
});

test("checkpoint with unknown remote state must not create orphan/push", (t) => {
  const seeded = seedBareRemoteWithDefaultBranch();
  t.after(seeded.cleanup);
  const clone = freshSingleBranchClone(seeded.bare, "ledger-cp-unknown-");
  t.after(clone.cleanup);
  const reports = prepareLocalSentEdition(clone.clone, "2026-06-21", "msg-u");

  // Unknown: missing remote name.
  assert.throws(
    () =>
      checkpointDeliveryToRemote({
        repoRoot: clone.clone,
        remote: "no-such-remote",
        editionDate: "2026-06-21",
        reportsRoot: reports,
      }),
    /probe failed|refusing send|duplicate status unknown/i,
  );

  // Unknown: unreachable origin URL after valid clone.
  const broken = path.join(tempDir("ledger-cp-broken-"), "gone.git");
  git(clone.clone, ["remote", "set-url", "origin", broken]);
  assert.throws(
    () =>
      checkpointDeliveryToRemote({
        repoRoot: clone.clone,
        remote: "origin",
        editionDate: "2026-06-21",
        reportsRoot: reports,
      }),
    /probe failed|refusing send|duplicate status unknown/i,
  );

  // Bare remote must still lack brief-delivery (no orphan push happened).
  // Re-point a fresh clone at the good bare and probe.
  const verify = freshSingleBranchClone(seeded.bare, "ledger-cp-verify-");
  t.after(verify.cleanup);
  assert.equal(
    probeDeliveryLedgerRemote({ repoRoot: verify.clone, remote: "origin" })
      .status,
    "absent",
    "failed checkpoint must not have created brief-delivery on the real bare",
  );
  const heads = runGit(
    seeded.bare,
    ["show-ref", "--heads", DELIVERY_LEDGER_BRANCH],
    { allowFail: true },
  );
  assert.equal(heads.ok, false, "bare remote must not have brief-delivery after failed checkpoint");
});

test("sanitizeGitDiagnostic redacts credential-bearing URLs and tokens", () => {
  const raw =
    "fatal: unable to access 'https://user:super-secret@github.com/org/repo.git/': failed\n" +
    "token ghp_ABCDEFG1234567890xyz and git@github.com:org/repo.git";
  const cleaned = sanitizeGitDiagnostic(raw);
  assert.doesNotMatch(cleaned, /super-secret/);
  assert.doesNotMatch(cleaned, /ghp_ABCDEFG/);
  assert.doesNotMatch(cleaned, /user:super-secret@/);
  assert.match(cleaned, /\[redacted-/);
});

test("production fetch refspec creates origin/brief-delivery after plain fetch would not", (t) => {
  const seeded = seedBareRemoteWithDefaultBranch();
  t.after(seeded.cleanup);

  // Seed a ledger first.
  const writer = freshSingleBranchClone(seeded.bare, "ledger-refspec-w-");
  t.after(writer.cleanup);
  const reports = prepareLocalSentEdition(writer.clone, "2026-06-10", "msg-r");
  checkpointDeliveryToRemote({
    repoRoot: writer.clone,
    remote: "origin",
    editionDate: "2026-06-10",
    reportsRoot: reports,
  });

  const reader = freshSingleBranchClone(seeded.bare, "ledger-refspec-r-");
  t.after(reader.cleanup);

  // Plain branch fetch (historical bug): updates FETCH_HEAD; tracking ref
  // creation is unreliable on single-branch clones — do not depend on it.
  runGit(reader.clone, ["fetch", "origin", DELIVERY_LEDGER_BRANCH, "--depth=1"], {
    allowFail: true,
  });
  // Regardless of plain-fetch behavior, production path must be explicit.
  // Clear any tracking ref that plain fetch might have created so we only
  // credit the production refspec.
  runGit(
    reader.clone,
    ["update-ref", "-d", deliveryLedgerRemoteTrackingRef("origin")],
    { allowFail: true },
  );
  assert.equal(
    runGit(
      reader.clone,
      ["rev-parse", "--verify", deliveryLedgerRemoteTrackingRef("origin")],
      { allowFail: true },
    ).ok,
    false,
  );

  const fetched = fetchDeliveryLedger(
    { repoRoot: reader.clone, remote: "origin" },
    { depth: 1, allowFail: false },
  );
  assert.equal(fetched.ok, true);
  assert.equal(
    runGit(
      reader.clone,
      ["rev-parse", "--verify", deliveryLedgerRemoteTrackingRef("origin")],
      { allowFail: true },
    ).ok,
    true,
  );
});
