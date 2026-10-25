import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * S5: the strip's site trigger is gone; the field's own mark is the register.
 *
 * The trigger carried a loopback exception (D11: `localhost:5173` drew a neutral
 * Globe instead of the open padlock). The operator ruled it OUT for S5 (ruling
 * 6): the field's mark reports the transport exactly, loopback http included,
 * and no neutral globe exists for a local page. That is a behaviour change, so
 * it is pinned here rather than left to a reviewer's memory.
 */

const bar = readFileSync(
	"src/renderer/src/features/browser/components/browser-url-bar.tsx",
	"utf8",
);
const surface = readFileSync(
	"src/renderer/src/features/browser/components/browser-surface.tsx",
	"utf8",
);
const siteInfo = readFileSync(
	"src/renderer/src/features/browser/model/site-info.ts",
	"utf8",
);

test("the trigger and its helpers are gone", () => {
	for (const source of [bar, surface]) {
		assert.doesNotMatch(source, /browser-address-trigger/);
		assert.doesNotMatch(source, /SiteTriggerIcon/);
		assert.doesNotMatch(source, /compactHost/);
		assert.doesNotMatch(source, /isLoopbackHost/);
	}
	assert.doesNotMatch(siteInfo, /export function compactHost/);
	assert.doesNotMatch(siteInfo, /export function isLoopbackHost/);
});

test("the field's mark maps every kind exactly, with no loopback branch", () => {
	// The mapping is a chain of kind checks ending in the Globe for internal.
	assert.match(bar, /siteInfo\.kind === "secure"/);
	assert.match(bar, /siteInfo\.kind === "not-secure"/);
	assert.match(bar, /siteInfo\.kind === "unverified"/);
	assert.match(bar, /siteInfo\.kind === "file"/);
	assert.match(bar, /:\s*\n?\s*Globe;/);
	// http is an open padlock, whatever the host: a loopback page shows the
	// warning glyph like any other plain-http origin (ruling 6).
	assert.match(
		bar,
		/siteInfo\.kind === "not-secure"[\s\S]{0,120}LockKeyholeOpen/,
	);
	assert.doesNotMatch(bar, /isLoopbackHost/);
});

test("the mark is the field's leading-edge description, not a tab stop (U4)", () => {
	assert.match(bar, /data-site-info=\{siteInfo\.kind\}/);
	assert.doesNotMatch(
		bar,
		/tabIndex=\{0\}/,
		"a no-op control must not sit in the tab order",
	);
	assert.match(bar, /aria-label=\{siteInfoLabel\}/);
	assert.match(bar, /absolute top-1\/2 left-2/);
	// The description reaches the field without focus: one hidden sentence, named
	// by the input's `aria-describedby`.
	assert.match(bar, /const siteDescId = `\$\{listId\}-site`/);
	assert.match(bar, /<span id=\{siteDescId\} className="sr-only">/);
	assert.match(bar, /siteDescId,/);
	assert.match(
		bar,
		/aria-describedby=\{[\s\S]{0,220}siteDescId/,
		"the field must actually name the mark's sentence",
	);
});
