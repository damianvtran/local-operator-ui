import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * The palette's two chords, across the process boundary that splits them.
 *
 * `Cmd/Ctrl+P` is decided in MAIN (a `before-input-event` hook, which is where
 * it has always been) and arrives in the renderer as an IPC message; `Cmd/Ctrl+K`
 * is decided in the RENDERER, because a canvas editor can claim it and main
 * cannot ask. Each half keeps working when the other is broken — main swallows
 * the press and sends into an empty room, or the renderer listens for a message
 * nothing sends — so a change to one side can kill a chord silently.
 *
 * It happened: the port to the renderer's own listener dropped the IPC
 * subscription with the component it had lived in, `Cmd+P` stopped opening
 * anything, and every suite stayed green because nothing asserted the pair
 * (round 1, R-1). This file is that assertion, read off the sources rather than
 * rendered, because the question is whether both halves exist at all.
 */

const read = (path) => readFileSync(path, "utf8");

/*
 * Comments are stripped before matching, and the RECEIVER is named.
 *
 * Both matter, and the review round that asked for this named why: a raw-text
 * match for the channel also matched `window.api.ipcRenderer.on(...)` — a
 * receiver whose whitelist (`preload/index.ts`, `validChannels`) cannot carry
 * this channel and whose `on` returns nothing — so a one-token swap would have
 * re-killed `Cmd/Ctrl+P` with every suite green. And a commented-out
 * subscription satisfied the subscription and teardown patterns both.
 */
const code = (path) =>
	read(path)
		.split("\n")
		.filter((line) => {
			const trimmed = line.trim();
			return !(
				trimmed.startsWith("//") ||
				trimmed.startsWith("*") ||
				trimmed.startsWith("/*")
			);
		})
		.join("\n");

const MAIN = code("src/main/index.ts");
const HOOK = code(
	"src/renderer/src/features/command-palette/use-command-palette-shortcut.ts",
);
const APP = code("src/renderer/src/app.tsx");
const SHORTCUT = code(
	"src/renderer/src/features/command-palette/palette-shortcut.ts",
);

test("main sends the palette's own channel for Cmd/Ctrl+P", () => {
	assert.match(
		MAIN,
		/webContents\.send\(\s*"toggle-command-palette"\s*\)/,
		"main must keep sending `toggle-command-palette`; if the chord moved, both docs and the renderer's subscription move with it",
	);
	assert.match(
		MAIN,
		/input\.key\.toLowerCase\(\) === "p"/,
		"the Cmd/Ctrl+P branch is what sends it",
	);
});

test("main does NOT bind Cmd/Ctrl+K, which the renderer owns", () => {
	/*
	 * Two owners for one keystroke toggles twice and the palette never opens, and
	 * main cannot ask whether an editor claimed the key: `before-input-event`
	 * fires before the renderer sees it.
	 */
	assert.doesNotMatch(
		MAIN,
		/input\.key\.toLowerCase\(\) === "k"/,
		"Cmd/Ctrl+K must stay out of the main process's hook",
	);
	assert.match(
		SHORTCUT,
		/(key|code)\s*(===|\.toLowerCase\(\)\s*===)\s*"k"/,
		"the renderer's predicate is where Cmd/Ctrl+K is decided",
	);
});

