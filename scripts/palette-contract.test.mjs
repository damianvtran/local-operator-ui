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
		/window\.electron\.ipcRenderer\.on\(\s*"toggle-command-palette"/,
		"the hook must subscribe on the bridge that can carry this channel, naming the channel main sends on",
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

test("the palette paints above the app's connection banner", () => {
	/*
	 * The banner is `fixed inset-x-0 top-0` and 68px tall; the dialog is centred.
	 * At a window under ~638 CSS px the two overlap, and the banner used to paint
	 * over the query field — the user typing into a field they could not see (UX
	 * round 1, U1).
	 */
	const banner = read("src/renderer/src/shared/components/common/connectivity-banner.tsx");
	const palette = read(
		"src/renderer/src/features/command-palette/components/command-palette.tsx",
	);
	const bannerZ = banner.match(/z-(?:\[(\d+)\]|(\d+))/);
	const paletteZ = palette.match(/className="z-\[(\d+)\]/);
	assert.ok(bannerZ, "the banner declares a stacking level");
	assert.ok(paletteZ, "the palette must declare one that clears it");
	const bannerLevel = Number(bannerZ[1] ?? bannerZ[2]);
	const paletteLevel = Number(paletteZ[1]);
	assert.ok(
		paletteLevel > bannerLevel,
		`the palette paints at ${paletteLevel} and the banner at ${bannerLevel}: the modal must own the screen`,
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
