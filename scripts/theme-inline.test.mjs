import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { transform } from "esbuild";

/*
 * `/theme <id>` mounts a CONFIRMATION, not a second chooser (issue #676).
 *
 * The defect the issue names: the composer's inline `/theme` list already WAS
 * the selection gesture, and the dialog the dispatch then mounted painted the
 * whole table again under the applied receipt - the "double selection UI". The
 * fix lives in `ThemePicker` (the agreed shape; the dispatcher alternative was
 * rejected because a sessionless resolve would fork the pane's route), and it
 * works by handing the host the NO-LIST shape: `options` omitted, which
 * `picker-host.tsx` distinguishes from an empty list (`hasList = options !==
 * undefined`) so no search field, no listbox and no empty-state sentence are
 * drawn. This file executes the SHIPPED component with the host boundary and
 * the React seams substituted - the bounded hook-runtime pattern
 * `draft-selection.test.mjs` states - and asserts the PROPS the host receives,
 * which is the whole of the contract between the two files. Rendered pixels
 * are the design round's frames; this is the shape behind them.
 */

const ROOT = process.cwd();
const pickerSource = readFileSync(
	join(ROOT, "src/renderer/src/features/chat/pickers/destination-pickers.tsx"),
	"utf8",
);
const start = pickerSource.indexOf("export const ThemePicker:");
const end = pickerSource.indexOf(
	"// ------------------------------------------------------------- team/agent",
);
assert.ok(start >= 0 && end > start, "ThemePicker's slice is gone");
const code = await transform(pickerSource.slice(start, end), {
	loader: "tsx",
	jsx: "automatic",
	format: "cjs",
});

/*
 * THE TABLE IS A FIXTURE, not the real one, on purpose: in scope here is the
 * RESOLUTION rule (id or name, case-insensitively) and the shape handed to the
 * host. The real table's ids are pinned one file over
 * (`slash-row-format.test.mjs`), where the drift guard that watches
 * `desktop_catalogues.py` lives; repeating them here would be a second copy
 * that can go stale with nothing to catch it.
 */
const THEMES = {
	dracula: { id: "dracula", name: "Dracula", description: "High contrast" },
	localOperatorLight: {
		id: "localOperatorLight",
		name: "Local Operator Light",
		description: "A light palette",
	},
};

/**
 * One mount of the shipped `ThemePicker`.
 *
 * Explicit renders, exactly as `draft-selection.test.mjs` states the contract:
 * state survives across renders (indices reset, values do not), the component
 * is invoked with the substituted seams, and EFFECTS run between the renders
 * because that is when React runs them. What this cannot prove is React
 * scheduling, focus or paint - those are QA's and the design round's, on real
 * frames.
 */
function mount(action) {
	const applied = [];
	const states = [];
	const effects = [];
	const hosts = [];
	let index = 0;
	const state = { themeName: "dark", setTheme: (id) => applied.push(id) };
	const deps = {
		themes: THEMES,
		useUiPreferencesStore: (selector) => selector(state),
		useState: (initial) => {
			const at = index++;
			if (!(at in states)) {
				states[at] = typeof initial === "function" ? initial() : initial;
			}
			// The setter honours the updater form, the same seam the sibling
			// harness substitues: a component that computed from the previous value
			// must not be silently frozen.
			const set = (value) => {
				states[at] = typeof value === "function" ? value(states[at]) : value;
			};
			return [states[at], set];
		},
		useMemo: (compute) => compute(),
		useEffect: (fn) => {
			effects.push(fn);
		},
		PickerHost: (props) => props,
	};
	const module = { exports: {} };
	new Function("require", "module", ...Object.keys(deps), code.code)(
		createRequire(import.meta.url),
		module,
		...Object.values(deps),
	);

	/*
	 * The host boundary is read off the ELEMENT the component returns: JSX
	 * creates an element (`jsx(PickerHost, props)`) without calling the
	 * component, so the returned object's `props` are exactly what React would
	 * hand the host - and asserting them here is asserting the one contract the
	 * two files share. `element.type === deps.PickerHost` is what pins the read
	 * to OUR host rather than to whatever a future wrapper returns.
	 */
	const render = () => {
		index = 0;
		const element = module.exports.ThemePicker({ onClose: () => {}, action });
		assert.equal(
			element?.type,
			deps.PickerHost,
			"the component no longer returns a PickerHost element",
		);
		hosts.push(element.props);
	};
	render();
	// React commits the first paint, then runs the mount effects; state written
	// there reaches the host on the next render, which is the render every
	// assertion below reads unless it says otherwise.
	const firstPaint = hosts.at(-1);
	for (const effect of effects.splice(0)) effect();
	render();
	return { applied, firstPaint, host: hosts.at(-1), mounts: hosts.length };
}

test("a bare `/theme` keeps the full picker", () => {
	const { applied, host } = mount({ args: "" });
	assert.ok(
		Array.isArray(host.options),
		"the grid is still handed to the host",
	);
	assert.equal(host.options.length, 2);
	assert.equal(host.result, null);
	assert.deepEqual(applied, [], "nothing is applied on mount");
});

test("a fully-qualified `/theme dracula` mounts the confirmation", () => {
	const { applied, firstPaint, host } = mount({ args: "dracula" });
	assert.equal(
		host.options,
		undefined,
		"the no-list shape: omitting `options` is what removes the grid",
	);
	assert.equal(
		firstPaint.options,
		undefined,
		"and the grid is never painted, not hidden after the fact",
	);
	assert.deepEqual(host.result, { tone: "success", text: "Theme: Dracula" });
	assert.deepEqual(applied, ["dracula"]);
});

test("resolution takes the id or the name, case-insensitively, trimmed", () => {
	const byId = mount({ args: "  DRACULA  " });
	assert.equal(byId.host.options, undefined);
	assert.deepEqual(byId.applied, ["dracula"]);
	const byName = mount({ args: "local operator light" });
	assert.equal(byName.host.options, undefined);
	assert.deepEqual(byName.applied, ["localOperatorLight"]);
	assert.deepEqual(byName.host.result, {
		tone: "success",
		text: "Theme: Local Operator Light",
	});
});

test("an argument that is not a theme keeps the grid, beside the warning", () => {
	const { applied, host } = mount({ args: "nope" });
	assert.ok(
		Array.isArray(host.options),
		"the table is the way out of a bad argument, so it stays",
	);
	assert.deepEqual(host.result, {
		tone: "warning",
		text: 'No desktop theme named "nope".',
	});
	assert.deepEqual(applied, []);
});

test("the no-list shape is the host's own gate, not a local convention", () => {
	/*
	 * The mechanism `options: undefined` turns on, pinned in the file that owns
	 * it: an empty ARRAY would still draw the search field, the listbox and the
	 * empty-state sentence, so the distinction between "absent" and "empty" is
	 * load-bearing for the confirmation shape and must not be normalised away.
	 */
	const host = readFileSync(
		join(ROOT, "src/renderer/src/features/chat/pickers/picker-host.tsx"),
		"utf8",
	);
	assert.match(
		host,
		/const hasList = options !== undefined;/,
		"the host's list gate is no longer 'absent options means no list'",
	);
});
