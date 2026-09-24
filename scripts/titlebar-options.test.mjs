import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { contentGeometryMatches } from "./renderer-content-geometry.mjs";

const DRAG_REGION_RULE =
	/\[data-titlebar-platform="mac"\][\s\S]*?\[data-titlebar-drag\]\s*\{\s*-webkit-app-region:\s*drag;/;
const NO_DRAG_RULE = /-webkit-app-region:\s*no-drag;/;
/*
 * The collapsed rail's lane compensation, and the defect this pattern exists to
 * keep out: `data-titlebar-platform` and `data-titlebar-sidebar-collapsed` are
 * BOTH on `app.tsx`'s one shell <div>, so the descendant combinator
 * (`[platform] [collapsed] [heading]`) can never match and the rule is dead CSS
 * while still LOOKING present in the file. Measured in the collapsed state on
 * the branch that carried it: the heading row's computed `padding-left` was 4px
 * (the `px-1` utility alone) and the `Chats` label sat at x 60, underneath the
 * traffic lights' zoom button (x 54.75-68.75). The two attribute selectors are
 * therefore written COMPOUND and the dead form is asserted absent below.
 *
 * THE ASSERTION READS THE DECLARATIONS, NOT THE FILE TEXT (review R7-1). A rule's
 * own doc comment may spell the dead form out in full while explaining why it is
 * dead, and asserting over the raw file would then fail for a documentation
 * reason - a guard that fires on prose is as wrong as one a comment satisfies.
 * `index.css` is therefore stripped of its comments before the pattern runs, so
 * what it tests is what the browser would parse.
 */
const COLLAPSED_CHAT_HEADING_SAFE_AREA =
	/\[data-titlebar-platform="mac"\]\[data-titlebar-sidebar-collapsed="true"\]\s+\[data-titlebar-chat-heading\]\s*\{\s*padding-left:\s*24px;/;
const DEAD_DESCENDANT_PLATFORM_SELECTOR =
	/\[data-titlebar-platform="mac"\]\s+\[data-titlebar-sidebar-collapsed="true"\]/;
/*
 * The macOS traffic-light lane, and the one thing about it a source pin can see:
 * it must be the rail's FIRST child. The lane is the whole reason the brand row
 * below it pays no left reservation and the collapse control fits in that row
 * (revision 2), so a lane rendered after the header - or not at all - would put
 * the OS circles back over the brand and the control's arithmetic back over 219.
 * Asserted as a source ORDER rather than as a count, because a second lane
 * somewhere further down the rail would satisfy a count and change nothing.
 *
 * IT MATCHES THE MARKUP SPELLING, NOT THE BARE TOKEN, and that is the whole
 * difference between a guard and a sentence (review R7-1). The bare
 * `data-titlebar-lane` occurs FIRST inside the rail's own doc comment (line 357,
 * "is the LANE above this row (`data-titlebar-lane`, 32px)"), so a lazy match
 * from that token to the `data-titlebar-rail-header` markup 107 lines later was
 * satisfied by COMMENT -> MARKUP and stayed true with the lane element deleted
 * and with the lane element moved to the end of the file. Both mutations were
 * reproduced against a byte copy of this file's own source, which is what makes
 * the `=""` form the fix: the attribute as the JSX writes it occurs exactly once
 * each, so the pin can only be satisfied by the two elements' real order.
 */
const LANE_BEFORE_RAIL_HEADER =
	/data-titlebar-lane=""[\s\S]*?data-titlebar-rail-header=""/;
const BANNER_BACKGROUND_RULE =
	/\[data-titlebar-platform="mac"\]\s+\[data-titlebar-banner\]\s*\{[\s\S]*?background-image:\s*linear-gradient\(\s*to right,\s*var\(--color-canvas\)\s+0\s+80px,\s*transparent\s+80px\s*\);[\s\S]*?padding-left:\s*80px;/;
/*
 * A CSS comment is prose: it is not parsed, so it can neither satisfy nor trip an
 * assertion about what the stylesheet DOES. The dead-selector pin below asserts on
 * the stripped text for that reason (review R7-1) - the same reading a browser
 * takes of the file.
 */
const stripCssComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");

const CHAT_HEADER_SAFE_AREA_SELECTOR = '[data-tour-tag="chat-header"]';
const GLOBAL_DRAG_RULE =
	/(?:^|\n)\s*(?:html|body|#app|main)\s*\{[^}]*-webkit-app-region:\s*drag/m;

const bundle = await build({
	stdin: {
		contents: 'export { titlebarOptions } from "./src/main/titlebar-options";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { titlebarOptions } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/*
 * macOS hides the titlebar and leaves the OS controls exactly where the platform
 * puts them. The derivation is pinned here rather than described, because it is
 * the one item in this redesign no renderer frame can show: `Page.captureScreenshot`
 * photographs the renderer only, so no in-app frame contains the traffic lights.
 *
 * The renderer gives them their own 32px lane (`data-titlebar-lane` in
 * `sidebar-navigation.tsx`), and that lane's height comes FROM their frame: 8px
 * above their 16px hit frames (y 8), 8px below = 32, centre 16 - and the drawn
 * circles measure that same centre at this default (a `screencapture -l` window
 * capture reads them spanning y 9.00-23.00, Ø 14.00, centre 16.00; an earlier
 * round's "Ø 13.5, centre 15.75" came from a spec figure). Nothing else on the
 * strip is aligned to the lights, which is why no offset is passed.
 * `trafficLightPosition` is a macOS-only option, so its absence on every other
 * platform is asserted too.
 */
test("macOS hides the titlebar while retaining native traffic lights", () => {
	assert.deepEqual(titlebarOptions("darwin"), { titleBarStyle: "hidden" });
});

test("Windows, Linux, and other platforms keep their existing native titlebar", () => {
	for (const platform of ["win32", "linux", "freebsd", "openbsd"]) {
		assert.deepEqual(titlebarOptions(platform), {});
		assert.ok(!("trafficLightPosition" in titlebarOptions(platform)), platform);
	}
});

test("macOS hidden-titlebar content exactly fills the window", () => {
	const windowSize = { width: 1380, height: 900 };
	const facts = (contentBounds) => ({
		platform: "darwin",
		windowSize,
		contentBounds,
	});

	assert.equal(
		contentGeometryMatches(facts({ width: 1380, height: 900 })),
		true,
	);
	for (const contentBounds of [
		{ width: 1379, height: 900 },
		{ width: 1380, height: 899 },
		{ width: 1380, height: 901 },
	]) {
		assert.equal(
			contentGeometryMatches(facts(contentBounds)),
			false,
			JSON.stringify(contentBounds),
		);
	}
});

test("Windows and Linux retain the bounded native-titlebar content inset", () => {
	const windowSize = { width: 1380, height: 900 };
	for (const platform of ["win32", "linux"]) {
		const matches = (contentBounds) =>
			contentGeometryMatches({ platform, windowSize, contentBounds });

		for (const height of [899, 860]) {
			assert.equal(
				matches({ width: 1380, height }),
				true,
				`${platform} ${height}`,
			);
		}
		for (const contentBounds of [
			{ width: 1380, height: 900 },
			{ width: 1380, height: 859 },
			{ width: 1379, height: 872 },
		]) {
			assert.equal(
				matches(contentBounds),
				false,
				`${platform} ${JSON.stringify(contentBounds)}`,
			);
		}
	}
});

test("macOS drag and safe areas are limited to existing empty shell headers", () => {
	const css = readFileSync("src/renderer/src/styles/index.css", "utf8");
	const shell = readFileSync("src/renderer/src/app.tsx", "utf8");
	const rail = readFileSync(
		"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx",
		"utf8",
	);
	const connectivityBanner = readFileSync(
		"src/renderer/src/shared/components/common/connectivity-banner.tsx",
		"utf8",
	);
	const compatibilityBanner = readFileSync(
		"src/renderer/src/shared/components/common/backend-compatibility-banner.tsx",
		"utf8",
	);
	const chatHeader = readFileSync(
		"src/renderer/src/features/chat/components/chat-header.tsx",
		"utf8",
	);
	const desktopTests = readFileSync("package.json", "utf8");
	const chatSidebar = readFileSync(
		"src/renderer/src/features/chat/components/chat-sidebar.tsx",
		"utf8",
	);

	assert.match(css, DRAG_REGION_RULE);
	assert.match(css, NO_DRAG_RULE);
	assert.match(css, COLLAPSED_CHAT_HEADING_SAFE_AREA);
	assert.ok(
		!DEAD_DESCENDANT_PLATFORM_SELECTOR.test(stripCssComments(css)),
		"the collapsed-rail compensation must key on ONE element carrying both attributes: a descendant combinator between them matches nothing",
	);
	assert.match(css, BANNER_BACKGROUND_RULE);
	assert.ok(!css.includes(CHAT_HEADER_SAFE_AREA_SELECTOR));
	assert.ok(chatHeader.includes('data-tour-tag="chat-header"'));
	assert.ok(shell.includes("data-titlebar-platform="));
	assert.ok(rail.includes("data-titlebar-rail-header"));
	assert.match(rail, LANE_BEFORE_RAIL_HEADER);
	assert.ok(!rail.includes("data-titlebar-collapsed-toggle-row"));
	/*
	 * The same standard, applied to the two hooks this round deleted for having no
	 * consumer left (`data-titlebar-brand` and `data-titlebar-rail-toggle` were
	 * selected only by the two rules the collapsed-state revision removed). The
	 * `=""` spelling is deliberate for the same reason the lane pin uses it: this
	 * file's own comments name both hooks while explaining why they went.
	 */
	assert.ok(!rail.includes('data-titlebar-brand=""'));
	assert.ok(!rail.includes('data-titlebar-rail-toggle=""'));
	assert.ok(rail.includes("aria-expanded={expanded}"));
	assert.ok(rail.includes("aria-label={toggleLabel}"));
	assert.ok(rail.includes('<Tooltip content={toggleLabel} side="right">'));
	assert.ok(!rail.includes("data-titlebar-expand-slot"));
	assert.ok(chatSidebar.includes("data-titlebar-chat-heading"));
	assert.ok(connectivityBanner.includes('data-titlebar-banner=""'));
	assert.ok(compatibilityBanner.includes('data-titlebar-banner=""'));
	assert.ok(chatHeader.includes('data-titlebar-no-drag=""'));
	assert.ok(desktopTests.includes("scripts/titlebar-options.test.mjs"));
	assert.doesNotMatch(css, GLOBAL_DRAG_RULE);
});
