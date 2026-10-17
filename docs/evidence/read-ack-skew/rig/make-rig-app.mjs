#!/usr/bin/env node
/**
 * make-rig-app.mjs — build a RIG APP DIR from a worktree's built `out/`.
 *
 * The read-ack-skew rig's one disclosed app-side modification: main's read-receipt
 * foreground gate (`guardForegroundReceipts`, src/main/desktop-ipc.ts) refuses
 * `sessions.seen`/`attention.seen` from a window that is not visible, unminimised
 * and focused — a state no agent rig may satisfy (focusing a window would steal
 * the operator's focus, which the repo forbids). The gate protects receipts from
 * windows the user cannot see; lifting it in the rig lets the REAL receipt flow
 * (renderer loop -> main transport -> daemon -> 409) run end to end so the
 * defect's toast and the fix's quiet state can be photographed from the app
 * itself. NOTHING under the worktree is touched; the modification lives only in
 * this cloned `out/` under the rig root, and the README records the exact
 * before/after text.
 *
 * Usage: node make-rig-app.mjs <worktree> <app-dir>
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [WT, APPDIR] = process.argv.slice(2);
if (!WT || !APPDIR) {
	console.error("usage: make-rig-app.mjs <worktree> <app-dir>");
	process.exit(2);
}
const wt = resolve(WT);
const appDir = resolve(APPDIR);
if (!existsSync(join(wt, "out/main/index.js"))) {
	console.error(`no build at ${wt}/out/main/index.js — build first`);
	process.exit(3);
}
rmSync(appDir, { recursive: true, force: true });
mkdirSync(appDir, { recursive: true });
// APFS clone: shares blocks with the worktree's out/ until written.
execFileSync("cp", ["-Rc", join(wt, "out"), join(appDir, "out")]);
symlinkSync(join(wt, "node_modules"), join(appDir, "node_modules"));
writeFileSync(
	join(appDir, "package.json"),
	JSON.stringify(
		{ name: "read-ack-rig-app", version: "0.0.0", private: true, main: "out/main/index.js" },
		null,
		2,
	),
);

const bundle = join(appDir, "out/main/index.js");
const data = readFileSync(bundle, "utf8");
const BEFORE = `      if (!owner || owner.isDestroyed() || !owner.isVisible() || owner.isMinimized() || !owner.isFocused()) {`;
const AFTER = `      if (false) { /* rig: foreground gate lifted (make-rig-app.mjs) */`;
const hits = data.split(BEFORE).length - 1;
if (hits !== 1) {
	console.error(`guard site found ${hits} times (expected exactly 1) — aborting`);
	process.exit(4);
}
writeFileSync(bundle, data.replace(BEFORE, AFTER));
console.log(`rig app at ${appDir}`);
console.log(`patched ${bundle}`);
console.log(`- ${BEFORE.trim()}`);
console.log(`+ ${AFTER.trim()}`);