test("something in the renderer subscribes to the channel main sends on", () => {
	assert.match(
		HOOK,
		/window\.electron\.ipcRenderer\.on\(\s*"toggle-command-palette"\s*,\s*toggleCommandPalette\s*,?\s*\)/,
		"the hook must subscribe on the bridge that can carry this channel, naming the channel main sends on AND the store's toggle as the handler",
	);
	/*
	 * The callback matters, not just the channel: `.on("toggle-command-palette",
	 * () => {})` satisfies a channel-only match with the chord dead, which is the
	 * same defect wearing a subscription's clothes (round 3's review).
	 */
	assert.doesNotMatch(
		HOOK,
		/toggle-command-palette"\s*,\s*\(\s*\)\s*=>/,
		"an empty handler answers the chord with nothing",
	);
	/*
	 * Not `window.api`: that bridge's `validChannels` whitelist does not include
	 * this channel, so its `on` registers nothing and returns undefined — the
	 * subscription would be a line that does nothing and says nothing.
	 */
	assert.doesNotMatch(
		HOOK,
		/window\.api\.ipcRenderer\.on[\s\S]{0,80}toggle-command-palette/,
		"`toggle-command-palette` is not on the api bridge's whitelist",
	);
	/*
	 * And it must be mounted by the shell, not merely defined: a subscription
	 * inside a component that is unmounted while the palette is closed answers
	 * nothing, which is the same defect one step further along.
	 */
	assert.match(
		APP,
		/useCommandPaletteShortcut\(\)/,
		"the app shell mounts the hook",
	);
});

test("the subscription is torn down, so a remount cannot double-toggle", () => {
	assert.match(
		HOOK,
		/unsubscribe\?\.\(\)|unsubscribe\(\)/,
		"the unsubscribe `ipcRenderer.on` returns must be called on cleanup",
	);
});

/*
 * Two geometric invariants the UX round had to find by driving the app at a
 * window size nobody had tried (900x600), because both are invisible at the size
 * the committed frames use. Neither needs a browser to assert.
 */

/** The two full-bleed bands, named once: every assertion below reads them. */
const BANDS = [
	"src/renderer/src/shared/components/common/connectivity-banner.tsx",
	"src/renderer/src/shared/components/common/backend-compatibility-banner.tsx",
];

/**
 * The surfaces the shell mounts that declare a stacking level of their own.
 *
 * Named rather than discovered by scanning `src/`: a new global scan is a second
 * way of asking a question this file already asks, and a list a reviewer can check
 * is what keeps the comparison honest. `z-[1300]`/`z-[1301]` is the canvas inline
 * editor, `z-50` is the update notification.
 */
const SHELL_SURFACES = [
	"src/renderer/src/app.tsx",
	"src/renderer/src/shared/components/common/update-notification.tsx",
	"src/renderer/src/features/chat/components/canvas/inline-edit.tsx",
	...BANDS,
];

/** The source with its comments blanked, so a level named in prose is not a declaration. */
function withoutComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

