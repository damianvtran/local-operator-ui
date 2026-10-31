/**
 * The desktop test inventory, DERIVED from the tree instead of hand-kept.
 *
 * WHY THIS EXISTS. `package.json`'s `scripts.test:desktop` used to be one ~23 KB
 * line naming every desktop test file. Every pull request that added a test file
 * rewrote that same line, so any two of them conflicted, and a pull request
 * waiting on the ~60-minute CI lost the race each time a sibling merged: on
 * 2026-10-31 one pull request (#1466) was re-conflicted seven times in about five
 * hours with every review round already terminal. A hand list also hid the
 * opposite failure: nine `scripts/i18n/*.test.mjs` files were in no suite at all,
 * because the inventory gate only looked at the top level of `scripts/`.
 *
 * THE RULE. Every `*.test.mjs` under `scripts/` (recursively) is a desktop test,
 * unless `EXEMPT` below names it with the reason and the place it runs instead.
 * Adding a test file therefore edits nothing shared; exempting one is the
 * deliberate, reviewed act.
 *
 * WHY A WALK AND NOT A CHECKED-IN GENERATED LIST. A generated list still has to
 * be rewritten by every pull request that adds a test, so it moves the conflict
 * to another file instead of removing it. The trade-off of the walk, accepted on
 * purpose: a new file is included EAGERLY - good for coverage (nothing can be
 * forgotten), bad if a file needs special handling (it runs in the shared lanes
 * until somebody adds it to `EXEMPT`). A heavy or display-bound suite must be
 * exempted in the same pull request that adds it; review is the step that
 * catches it, as it was for the hand list.
 *
 * WHAT STILL FAILS CLOSED. A path that is not a plain relative `.test.mjs` name,
 * a symlink anywhere under `scripts/` (the walk does not follow links, so a link
 * would otherwise drop or alias files silently), an `EXEMPT` entry that names no
 * existing test file (a typo or a stale claim about where a suite runs), and an
 * exemption without a reason. Nothing here imports a test, spawns a process or
 * writes a file; it uses Node builtins only, so the CI result job can call it
 * without `pnpm install`.
 */
import { lstatSync, readdirSync } from "node:fs";
import { constants } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "./entry-point.mjs";

/** The tree the inventory is derived from, repository-relative. */
export const TEST_ROOT = "scripts";

/**
 * The ONLY accepted `scripts.test:desktop` value. It is a constant on purpose:
 * the line no longer changes when a test is added, which is the whole fix, and
 * the planner refuses any other value so a branch still carrying the old literal
 * list fails loudly instead of being half-honoured.
 */
export const DESKTOP_COMMAND = "node scripts/desktop-test-inventory.mjs run";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The guarded runner every desktop file goes through; its CLI (argv = files,
// plus `--test-concurrency`) is unchanged by deriving the list.
const RUNNER = "scripts/run-desktop-tests.mjs";

const TEST_FILE = /\.test\.mjs$/;
const SAFE_PATH = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.test\.mjs$/;

/**
 * Files that deliberately do not run in the desktop suite, and where they do run.
 *
 * Each reason names the command a reader can run to see it, or says plainly
 * that nothing runs it — which is the honest answer for ONE entry below
 * (`session-cookie-electron.test.mjs`), and a gap in the repository rather than
 * in this list. (Round 4, R4-4: this sentence said "the two at the end" while
 * exactly one entry carried that reason.)
 *
 * Moved here from `test-inventory.test.mjs` so the planner and that gate read
 * ONE table: an exemption the runner honours but the gate does not know about
 * (or the reverse) is exactly the drift the gate exists to catch.
 */
export const EXEMPT = Object.freeze({
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
});

/**
 * Every `*.test.mjs` path under `TEST_ROOT`, sorted, exemptions INCLUDED.
 *
 * `lstat`-based and non-following: a symlinked file or directory throws rather
 * than being skipped, so a link can neither hide a suite nor run one twice.
 */
export function walkTestFiles(root) {
	const found = [];
	const visit = (relativeDir) => {
		for (const entry of readdirSync(join(root, relativeDir), {
			withFileTypes: true,
		})) {
			const path = `${relativeDir}/${entry.name}`;
			if (entry.isSymbolicLink())
				throw new Error(
					`Symlink under ${TEST_ROOT}/ cannot be inventoried: ${path}`,
				);
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile() && TEST_FILE.test(entry.name)) found.push(path);
		}
	};
	if (!lstatSync(join(root, TEST_ROOT)).isDirectory())
		throw new Error(`Missing ${TEST_ROOT}/ directory`);
	visit(TEST_ROOT);
	return found.sort();
}

