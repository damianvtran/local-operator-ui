import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * THE RULES THAT DECIDE WHETHER ESCAPE IS THE SETTINGS PAGE'S, asserted without
 * a renderer.
 *
 * WHY THIS FILE HAS NO DOM HARNESS. Round 1's suite mounted the surface in jsdom
 * and bundled the page's whole import graph; on this host that graph (all seven
 * translation catalogues, the settings search index and the Radix barrel) made
 * the bundler and the runner the largest thing in the process, and the memory
 * guard killed the run three times. The rules these cases pin are pure: a
 * target-based predicate and a four-line tour guard. They are bundled small
 * here, and the DOM side - focus outside the column, a focused tooltip's first
 * Escape, a real dialog, the gear's focus on return - is exercised by
 * `scripts/renderer-driver.mjs --scene settings-close` against the built app and
 * by the three recorder suites, which mount their real components.
 */
const bundle = await build({
	stdin: {
		contents: `
			export { settingsEscapeIsClaimed, isBareEscape } from "./src/renderer/src/features/settings/settings-escape";
			export { tourGearNeedsClick } from "./src/renderer/src/features/onboarding/tour/tour-gear-open";
			export { nextSettingsReturn, settingsCloseTarget, isSettingsPath } from "./src/renderer/src/shared/hooks/use-settings-route";
			export { KEYMAP_ACTIONS } from "./src/renderer/src/shared/keymap/keymap-registry";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	loader: { ".css": "empty" },
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	write: false,
});
const bundlePath = new URL(
	"./_settings-close-pure.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));
const {
	settingsEscapeIsClaimed,
	isBareEscape,
	tourGearNeedsClick,
	nextSettingsReturn,
	settingsCloseTarget,
	isSettingsPath,
	KEYMAP_ACTIONS,
} = await import(bundlePath.href);

/*
 * A target with just enough of an element to answer `closest`: the selectors the
 * predicate uses, matched against a small attribute model. Real enough to catch
 * a rule that asks the wrong question, and small enough to run anywhere.
 */
function element({ tag = "div", parent = null, ...attributes }) {
	const node = {
		tagName: tag.toUpperCase(),
		attributes,
		parent,
		value: attributes.value ?? "",
		querySelector: () => null,
		getAttribute: (name) => attributes[name] ?? null,
		matches(selector) {
			return selector.split(",").some((part) => {
				const clause = part.trim();
				const attributeEquals = /^\[([a-z-]+)="([^"]*)"\]$/.exec(clause);
				if (attributeEquals) {
					return attributes[attributeEquals[1]] === attributeEquals[2];
				}
				const marker = /^\[([a-z-]+)\]$/.exec(clause);
				if (marker) return marker[1] in attributes;
				if (clause === "input") return tag === "input";
				if (clause === "textarea") return tag === "textarea";
				if (clause === "select") return tag === "select";
				if (clause.startsWith('[contenteditable="')) {
					return attributes.contenteditable !== undefined;
				}
				return false;
			});
		},
		hasAttribute: (name) => name in attributes,
		closest(selector) {
			let current = node;
			while (current) {
				if (current.matches(selector)) return current;
				current = current.parent;
			}
			return null;
		},
	};
	return node;
}

/** The document the tooltip rule reads, with nothing open by default. */
function documentWith({ tooltip = false, layer = false } = {}) {
	return {
		querySelector(selector) {
			if (selector === '[role="tooltip"]')
				return tooltip ? element({ role: "tooltip" }) : null;
			if (selector.includes('role="dialog"')) {
				return layer ? element({ role: "dialog" }) : null;
			}
			return null;
		},
	};
}

/** Run the predicate against a press, with `document` as the page would have it. */
function claimed({ target, defaultPrevented = false, ...open }) {
	const previous = globalThis.document;
	globalThis.document = documentWith(open);
	try {
		return settingsEscapeIsClaimed({ target, defaultPrevented });
	} finally {
		globalThis.document = previous;
	}
}

test("a bare press on the page is the page's", () => {
	assert.equal(claimed({ target: element({ tag: "button" }) }), false);
	assert.equal(claimed({ target: null }), false);
});

test("a recorder keeps the press, and so does anything inside one", () => {
	const recorder = element({ tag: "input", "data-shortcut-recorder": "" });
	assert.equal(claimed({ target: recorder }), true);
	assert.equal(
		claimed({ target: element({ tag: "span", parent: recorder }) }),
		true,
	);
});

test("the search field owns the press only while it has text or an open list", () => {
	const widget = element({ "data-settings-search": "" });
	const field = element({ tag: "input", parent: widget });
	// The widget's own reading asks its field and its combobox (settings-search.tsx
	// renders both); the fake answers the same questions.
	widget.querySelector = (selector) =>
		selector === '[role="combobox"]' ? null : field;

	field.value = "";
	assert.equal(claimed({ target: field }), false, "empty, no list: the page's");

	field.value = "theme";
	assert.equal(claimed({ target: field }), true, "text in the field");

	// An OPEN list owns it whatever the field holds (round 1: U3 keeps this).
	const openWidget = element({ "data-settings-search": "" });
	const openField = element({ tag: "input", parent: openWidget, value: "" });
	openWidget.querySelector = (selector) =>
		selector === '[role="combobox"]'
			? { getAttribute: () => "true" }
			: openField;
	assert.equal(
		claimed({ target: openField }),
		true,
		"an expanded list owns the press",
	);
});

test("a text field keeps the press", () => {
	assert.equal(claimed({ target: element({ tag: "input" }) }), true);
	assert.equal(claimed({ target: element({ tag: "textarea" }) }), true);
	assert.equal(
		claimed({ target: element({ tag: "div", contenteditable: "true" }) }),
		true,
	);
});

test("a closed combobox does not own the press; an expanded one does", () => {
	const closed = element({
		tag: "button",
		role: "combobox",
		"aria-expanded": "false",
	});
	assert.equal(claimed({ target: closed }), false);
	const open = element({
		tag: "button",
		role: "combobox",
		"aria-expanded": "true",
	});
	assert.equal(claimed({ target: open }), true);
});

test("a press inside an overlay belongs to the overlay", () => {
	const dialog = element({ role: "dialog" });
	const inDialog = element({ tag: "button", parent: dialog });
	assert.equal(claimed({ target: inDialog }), true);
});

test("a prevented press is its owner's - a tooltip trigger's own tooltip excepted", () => {
	// A dialog, menu or select marks its dismissal handled in the capture phase;
	// the page must stand aside for that.
	assert.equal(
		claimed({
			target: element({ tag: "button" }),
			defaultPrevented: true,
			layer: true,
		}),
		true,
	);
	// Nothing open at all: a prevented press with no layer is still not ours.
	assert.equal(
		claimed({ target: element({ tag: "button" }), defaultPrevented: true }),
		true,
	);
	// A tooltip's own trigger: the press is the page's (see the trigger-keyed
	// case below for the full matrix).
	assert.equal(
		claimed({
			target: element({ tag: "button", "data-state": "instant-open" }),
			defaultPrevented: true,
			tooltip: true,
		}),
		false,
	);
});

test("the tour's gear click is open-only, so Back then Next keeps Settings open", () => {
	const gear = element({ tag: "button", "data-tour-tag": "nav-item-settings" });
	assert.equal(
		tourGearNeedsClick(gear),
		true,
		"Settings closed: the step opens it",
	);

	const openGear = element({
		tag: "button",
		"data-tour-tag": "nav-item-settings",
		"aria-current": "page",
	});
	assert.equal(tourGearNeedsClick(openGear), false, "Settings open: no toggle");
	assert.equal(tourGearNeedsClick(null), false, "no gear, nothing to click");
});

/*
 * WIRING, because the predicate only matters if it is actually mounted where
 * focus is. Read from source: these are one-line relationships a renderer test
 * would restate at the cost of the whole import graph (see this file's header).
 */
test("the surface mounts the document listener and no column onKeyDown", () => {
	const surface = readFileSync(
		"src/renderer/src/features/settings/components/settings-close-surface.tsx",
		"utf8",
	);
	assert.match(surface, /useSettingsEscapeClose\(closeSettings\)/);
	// The word appears in the file's own explanation; the JSX PROP is what must
	// be gone, because a column handler is exactly the bug this round fixed.
	assert.doesNotMatch(surface, /onKeyDown=\{/);
	const escapeSource = readFileSync(
		"src/renderer/src/features/settings/settings-escape.ts",
		"utf8",
	);
	assert.match(
		escapeSource,
		/document\.addEventListener\("keydown", onKeyDown\)/,
	);
	assert.match(
		escapeSource,
		/document\.removeEventListener\("keydown", onKeyDown\)/,
	);
});

test("the gear exposes its direction and shares one route reading", () => {
	const gear = readFileSync(
		"src/renderer/src/shared/components/navigation/sidebar-foot.tsx",
		"utf8",
	);
	assert.match(gear, /isSettingsPath\(pathname\)/);
	assert.match(gear, /aria-describedby=\{isOpen \? SETTINGS_GEAR_DIRECTION_ID/);
	// The description reuses the audited "Close settings" string; a new key here
	// would stale the translation ledger for a phrase that already exists.
	assert.match(
		gear,
		/t\("ui\.settings\.navigation\.settings_page\.close_settings"\)/,
	);
});

test("the tour step calls the seam rather than deciding inline", () => {
	const steps = readFileSync(
		"src/renderer/src/features/onboarding/tour/tour-steps.ts",
		"utf8",
	);
	assert.match(steps, /if \(tourGearNeedsClick\(button\)\)/);
});

test("only a caret owns Escape; sliders, radios and checkboxes do not", () => {
	// Round 2 M1: `input` as a blanket claim made Esc dead after a keyboard
	// adjustment on any of Settings' sliders and its native radios.
	for (const type of [
		"range",
		"radio",
		"checkbox",
		"button",
		"file",
		"color",
	]) {
		assert.equal(
			claimed({ target: element({ tag: "input", type }) }),
			false,
			`input[type=${type}] must not own the press`,
		);
	}
	for (const type of [
		"text",
		"search",
		"email",
		"url",
		"tel",
		"password",
		"number",
		"",
	]) {
		assert.equal(
			claimed({ target: element({ tag: "input", type }) }),
			true,
			`input[type=${type || "(default)"}] is a caret`,
		);
	}
	assert.equal(claimed({ target: element({ tag: "textarea" }) }), true);
	assert.equal(claimed({ target: element({ tag: "select" }) }), true);
	assert.equal(
		claimed({ target: element({ tag: "div", contenteditable: "true" }) }),
		true,
	);
});

test("a bare Escape closes; every modifier makes it a chord", () => {
	assert.equal(isBareEscape({ key: "Escape" }), true);
	assert.equal(isBareEscape({ key: "Esc" }), true);
	assert.equal(isBareEscape({ key: "Enter" }), false);
	for (const modifier of ["ctrlKey", "metaKey", "altKey", "shiftKey"]) {
		assert.equal(
			isBareEscape({ key: "Escape", [modifier]: true }),
			false,
			`${modifier}+Escape is a chord, not a close`,
		);
	}
});

test("the return target: cold fallback, no re-pin on a query change, cleared on leave", () => {
	const cold = nextSettingsReturn(
		{ returnTarget: null, lastOutsideRoute: null },
		"/settings",
		"",
	);
	assert.equal(settingsCloseTarget(cold), "/chat", "cold deep link falls back");

	const entered = nextSettingsReturn(cold, "/agents", "?tab=teams");
	assert.equal(entered.returnTarget, null, "still outside: no target yet");
	const inside = nextSettingsReturn(entered, "/settings", "?section=general");
	assert.equal(settingsCloseTarget(inside), "/agents?tab=teams");
	const moved = nextSettingsReturn(inside, "/settings", "?section=appearance");
	assert.equal(
		settingsCloseTarget(moved),
		"/agents?tab=teams",
		"an in-page query change must not re-pin",
	);
	// Two close presses before the route commits read the same target (R3).
	assert.equal(settingsCloseTarget(moved), settingsCloseTarget(moved));
	const left = nextSettingsReturn(moved, "/agents", "?tab=teams");
	assert.equal(left.returnTarget, null, "the visit ends when the route leaves");
	const reentered = nextSettingsReturn(left, "/settings", "");
	assert.equal(
		settingsCloseTarget(reentered),
		"/agents?tab=teams",
		"re-entry pins the route just left",
	);
	assert.equal(isSettingsPath("/settings"), true);
	assert.equal(isSettingsPath("/settings/advanced"), false);
});

test("a tooltip owns the press only when the press landed on its own open trigger", () => {
	const trigger = element({ tag: "button", "data-state": "instant-open" });
	// Tooltip open, press on the trigger: the page closes (round 1 U2; U8/Q-7's
	// ordering included, because the trigger keeps its state after the tooltip
	// node unmounts).
	assert.equal(
		claimed({ target: trigger, defaultPrevented: true, tooltip: true }),
		false,
	);
	// A tooltip open elsewhere must NOT discard a real owner's claim (M3): the
	// sound preview's radio and the disclosure's trigger claim by preventDefault.
	const radio = element({ tag: "input", type: "radio" });
	assert.equal(
		claimed({ target: radio, defaultPrevented: true, tooltip: true }),
		true,
	);
	const plainButton = element({ tag: "button" });
	assert.equal(
		claimed({ target: plainButton, defaultPrevented: true, tooltip: true }),
		true,
	);
	// A real overlay layer outranks the tooltip rule.
	const dialog = element({ role: "dialog" });
	const inDialog = element({ tag: "button", parent: dialog });
	assert.equal(
		claimed({
			target: inDialog,
			defaultPrevented: true,
			tooltip: true,
			layer: true,
		}),
		true,
	);
});

test("no keymap action can reach the gear", () => {
	// The gear is click-only (round 1 R5's check, restored without a renderer):
	// every action is a panel toggle or a composer send, and none names Settings.
	assert.ok(KEYMAP_ACTIONS.length > 0);
	for (const action of KEYMAP_ACTIONS) {
		assert.match(action.id, /^(panel|composer)\./);
		assert.doesNotMatch(action.id, /settings/i);
	}
});
