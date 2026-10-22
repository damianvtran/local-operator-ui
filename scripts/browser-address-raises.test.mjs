import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * S4b round 2: the raise decision, and the wiring that must obey it.
 *
 * MAJOR-2 in round 1 was reachable with no fault injection at all: in the
 * zero-tab state the popout's input is `disabled`, so its focus cannot take, two
 * raises satisfy the 300 ms focus contract and Tier 2 latches — and from then on
 * every raise still set `popout`, a row that does not render, while the strip
 * went invisible and inert under nothing. The state machine is now a pure
 * function (`planAddressRaise`) and it is walked here in that order; the surface
 * half (what each plan DOES, and the fact that the strip is only inert for a
 * row that is actually painted) is pinned by the guards below.
 */

const bundle = await build({
	stdin: {
		contents:
			'export { planAddressRaise } from "./src/renderer/src/features/browser/model/address-raise";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { planAddressRaise } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const PLAN_CALL =
	/planAddressRaise\(\{\s*startPage: startPageRef\.current,\s*fallback: addressFallback,\s*open: popoutRef\.current !== null,?\s*\}\)/;
const POPOUT_SHOWN =
	/const popoutShown = popout !== null && !addressFallback && !onStartPage;/;
const CHROME_INERT = /chromeInert=\{popoutShown\}/;
const ESCAPE_CAPTURE = /onKeyDownCapture=\{\(event\) => \{/;
const ESCAPE_MENU = /event\.key !== "Escape" \|\| pageMenuOpenRef\.current/;
const PORTAL_BLUR = /isPortalledChromeTarget\(next\)/;
const CLOSE_FOCUS = /onCloseAutoFocus=\{returnFocusToAddress\}/;

const surface = readFileSync(
	"src/renderer/src/features/browser/components/browser-surface.tsx",
	"utf8",
);
const code = (source) =>
	source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("the raise decision follows the fallback even when a popout looks open", () => {
	const base = { startPage: false, fallback: false, open: false };
	assert.equal(planAddressRaise(base), "raise");
	// A second raise of an open row re-selects it; it never remounts.
	assert.equal(planAddressRaise({ ...base, open: true }), "refocus");
	// The start page owns its own field before anything else is considered.
	assert.equal(
		planAddressRaise({ startPage: true, fallback: true, open: true }),
		"start-page",
	);
	// The zero-tab path: two raises that cannot focus, so Tier 2 latches, and
	// every later raise — open flag stale or not — takes the in-flow field.
	assert.equal(planAddressRaise({ ...base, fallback: true }), "fallback");
	assert.equal(
		planAddressRaise({ ...base, fallback: true, open: true }),
		"fallback",
	);
	assert.equal(
		planAddressRaise({ ...base, fallback: true, startPage: false }),
		"fallback",
		"a Cmd+L, a trigger and a printable seed all reach the same branch",
	);
});

test("the surface gates every raise and inerts the strip only for a painted row", () => {
	const source = code(surface);
	// The raise path consults the planner with the three facts, not a subset.
	assert.match(source, PLAN_CALL);
	// `setPopout` appears once in the raise path, below the fallback return.
	const raiseAt = source.indexOf("const raiseAddress = useCallback");
	assert.notEqual(raiseAt, -1);
	const raiseBody = source.slice(
		raiseAt,
		source.indexOf("const addressController", raiseAt),
	);
	assert.ok(
		raiseBody.indexOf('plan === "fallback"') < raiseBody.indexOf("setPopout({"),
		"the Tier 2 branch returns before the popout is set",
	);
	// The strip is inert for the row that renders, never for the state alone.
	assert.match(
		source,
		/const popoutShown = popout !== null && !addressFallback && !onStartPage;/,
	);
	assert.match(source, CHROME_INERT);
	// Escape works from the row, not only from the input.
	assert.match(source, ESCAPE_CAPTURE);
	assert.match(source, ESCAPE_MENU);
	// Focus that lands in the menu portal is not a dismissal.
	assert.match(source, PORTAL_BLUR);
	// Radix's return-to-trigger is suppressed so the Address item's field keeps focus.
	assert.match(source, CLOSE_FOCUS);
});
