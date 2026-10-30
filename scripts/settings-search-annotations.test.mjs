import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE ANTI-DRIFT RATCHET for settings search's annotations.
 *
 * The search's page half is read from the DOM, so a control the page renders
 * without `data-search-row` is invisible to it — silently, and only for SOME
 * readers (the ones who typed the word that control represents). This file is
 * the tripwire: every focusable control inside a mounted settings surface must
 * sit inside a `[data-search-row]` (it is searchable) or a `[data-search-ignore]`
 * (it is deliberately not), and every ignore reason in the page must be one the
 * table below names with a sentence saying why.
 *
 * WHAT IT MOUNTS, and the honest edge of the claim. The sections that are
 * self-contained components are mounted here and checked as real DOM: the
 * keyboard shortcut rows, the theme grid, and every shared row component that
 * takes a `searchRow` prop (a toggle, the transcript mode, window glass, an
 * editable field). The page itself — the profile fields, the model trio, the
 * tour button — is NOT mounted: `settings-page.tsx` pulls MUI through the theme
 * selector and the whole query graph through its hooks, neither of which this
 * repository's jsdom harness can take (measured: `@assets` and MUI's
 * `styles` directory both fail ESM resolution). For those the ratchet is the
 * second arm: the page's own `data-search-ignore` declarations are read from the
 * source and must match the table, so a new ignore cannot arrive unexplained.
 *
 * A new unannotated control in a MOUNTED surface fails the DOM arm; a new ignore
 * anywhere fails the table arm. What neither arm sees is a control the page adds
 * outside the mounted surfaces AND outside an ignore — a gap stated here rather
 * than left to be discovered.
 */
const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
});
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// A few of jsdom's own accessors refuse to be read out of context.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CSS = { escape: (value) => String(value) };
bootstrapDOM.window.Element.prototype.scrollIntoView = () => {};
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
	globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});
globalThis.window.api = {
	desktop: { request: async () => ({ status: 200, body: {} }) },
	windowChrome: { facts: () => ({ platform: "mac" }) },
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { KeyboardShortcutsSection } from "./src/renderer/src/features/settings/components/keyboard-shortcuts-section";
			import { ToggleSetting } from "./src/renderer/src/shared/components/common/toggle-setting";
			import { TranscriptDisplayModeSetting } from "./src/renderer/src/features/settings/components/transcript-display-mode-setting";
			import { WindowGlassSetting } from "./src/renderer/src/features/settings/components/window-glass-setting";
			import { EditableField } from "./src/renderer/src/shared/components/common/editable-field";
			export {
				createElement, KeyboardShortcutsSection, ToggleSetting,
				TranscriptDisplayModeSetting, WindowGlassSetting, EditableField,
			};
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	external: ["react", "react-dom", "react/jsx-runtime"],
	/*
	 * MUI arrives through a shared row component's imports; leaving packages
	 * external turns it into a bare directory import Node refuses (measured).
	 * Bundling it keeps one React (still external above), which is what `act`
	 * needs.
	 */
	loader: {
		".css": "empty",
		".png": "empty",
		".svg": "empty",
		".webp": "empty",
	},
	jsx: "automatic",
	write: false,
});
const bundlePath = new URL(
	"./_settings-search-annotations.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));
const components = await import(bundlePath.href);

/*
 * THE IGNORE TABLE — one line per deliberate exclusion, and the ratchet.
 *
 * Each entry is the exact `data-search-ignore` reason string a surface ships. A
 * reason that is not here fails; an entry that is no longer shipped fails too
 * (that is what makes it a ratchet rather than a list).
 */
const IGNORE_REASONS = [
	"registry rows are searched by the Backend section's own filter",
	"imports are a one-off task list, not a setting",
	"application updates are an action surface, not a setting",
	"account, billing and usage are read-only or remote",
	"speech rows are registry keys read from the daemon's own selection",
	"agent messages is a consent state machine; its registry rows are searchable",
	"the theme picker is a grid of fifty-nine choices; the Appearance section result is its destination",
];

/** The control selector the issue names, as one list. */
const FOCUSABLE =
	"input, textarea, select, button, [role='switch'], [role='tab'], [role='combobox'], [tabindex]";

/**
 * The nearest marker for a control: the row or ignore it sits inside.
 *
 * NEAREST, not "any ancestor": a section root can be an ignore marker while a
 * row inside it is searchable (and vice versa), so a control's coverage is the
 * first marker up its own chain.
 */
function nearestMarker(element) {
	for (let node = element; node; node = node.parentElement) {
		if (node.hasAttribute?.("data-search-row")) return "row";
		if (node.hasAttribute?.("data-search-ignore")) return "ignore";
	}
	return null;
}

/** Mount one element inside a settings content column and return the container. */
async function mount(t, element) {
	const container = document.createElement("div");
	container.setAttribute("data-settings-content", "");
	document.body.append(container);
	const root = createRoot(container);
	t.after(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	});
	await act(async () => {
		root.render(element);
	});
	return container;
}

