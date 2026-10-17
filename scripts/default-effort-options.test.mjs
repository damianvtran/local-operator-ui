/*
 * The Default effort row's rules: which rows a model's ladder produces, what
 * the stored value selects, when a model switch may rewrite `model_effort`,
 * and which states are disabled rather than lying about a capability.
 *
 * These are pure functions precisely so they can be asserted here rather than
 * judged from a frame, and the clamp is the part most likely to be wrong: it
 * writes a persisted setting, so a gate that is too loose is a silent value
 * change and a gate that is too tight leaves an invalid level stored.
 *
 * Exercised through the SHIPPED module: the bundle below imports the same
 * `default-effort-options.ts` the Settings row renders, and that module prints
 * through the same `effortDisplay` the composer's effort picker uses, so a
 * second implementation cannot pass this test while the product disagrees.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/settings/default-effort-options";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The renderer's `@shared`/`@features` aliases are tsconfig paths, not node
	// resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	write: false,
});
const {
	defaultEffortClampWrite,
	defaultEffortOptions,
	defaultEffortSelectedId,
	defaultEffortState,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/* --------------------------------------------------------------- fixtures */

/** A state input with every fact resolved and nothing unusual. */
const ready = (overrides = {}) => ({
	supported: true,
	hasHome: true,
	hasModel: true,
	settings: "ready",
	preview: "ready",
	ladder: ["low", "medium", "high"],
	specResolved: true,
	stored: "",
	resolvedLevel: "medium",
	storable: STORABLE,
	...overrides,
});

/**
 * The values `model_effort` stores on the shipped registry: `""` plus
 * `EFFORT_ORDER` (`settings_io.py:1259-1283`). A test that varies this set names
 * why in its own words.
 */
