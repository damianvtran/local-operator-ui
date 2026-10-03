/*
 * The combobox's behavioural rules, driven directly rather than through a frame.
 *
 * A frame can show that a list narrowed; it cannot show WHY, and none of these
 * rules is visible in a screenshot:
 *
 * 1. the FILTER — a case- and accent-insensitive substring match over the shown
 *    name, and the deliberate exception that makes clicking the field show the
 *    whole list instead of the one row already chosen;
 * 2. the ROWS — the options a query admits, then the row that carries the typed
 *    text, which is what keeps "assist, never constrain" true without the trap
 *    it used to set;
 * 3. what ENTER does — the resolved active row, where "resolved" means the
 *    stored highlight, an exact name match, or else the first row of a NARROWED
 *    list, and nothing at all for a field at rest or an empty buffer;
 * 4. the KEYWORDS — the second matchable term a row may carry beside its shown
 *    name (a team's slug when the row displays a label, an alias): it matches
 *    in the filter, suppresses the custom row when the typed text IS that term
 *    (the option's own row is then the typed value), and wins the exact arm of
 *    the keyboard resolution — so "type the key, press Enter" takes the row the
 *    key names (round 1, R1-1: the start-session dialog stopped answering a
 *    team's slug the moment its row started showing the label).
 *
 * Rule 3 is the whole of the keyboard contract, and it is the one this file
 * exists for: "type three characters, press Enter" used to commit the three
 * characters as a value — a stored provider that no registry had ever heard of,
 * with nothing on the page saying so (UX round 1, U1). Both halves of the fix
 * are pinned here, and each of them fails if the other is removed:
 *
 * - take the visible match → `resolveActiveIndex` gets no "first row" default;
 * - keep the typed value committable → `buildComboboxRows` gets no custom row.
 *
 * Every function is exported FROM the shipped component module, so this file
 * cannot pass while the component disagrees with it.
 */
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const bundle = await build({
	stdin: {
		contents:
			'export { buildComboboxRows, filterSearchableOptions, fold, navigableRowCount, resolveActiveIndex, resolveEnter } from "./src/renderer/src/shared/components/ui/searchable-select";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: { "@shared": "./src/renderer/src/shared" },
	write: false,
});
const {
	buildComboboxRows,
	filterSearchableOptions,
	fold,
	navigableRowCount,
	resolveActiveIndex,
	resolveEnter,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const option = (id, name) => ({ id, name });
const OPTIONS = [
	option("gpt-4o", "openai/gpt-4o"),
	option("claude-opus-5", "anthropic/claude-opus-5"),
	option("gemini-ultra", "Google Gemini Ultra"),
	option("accented", "Café Modèle"),
];

/** The provider list the settings field shows: grouped, and with a shorter name
 * that contains a longer one, so "the first row" and "the exact row" differ. */
const GROUPED = [
	{ id: "lmstudio", name: "LM Studio", group: "Needs a running server" },
	{ id: "ollama", name: "Ollama", group: "Needs a running server" },
	{ id: "anthropic", name: "Anthropic", group: "Needs sign-in" },
	{
		id: "anthropic-max",
		name: "Anthropic (Claude Pro/Max)",
		group: "Needs sign-in",
	},
];

const names = (options) => options.map((entry) => entry.name);

/** The rows the listbox would draw for this state. */
const rowsFor = (options, query, selectedName = "", customRow = true) =>
	buildComboboxRows(options, query, selectedName, customRow);

/** The row the keyboard is on, with no arrow key pressed (`activeIndex` -1). */
const activeFor = (options, query, selectedName = "", customRow = true) => {
	const rows = rowsFor(options, query, selectedName, customRow);
	return resolveActiveIndex(rows, query, selectedName, -1);
};

/** What Enter commits for this state, driving the same three steps the
 * component does: build the rows, resolve the active row, read the answer. */
const enterFor = (
	options,
	query,
	selectedName = "",
	customRow = true,
	activeIndex = -1,
) => {
	const rows = rowsFor(options, query, selectedName, customRow);
	return resolveEnter(
		rows,
		resolveActiveIndex(rows, query, selectedName, activeIndex),
	);
};

test("fold strips accents and case, as the MUI default filter did", () => {
	// Dropping the accent fold would quietly break names that arrive from the
	// API with combining marks.
	assert.equal(fold("Café"), "cafe");
	assert.equal(fold("CAFÉ"), "cafe");
	assert.equal(fold("Gemini Ultra"), "gemini ultra");
});

test("an empty query, and the query equal to the selection, show everything", () => {
	// The second half is what makes clicking an already-filled field show the
	// whole list instead of the single row that is chosen — the exception that
	// is easy to lose and reads to a user as "the list is empty".
	assert.deepEqual(
		names(filterSearchableOptions(OPTIONS, "", "openai/gpt-4o")),
		names(OPTIONS),
	);
	assert.deepEqual(
		names(filterSearchableOptions(OPTIONS, "openai/gpt-4o", "openai/gpt-4o")),
		names(OPTIONS),
	);
	assert.deepEqual(
		names(filterSearchableOptions(OPTIONS, "   ", "openai/gpt-4o")),
		names(OPTIONS),
	);
});

test("the filter is a case- and accent-insensitive substring match", () => {
	assert.deepEqual(names(filterSearchableOptions(OPTIONS, "ANTHROPIC", "")), [
		"anthropic/claude-opus-5",
	]);
	assert.deepEqual(names(filterSearchableOptions(OPTIONS, "cafe", "")), [
		"Café Modèle",
	]);
	// A substring, not a prefix: the settings rows show `provider/model`, so
	// typing the provider narrows while the accepted value stays bare.
	assert.deepEqual(names(filterSearchableOptions(OPTIONS, "opus", "")), [
		"anthropic/claude-opus-5",
	]);
	assert.deepEqual(
		filterSearchableOptions(OPTIONS, "nothing-mat\nches", ""),
		[],
	);
});

test("a query that narrows the list makes its first row the active row", () => {
	// U1, first half. Nothing has been arrowed to, but the user is LOOKING at
	// one row, so that is the row Enter acts on.
	// `ant` admits two rows — `Anthropic` and `Anthropic (Claude Pro/Max)` —
	// and the active row is the first of them, in the keyboard's own numbering.
	assert.equal(activeFor(GROUPED, "ant"), 0);
	// A group heading is not a row and is never the answer: `ollama` admits one
	// option, which sits under a heading, and the answer is still 0.
	assert.equal(activeFor(GROUPED, "ollama"), 0);
	// And no typed-text row: the query already IS that option's name, so the
	// option's row is the value and a second row saying the same thing would be
	// two ways to commit one thing.
	assert.equal(navigableRowCount(rowsFor(GROUPED, "ollama")), 1);
});

test("typing a filter and pressing Enter takes the visible match, not the filter", () => {
	// The reported gesture, end to end: type `ant`, see one row, press Enter.
	// Before the fix this committed the string "ant" as the provider.
	assert.deepEqual(enterFor(GROUPED, "ant"), {
		kind: "option",
		option: GROUPED[2],
	});
});

test("an exact name match still wins over the first narrowed row", () => {
	// A list where the exact spelling is NOT the first row it narrows to: the
	// longer name comes first in the listing, so "first row" and "the row that
	// spells the query" are different answers.
	const longerFirst = [
		GROUPED[3],
		GROUPED[2],
		{
			id: "anthropic-vertex",
			name: "Anthropic on Vertex",
			group: "Needs sign-in",
		},
	];
	assert.equal(activeFor(longerFirst, "Anthropic"), 1);
	assert.deepEqual(enterFor(longerFirst, "anthropic"), {
		kind: "option",
		option: GROUPED[2],
	});
	// And the accent/case fold still decides which row is "exact".
	assert.deepEqual(enterFor(OPTIONS, "CAFÉ MODÈLE"), {
		kind: "option",
		option: OPTIONS[3],
	});
});

test("a field at rest keeps no active row, so Enter cannot re-pick for the user", () => {
	// The other half of the same rule, and the reason the default is not simply
	// "row 0": a field opened with its own value in it shows EVERY row, and the
	// first of those is arbitrary. Clicking the field and pressing Enter must
	// not silently replace the value with whatever happens to be first.
	assert.equal(activeFor(GROUPED, "Ollama", "Ollama"), -1);
	assert.equal(activeFor(GROUPED, "", ""), -1);
	assert.deepEqual(enterFor(GROUPED, "Ollama", "Ollama"), { kind: "none" });
	assert.deepEqual(enterFor(GROUPED, "", ""), { kind: "none" });
});

test("the typed text gets its own row, last, and only when free text is allowed", () => {
	const rows = rowsFor(OPTIONS, "my/custom-id");
	assert.equal(rows.at(-1).kind, "custom");
	assert.equal(rows.at(-1).text, "my/custom-id");
	// Its index is one past the last VISIBLE option, which is what the keyboard
	// numbering is in — no query matched, so it is row 0.
	assert.equal(rows.at(-1).index, 0);
	assert.equal(
		rowsFor(OPTIONS, "gpt").at(-1).index,
		filterSearchableOptions(OPTIONS, "gpt", "").length,
	);
	// A field that rejects free text must not offer the row …
	assert.equal(
		rowsFor(OPTIONS, "my/custom-id", "", false).some(
			(row) => row.kind === "custom",
		),
		false,
	);
	// … and neither must one whose query already IS a row's own name, because
	// then that option's row is the typed value.
	assert.equal(
		rowsFor(OPTIONS, "anthropic/claude-opus-5").some(
			(row) => row.kind === "custom",
		),
		false,
	);
});

test("the typed text is committed by its own row, and by nothing else", () => {
	// U1, second half. Enter on the filtered list takes the match; reaching the
	// last row takes the text. Both are visible gestures, which is what makes
	// "suggestions assist, they do not constrain" survivable.
	const rows = rowsFor(GROUPED, "zzz-not-a-provider");
	const last = navigableRowCount(rows) - 1;
	assert.deepEqual(
		enterFor(GROUPED, "  zzz-not-a-provider  ", "", true, last),
		{
			kind: "custom",
			text: "zzz-not-a-provider",
		},
	);
	// The same query with a row to match: the match is taken by default, and the
	// typed text only by explicitly reaching its row.
	assert.deepEqual(enterFor(GROUPED, "ant"), {
		kind: "option",
		option: GROUPED[2],
	});
	assert.deepEqual(
		enterFor(
			GROUPED,
			"ant",
			"",
			true,
			navigableRowCount(rowsFor(GROUPED, "ant")) - 1,
		),
		{ kind: "custom", text: "ant" },
	);
});

test("an empty buffer is nobody's, even with rows on screen", () => {
	// Clearing is a deliberate gesture with its own affordance; "delete the text
	// and press Enter" must not write the empty string by accident. The custom
	// row is keyed on non-empty text, so an empty buffer has no row to land on.
	assert.deepEqual(enterFor(OPTIONS, ""), { kind: "none" });
	assert.deepEqual(enterFor(OPTIONS, "   "), { kind: "none" });
});

/*
 * The KEYWORDS (round 1, R1-1). The rows below are the start-session dialog's
 * shape after the team-label change: the shown name is a human label and the
 * team's actual key rides as a keyword, the way that dialog now passes it.
 */
const TEAM_OPTIONS = [
	{
		id: "team:release-crew",
		name: "Release Engineering",
		keywords: ["release-crew"],
	},
	{ id: "team:docs-pod", name: "docs-pod" },
];

test("a keyword keeps a row findable when its name is a human label", () => {
	// The label matches through the name, as it always did …
	assert.deepEqual(
		names(filterSearchableOptions(TEAM_OPTIONS, "release", "")),
		["Release Engineering"],
	);
	// … and the SLUG the row no longer shows matches through its keyword — the
	// full hyphenated key, and a fragment of it.
	assert.deepEqual(
		names(filterSearchableOptions(TEAM_OPTIONS, "release-crew", "")),
		["Release Engineering"],
	);
	assert.deepEqual(names(filterSearchableOptions(TEAM_OPTIONS, "crew", "")), [
		"Release Engineering",
	]);
	// A row without a keyword keeps matching by its name alone: the mechanism is
	// additive, not a rewrite of the rule.
	assert.deepEqual(names(filterSearchableOptions(TEAM_OPTIONS, "docs", "")), [
		"docs-pod",
	]);
	assert.deepEqual(filterSearchableOptions(TEAM_OPTIONS, "zzz", ""), []);
});

test("typing a row's exact keyword commits that row, not a copy of the text", () => {
	// The custom row is suppressed: the typed text IS the option's own term,
	// so the option's row is the typed value and offering a second row would
	// make the same choice twice.
	assert.equal(
		rowsFor(TEAM_OPTIONS, "release-crew").some((row) => row.kind === "custom"),
		false,
	);
	// Enter takes it — an exact keyword match wins over "first visible", the
	// same deliberate-act rule an exact NAME has always had.
	assert.deepEqual(enterFor(TEAM_OPTIONS, "release-crew"), {
		kind: "option",
		option: TEAM_OPTIONS[0],
	});
	// Text that matches no term still gets its own row, keyworded or not.
	assert.deepEqual(enterFor(TEAM_OPTIONS, "release-plz"), {
		kind: "custom",
		text: "release-plz",
	});
});

/* --------------------------------------------------------- the forwarded ref --
 *
 * WHAT A CONSUMER MUST BE ABLE TO HAND THE INLINE-EDIT MACHINE, and the dead
 * end that made it a defect rather than a nicety.
 *
 * The shared inline-edit machine reaches its editor through ONE `editorRef`: it
 * focuses that element when the field enters editing, and it scopes Enter by
 * comparing `event.target` to it (`use-inline-edit.ts`, the focus-on-begin
 * effect and `handleKeyDown`). Every agents/teams picker field - a team's
 * manager, a member's role, an agent's effort - is this control, so if the
 * control forwards no ref the consumer has no element to give the machine: the
 * focus effect returns early, and pressing the pencil leaves focus on the
 * pencil with the picker unopened.
 *
 * WHY THE CASES MOUNT RATHER THAN READ THE SOURCE. A `forwardRef` assertion made
 * by reading the file would pass on a ref that flowed to the wrong node. The
 * `PopoverAnchor` wrapper around the input is a plain `div` with no `tabIndex`:
 * it takes no focus, and a keydown's `target` is never it, so a ref landing
 * there fixes nothing while looking exactly like the fix. The cases below
 * therefore mount the SHIPPED component and name the element the machine would
 * actually reach. What they cannot claim is layout - jsdom draws nothing - and
 * none of this is about pixels.
 *
 * The chain is pinned in three pieces rather than one live press of the pencil:
 * the control's ref IS the focusable combobox input (first case), the consumer's
 * single `editorRef` receives it (second), and the machine focuses whatever
 * `editorRef` it was handed (third). Composed, those are the claim; keeping them
 * separate is what makes the popover's open - the one expensive thing here -
 * reachable only by the case that does not need the machine mounted around it.
 *
 * The harness (jsdom bootstrap, an esbuild bundle imported by file URL so its
 * bare `react` externals resolve, a `createRoot` mount driven under `act`) is
 * the one `typed-row-call-sites.test.mjs` uses for the same component.
 */
const refDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	// Radix resolves anchors through `new URL(...)`, which needs a document
	// address rather than jsdom's default `about:blank`.
	url: "http://localhost/agents",
});
/*
 * The DOM classes jsdom owns are FORCED onto the global, including the ones
 * Node already defines: Node defines `Event`/`CustomEvent` itself, and Radix
 * would build its document-level events from NODE's classes, which jsdom then
 * refuses with `parameter 1 is not of type 'Event'` - thrown from React's
 * commit phase, where it reads as a component bug rather than a harness one.
 */