/** Every control in the container, with whether it is covered and by what. */
function coverage(container) {
	return Array.from(container.querySelectorAll(FOCUSABLE)).map((element) => ({
		description: `${element.tagName.toLowerCase()}${
			element.getAttribute("data-search-row")
				? `[data-search-row=${element.getAttribute("data-search-row")}]`
				: ""
		} "${(element.textContent ?? "").trim().slice(0, 40)}"`,
		marker: nearestMarker(element),
	}));
}

function assertEveryControlCovered(container) {
	const uncovered = coverage(container).filter(
		(entry) => entry.marker === null,
	);
	assert.deepEqual(
		uncovered.map((entry) => entry.description),
		[],
		"every focusable control sits inside a data-search-row or a data-search-ignore",
	);
}

test("the keyboard shortcuts section annotates one row per action", async (t) => {
	const container = await mount(
		t,
		components.createElement(components.KeyboardShortcutsSection),
	);
	assertEveryControlCovered(container);
	const rows = container.querySelectorAll("[data-search-row^='keyboard.']");
	assert.ok(rows.length >= 6, "one row per registry action");
	for (const row of rows) {
		assert.ok(
			row.querySelector(FOCUSABLE),
			"a keyboard row holds its recorder field",
		);
		assert.equal(row.hasAttribute("data-search-control"), true);
	}
	assert.equal(
		container.querySelector("[data-search-section='keyboard']") !== null,
		true,
		"and the section names itself for the panel's context line",
	);
});

test("the theme grid is out of scope, and says why", () => {
	/*
	 * Round 1 shipped it as ONE row; its label was then the whole subtree's
	 * text ("DarkLocal Operator DarkCatppuccin Macchiato…"), because JSX emits
	 * no separator between sibling names (review round 1, M3). There is no
	 * honest label for it without a new localized title, so it is marked out of
	 * scope with its reason and the Appearance section result is its
	 * destination. Not mounted here — `ThemeSelector` reaches MUI through the
	 * theme previews, which this harness cannot resolve as ESM (measured) — so
	 * the contract is read from the source rather than dressed up as a DOM pass.
	 */
	const source = readFileSync(
		"src/renderer/src/features/settings/components/theme-selector.tsx",
		"utf8",
	);
	assert.ok(source.includes("data-search-ignore="));
	assert.equal(source.includes('data-search-row="appearance.theme"'), false);
});

test("a shared row component's searchRow prop is what paints the markers", async (t) => {
	const toggle = await mount(
		t,
		components.createElement(components.ToggleSetting, {
			searchRow: "appearance.reasoning",
			value: false,
			label: "Show agent reasoning",
			onChange: async () => {},
		}),
	);
	assertEveryControlCovered(toggle);
	assert.equal(
		toggle.querySelector("[data-search-row='appearance.reasoning']") !== null,
		true,
	);

	const mode = await mount(
		t,
		components.createElement(components.TranscriptDisplayModeSetting, {
			searchRow: "appearance.transcript",
			value: "condensed",
			onChange: () => {},
		}),
	);
	assertEveryControlCovered(mode);

	const field = await mount(
		t,
		components.createElement(components.EditableField, {
			searchRow: "general.profile.name",
			value: "Damian",
			label: "Name",
			onSave: async () => {},
		}),
	);
	assertEveryControlCovered(field);

	const glass = await mount(
		t,
		components.createElement(components.WindowGlassSetting, {
			searchRow: "appearance.glass",
			state: null,
			onChange: async () => {},
		}),
	);
	assertEveryControlCovered(glass);
});