const STORABLE = [
	"",
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

/** The shipped decisions, called with the shipped vocabulary unless a test says otherwise. */
const rowsFor = (input) =>
	defaultEffortOptions({ storable: STORABLE, ...input });
const clampWrite = (input) =>
	defaultEffortClampWrite({ storable: STORABLE, ...input });

/* ------------------------------------------------------------------ rows */

test("the unset member comes first and names the level it resolves to", () => {
	const rows = rowsFor({
		ladder: ["low", "medium", "high"],
		resolvedLevel: "medium",
		stored: "",
	});
	assert.equal(rows.length, 4);
	assert.deepEqual(
		rows.map((row) => row.id),
		["", "low", "medium", "high"],
	);
	assert.equal(rows[0].name, "Model default");
	assert.equal(
		rows[0].description,
		"Runs at Medium for this model.",
		"the unset row says what it currently means rather than leaving the reader to guess",
	);
	assert.deepEqual(
		rows.slice(1).map((row) => row.name),
		["Low", "Medium", "High"],
		"rung labels are the composer's own title-cased vocabulary",
	);
});

test("a level this file does not know is printed as the wire spells it", () => {
	const rows = rowsFor({
		ladder: ["low", "paranoid"],
		resolvedLevel: null,
		stored: "",
		/* A storable rung the display map does not know: the label falls back to
		 * the wire spelling rather than dropping the row. */
		storable: ["", "low", "paranoid"],
	});
	assert.deepEqual(
		rows.map((row) => row.name),
		["Model default", "Low", "paranoid"],
	);
	assert.equal(
		rows[0].description,
		undefined,
		"no resolved level means no sentence - never a synthesised state word",
	);
});

test("xhigh keeps the composer's spelling", () => {
	const rows = rowsFor({
		ladder: ["low", "medium", "high", "xhigh", "max"],
		resolvedLevel: "high",
		stored: "",
	});
	assert.deepEqual(
		rows.map((row) => row.name),
		["Model default", "Low", "Medium", "High", "xHigh", "Max"],
	);
});

test("a stored level is not described as the model's own default", () => {
	/*
	 * With `max` stored the preview reports `max` CLAMPED into this model's
	 * ladder - a fact about the selected row, not about `""`. Describing the
	 * unset row with it would promise a level that clearing the row would not
	 * run.
	 */
	const rows = rowsFor({
		ladder: ["low", "medium", "high"],
		resolvedLevel: "high",
		stored: "max",
	});
	assert.equal(rows[0].name, "Model default");
	assert.equal(rows[0].description, undefined);
});

/* -------------------------------------------------------------- selected */

test("a stored value in the ladder selects its own row", () => {
	assert.equal(defaultEffortSelectedId("high", ["low", "high"]), "high");
});

test("no opinion selects the unset row", () => {
	assert.equal(defaultEffortSelectedId("", ["low", "high"]), "");
	assert.equal(defaultEffortSelectedId("   ", ["low", "high"]), "");
});

test("a stored value off the ladder selects the unset row, never a lie", () => {
	assert.equal(defaultEffortSelectedId("xhigh", ["low", "high"]), "");
});

/* ----------------------------------------------------------- clamp writes */

test("a stored level in the new ladder is left alone", () => {
	assert.equal(
		clampWrite({
			stored: "high",
			ladder: ["low", "medium", "high"],
			resolvedLevel: "medium",
			resolved: true,
		}),
		null,
	);
});

test("no opinion is never turned into a level", () => {
	assert.equal(
		clampWrite({
			stored: "",
			ladder: ["low", "medium", "high"],
			resolvedLevel: "medium",
			resolved: true,
		}),
		null,
		"writing the model's seeded level would pin a choice the user did not make",
	);
});

test("an off-ladder level is clamped to the level the backend resolves", () => {
	assert.equal(
		clampWrite({
			stored: "xhigh",
			ladder: ["low", "medium", "high"],
			resolvedLevel: "medium",
			resolved: true,
		}),
		"medium",
	);
});

test("an off-ladder level on a model that resolves none is written as unset", () => {
	assert.equal(
		clampWrite({
			stored: "high",
			ladder: [],
			resolvedLevel: null,
			resolved: true,
		}),
		"",
	);
});

test("a clamp that would repeat the stored value is not written", () => {
	assert.equal(
		clampWrite({
			stored: "xhigh",
			ladder: ["low"],
			resolvedLevel: "xhigh",
			resolved: true,
		}),
		null,
		"no loop, even if the backend reports a level its own ladder omits",
	);
});

test("no write unless the preview resolved for THIS model", () => {
	assert.equal(
		clampWrite({
			stored: "xhigh",
			ladder: ["low"],
			resolvedLevel: "low",
			resolved: false,
		}),
		null,
	);
});

test("a ladder that is not an array is not an empty ladder", () => {
	assert.equal(
		clampWrite({
			stored: "high",
			ladder: null,
			resolvedLevel: null,
			resolved: true,
		}),
		null,
	);
});

/* ---------------------------------------------------------------- states */

test("an unsupported backend renders nothing", () => {
	const state = defaultEffortState(ready({ supported: false }));
	assert.equal(state.kind, "unsupported");
	assert.equal(state.disabled, true);
});

test("no model selected disables the row and says what to do", () => {
	const state = defaultEffortState(ready({ hasModel: false, stored: "high" }));
	assert.equal(state.kind, "no-model");
	assert.equal(state.disabled, true);
	assert.ok(state.helper.includes("Select a model"));
	assert.ok(
		state.options.every((row) => row.id !== state.selectedId),
		"a value with no model to mean anything about is not shown as chosen",
	);
});

test("no home directory disables the row without issuing anything", () => {
	const state = defaultEffortState(ready({ hasHome: false }));
	assert.equal(state.kind, "no-home");
	assert.equal(state.disabled, true);
});

test("a loading preview says it is checking, not that nothing is adjustable", () => {
	const state = defaultEffortState(ready({ preview: "loading", ladder: null }));
	assert.equal(state.kind, "loading");
	assert.equal(state.disabled, true);
	assert.ok(state.helper.includes("Checking this model's effort levels"));
});

test("a failed preview says the levels could not be read and offers no list", () => {
	const state = defaultEffortState(
		ready({ preview: "error", ladder: null, specResolved: false }),
	);
	assert.equal(state.kind, "error");
	assert.equal(state.disabled, true);
	assert.equal(
		state.options.length,
		1,
		"only the unset row, so a failure cannot look like a ladder",
	);
	assert.ok(
		state.options.every((row) => row.id === ""),
		"no rung is offered from a failed read",
	);
});

test("an unresolved spec is a wait, not a capability claim", () => {
	const state = defaultEffortState(ready({ ladder: [], specResolved: false }));
	assert.equal(state.kind, "unresolved");
	assert.notEqual(state.kind, "empty");
});

test("a known-empty ladder says effort is not adjustable", () => {
	const state = defaultEffortState(ready({ ladder: [], specResolved: true }));
	assert.equal(state.kind, "empty");
	assert.equal(state.disabled, true);
	assert.ok(state.helper.toLowerCase().includes("not adjustable"));
});

test("a single rung is not a choice: one row, disabled", () => {
	const state = defaultEffortState(
		ready({ ladder: ["high"], resolvedLevel: "high" }),
	);
	assert.equal(state.kind, "one-level");
	assert.equal(state.disabled, true);
	assert.equal(state.options.length, 1);
	assert.equal(state.options[0].id, "high");
	assert.equal(state.selectedId, "high");
	assert.ok(state.helper.includes("one effort level: High"));
});

test("a real ladder offers the unset row plus every rung, enabled", () => {
	const state = defaultEffortState(ready({ stored: "low" }));
	assert.equal(state.kind, "ready");
	assert.equal(state.disabled, false);
	assert.deepEqual(
		state.options.map((row) => row.id),
		["", "low", "medium", "high"],
	);
	assert.equal(state.selectedId, "low");
	assert.ok(state.helper.includes("Model default"));
});

test("the saved value is not read as a ladder row while settings load", () => {
	const state = defaultEffortState(ready({ settings: "loading" }));
	assert.equal(state.kind, "settings-loading");
	assert.equal(state.disabled, true);
});

test("a settings read failure disables the row instead of offering a write", () => {
	const state = defaultEffortState(ready({ settings: "error" }));
	assert.equal(state.kind, "settings-error");
	assert.equal(state.disabled, true);
});

/* ------------------------------------------------- the storable vocabulary */

/*
 * THE LADDER IS NOT THE VALUE SPACE. Radient's ladder is `auto/low/medium/high`
 * (`model/configure.py`), and `auto` there is the registry's LABEL for the
 * empty choice, not a value `settings_io.py` accepts. These tests pin the rule
 * the Radient-shaped ladder exposed: offer and write only what the backend's
 * own choices say it can store.
 */

test("a Radient-shaped ladder never offers the auto sentinel", () => {
	const state = defaultEffortState(
		ready({
			ladder: ["auto", "low", "medium", "high"],
			resolvedLevel: "auto",
			stored: "",
		}),
	);
	assert.equal(state.kind, "ready");
	assert.equal(state.disabled, false);
	assert.deepEqual(
		state.options.map((row) => row.id),
		["", "low", "medium", "high"],
		"the unset row already IS the storable spelling of auto, so there is no second row",
	);
	assert.equal(
		state.options[0].description,
		undefined,
		"auto is not a level a sentence can name",
	);
});

test("a clamp resolved to the auto sentinel writes the empty value", () => {
	assert.equal(
		clampWrite({
			stored: "max",
			ladder: ["auto", "low", "medium", "high"],
			resolvedLevel: "auto",
			resolved: true,
		}),
		"",
		"writing 'auto' is rejected by the registry, so the honest clamp is unset",
	);
});

test("an auto-only ladder is one outcome, named, and disabled", () => {
	const state = defaultEffortState(
		ready({ ladder: ["auto"], resolvedLevel: "auto" }),
	);
	assert.equal(state.kind, "one-level");
	assert.equal(state.disabled, true);
	assert.equal(state.options.length, 1);
	assert.equal(state.options[0].id, "");
	assert.equal(
		state.options[0].name,
		"Auto",
		"the single outcome is named rather than replaced by a choice that cannot exist",
	);
	assert.ok(
		state.helper.includes("has no effort level to choose"),
		"the sentinel is a delegation to the model, not a level the reader picks",
	);
	assert.ok(
		!state.helper.includes("one effort level"),
		"calling Auto one effort level would put a state word in a level's slot",
	);
});

test("a real single level keeps the one-effort-level sentence", () => {
	const state = defaultEffortState(
		ready({ ladder: ["high"], resolvedLevel: "high" }),
	);
	assert.equal(state.kind, "one-level");
	assert.ok(
		state.helper.includes("one effort level: High"),
		"a real level is still named as the level the model offers",
	);
});

test("a ladder with one storable rung beside the sentinel is two outcomes", () => {
	const state = defaultEffortState(
		ready({ ladder: ["auto", "high"], resolvedLevel: "auto" }),
	);
	assert.equal(state.kind, "ready");
	assert.deepEqual(
		state.options.map((row) => row.id),
		["", "high"],
		"Model default runs auto and High runs high: two outcomes, not one level",
	);
});

test("a storable rung is written in the settings row's own spelling", () => {
	assert.deepEqual(
		rowsFor({
			ladder: ["low", "HIGH"],
			resolvedLevel: null,
			stored: "",
			storable: ["", "low", "high"],
		}).map((row) => row.id),
		["", "low", "high"],
	);
});

test("an unknown stored value never renders as a chosen Model default", () => {
	for (const settings of ["loading", "error"]) {
		const state = defaultEffortState(ready({ settings, stored: "high" }));
		assert.ok(
			state.options.every((row) => row.id !== state.selectedId),
			`${settings}: the control must show its placeholder, not claim the unset value`,
		);
	}
});

/*
 * U3: a stored level is never shown as "Model default" while the MODEL's ladder
 * is still out. The settings read may know the value, but the row cannot say
 * which level is in force - or that the unset row means anything - until the
 * preview answers. With nothing stored the unset row IS the truth and stays
 * selected, so the honest loading state does not lose its label.
 */
test("a stored level shows no chosen row while the model's ladder is unknown", () => {
	const states = [
		["loading", ready({ preview: "loading", ladder: null, stored: "high" })],
		["error", ready({ preview: "error", ladder: null, stored: "high" })],
		[
			"unresolved",
			ready({ ladder: null, specResolved: false, stored: "high" }),
		],
		["empty", ready({ ladder: [], specResolved: true, stored: "high" })],
	];
	for (const [kind, input] of states) {
		const state = defaultEffortState(input);
		assert.equal(state.kind, kind);
		assert.ok(
			state.options.every((row) => row.id !== state.selectedId),
			`${kind}: the control must show its placeholder rather than claim Model default for a stored level`,
		);
		assert.ok(
			state.selectedId.length > 0,
			`${kind}: the unset id is a real option id, so "no selection" needs its own spelling`,
		);
	}
});

test("with nothing stored the unset row stays chosen while the ladder loads", () => {
	const states = [
		["loading", ready({ preview: "loading", ladder: null, stored: "" })],
		["error", ready({ preview: "error", ladder: null, stored: "" })],
		["unresolved", ready({ ladder: null, specResolved: false, stored: "" })],
		["empty", ready({ ladder: [], specResolved: true, stored: "" })],
	];
	for (const [kind, input] of states) {
		const state = defaultEffortState(input);
		assert.equal(state.kind, kind);
		assert.equal(
			state.selectedId,
			"",
			`${kind}: nothing is stored, so Model default is what the row means`,
		);
		assert.ok(
			state.options.some((row) => row.id === state.selectedId),
			`${kind}: the unset row is an offered row and may be shown`,
		);
	}
});
