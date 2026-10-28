#!/usr/bin/env node
/**
 * Every sidebar and Team Bridge attention count goes through ONE shared badge,
 * and the More row's aggregate is a sum (operator, 2026-10-28).
 *
 * WHAT THIS FILE IS FOR. The operator asked for the Notifications row's filled
 * accent pill on EVERY sidebar attention count, reversing notifications decision
 * D5 (2026-10-25), which kept it on Notifications alone. The failure this guards
 * is the one that produced the request: a row drawing its own badge (its own
 * variant, its own classes, its own cap), so the registers drift row by row
 * until one is easy to miss. Three halves:
 *
 *   - the SHARED COMPONENT is bundled and RENDERED with the server renderer, so
 *     the shipped markup is asserted (accent fill, on-accent digit, `99+` cap,
 *     nothing at zero) rather than a restatement of it;
 *   - the WIRING is pinned as source text, the idiom `aida-sidebar.test.mjs`
 *     uses, because the sidebar and Team Bridge rail are React-importing modules
 *     with live reads this suite does not stand up: no host file may name a
 *     Badge `variant` for a count or spell its own cap, and every count site
 *     must be an `<AttentionBadge`. Comments are stripped before matching, so
 *     prose about the rule cannot satisfy or trip a pin;
 *   - the MORE AGGREGATE (`moreAttentionCount`) is executed.
 *
 * WHAT THIS FILE DOES NOT PROVE: how the badge looks on a theme or under the
 * window glass - that is `scripts/contrast-contract.mjs` ("rail attention badge
 * (emphasis)") and the PR's rendered frames.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const bundle = await build({
	stdin: {
		contents: `
			export { AttentionBadge, ATTENTION_BADGE_CAP, ATTENTION_BADGE_CORNER_CAP } from "./src/renderer/src/shared/components/ui/attention-badge";
			export { moreAttentionCount } from "./src/renderer/src/shared/components/navigation/sidebar-destinations";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	mainFields: ["module", "main"],
	conditions: ["import"],
	/* React stays external so the component and the server renderer share one
	   copy (a second copy is a different hook dispatcher). */
	external: ["react", "react/jsx-runtime", "react-dom"],
	jsx: "automatic",
});
/* A real file rather than a data: URL, so the external bare `react` import has
   a base path to resolve from. */
const bundlePath = `${process.cwd()}/scripts/.sidebar-attention-badge.bundle.mjs`;
await writeFile(bundlePath, bundle.outputFiles[0].text);
let mod;
try {
	mod = await import(bundlePath);
} finally {
	await unlink(bundlePath);
}
const {
	AttentionBadge,
	ATTENTION_BADGE_CAP,
	ATTENTION_BADGE_CORNER_CAP,
	moreAttentionCount,
} = mod;

const render = (props) =>
	renderToStaticMarkup(React.createElement(AttentionBadge, props));
const classesOf = (html) =>
	(html.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/);

/* ------------------------------------------------------- the shared badge */

test("the badge is the filled accent pill: accent fill, on-accent digit, no border", () => {
	const classes = classesOf(render({ count: 6 }));
	for (const cls of [
		"bg-accent",
		"text-on-accent",
		"border-0",
		"rounded-full",
		"font-medium",
		"tabular-nums",
	]) {
		assert.ok(classes.includes(cls), `missing ${cls}: ${classes.join(" ")}`);
	}
	// The quiet register's tokens must not leak in.
	assert.ok(!classes.includes("bg-elevated"));
	assert.ok(!classes.includes("text-ink-dim"));
});

test("it caps at 99+ so three digits never clip, and spells smaller counts exactly", () => {
	assert.equal(ATTENTION_BADGE_CAP, 99);
	assert.match(render({ count: 7 }), />7</);
	assert.match(render({ count: 42 }), />42</);
	assert.match(render({ count: 99 }), />99</);
	assert.match(render({ count: 100 }), />99\+</);
	assert.match(render({ count: 4821 }), />99\+</);
});

/*
 * THE CORNER CAPS AT 9+ (design follow-up to #1465, D1): on the collapsed
 * strip's 16px icon a `99+` mark lay across 37.5 % of the glyph. The cap is the
 * component's, keyed on placement, so no strip host spells it.
 */
test("the corner mark caps at 9+, while the inline mark keeps 99+", () => {
	assert.equal(ATTENTION_BADGE_CORNER_CAP, 9);
	const corner = (count) => render({ count, placement: "corner" });
	assert.match(corner(5), />5</);
	assert.match(corner(9), />9</);
	assert.match(corner(10), />9\+</);
	assert.match(corner(12), />9\+</);
	assert.match(corner(125), />9\+</);
	assert.match(render({ count: 12 }), />12</);
	assert.match(render({ count: 125 }), />99\+</);
});