/**
 * The desktop inventory from a list of candidate test paths: drop `EXEMPT`,
 * refuse unsafe, duplicate or stale input, return a sorted list.
 *
 * Pure, so the planner can feed it either a real walk or the path set of an
 * immutable `git ls-tree` export (metadata mode) and get the same answer.
 */
export function selectDesktopTests(paths, exempt = EXEMPT) {
	for (const file of paths) {
		if (
			!SAFE_PATH.test(file) ||
			file.split("/").some((p) => p === "." || p === "..") ||
			!file.startsWith(`${TEST_ROOT}/`)
		)
			throw new Error(
				`Unsafe/unsupported test path ${JSON.stringify(file)}: no flags, quotes, glob, shell operators or traversal`,
			);
	}
	if (new Set(paths).size !== paths.length)
		throw new Error("Duplicate desktop test path");
	const present = new Set(paths);
	for (const [file, reason] of Object.entries(exempt)) {
		if (typeof reason !== "string" || !reason.trim())
			throw new Error(`EXEMPT entry has no reason: ${file}`);
		// A typo here would otherwise exempt nothing and say nothing.
		if (!present.has(file))
			throw new Error(`EXEMPT entry names no existing test file: ${file}`);
	}
	const files = paths.filter((file) => !Object.hasOwn(exempt, file)).sort();
	if (!files.length) throw new Error("Empty desktop test inventory");
	return files;
}

/** The desktop inventory of a real checkout. */
export function discoverDesktopTests(root = ROOT) {
	return selectDesktopTests(walkTestFiles(root));
}

/**
 * Spawn `node <argv>` in `cwd`, forward SIGINT/SIGTERM, resolve its exit code.
 *
 * Shared by the local full-suite entry below and the CI shard `run` mode in
 * `desktop-test-shards.mjs`, so there is one way a desktop list reaches the
 * runner. The runner owns concurrency, memory, lane and hardlink protections.
 */
export async function runNode(argv, cwd) {
	const { spawn } = await import("node:child_process");
	const child = spawn(process.execPath, argv, { cwd, stdio: "inherit" });
	const forward = (signal) => child.kill(signal);
	const interrupt = () => forward("SIGINT");
	const terminate = () => forward("SIGTERM");
	process.on("SIGINT", interrupt);
	process.on("SIGTERM", terminate);
	try {
		return await new Promise((resolveExit, reject) => {
			child.once("error", reject);
			child.once("exit", (code, signal) =>
				resolveExit(code ?? 128 + (constants.signals[signal] ?? 1)),
			);
		});
	} finally {
		process.off("SIGINT", interrupt);
		process.off("SIGTERM", terminate);
	}
}

/**
 * `list` prints the inventory (one path per line, nothing run); `run` hands the
 * WHOLE inventory to the guarded runner in ONE spawn, so its single `--import`
 * guard covers every file, exactly as the literal list did. Extra arguments
 * after `run` (e.g. `--test-concurrency=12`) reach the runner unchanged.
 */
export async function main(args) {
	const [mode, ...rest] = args;
	// Refuse a bad mode before the walk, so the refusal is the same answer on
	// any tree (entry-point.test.mjs drives exactly this through a symlink).
	if (!(mode === "run" || (mode === "list" && !rest.length)))
		throw new Error("Expected `list` or `run [runner flags]`");
	const files = discoverDesktopTests(ROOT);
	if (mode === "list") {
		console.log(files.join("\n"));
		return 0;
	}
	return runNode([RUNNER, ...rest, ...files], ROOT);
}

if (isEntryPoint(import.meta.url)) {
	try {
		process.exitCode = await main(process.argv.slice(2));
	} catch (error) {
		console.error(`Desktop test inventory failed: ${error.message}`);
		process.exitCode = 1;
	}
}
