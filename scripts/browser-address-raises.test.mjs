import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * S5: the row is permanent, so "raise" is a FOCUS REQUEST, not a mount.
 *
 * The S4b state machine (`planAddressRaise`) existed to order four outcomes —
 * start page's own field, Tier 2 fallback, refocus, raise — and every one of
 * those outcomes has been deleted with the popout. What must stay true is the
 * simpler contract this test pins:
 *
 *  - every entry point writes a nonce the always-mounted row applies, so there
 *    is exactly ONE address input and it cannot be "raised" into nothing;
 *  - the surface never grows a conditional row again (no popout, no fallback,
 *    no strip inert);
 *  - the start page has no field of its own and seeds the row from `refusedUrl`.
 */

const read = (path) => readFileSync(path, "utf8");
const code = (source) =>
	source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const surface = code(
	read("src/renderer/src/features/browser/components/browser-surface.tsx"),
);
const urlBar = code(
	read("src/renderer/src/features/browser/components/browser-url-bar.tsx"),
);
const chords = code(
	read("src/renderer/src/features/browser/hooks/use-browser-chords.ts"),
);
const startPage = code(
	read("src/renderer/src/features/browser/components/browser-new-tab.tsx"),
);

/* Top level because Biome's performance rule is right about these: they are
   rebuilt per test otherwise, and a source guard is scanned on every run. */
const GONE_FROM_SURFACE = [
	/planAddressRaise/,
	/addressFallback/,
	/popoutRef/,
	/chromeInert/,
	/addressFocusFailures/,
	/setPopout\(/,
];
const ROW_FOCUS_LAYOUT_EFFECT =
	/useLayoutEffect\(\(\) => \{[\s\S]*?element\.focus\(\{ preventScroll: true \}\)[\s\S]*?\}, \[focusRequest\?\.nonce\]\);/;
const START_PAGE_FIELD = /browser-start-page-address/;
const START_PAGE_GO = /browser-start-page-go/;
const INPUT_ELEMENT = /<Input/;
const REFUSED_SEED = /raiseAddress\(\{ origin: "chrome", seed \}\)/;
const CONTROLLER_CLOSE = /close: \(\) =>/;
const CONTROLLER_CALL = /address\.current\?\.close\(\)/;

test("a raise bumps a nonce; there is no second placement to fall into", () => {
	assert.match(surface, /focusNonce\.current \+= 1;/);
	assert.match(surface, /setFocusRequest\(\{/);
	assert.match(surface, /nonce: focusNonce\.current/);
	// The deleted machinery must not come back by copy-paste.
	for (const gone of GONE_FROM_SURFACE) {
		assert.doesNotMatch(surface, gone);
	}
});

test("the row is rendered unconditionally, between strip and find row", () => {
	assert.match(surface, /rootRef=\{rowRef\}/);
	const rowAt = surface.indexOf("<BrowserUrlBar");
	assert.ok(rowAt > 0);
	assert.ok(surface.indexOf("<BrowserTabStrip") < rowAt);
	assert.ok(surface.indexOf("<BrowserFindRow") > rowAt);
	// No conditional wrapper around the row: the popout branch is gone.
	assert.doesNotMatch(surface, /\{popout &&/);
	assert.doesNotMatch(surface, /placement=/);
});

test("the row applies the focus request in a layout effect", () => {
	assert.match(urlBar, ROW_FOCUS_LAYOUT_EFFECT);
	assert.match(urlBar, /focusRequest\?\.seed !== undefined/);
	assert.match(urlBar, /focusRequest\?\.selectAll/);
});

test("the start page has no field and no Go; the row is the only input", () => {
	assert.doesNotMatch(startPage, START_PAGE_FIELD);
	assert.doesNotMatch(startPage, START_PAGE_GO);
	assert.doesNotMatch(startPage, INPUT_ELEMENT);
	// Seeded from the refused address when a navigation was refused.
	assert.match(surface, /chrome\.refusedUrl/);
	assert.match(surface, REFUSED_SEED);
});

test("the chord layer has no close(): nothing is raised to lower", () => {
	assert.doesNotMatch(chords, CONTROLLER_CLOSE);
	assert.doesNotMatch(chords, CONTROLLER_CALL);
	assert.match(chords, /export interface AddressController \{\s*raise:/);
});
