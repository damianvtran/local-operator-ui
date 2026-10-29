import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { inventory } from "./desktop-test-shards.mjs";

/*
 * Every `scripts/*.test.mjs` runs somewhere CI runs, or says why not.
 *
 * WHY THIS EXISTS. Two suites added by round 2 — the conflict-marker guard that
 * closed a BLOCKER and the receipt guard — were in no `run:` step of any
 * workflow, so both were inert: a guard that cannot fail is a comment. The
 * inverse gap is the same defect seen from the other side, because
 * `test:desktop` is a hand-kept list: dropping a file from it leaves the
 * neighbouring suites green and the drop invisible.
 *
 * The rule: every test file under `scripts/` is either named in
 * `package.json`'s `test:desktop`, or named in `EXEMPT` below with the reason it
 * runs elsewhere (or nowhere, which is itself worth recording).
 */

/**
 * Files that deliberately do not run in the desktop suite, and where they do run.
 *
 * Each reason names the command a reader can run to see it, or says plainly
 * that nothing runs it — which is the honest answer for ONE entry below
 * (`session-cookie-electron.test.mjs`), and a gap in the repository rather than
 * in this list. (Round 4, R4-4: this sentence said "the two at the end" while
 * exactly one entry carried that reason.)
 */
const EXEMPT = {
	"scripts/check-scripts-lint.test.mjs":
		"`node --test scripts/check-scripts-lint.test.mjs`, its own CI step (ci.yml).",
	"scripts/release-baseline.test.mjs":
		"the release-gate suite in ci.yml, run as one node --test invocation.",
	"scripts/upload-release.test.mjs":
		"the release-gate step in ci.yml, its own node --test invocation: it drives the attach path against a stub upload endpoint, which the desktop suite has no fixture for.",
	"scripts/release-candidate.test.mjs":
		"same release-gate step as release-baseline.",
	"scripts/entry-point.test.mjs": "same release-gate step as release-baseline.",
	"scripts/require-report.test.mjs":
		"same release-gate step as release-baseline.",
	"scripts/mac-build-arch.test.mjs":
		"the release-contracts step in ci.yml, its own node --test invocation: it is a contract over .github/workflows rather than over the app, and it reads them with electron-builder's js-yaml the way test-publish-workflow.mjs does.",
	"scripts/appimage-update-info.test.mjs":
		"the release-contracts step in ci.yml, its own node --test invocation: the ELF64 `.upd_info` patch/readback, the `.zsync` header checks and the `latest-linux.yml` entry check, over synthetic fixtures. The real download, `7z` and `zsyncmake` run in the linux build job itself, which no local suite can stand up.",
	"scripts/window-guards-electron.test.mjs":
		"`pnpm test:window-guards` - boots the REAL Electron (hidden window, own userData) against a hostile document; like the session-cookie suite it needs a display, so no CI step runs it.",
	"scripts/window-glass-cdp.test.mjs":
		"`pnpm test:window-glass` - boots the BUILT app headless and reads the glass's effective alpha back over CDP, so it needs `pnpm build` first (it skips with a stated reason when `out/` is absent) and, like the window-guards suite, a display on Linux; the pure decisions are in `window-glass.test.mjs`, which test:desktop does run.",
	"scripts/session-cookie-electron.test.mjs":
		"`pnpm test:session-cookies` — it boots the REAL Electron binary twice, which no CI step does today; a pre-existing gap, recorded rather than papered over.",
	"scripts/chat-tag-dialogs-immediate.test.mjs":
		"`pnpm test:tag-dialogs` — its own step in the Desktop Tests job (ci.yml), run BEFORE `pnpm test:desktop` so its process exits and releases memory first. It bundles the shipped renderer with esbuild and drives it in jsdom; inside the desktop lane its peak landed on the files already resident there and the process group was killed at 9.7 GB against the 7.8 GB budget (main's suite passes at 851aea1).",
};

test("every scripts/*.test.mjs is run by test:desktop or exempt with a reason", () => {
	const pkg = JSON.parse(readFileSync("package.json", "utf8"));
	const listed = new Set(inventory(pkg.scripts["test:desktop"]));
	const files = readdirSync("scripts")
		.filter((name) => name.endsWith(".test.mjs"))
		.map((name) => `scripts/${name}`)
		.sort();
	const missing = files.filter(
		(file) => !listed.has(file) && !(file in EXEMPT),
	);
	assert.deepEqual(
		missing,
		[],
		`a test file no CI step runs is a guard that cannot fail — add it to test:desktop or to EXEMPT with its reason:\n${missing.join("\n")}`,
	);
	// The table may not rot either: an exemption for a file that no longer
	// exists, or that is now listed, is a stale claim about where it runs.
	const stale = Object.keys(EXEMPT).filter(
		(file) => !files.includes(file) || listed.has(file),
	);
	assert.deepEqual(
		stale,
		[],
		"an EXEMPT entry must name an existing unlisted file",
	);
});
