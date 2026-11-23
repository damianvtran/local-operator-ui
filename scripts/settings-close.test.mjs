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
			export { settingsEscapeIsClaimed } from "./src/renderer/src/features/settings/settings-escape";
			export { tourGearNeedsClick } from "./src/renderer/src/features/onboarding/tour/tour-gear-open";
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
const { settingsEscapeIsClaimed, tourGearNeedsClick } = await import(
	bundlePath.href
);

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
				const role = /^\[role="([^"]+)"\]$/.exec(clause);
				if (role) return attributes.role === role[1];
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

test("a prevented press is the owner's - unless the only owner was a tooltip", () => {
	// A dialog, menu or select marks its dismissal handled in the capture phase;
	// the page must stand aside for that (round 1: R2's class of bug, inverted).
	assert.equal(
		claimed({
			target: element({ tag: "button" }),
			defaultPrevented: true,
			layer: true,
		}),
		true,
	);
	// A tooltip does the same, and is not a surface a press is owed to: the
	// Close button's own tooltip must not swallow the reader's first Escape
	// (round 1: U2, Q-3).
	assert.equal(
		claimed({
			target: element({ tag: "button" }),
			defaultPrevented: true,
			tooltip: true,
		}),
		false,
	);
	// Nothing open at all: a prevented press with no layer is still not ours.
	assert.equal(
		claimed({ target: element({ tag: "button" }), defaultPrevented: true }),
		true,
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
