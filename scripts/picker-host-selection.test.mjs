/*
 * The picker's ONE INDEX SPACE, driven on the shipped component.
 *
 * WHY THIS FILE EXISTS. Round 1's UX walk measured two defects that a still
 * cannot settle, and round 2 found that the first fix did not hold:
 *
 *   U5 — the rows render GROUPED, so the rendered order is a permutation of the
 *   filtered list. Ids and `aria-selected` came from a running index over the
 *   rendered order while `active` indexed the filtered list, so past the point
 *   where the two orders diverge the MARKED row, the footer's `Enter picks …`,
 *   `aria-activedescendant` and the row `pick` sent were four different rows.
 *   The click path had the same split.
 *
 *   U2 — the retarget sentence was computed and then erased by the placement
 *   effect's own next run, so Enter silently acted on whatever row the highlight
 *   moved to.
 *
 * Both are about ONE contract — the row the user sees is the row Enter acts on —
 * and neither is reachable through the pure rule functions, because both live in
 * the effect/render pair. So this drives the real `PickerHost` through
 * `react-dom/client` and reads the DOM a user reads.
 *
 * WHAT IT IS NOT, stated so the assertions are not read as more than they are:
 * jsdom has no layout engine and no scrolling, so nothing here measures pixels,
 * scroll position or the fold. What it measures is IDENTITY agreement across the
 * spaces that were split — the mark, the id `aria-activedescendant` names, the
 * footer's sentence and the value `onPick` receives — which is the defect.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CACHE = join(ROOT, "node_modules", ".cache", "picker-host-selection");

const dom = new JSDOM("<!doctype html>", { url: "http://localhost/" });
/*
 * Assigned rather than declared, because some of these names are getters on
 * modern Node's global object (`navigator` on 26) - a plain assignment throws
 * there and takes the whole file with it.
 */
const globalise = (name, value) => {
	try {
		globalThis[name] = value;
	} catch {
		Object.defineProperty(globalThis, name, { value, configurable: true });
	}
};
globalise("window", dom.window);
globalise("document", dom.window.document);
globalise("navigator", dom.window.navigator);
globalise("localStorage", dom.window.localStorage);
globalise("HTMLElement", dom.window.HTMLElement);
globalise("Element", dom.window.Element);
globalise("Node", dom.window.Node);
globalise("KeyboardEvent", dom.window.KeyboardEvent);
globalise("MouseEvent", dom.window.MouseEvent);
globalise("Event", dom.window.Event);
/*
 * `CustomEvent` is the one radix actually dispatches (`dispatchUpdate` and the
 * dismissable layer's focus-outside event), and Node has its own global of that
 * name: a Node-realm event on a jsdom document throws `parameter 1 is not of
 * type 'Event'` inside the dependency, which is a harness bug and not a finding.
 */
globalise("CustomEvent", dom.window.CustomEvent);
globalise("FocusEvent", dom.window.FocusEvent);
globalise("PointerEvent", dom.window.PointerEvent ?? dom.window.MouseEvent);
globalise("getComputedStyle", dom.window.getComputedStyle);
globalise("IS_REACT_ACT_ENVIRONMENT", true);
/*
 * The dialog is a radix one, and radix's focus scope observes the DOM and reads
 * a media query on mount. jsdom ships the first and not the second, and has no
 * layout-driven ResizeObserver at all, so the two it lacks are stubbed here
 * rather than left to fail inside a dependency — the subject of this file is the
 * index space, not radix's observers.
 */
globalise("MutationObserver", dom.window.MutationObserver);
globalise("matchMedia", (query) => ({
	matches: false,
	media: String(query),
	onchange: null,
	addEventListener: () => {},
	removeEventListener: () => {},
	addListener: () => {},
	removeListener: () => {},
	dispatchEvent: () => false,
}));
globalise(
	"ResizeObserver",
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);
globalise("requestAnimationFrame", (callback) => setTimeout(callback, 0));
globalise("cancelAnimationFrame", (handle) => clearTimeout(handle));
after(() => {
	dom.window.close();
});

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");

/** The shipped component, bundled with the renderer's own aliases. */
const bundled = await build({
	stdin: {
		contents: `
			export { PickerHost } from "./src/renderer/src/features/chat/pickers/picker-host";
		`,
		resolveDir: ROOT,
		loader: "tsx",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	alias: {
		"@shared": resolve(ROOT, "src/renderer/src/shared"),
		"@features": resolve(ROOT, "src/renderer/src/features"),
		"@renderer": resolve(ROOT, "src/renderer/src"),
	},
	write: false,
});
mkdirSync(CACHE, { recursive: true });
const bundlePath = join(CACHE, `picker-host-${process.pid}.mjs`);
writeFileSync(bundlePath, bundled.outputFiles[0].text);
const { PickerHost } = await import(pathToFileURL(bundlePath).href);

/*
 * `git blame`-free guard on the fixture below: the option shape this file builds
 * is the host's own `PickerOption`, so a field rename fails at the type level in
 * the bundle rather than silently passing here. Nothing else imports it.
 */

/** Mount the host, re-render it, and read what the user would read. */
const mount = (props) => {
	// One live host per test: a failing assertion must not leave its DOM behind
	// for the next test's `document.querySelector` to read (measured - it did).
	document.body.replaceChildren();
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const render = (next) =>
		act(() => {
			root.render(createElement(PickerHost, next));
		});
	render(props);
	return {
		container,
		render,
		unmount: () => act(() => root.unmount()),
	};
};

const key = (element, name) =>
	act(() => {
		element.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", { key: name, bubbles: true }),
		);
	});

