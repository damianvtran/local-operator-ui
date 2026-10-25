import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * S5: TOOLTIPS NEVER PAUSE THE BROWSER VIEW — the kind table, not a measurement.
 *
 * THE CHANGE THIS FILE PINS. Until S5 the shared `Tooltip` registered with the
 * browser-view policy for every tooltip that reached the native view: hovering a
 * sidebar row with the Browser route open hid the page, and once hidden the
 * tooltip was readable over a blank surface. Both halves were wrong. The ruling
 * is that a tooltip, hover card or toast NEVER pauses, by kind; placement is the
 * channel (the conversation flyout opens below its row, the panel rail drops its
 * tooltip), and `data-suppressed-by` can never name a tooltip.
 *
 * WHY THE ASSERTIONS ARE MOSTLY PURE. The policy's decision for a kind is a
 * value, not a measurement: what a menu does depends on its painted rect, and
 * that half belongs to the native probe (`browser-chrome-s4b-probe`'s S5 rows).
 * What is decidable here — and what a regression would silently break — is the
 * TABLE, the registry's refusal of a never-kind, the release path, and the call
 * sites' placement.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export { OVERLAY_KIND_CLASS, overlayClassOfId, isPausingOverlayId, suppressBrowserView, suppressedOverlayIds, browserViewSuppressed } from "./src/renderer/src/shared/browser-view-policy";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const policy = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const read = (path) => readFileSync(path, "utf8");

test("the kind table is exhaustive and only four names never pause", () => {
	const never = Object.entries(policy.OVERLAY_KIND_CLASS)
		.filter(([, klass]) => klass === "never")
		.map(([kind]) => kind)
		.sort();
	assert.deepEqual(never, [
		"address-suggestions-native",
		"hover-card",
		"toast",
		"tooltip",
	]);
	// Every other entry has a class the registry knows how to treat.
	for (const [kind, klass] of Object.entries(policy.OVERLAY_KIND_CLASS)) {
		assert.ok(
			["pause-modal", "pause-measured", "own-state", "never"].includes(klass),
			`${kind}: ${klass}`,
		);
	}
});

test("a tooltip, hover card or toast id is not a pausing id", () => {
	for (const kind of ["tooltip", "hover-card", "toast"]) {
		assert.equal(policy.overlayClassOfId(`${kind}:x:y`), "never");
		assert.equal(policy.isPausingOverlayId(`${kind}:x:y`), false);
	}
	// The native suggestion child is above a LIVE page and is not a DOM overlay.
	assert.equal(
		policy.isPausingOverlayId("address-suggestions-native:x"),
		false,
	);
	// Unknown prefixes are refused too: a hand-written id cannot bypass the table.
	assert.equal(policy.isPausingOverlayId("something-else:x"), false);
});

test("registering a never-kind is a no-op; nothing names a tooltip", () => {
	const before = policy.suppressedOverlayIds();
	// In this node bundle `import.meta.env` is absent, so the dev throw is not the
	// path under test; the production no-op is, and either way the id must not
	// reach the snapshot.
	policy.suppressBrowserView("tooltip:x:1")();
	assert.deepEqual(policy.suppressedOverlayIds(), before);
	assert.equal(policy.browserViewSuppressed(), false);
});

test("a dialog registers while open and releases on close", () => {
	assert.equal(policy.browserViewSuppressed(), false);
	const release = policy.suppressBrowserView("dialog:test:dialog");
	assert.equal(policy.browserViewSuppressed(), true);
	assert.deepEqual(policy.suppressedOverlayIds(), ["dialog:test:dialog"]);
	release();
	assert.equal(policy.browserViewSuppressed(), false);
	// The sweep the paused state relies on: every live id names a pausing kind.
	for (const id of [
		"menu:test",
		"sheet:test",
		"browser-state:start-page:test",
	]) {
		const off = policy.suppressBrowserView(id);
		for (const live of policy.suppressedOverlayIds())
			assert.equal(policy.isPausingOverlayId(live), true, live);
		off();
	}
	assert.deepEqual(policy.suppressedOverlayIds(), []);
});

test("the shared Tooltip no longer imports or registers with the policy", () => {
	const tooltip = read("src/renderer/src/shared/components/ui/tooltip.tsx");
	assert.doesNotMatch(tooltip, /browser-view-policy/);
	assert.doesNotMatch(tooltip, /overlayName/);
	assert.doesNotMatch(tooltip, /useSuppressBrowserView/);
});

test("the sidebar conversation flyout opens below its row, inside the sidebar", () => {
	const sidebar = read(
		"src/renderer/src/features/chat/components/chat-sidebar.tsx",
	);
	const block = sidebar.slice(
		sidebar.indexOf("const withFlyout"),
		sidebar.indexOf("const withFlyout") + 3000,
	);
	assert.match(block, /side="bottom"/);
	assert.match(block, /align="start"/);
	assert.doesNotMatch(block, /^\s*side="right"$/m);
	assert.doesNotMatch(block, /overlayName=/);
	assert.match(block, /w-\(--radix-tooltip-trigger-width\)/);
});

test("the panel rail's tooltip is conditional on a mounted browser view", () => {
	const rail = read(
		"src/renderer/src/shared/components/navigation/panel-rail-item.tsx",
	);
	// A tooltip may not pause, so with a view under the pane the label is clipped;
	// the wrapper mounts it only when no surface is mounted, and `aria-label`
	// carries the name then. On every other route the tooltip is unchanged. The
	// side is direction-aware: in RTL the rail stands at the window's left, so the
	// label has to open toward the pane on its right.
	assert.match(
		rail,
		/<BrowserSafeTooltip\s+content=\{label\}\s+side=\{direction === "rtl" \? "right" : "left"\}/,
	);
	assert.doesNotMatch(rail, /useSuppressBrowserView/);
	assert.match(rail, /aria-label=\{ariaLabel \?\? label\}/);
	// The wrapper itself is the one place the presence decision lives, and it
	// must not import the pause path beyond the read-only presence hook.
	const wrapper = read(
		"src/renderer/src/shared/components/ui/browser-safe-tooltip.tsx",
	);
	assert.match(wrapper, /useBrowserViewPresent/);
	assert.doesNotMatch(wrapper, /suppressBrowserView/);
});

test("the collapsed sidebar and profile tooltips are restored conditionally", () => {
	for (const path of [
		"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx",
		"src/renderer/src/shared/components/navigation/user-profile-sidebar.tsx",
	]) {
		const source = read(path);
		assert.match(source, /<BrowserSafeTooltip\s+content=/);
	}
});

test("BrowserSafeTooltip keeps ONE tree and uses the Tooltip's suppressed prop (U8)", () => {
	const wrapper = read(
		"src/renderer/src/shared/components/ui/browser-safe-tooltip.tsx",
	);
	assert.match(
		wrapper,
		/suppressed=\{viewPresent \|\| Boolean\(props\.suppressed\)\}/,
	);
	assert.match(wrapper, /discardWhileSuppressed=\{viewPresent\}/);
	assert.doesNotMatch(
		wrapper,
		/<\/>/,
		"a bare-children branch replaces the trigger and drops focus",
	);
});

test("the surface still publishes why the page is hidden", () => {
	const surface = read(
		"src/renderer/src/features/browser/components/browser-surface.tsx",
	);
	assert.match(surface, /data-suppressed-by=\{suppressedBy\}/);
});