const FORCE_FROM_JSDOM = [
	"Event",
	"CustomEvent",
	"UIEvent",
	"MouseEvent",
	"PointerEvent",
	"KeyboardEvent",
	"FocusEvent",
	"InputEvent",
	"CompositionEvent",
	"HTMLElement",
	"Element",
	"Node",
	"DocumentFragment",
	"Range",
	"Selection",
	"DOMRect",
	"DOMRectReadOnly",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
];
for (const key of Object.getOwnPropertyNames(refDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = refDOM.window[key];
	} catch {
		// A few of jsdom's own accessors refuse to be read out of scope.
	}
}
globalThis.window = refDOM.window;
globalThis.document = refDOM.window.document;
// React refuses `act` outside a declared act environment.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom implements no scrolling, and ships no `ResizeObserver` for Radix.
refDOM.window.Element.prototype.scrollIntoView = () => {};
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
const { createRoot } = await import("react-dom/client");

const refBundle = await build({
	stdin: {
		contents: `
			export { SearchableSelect } from "./src/renderer/src/shared/components/ui/searchable-select";
			export { useInlineEdit } from "./src/renderer/src/shared/components/inline-edit/use-inline-edit";
			export { inlineEditEditorShown } from "./src/renderer/src/shared/components/inline-edit/inline-edit-model";
		`,
		loader: "tsx",
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: { "@shared": "./src/renderer/src/shared" },
	/*
	 * React stays external so the bundle shares ONE copy with this file's own
	 * imports: two copies hand the component a different dispatcher than the one
	 * `act` drives, and that failure reads as a hook called outside a component.
	 */
	external: ["react", "react-dom", "react/jsx-runtime"],
	packages: "external",
	// Stylesheets carry no assertion here and Node cannot import them.
	loader: { ".css": "empty" },
	jsx: "automatic",
});
/*
 * Written beside this file and imported by URL rather than inlined as a `data:`
 * URL: the bundle's externals are bare specifiers (`react/jsx-runtime` above
 * all), and only a file URL resolves those against `node_modules`. The name is
 * process-unique so two runs in one tree cannot clobber each other's module.
 */
const refBundlePath = new URL(
	`./_searchable-select-ref-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(refBundlePath, refBundle.outputFiles[0].text);
after(() => unlink(refBundlePath).catch(() => {}));
const { SearchableSelect, useInlineEdit, inlineEditEditorShown } = await import(
	refBundlePath.href
);

const h = React.createElement;

/** The picker's options as the agents/teams lane builds them: agents and teams. */
const PICKER_OPTIONS = [
	{ id: "aida", name: "aida", group: "Agents" },
	{ id: "docs-pod", name: "docs-pod", group: "Teams" },
];

/** A field's own words; the machine names the field in all of them. */
const AGENT_LABELS = {
	name: "Manager agent",
	begin: "Edit manager agent",
	accept: "Save manager agent",
	cancel: "Discard the manager agent edit",
	busy: "Saving the manager agent",
	saved: "Manager agent saved",
};

/** The props every agents/teams picker passes, transcribed from `team-detail`. */
const pickerProps = (ref) => ({
	ref,
	ariaLabel: "Manager agent",
	showLabel: false,
	placeholder: "Choose a manager",
	busyLabel: "Loading agents",
	options: PICKER_OPTIONS,
	selected: null,
	onSelect: () => {},
});

const mountInto = async (element) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(element);
	});
	return {
		container,
		async unmount() {
			await act(async () => root.unmount());
			container.remove();
		},
	};
};

test("the control forwards its ref to the focusable combobox input, not to a wrapper div", async () => {
	const ref = React.createRef();
	const view = await mountInto(h(SearchableSelect, pickerProps(ref)));
	const input = view.container.querySelector('input[role="combobox"]');
	assert.ok(input, "the control must render its combobox input");
	assert.equal(
		ref.current,
		input,
		"the forwarded ref must be the combobox input itself: the PopoverAnchor div around it has no tabIndex, so a ref to it would take no focus and never be a keydown's target",
	);
	assert.equal(ref.current.getAttribute("role"), "combobox");
	// The machine's ONLY use of the element is `.focus()`, so focusability is
	// the property the contract is really about.
	//
	// DELIBERATELY NOT wrapped in `act`: focusing this control OPENS its popover,
	// and Radix's open machinery under `act` is the one thing in this harness that
	// is slow (a measured ~10s per case, the same cost `typed-row-call-sites.test.mjs`
	// pays for its four popover opens) - while in a `act(() => input.focus())`
	// AFTER the mount it does not settle at all, which is why the shape here is
	// "mount, then focus outside the act". Nothing asserted below depends on
	// React having processed the open: `.focus()` is a DOM call and
	// `document.activeElement` is a DOM reading.
	ref.current.focus();
	assert.equal(
		document.activeElement,
		ref.current,
		"the forwarded element must be one the machine can actually focus",
	);
	await view.unmount();
});

test("a consumer's single editorRef reaches the picker's own control", async () => {
	/*
	 * The consumer's shape, and the reason the control had to forward anything at
	 * all: ONE `editorRef` object, handed to the machine through `useInlineEdit`
	 * and to the control through `ref`. This case proves the control writes into
	 * that shared object; the case below proves the machine then focuses it.
	 *
	 * The machine is mounted here only to hold the ref it would hold in the real
	 * field - the picker is rendered unconditionally because what is under test is
	 * the ref's identity, not the machine's phase gate (whose own tests own that).
	 * Starting the field instead (`beginOnMount`) buys the same assertion for the
	 * popover-open cost noted above.
	 */
	const editorRef = React.createRef();
	const fieldRef = React.createRef();
	const Harness = () => {
		const api = useInlineEdit({
			value: "aida",
			commit: async () => {},
			keyboardCommit: false,
			editorRef,
			fieldRef,
			labels: AGENT_LABELS,
		});
		return h(
			"div",
			api.fieldProps,
			h(SearchableSelect, pickerProps(editorRef)),
		);
	};
	const view = await mountInto(h(Harness));
	const input = view.container.querySelector('input[role="combobox"]');
	assert.ok(input, "the picker must render its control");
	assert.notEqual(
		editorRef.current,
		null,
		"the shared editorRef must be filled",
	);
	assert.equal(
		editorRef.current,
		input,
		"the machine's editorRef must hold the picker's combobox input",
	);
	await view.unmount();
});

test("the machine focuses its editorRef when a field opens, which is the focus the pencil used to lose", async () => {
	/*
	 * The machine's other half, isolated from this control so it runs in
	 * milliseconds: on begin, the focus-on-begin effect calls
	 * `editorRef.current.focus()`. With the shared ref above, that call now lands
	 * on the picker's input instead of returning early - which is exactly the
	 * dead end (pencil keeps focus, picker never opens) G2 removes.
	 */
	const editorRef = React.createRef();
	const fieldRef = React.createRef();
	const Harness = () => {
		const api = useInlineEdit({
			value: "aida",
			commit: async () => {},
			keyboardCommit: false,
			beginOnMount: true,
			editorRef,
			fieldRef,
			labels: AGENT_LABELS,
		});
		return h(
			"div",
			api.fieldProps,
			inlineEditEditorShown(api.phase)
				? h("input", { ref: editorRef, role: "combobox", readOnly: true })
				: null,
		);
	};
	const view = await mountInto(h(Harness));
	assert.notEqual(editorRef.current, null, "the field must render its editor");
	assert.equal(
		document.activeElement,
		editorRef.current,
		"opening the field must leave focus on the editor the machine was handed",
	);
	await view.unmount();
});