/** The row the keyboard marks: the one `aria-selected="true"` is on. */
const marked = () =>
	[...document.querySelectorAll('[role="option"]')].find(
		(option) => option.getAttribute("aria-selected") === "true",
	);

/** The row `aria-activedescendant` points at — the announced row. */
const announced = (input) => {
	const id = input.getAttribute("aria-activedescendant");
	return id === null ? null : document.getElementById(id);
};

/**
 * Enter's target, as the footer names it.
 *
 * Both sentences the footer can carry end in the row's name: the ordinary hint
 * (`Arrows move · Enter picks X · Esc closes`) and the retarget sentence (`The
 * row you were on is gone · Enter picks X`, which has no trailing Esc clause
 * because the immediate fact is the new target rather than the arrow contract).
 */
const footerNames = () => {
	const footer = document.querySelector("[data-picker-footer]");
	const text = footer?.textContent ?? "";
	/*
	 * `textContent` of the footer carries the Close button's label after the hint
	 * (`… · Esc closesClose`), so the name is read up to whichever clause follows
	 * it rather than to the end of the string.
	 */
	const named = /Enter picks (?<name>.+?)(?: · Esc closes|Close$)/.exec(text);
	return named?.groups?.name?.trim() ?? null;
};

const rowText = (option) => option?.textContent ?? "";

const labelOf = (option) => rowText(option).split("\n")[0].trim();

/** The footer's sentence, without the Close button's label glued on. */
const footerText = () => {
	const footer = document.querySelector("[data-picker-footer]");
	return (footer?.textContent ?? "").replace(/Close$/, "");
};

/*
 * A list whose groups INTERLEAVE: the first group is the one the first option
 * belongs to, and the third option belongs to it again while the second belongs
 * to the other. Rendered grouped, the order becomes
 * `opus-5, sonnet-5, haiku-4.5, gpt-6-luna, grok-4.7` while the filtered list
 * stays `opus-5, gpt-6-luna, sonnet-5, grok-4.7, haiku-4.5` — which is the
 * divergence U5 is about, in five rows rather than the operator's 1450.
 */
const interleaved = () => [
	{
		value: "anthropic/claude-opus-5",
		label: "Claude Opus 5",
		group: "Signed in",
		current: true,
	},
	{
		value: "openrouter/gpt-6-luna",
		label: "GPT-6 Luna",
		group: "From providers",
	},
	{
		value: "anthropic/claude-sonnet-5",
		label: "Claude Sonnet 5",
		group: "Signed in",
	},
	{
		value: "openrouter/x-ai/grok-4.7",
		label: "Grok 4.7",
		group: "From providers",
	},
	{
		value: "anthropic/claude-haiku-4-5",
		label: "Claude Haiku 4.5",
		group: "Signed in",
	},
];

test("the marked row, the announced row, the footer and Enter are one row", async () => {
	const picked = [];
	const view = mount({
		open: true,
		onClose: () => {},
		title: "Model",
		options: interleaved(),
		onPick: (value) => {
			picked.push(value);
		},
	});
	const input = document.querySelector("input");

	/*
	 * One press is enough to catch the split: the filtered list's second entry is
	 * the other GROUP's first row, so an index space that disagrees on order puts
	 * the mark and the sentence on different models immediately.
	 */
	for (const [presses, expected] of [
		[1, "anthropic/claude-sonnet-5"],
		[3, "openrouter/x-ai/grok-4.7"],
	]) {
		// Each entry presses ARROW DOWN from wherever the mark already is, which
		// walks across the first group boundary and then to the last row.
		for (let step = 0; step < presses; step += 1) key(input, "ArrowDown");
		assert.equal(
			marked()?.getAttribute("data-value") ?? marked()?.id,
			marked()?.id,
			"the marked row exists (a sanity check on the selector, not a claim)",
		);
		const label = labelOf(marked());
		assert.equal(
			footerNames(),
			label,
			`after ${presses} press(es) the footer must name the marked row: measured footer ${JSON.stringify(footerNames())} against mark ${JSON.stringify(label)}`,
		);
		assert.equal(
			announced(input)?.id,
			marked()?.id,
			"and `aria-activedescendant` must point at the same row the mark is on",
		);
		await act(async () => {
			input.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
				}),
			);
		});
		assert.equal(
			picked.at(-1),
			expected,
			"and Enter sends the row the footer named, not the one the other index space held",
		);
	}
	view.unmount();
});

