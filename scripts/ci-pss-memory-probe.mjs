/**
 * Passive, Linux-only, branch-only observer. Never imports the watchdog or sends
 * a signal. The existing runner retains exclusive ownership of enforcement.
 * Exact file membership is evidence: do not regenerate it from today's planner.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { openSync, writeSync, fsyncSync, closeSync, mkdirSync } from "node:fs";

const composition = `scripts/agent-hub-queries.test.mjs
scripts/agents-composer-mount.test.mjs
scripts/agents-source-and-recency-locale.test.mjs
scripts/approvals-card-document.test.mjs
scripts/ask-options.test.mjs
scripts/attachment-url.test.mjs
scripts/backend-settings-collapse.test.mjs
scripts/browser-address-overlay.test.mjs
scripts/browser-chrome-s4b-probe-rig.test.mjs
scripts/browser-page-menu-focus.test.mjs
scripts/browser-tab-strip-focus.test.mjs
scripts/canonical-notice.test.mjs
scripts/chat-device-model.test.mjs
scripts/chat-search.test.mjs
scripts/chat-sidebar-hover-intent.test.mjs
scripts/chat-sidebar-time-order.test.mjs
scripts/check-runtime-deps.test.mjs
scripts/ci-scope.test.mjs
scripts/compact-receipt.test.mjs
scripts/composer-suggestions.test.mjs
scripts/console-close.test.mjs
scripts/copy-button-copy-locale.test.mjs
scripts/default-effort-options.test.mjs
scripts/desktop-stream.test.mjs
scripts/dev-shortcuts.test.mjs
scripts/echo-delivery.test.mjs
scripts/file-blob-url.test.mjs
scripts/held-claim-reach.test.mjs
scripts/hub-link-policy-popover.test.mjs
scripts/i18n-wave-b-keyed-copy.test.mjs
scripts/i18n/check-strings.test.mjs
scripts/i18n/ledger-check.test.mjs
scripts/i18n/ur-activation.test.mjs
scripts/import-settings-view.test.mjs
scripts/job-controls.test.mjs
scripts/lane-leading.test.mjs
scripts/library-markdown.test.mjs
scripts/live-update-integrity.test.mjs
scripts/markdown-remend.test.mjs
scripts/mcp-list-query.test.mjs
scripts/message-quote.test.mjs
scripts/move-session.test.mjs
scripts/notification-lifetime.test.mjs
scripts/onboarding-default-model.test.mjs
scripts/owned-serve-lifecycle.test.mjs
scripts/palette-shortcut.test.mjs
scripts/panel-rail.test.mjs
scripts/phone-access-block.test.mjs
scripts/project-view-perf.test.mjs
scripts/projects-quick-send.test.mjs
scripts/provider-catalog.test.mjs
scripts/provider-status.test.mjs
scripts/radient-session-issue.test.mjs
scripts/render-mac-entitlements.test.mjs
scripts/row-state-floors.test.mjs
scripts/scroll-region-to-top.test.mjs
scripts/session-asks.test.mjs
scripts/session-stream-token.test.mjs
scripts/settings-search-match.test.mjs
scripts/sidebar-attention-badge.test.mjs
scripts/sidebar-tag-drag.test.mjs
scripts/slash-contract.test.mjs
scripts/slash-token.test.mjs
scripts/speech-store.test.mjs
scripts/storybook-cache-prune.test.mjs
scripts/suggestion-stack-react.test.mjs
scripts/team-bridge-archive-container.test.mjs
scripts/team-bridge-client-ref.test.mjs
scripts/team-bridge-members.test.mjs
scripts/team-bridge-optimistic-send.test.mjs
scripts/team-bridge-receipt-contract.test.mjs
scripts/team-member-overrides.test.mjs
scripts/thread-search-contract.test.mjs
scripts/tooltip-browser-view.test.mjs
scripts/transcript-fade.test.mjs
scripts/transcript-perflush-perf.test.mjs
scripts/turn-collapse-model.test.mjs
scripts/update-global-guard.test.mjs
scripts/update-window-report.test.mjs
scripts/user-attachments.test.mjs
scripts/webauthn.test.mjs
scripts/working-line-clock.test.mjs
`;
const digest = "24a25a997ec2b21294f76edda09af3d3d23c75a32143d441d5718f01b0753eb5";
const files = composition.trimEnd().split("\n");
if (createHash("sha256").update(composition).digest("hex") !== digest || files.length !== 82) {
  throw new Error("Pinned 82-file composition digest mismatch; refusing to spawn");
}
if (process.platform !== "linux" || process.env.GITHUB_ACTIONS !== "true" ||
    !["refs/heads/main", "refs/heads/diag/ui-pss-memory-probe-activate"].includes(process.env.GITHUB_REF)) {
  throw new Error("Activation refused: Linux Actions on main or approved activation ref only");
}
// Refuse inherited tuning rather than silently changing the experiment.
for (const key of ["NODE_OPTIONS", "NODE_TEST_CONTEXT", "LOCAL_OPERATOR_UI_TEST_MEMORY_BUDGET_MB",
  "LOCAL_OPERATOR_UI_TEST_CONCURRENCY", "LOCAL_OPERATOR_UI_LANE_BOUND_MS"]) {
  if (process.env[key] !== undefined) throw new Error(`Unexpected tuning variable: ${key}`);
}
for (const file of files) await access(file);

const out = "pss-probe-artifacts";
mkdirSync(out, { recursive: false }); // Do not mix two experiments' artifacts.
// No timeout/maxBuffer helper: execFile would signal its subprocess on overflow.
// This observer never signals even its ps helper; the job's hard timeout owns it.
async function processTable() {
  return new Promise((resolve, reject) => {
    const ps = spawn("ps", ["-axo", "pid=,ppid=,pgid="], { stdio: ["ignore", "pipe", "ignore"] });
    let text = "";
    let overflow = false;
    ps.stdout.on("data", (chunk) => {
      if (Buffer.byteLength(text) + chunk.length > 1024 * 1024) overflow = true;
      if (!overflow) text += chunk.toString("utf8");
    });
    ps.once("error", reject);
    ps.once("close", (code) => code === 0 && !overflow ? resolve(text) : reject(new Error("Process table unavailable")));
  });
}
const LIMIT = 384 * 1024;
// Two rotating, fsynced JSONL segments + one bounded summary + one bounded
// allowlisted suite-output file total < 1.5 MiB, independent of suite duration.
let slot = 0;
let tickBytes = 0;
let tickFd = openSync(`${out}/ticks-${slot}.jsonl`, "w");
const outputFd = openSync(`${out}/suite-output.jsonl`, "w");
let outputBytes = 0;
function append(fd, value) {
  const text = `${JSON.stringify(value)}\n`;
  writeSync(fd, text);
  fsyncSync(fd);
  return Buffer.byteLength(text);
}
function tickRow(value) {
  const size = Buffer.byteLength(JSON.stringify(value)) + 1;
  if (size > LIMIT) throw new Error("Tick exceeds bounded artifact capacity");
  if (tickBytes + size > LIMIT) {
    closeSync(tickFd);
    slot = 1 - slot;
    tickFd = openSync(`${out}/ticks-${slot}.jsonl`, "w");
    tickBytes = 0;
  }
  tickBytes += append(tickFd, value);
}
const args = ["scripts/run-desktop-tests.mjs", "--test-concurrency=3", ...files];
const child = spawn(process.execPath, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
const started = Date.now();
let exited = false;
let exit = null;
let last = null;
let peak = null;
const maxima = { rssKb: 0, pssKb: 0, swapPssKb: 0 };
let guardLeader = null;
let samples = 0;
let skipped = 0;
let observedBytes = 0;
// Never persist arbitrary TAP, argv, environment, or test payloads. Only numeric
// guard readings survive this allowlist. Both pipes are continuously drained.
function drain(stream) {
  let partial = "";
  stream.on("data", (chunk) => {
    observedBytes += chunk.length;
    partial += chunk.toString("utf8");
    const lines = partial.split("\n");
    partial = lines.pop().slice(-16384);
    for (const line of lines) {
      const match = line.match(/MEMORY LIMIT EXCEEDED.*?process group (\d+) \((\d+) processes\).*?([\d.]+) GB owned \(rss ([\d.]+) GB\) >= budget ([\d.]+) GB/);
      if (match && outputBytes < 32 * 1024) outputBytes += append(outputFd, {
        type: "guard_breach", at: Date.now(), leaderPid: Number(match[1]), pidCount: Number(match[2]),
        ownedGiB: Number(match[3]), rssGiB: Number(match[4]), budgetGiB: Number(match[5]),
      });
    }
  });
}
drain(child.stdout);
drain(child.stderr);
const drained = new Promise((resolve) => child.once("close", resolve));
const finished = new Promise((resolve) => {
  child.once("error", () => { exit = { code: null, signal: null, spawnError: true, at: Date.now() }; exited = true; resolve(); });
  child.once("exit", (code, signal) => { exit = { code, signal, at: Date.now() }; exited = true; resolve(); });
});

// /proc stat's comm may contain spaces/parentheses. starttime is field 22;
// anchoring after the LAST ')' prevents a command name shifting the identity.
async function identity(pid) {
  const text = await readFile(`/proc/${pid}/stat`, "utf8");
  const fields = text.slice(text.lastIndexOf(")") + 2).trim().split(/\s+/);
  return { pid, ppid: Number(fields[1]), pgid: Number(fields[2]), start: fields[19] };
}
let leader;
try { leader = await identity(child.pid); } catch { /* Fast spawn failure: no claim. */ }
const known = new Map();
if (leader) known.set(leader.pid, leader.start);
function metric(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s+(\\d+) kB$`, "m"));
  if (!match) throw new Error("Missing proc metric");
  return Number(match[1]);
}
function total(rows) {
  return { pidCount: rows.length, pssKb: rows.reduce((n, p) => n + p.pssKb, 0),
    swapPssKb: rows.reduce((n, p) => n + p.swapPssKb, 0), rssKb: rows.reduce((n, p) => n + p.rssKb, 0) };
}
async function sample() {
  const begin = Date.now();
  try {
    const stdout = await processTable();
    const table = stdout.trim().split("\n").map((line) => {
      const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number);
      return { pid, ppid, pgid };
    });
    const identities = new Map();
    // Resolve identities BEFORE walking links, and require ps/proc agreement.
    await Promise.all(table.map(async (p) => {
      try {
        const id = await identity(p.pid);
        if (id.ppid === p.ppid && id.pgid === p.pgid) identities.set(p.pid, id);
      } catch { /* Departed pid is never guessed to be ours. */ }
    }));
    const selected = new Set();
    const currentLeader = identities.get(leader?.pid);
    const leaderLive = currentLeader?.start === leader?.start && leader !== undefined;
    for (const id of identities.values()) {
      if (known.get(id.pid) === id.start || (leaderLive && id.pgid === leader.pid && BigInt(id.start) >= BigInt(leader.start))) selected.add(id.pid);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of identities.values()) {
        const parent = identities.get(id.ppid);
        if (!selected.has(id.pid) && selected.has(id.ppid) && BigInt(id.start) >= BigInt(parent.start)) {
          selected.add(id.pid); changed = true;
        }
      }
    }
    // The runner and its keeper are observer-tree overhead, not charged by the
    // guard. Resolve node --test's group without persisting argv or test data.
    if (!guardLeader) {
      for (const pid of selected) {
        const id = identities.get(pid);
        if (id.ppid !== leader?.pid || id.pgid !== pid) continue;
        try {
          const argv = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0");
          if (argv.includes("--test")) guardLeader = id;
        } catch { /* Departed pid: do not guess the charged root. */ }
      }
    }
    const guardPids = new Set();
    const guardLive = guardLeader && identities.get(guardLeader.pid)?.start === guardLeader.start;
    if (guardLive) {
      for (const id of identities.values()) {
        if (id.pgid === guardLeader.pid && BigInt(id.start) >= BigInt(guardLeader.start)) guardPids.add(id.pid);
      }
      let growing = true;
      while (growing) {
        growing = false;
        for (const id of identities.values()) {
          if (!guardPids.has(id.pid) && guardPids.has(id.ppid) &&
              BigInt(id.start) >= BigInt(identities.get(id.ppid).start)) {
            guardPids.add(id.pid); growing = true;
          }
        }
      }
    }
    const rows = [];
    // A proc read that failed during identity resolution must not make a known
    // child silently disappear from an otherwise 'complete' process-table tick.
    const candidates = new Set(selected);
    let expanding = true;
    while (expanding) {
      expanding = false;
      for (const p of table) {
        if (!candidates.has(p.pid) && (candidates.has(p.ppid) ||
            (leaderLive && p.pgid === leader.pid) || known.has(p.pid))) {
          candidates.add(p.pid); expanding = true;
        }
      }
    }
    const missingPids = [...candidates].filter((pid) => !selected.has(pid));
    for (const pid of [...selected].sort((a, b) => a - b)) {
      const id = identities.get(pid);
      known.set(pid, id.start);
      try {
        const [smaps, status, comm] = await Promise.all([
          readFile(`/proc/${pid}/smaps_rollup`, "utf8"), readFile(`/proc/${pid}/status`, "utf8"), readFile(`/proc/${pid}/comm`, "utf8"),
        ]);
        const after = await identity(pid);
        if (after.start !== id.start || after.ppid !== id.ppid || after.pgid !== id.pgid) throw new Error("Identity changed");
        rows.push({ ...id, inGuardTree: guardPids.has(pid), command: comm.trim().replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 24),
          pssKb: metric(smaps, "Pss"), swapPssKb: metric(smaps, "SwapPss"), rssKb: metric(status, "VmRSS") });
      } catch { missingPids.push(pid); }
    }
    // A disappearing pid invalidates the pair; never silently sum a partial tree.
    const row = { type: "tick", tick: ++samples, begin, end: Date.now(), complete: missingPids.length === 0 && rows.length > 0,
      missingPids, totals: total(rows), guardTotals: guardLive ? total(rows.filter((p) => p.inGuardTree)) : null, processes: rows };
    // Reserve capacity for BOTH final detailed tables; never truncate a table
    // and present the resulting partial sum as a complete tree measurement.
    if (Buffer.byteLength(JSON.stringify(row)) > 128 * 1024) throw new Error("Tick capacity exceeded");
    if (!exit || row.end <= exit.at) {
      last = row;
      if (row.complete) {
        if (!peak || row.totals.rssKb > peak.totals.rssKb) peak = row;
        for (const key of Object.keys(maxima)) maxima[key] = Math.max(maxima[key], row.totals[key]);
      }
    }
    tickRow(row);
  } catch {
    skipped++;
    tickRow({ type: "unavailable", begin, end: Date.now(), reason: "sample_unavailable" });
  }
}
// Non-overlapping one-second targets. If a sample overruns, record its duration
// and skip missed targets, rather than overlapping or delaying suite enforcement.
let next = started;
while (!exited) {
  await sample();
  next += 1000;
  if (next < Date.now()) next = Date.now();
  await Promise.race([finished, new Promise((resolve) => setTimeout(resolve, Math.max(0, next - Date.now())))]);
}
await finished;
await drained; // 'exit' precedes pipe EOF; keep draining before closing artifacts.
const summary = { type: "summary", digest, fileCount: files.length,
  sourceCommit: /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? "") ? process.env.GITHUB_SHA : null,
  nodeVersion: process.version, started, exit, samples, skipped,
  suiteOutputBytesDrained: observedBytes, lastTickBeforeExit: last?.begin <= exit.at ? last : null,
  peakRssTick: peak, maximaKb: maxima, elapsedMs: Date.now() - started };
const summaryText = JSON.stringify(summary);
if (Buffer.byteLength(summaryText) >= LIMIT) throw new Error("Summary exceeds bounded artifact capacity");
const summaryFd = openSync(`${out}/summary.json`, "w");
append(summaryFd, summary);
closeSync(summaryFd);
closeSync(tickFd);
closeSync(outputFd);
console.log(JSON.stringify({ digest, fileCount: files.length, exit, samples, skipped, peakTotals: peak?.totals }));
process.exitCode = exit.code === 0 && peak ? 0 : (exit.code || 1);
