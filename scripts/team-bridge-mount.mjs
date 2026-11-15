/**
 * THE NODE THE APP MOUNTS ON, read from the app's own source instead of guessed.
 *
 * WHY THIS EXISTS (QA round 3, finding Q3-1 on ui#1889). The bench's `waitForShell`
 * gated "the shell is up" on `document.getElementById("root")`, but the renderer
 * mounts on `#app` (`src/renderer/index.html` declares `<div id="app">`, and
 * `src/renderer/src/main.tsx` hands that node to `createRoot`). The check read -1
 * forever, so every `instant-load` run timed out in `mount` on an app that had
 * started fine. A hardcoded copy of the id is a second source of truth that can
 * drift silently; this module reads the first one.
 *
 * CONSTRAINTS.
 * - `main.tsx`'s `createRoot(document.getElementById("..."))` names the node React
 *   actually renders into, and `index.html` must declare it. Both are checked, and
 *   a mismatch or an unparseable source THROWS: a bench that cannot name the mount
 *   node must refuse to run, not poll a node that will never fill.
 * - `--root` lets the bench measure another checkout, so the id is read from THAT
 *   checkout's sources, never this script's.
 * - The probe is a page-side expression string (it runs through CDP `evaluate`), so
 *   tests evaluate the very same string against a fake `document`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const RENDERER_HTML = join("src", "renderer", "index.html");
export const RENDERER_ENTRY = join("src", "renderer", "src", "main.tsx");

/** The id `main.tsx` passes to `createRoot`, or null when it cannot be read. */
export function entryMountId(source) {
	const match = source.match(
		/createRoot\(\s*document\.getElementById\(\s*["'`]([^"'`]+)["'`]\s*\)/,
	);
	return match ? match[1] : null;
}

/** Whether `index.html` declares an element with this id. */
export function htmlDeclaresId(html, id) {
	const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`\\sid\\s*=\\s*["']${escaped}["']`).test(html);
}

/** The app's mount id for the checkout at `root`; throws when it cannot be proven. */
export function appMountId(root) {
	const entry = readFileSync(join(root, RENDERER_ENTRY), "utf8");
	const id = entryMountId(entry);
	if (!id)
		throw new Error(
			`could not find createRoot(document.getElementById(...)) in ${RENDERER_ENTRY}`,
		);
	const html = readFileSync(join(root, RENDERER_HTML), "utf8");
	if (!htmlDeclaresId(html, id))
		throw new Error(
			`${RENDERER_ENTRY} mounts on #${id}, but ${RENDERER_HTML} declares no such element`,
		);
	return id;
}

/** Page-side expression: the mount node's child count, -1 when the node is absent. */
export function mountProbe(id) {
	return `(document.getElementById(${JSON.stringify(id)})?.childElementCount ?? -1)`;
}

/** The shell counts as mounted once React has rendered at least one child. */
export function isMounted(count) {
	return typeof count === "number" && count > 0;
}