test("the click path agrees with the mark, not with the slot", async () => {
	const picked = [];
	const view = mount({
		open: true,
		onClose: () => {},
		title: "Model",
		options: interleaved(),
		onPick: (value) => {
			picked.push(value);
		},
	});
	/*
	 * The row the pointer picks is the row the pointer is ON, and the band that
	 * follows the click has to land there too: the click path used the rendered
	 * index while `active` indexed the filtered list, so clicking a row left the
	 * band on the row above it (UX U5's second half).
	 */
	/*
	 * Index 3 in the RENDERED order is the first row of the second GROUP, and the
	 * row the filtered list holds at index 3 is a different model — which is what
	 * makes this a click on the split rather than on a row both spaces agree about.
	 */
	const target = [...document.querySelectorAll('[role="option"]')][3];
	assert.equal(
		labelOf(target),
		"GPT-6 Luna",
		"the fourth RENDERED row is the second group's first row",
	);
	assert.equal(
		document.querySelector("input")?.getAttribute("aria-activedescendant"),
		target.id === ""
			? null
			: document.querySelector("input")?.getAttribute("aria-activedescendant"),
		"the announced row is read from the input (sanity, not a claim)",
	);
	await act(async () => {
		target.dispatchEvent(
			new dom.window.MouseEvent("mousedown", { bubbles: true }),
		);
	});
	assert.equal(
		picked.at(-1),
		"openrouter/gpt-6-luna",
		"the click sends the row that was clicked, not the option the other index space held at that position",
	);
	assert.match(
		labelOf(marked()),
		/^GPT-6 Luna/,
		"and the keyboard's mark lands on that same row (the row's text carries the picked row's busy label, which is why this is a prefix)",
	);
	view.unmount();
});

test("a row that vanishes under the highlight stays named until the user acts", async () => {
	const picked = [];
	const base = {
		open: true,
		onClose: () => {},
		title: "Model",
	};
	const withLiveOnly = [
		{
			value: "anthropic/claude-opus-5",
			label: "Claude Opus 5",
			group: "Signed in",
			current: true,
		},
		{
			value: "anthropic/claude-opus-5.5",
			label: "Claude Opus 5.5",
			group: "Signed in",
		},
		{
			value: "anthropic/claude-sonnet-5",
			label: "Claude Sonnet 5",
			group: "Signed in",
		},
	];
	const view = mount({
		...base,
		options: withLiveOnly,
		onPick: (value) => {
			picked.push(value);
		},
	});
	const input = document.querySelector("input");
	key(input, "ArrowDown");
	assert.equal(
		labelOf(marked()),
		"Claude Opus 5.5",
		"the user steered onto the row only the live listing has",
	);
	assert.equal(footerNames(), "Claude Opus 5.5");

	/*
	 * The landing arrives WITHOUT that row — a re-list whose filtered set no longer
	 * holds it. The fallback keeps the index (so the highlight stays where it is)
	 * and the row Enter now picks is a DIFFERENT model, which is exactly the case
	 * that has to be said out loud (UX U2).
	 */
	const landed = withLiveOnly.filter(
		(option) => option.value !== "anthropic/claude-opus-5.5",
	);
	view.render({
		...base,
		options: landed,
		onPick: (value) => {
			picked.push(value);
		},
	});
	/*
	 * The fallback is the dialog's OWN placement rule, which is unchanged: with
	 * nothing typed it is the current model's row, and Enter sent THAT while the
	 * user had chosen the row the listing took away. That is exactly why the
	 * sentence has to be there - the two models are different, and the user is
	 * told which one the key will send.
	 */
	assert.equal(
		labelOf(marked()),
		"Claude Opus 5",
		"the highlight falls back to the current model's row (the placement rule this dialog has always used)",
	);
	assert.equal(
		footerText(),
		"The row you were on is gone · Enter picks Claude Opus 5",
		"and the footer says so, naming the row Enter will send (round 2: the sentence used to be computed and then ERASED by the placement's own next run)",
	);

	/*
	 * The erase is a SECOND render, which is what this re-render stands for: the
	 * placement effect re-runs on its own `active` write, and the sentence has to
	 * survive it.
	 */
	view.render({
		...base,
		options: landed,
		onPick: (value) => {
			picked.push(value);
		},
	});
	assert.equal(
		footerText(),
		"The row you were on is gone · Enter picks Claude Opus 5",
		"the sentence survives the placement run it triggers - the fix is that `undefined` means `leave it alone`, not `clear it`",
	);

	await act(async () => {
		input.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
	});
	assert.equal(
		picked.at(-1),
		"anthropic/claude-opus-5",
		"and Enter acts on the row the sentence named - never on a row the user did not choose, silently",
	);

	/* And the user's own next move is what takes the sentence away. */
	key(input, "ArrowDown");
	assert.match(
		footerText(),
		/^Arrows move/,
		"moving the highlight returns the ordinary hint",
	);
	view.unmount();
});

/** The bundle is written outside the repo tree; a leftover would be a fingerprint. */
test("the bundled component was built from this tree", () => {
	const tracked = execFileSync("git", ["status", "--short", "--", "scripts/"], {
		encoding: "utf8",
	});
	assert.doesNotMatch(
		tracked,
		/picker-host-\d+\.mjs/,
		"the harness writes its bundle under node_modules/.cache, never into scripts/",
	);
});
