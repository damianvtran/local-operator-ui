/**
 * THE FAIL-ON-MAIN PROBE (agent review round 1, F3): the readings cells (A) and
 * (C) of `scripts/right-slot-memory.test.mjs` discriminate ON - the switch that
 * must not carry a pane, and the fleet drawer's close that must restore the
 * LATTER conversation's pane - driven against MAIN's own stores, which have no
 * per-conversation memory at all.
 *
 * WHY THIS FILE EXISTS. The test header and the PR body cited a throwaway probe
 * for these two readings, and a reader could not re-run it: `grep` found the
 * name only in the header. This is that probe, committed, with its captured
 * output beside it (`probe-main-failures.json`).
 *
 * WHAT IT DOES. Given a checkout of the tree to probe (the evidence set's
 * `before` arm, `origin/main` @ `15a7a4ed522`), it bundles THAT tree's stores
 * with esbuild from its own `node_modules` (the evidence recipe symlinks this
 * checkout's in), drives them through the same public API the two cells use,
 * and prints one JSON document: the expected reading, the actual reading and a
 * per-cell verdict. It EXITS NON-ZERO when a cell fails - which is the point on
 * `main`, where both cells fail: the flag follows the user onto a conversation
 * that never opened a pane, and the drawer's close puts the FIRST conversation's
 * pane back. Run against this branch's tree the same probe exits 0, because
 * both cells pass there; the committed capture is the `main` run.
 *
 * Usage:
 *   node probe-main-failures.mjs <path-to-main-worktree>
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const worktree = process.argv[2];
if (!worktree) {
	console.error("usage: node probe-main-failures.mjs <path-to-main-worktree>");
	process.exit(2);
}
const ROOT = resolve(worktree);
const probeRepo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const esbuildEntry = [
	join(ROOT, "node_modules/esbuild/lib/main.js"),
	join(probeRepo, "node_modules/esbuild/lib/main.js"),
].find((candidate) => existsSync(candidate));
if (!esbuildEntry) {
	console.error(`no esbuild found under ${ROOT} or ${probeRepo}`);
	process.exit(2);
}
const { build } = await import(pathToFileURL(esbuildEntry).href);

/* The stores hydrate from `localStorage`; node has none, so the probe supplies the same shim the unit cells do. */
const memory = new Map();
globalThis.localStorage = {
	getItem: (key) => (memory.has(key) ? memory.get(key) : null),
	setItem: (key, value) => void memory.set(key, String(value)),
	removeItem: (key) => void memory.delete(key),
	clear: () => memory.clear(),
	key: (index) => [...memory.keys()][index] ?? null,
	get length() {
		return memory.size;
	},
};

let ref = null;
try {
	ref = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim();
} catch (error) {
	ref = null;
}

const STORES = [
	'export { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";',
	'export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";',
];
/*
 * The follower only exists ON THE BRANCH. `main` has no `right-slot-follower`
 * module, so the first build throws there and the second (stores-only) carries
 * the probe; on the branch the follower is installed, because without it the
 * slot is UNBOUND and the setters fall back to the global behaviour this probe
 * exists to distinguish (`right-slot-memory.test.mjs` installs it the same way,
 * for the same reason).
 */
const WITH_FOLLOWER = [
	...STORES,
	'export { installRightSlotMemoryFollower } from "./src/renderer/src/shared/store/right-slot-follower";',
];