test("every ignore reason in the settings surface is in the ratchet table", () => {
	const files = [
		"src/renderer/src/features/settings/components/settings-page.tsx",
		"src/renderer/src/features/settings/components/speech-section.tsx",
		"src/renderer/src/features/settings/components/keyboard-shortcuts-section.tsx",
		"src/renderer/src/features/settings/components/theme-selector.tsx",
	];
	const reasons = new Set();
	for (const file of files) {
		const source = readFileSync(file, "utf8");
		for (const match of source.matchAll(
			/(?:data-search-ignore|searchIgnore)=(?:"([^"]+)"|\{"([^"]+)"\})/g,
		)) {
			reasons.add(match[1] ?? match[2]);
		}
	}
	assert.deepEqual(
		[...reasons].sort(),
		[...IGNORE_REASONS].sort(),
		"the shipped ignore reasons and the ratchet table agree, one line each",
	);
});

test("the search row contract is the one the index reads", () => {
	// The DOM contract, asserted against the module that consumes it: a rename
	// on one side without the other is the drift this file exists to stop.
	const source = readFileSync(
		"src/renderer/src/features/settings/search/settings-search-index.ts",
		"utf8",
	);
	for (const attribute of [
		"data-search-row",
		"data-search-terms",
		"data-search-section",
	]) {
		assert.ok(source.includes(attribute), attribute);
	}
	const jump = readFileSync(
		"src/renderer/src/features/settings/search/settings-search-jump.ts",
		"utf8",
	);
	assert.ok(jump.includes("data-search-control"));
});

test("every sidebar section the index offers has a resolvable root", () => {
	/*
	 * B1 (review round 1): the index offers one result per sidebar section, but
	 * five of the eleven had no `data-search-section` root, so pressing Enter on
	 * them moved nothing and said nothing. This is the ratchet for that class:
	 * the sidebar's ids and the roots the page renders must be the same set.
	 *
	 * Read from source rather than the DOM for the reason this file's header
	 * states — the page mounts MUI and the whole query graph — and the
	 * attributes are static in every one of these files.
	 */
	const SIDEBAR_IDS = [
		"general",
		"appearance",
		"speech",
		"keyboard",
		"providers",
		"integrations",
		"radient",
		"agent-messages",
		"backend",
		"imports",
		"updates",
	];
	const sources = [
		"src/renderer/src/features/settings/components/settings-page.tsx",
		"src/renderer/src/features/settings/components/speech-section.tsx",
		"src/renderer/src/features/settings/components/keyboard-shortcuts-section.tsx",
		"src/renderer/src/features/settings/components/mcp-management-section.tsx",
	].map((file) => readFileSync(file, "utf8"));
	const declared = new Set();
	for (const source of sources) {
		for (const match of source.matchAll(
			/(?:data-search-section|searchSection)="([^"${}]+)"/g,
		)) {
			declared.add(match[1]);
		}
	}
	assert.deepEqual(
		[...declared].sort(),
		[...SIDEBAR_IDS].sort(),
		"the sidebar's ids and the rendered section roots agree",
	);
});

test("the Model settings row names itself with the heading's own string (QA round 2b, Q6b)", () => {
	/*
	 * The hosting/model/effort trio is one row with no title of its own: before
	 * this, its index label was the concatenated text of three selects, so a
	 * reader typing "model" — the word the section heading prints — competed
	 * against twelve registry rows literally labelled that word and never saw the
	 * page's own row inside the cap (QA round 2b, Q6b).
	 *
	 * Asserted from source for the reason this file's header gives (the page
	 * mounts MUI and its query graph, which jsdom cannot resolve), and asserted
	 * as the SAME catalogue key the section heading reads — so the label cannot
	 * drift into a second spelling of the section's name.
	 */
	const source = readFileSync(
		"src/renderer/src/features/settings/components/settings-page.tsx",
		"utf8",
	);
	const at = source.indexOf('data-search-row="general.model"');
	assert.ok(at > 0, "the model row is still one indexed row");
	const opening = source.slice(at, at + 900);
	assert.ok(
		at + 900 < source.length && source.indexOf(">", at) > 0,
		"the row's opening tag is inside the window this test reads",
	);
	assert.ok(
		at < source.indexOf("data-search-label", at) &&
			source.indexOf("data-search-label", at) < source.indexOf(">", at),
		"the row's opening tag carries its own search label",
	);
	assert.ok(
		opening.includes("ui.settings.model.settings_page.model_settings"),
		"and that label is the string the section heading prints",
	);
});