test("zero, negative and NaN draw nothing", () => {
	assert.equal(render({ count: 0 }), "");
	assert.equal(render({ count: -3 }), "");
	assert.equal(render({ count: Number.NaN }), "");
});

test("the corner placement is the collapsed strip's 14px mark, same register", () => {
	const classes = classesOf(render({ count: 3, placement: "corner" }));
	assert.ok(classes.includes("h-3.5"));
	assert.ok(classes.includes("bg-accent"));
	assert.ok(classes.includes("text-on-accent"));
});

/* ------------------------------------------------- no row draws its own */

/** Source with block and line comments removed, so prose cannot satisfy a pin. */
const code = (path) =>
	readFileSync(path, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

/*
 * Every file that draws a sidebar or Team Bridge attention count, and how many
 * count sites each holds. A new count site must be added here - and the counts
 * make a site silently reverting to a hand-rolled `<Badge>` fail twice.
 */
const HOSTS = {
	// expanded row, collapsed strip corner, strip-button corner (More), More row
	"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx": 4,
	// the shared `Unread` pill (channels, groups, people, chiefs of staff)
	"src/renderer/src/features/team-bridge/team-bridge-rail.tsx": 1,
	// all-organizations total unread, per-organization unread
	"src/renderer/src/features/team-bridge/team-bridge-org-switcher.tsx": 2,
	// pending invitations
	"src/renderer/src/features/team-bridge/team-bridge-page.tsx": 1,
};

for (const [path, sites] of Object.entries(HOSTS)) {
	test(`${path.split("/").pop()}: every count goes through <AttentionBadge>`, () => {
		const src = code(path);
		const uses = src.match(/<AttentionBadge\b/g) ?? [];
		assert.equal(uses.length, sites, "count sites through the shared badge");
		/* No host names the count register or a cap itself: the register and the
		   99+ cap belong to the shared component alone. (`attentionQuiet` is still
		   allowed on a non-count label - the rail's "Preview" chip - so the pin is
		   on the loud register and on count geometry, not on the quiet word.) */
		assert.doesNotMatch(src, /variant=\{?["'`]?emphasis/);
		assert.doesNotMatch(src, /\bcountLabel\(/);
		assert.doesNotMatch(src, /attentionEmphasis/);
		/* A Badge left in a host must not be a count: no count geometry, and no
		   number expression as its only child. */
		assert.doesNotMatch(src, /<Badge\b[^>]*size="count"/);
		assert.doesNotMatch(
			src,
			/<Badge\b[^>]*>\s*\{[^}]*(?:count|unread|attention|length)[^}]*\}\s*<\/Badge>/i,
		);
	});
}

test("the sidebar draws no <Badge> of its own at all", () => {
	const src = code(
		"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx",
	);
	assert.doesNotMatch(src, /<Badge\b/);
	assert.doesNotMatch(src, /\bbadgeVariants\(/);
});

test("the More aggregate is computed by moreAttentionCount, not inline", () => {
	const src = code(
		"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx",
	);
	assert.match(src, /moreAttentionCount\(hiddenItems\)/);
});

/* ------------------------------------------------------- More's aggregate */

test("More sums every hidden row's attention", () => {
	assert.equal(
		moreAttentionCount([
			{ attention: 2 }, // Aida, 2 missed
			{ attention: 1 }, // Mesh, 1 approval
			{}, // Agent Hub, no count
			{ attention: 0 }, // Team Bridge, read
		]),
		3,
	);
});

test("More with nothing waiting is zero, so the badge draws nothing", () => {
	assert.equal(moreAttentionCount([]), 0);
	assert.equal(moreAttentionCount([{}, { attention: 0 }]), 0);
	assert.equal(render({ count: moreAttentionCount([{}]) }), "");
});

test("a malformed entry neither hides nor subtracts from the rest", () => {
	assert.equal(
		moreAttentionCount([
			{ attention: Number.NaN },
			{ attention: -4 },
			{ attention: Number.POSITIVE_INFINITY },
			{ attention: 5 },
		]),
		5,
	);
});

test("a large hidden sum renders capped while the sum itself stays exact", () => {
	const sum = moreAttentionCount([{ attention: 60 }, { attention: 70 }]);
	assert.equal(sum, 130); // the accessible name states this
	assert.match(render({ count: sum }), />99\+</);
});