const buildBundle = (exports) =>
	build({
		stdin: {
			contents: exports.join("\n"),
			resolveDir: ROOT,
			loader: "ts",
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		alias: {
			"@shared": join(ROOT, "src/renderer/src/shared"),
			"@features": join(ROOT, "src/renderer/src/features"),
			"@assets": join(ROOT, "src/renderer/src/assets"),
		},
		logLevel: "silent",
	});

let bundle;
try {
	bundle = await buildBundle(WITH_FOLLOWER);
} catch (error) {
	bundle = await buildBundle(STORES);
}
const { useUiPreferencesStore, useCanonicalSessionsStore, installRightSlotMemoryFollower } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
installRightSlotMemoryFollower?.();

const prefs = () => useUiPreferencesStore.getState();
const sessions = () => useCanonicalSessionsStore.getState();

/** All flags down, the way each cell's own `reset()` starts. */
const reset = () => {
	prefs().setCanvasOpen(false);
	prefs().setRunPanelOpen(false);
	prefs().setBrowserPaneOpen(false);
	prefs().setConsolePaneOpen(false);
};

/*
 * CELL (A) - THE SWITCH. A pane opened on one conversation must not be there on
 * the next: the middle reading is the whole discrimination. On `main` the flag
 * is global, so it stays true; on the branch it projects the destination's own
 * (empty) memory.
 */
reset();
sessions().setActiveSession("probe:A");
prefs().setCanvasOpen(true);
sessions().setActiveSession("probe:B");
const cellA = {
	expected: { isCanvasOpen: false },
	actual: { isCanvasOpen: prefs().isCanvasOpen },
	note: "a conversation that never opened a pane must not show one",
};
cellA.pass = cellA.actual.isCanvasOpen === cellA.expected.isCanvasOpen;

/*
 * CELL (C) - THE FLEET DRAWER. Its discrimination is the MIDDLE reading, not the
 * close: after hopping back to A while B's browser was the last pane opened,
 * the branch re-projects A's own memory (A's canvas is back, B's browser is
 * gone), while `main` - no memory - still shows B's browser where A's canvas
 * should be. The close then gives B its own pane back on both trees (on `main`
 * because the evicted pane it restores happens to be the same browser the flag
 * never dropped), so the close is checked but is not the discriminating half.
 */
reset();
sessions().setActiveSession("probe:C-A");
prefs().setCanvasOpen(true);
sessions().setActiveSession("probe:C-B");
prefs().setBrowserPaneOpen(true);
sessions().setActiveSession("probe:C-A");
const cellCBack = {
	expected: { isCanvasOpen: true, isBrowserPaneOpen: false },
	actual: {
		isCanvasOpen: prefs().isCanvasOpen,
		isBrowserPaneOpen: prefs().isBrowserPaneOpen,
	},
	note: "back on A the canvas must return; `main` still shows the other conversation's browser",
};
cellCBack.pass =
	cellCBack.actual.isCanvasOpen === cellCBack.expected.isCanvasOpen &&
	cellCBack.actual.isBrowserPaneOpen === cellCBack.expected.isBrowserPaneOpen;

prefs().setAskDrawerOpen(true, "fleet");
sessions().setActiveSession("probe:C-B");
prefs().setAskDrawerOpen(false, "fleet");
const cellCClose = {
	expected: { isCanvasOpen: false, isBrowserPaneOpen: true },
	actual: {
		isCanvasOpen: prefs().isCanvasOpen,
		isBrowserPaneOpen: prefs().isBrowserPaneOpen,
	},
	note: "closing the drawer on B gives B its own browser back (true on both trees)",
};
cellCClose.pass =
	cellCClose.actual.isCanvasOpen === cellCClose.expected.isCanvasOpen &&
	cellCClose.actual.isBrowserPaneOpen === cellCClose.expected.isBrowserPaneOpen;

const cellC = { checks: { backOnA: cellCBack, closeOnB: cellCClose } };
cellC.pass = cellCBack.pass && cellCClose.pass;

const failures = [cellA, cellC].filter((cell) => !cell.pass).length;
console.log(
	JSON.stringify(
		{
			probed: "the two cells whose discrimination rides `right-slot-memory.test.mjs`'s (A) and (C)",
			ref,
			worktree: ROOT,
			cells: { A: cellA, C: cellC },
			verdict:
				failures === 0
					? "both cells PASS on this tree"
					: `FAIL-ON-THIS-TREE: ${failures} of 2 cells fail (the old global behaviour)`,
		},
		null,
		2,
	),
);
process.exit(failures === 0 ? 0 : 1);