test("the palette owns the screen over the app's full-bleed bands", () => {
	/*
	 * WHAT THIS USED TO BE, and why it is the same invariant in a new shape. The
	 * band was `fixed inset-x-0 top-0` and 68px tall and the dialog is centred, so
	 * at a window under ~638 CSS px the two overlapped and the band painted over
	 * the query field: the user typing into a field they could not see (UX round
	 * 1, U1). The band is the shell's FIRST CHILD in flow since D9
	 * (`docs/evidence/band-occlusion/`), so it carries no stacking level at all
	 * and that overlap is impossible by construction - the assertion is kept
	 * rather than deleted because the failure it was written for was real and
	 * invisible at the captured window size, and the property that keeps it
	 * impossible is a pairing this can still falsify: no band declares a level,
	 * and the modal declares one above every level the shell itself declares.
	 */
	for (const file of BANDS) {
		const source = read(file);
		/*
		 * Matched on the ATTRIBUTE rather than on the file: these components carry
		 * their old spelling in a comment (the change's own record of what moved),
		 * and a scan of the whole text would read that comment as a live class.
		 */
		assert.doesNotMatch(
			source,
			/className="[^"]*\bz-(?:\[?\d)/,
			`${file}: an in-flow band must declare no stacking level of its own`,
		);
	}
	const palette = read(
		"src/renderer/src/features/command-palette/components/command-palette.tsx",
	);
	const paletteZ = palette.match(/className="z-\[(\d+)\]/);
	assert.ok(paletteZ, "the palette must declare a stacking level of its own");
	/*
	 * The bar is the shell's OWN highest declared level, read from the surfaces the
	 * shell mounts rather than from a constant: `z-[1300]`/`z-[1301]` (the canvas
	 * inline editor) and `z-50` (the update notification) are the other levels a
	 * screen-owning modal has to clear, and comparing against them is what makes
	 * `> 0` a claim about this app rather than about arithmetic. Comments are
	 * stripped so a level named in prose is not a declaration.
	 */
	const declared = SHELL_SURFACES.flatMap((file) =>
		[...withoutComments(read(file)).matchAll(/\bz-(?:\[(\d+)\]|(\d+))/g)].map(
			(match) => Number(match[1] ?? match[2]),
		),
	);
	const highest = declared.length ? Math.max(...declared) : 0;
	assert.ok(
		Number(paletteZ[1]) > highest,
		`the palette paints at ${paletteZ[1]} and the shell's highest declared level is ${highest}: the modal must own the screen`,
	);
});

test("the bands are in flow, and the region keeps the window minus their height", () => {
	/*
	 * THE ACCEPTANCE POINT NO OTHER GATE WATCHES. With no band up the region is the
	 * WHOLE window, and it is the whole window because both bands `return null`
	 * rather than because a `fixed` band happened to take no layout space - so a
	 * revert of the shell restructure, or of a band's `fixed inset-x-0 top-0 w-full`,
	 * would put the covered rows back with every other check in this file green.
	 * Three facts, each of which the reviewed change is the only reason for: the
	 * band's own class attribute is not positioned, the region below them is
	 * `flex-1 min-h-0`, and the two bands are the shell root's first children.
	 */
	/*
	 * THE REACH OF THIS, which is a literal class attribute and nothing else (review
	 * round 2, F5). `className="..."` is what it reads, so a band that took its
	 * positioning through `cn(...)` - this repo's route for conditional classes - would
	 * satisfy this assertion without carrying the class in an attribute at all. That is
	 * complete TODAY and only today: both band files use literal class names (0 `cn(`
	 * calls), and the day one of them grows a conditional class this assertion, the
	 * palette's level comparison and the first-children check below all need a scan of
	 * the class surface rather than of the attribute. Stated here so the limit is read
	 * beside the assertion rather than discovered when it matters.
	 */
	for (const file of BANDS) {
		assert.doesNotMatch(
			read(file),
			/className="[^"]*\bfixed\b/,
			`${file}: a band must not be positioned (it takes its height out of the shell)`,
		);
	}
	const app = read("src/renderer/src/app.tsx");
	const region = [...app.matchAll(/className="([^"]*)"/g)]
		.map((match) => match[1])
		.find(
			(classes) =>
				classes.includes("flex-1") &&
				classes.includes("min-h-0") &&
				classes.includes("overflow-hidden"),
		);
	assert.ok(
		region,
		"the region below the bands must be `flex-1 min-h-0 overflow-hidden`: `h-screen` on it would make the shell taller than the window whenever a band is up",
	);
	assert.match(
		app,
		/className="relative flex h-screen flex-col overflow-hidden"/,
		"the shell root must be a COLUMN, or the bands and the region share a row",
	);
	const order = [
		"<ConnectivityBanner />",
		"<BackendCompatibilityBanner />",
		'className="flex min-h-0 flex-1 overflow-hidden"',
	].map((needle) => app.indexOf(needle));
	assert.ok(
		order.every((at) => at > -1) && order[0] < order[1] && order[1] < order[2],
		`the two bands must be the shell root's FIRST children, above the region (offsets ${order.join(", ")})`,
	);
});

test("the key listener owns the field's keys, not the dialog's", () => {
	/*
	 * The listener is on `window`, so without this gate Tab-to-the-Clear-button
	 * followed by Enter ran a row instead of the focused control, and
	 * Shift/Alt+Arrow were taken from the caret (UX round 1, U2 and U3).
	 */
	const palette = read(
		"src/renderer/src/features/command-palette/components/command-palette.tsx",
	);
	assert.match(
		palette,
		/event\.target[^\n]*?INPUT_ID/,
		"the handler must stand down unless the event's target is the query field",
	);
});
