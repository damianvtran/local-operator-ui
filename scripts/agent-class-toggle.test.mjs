import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The agent class: its reading, its copy, and the ORDER of the writes a switch
 * makes.
 *
 * WHY THIS FILE EXISTS RATHER THAN ONLY A RIG FRAME. A capture rig can show the
 * control's four visual states, but it cannot produce the two facts that matter
 * most about it: the sequence of ops a switch sends (install-then-update for a
 * packaged starter, update alone for anything else) and what a failure midway
 * leaves behind. Both are decided before any pixel is drawn, so they are pinned
 * here against the SHIPPED module (bundled in memory, as
 * `agents-config-summary.test.mjs` does), and the frames carry the rest.
 *
 * Every assertion below is about behaviour that a wrong implementation would
 * still make look right on screen: a switch that sent the whole profile back
 * would revert a description edited in another window; a switch that installed
 * twice would report an idempotent no-op as work; a switch that read `""` or
 * `"PROACTIVE"` as proactive would be the nagging bug the class exists to end.
 */
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/agents/utils/agent-class";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	write: false,
	tsconfig: "tsconfig.web.json",
});
const {
	BUILTIN_SWITCH_DISCLOSURE,
	CLASS_LABEL,
	CLASS_MEANING,
	CLASS_SWITCH_EFFECT,
	ClassSwitchError,
	classOf,
	classSwitchFailure,
	classSwitchSteps,
	oppositeClass,
	switchAgentClass,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** A profile as the wire answers it, with only the fields a switch reads. */
const profile = (over = {}) => ({
	name: "aida",
	kind: "role",
	source: "installed",
	agent_id: "a1",
	description: "",
	tools: null,
	effort: null,
	delegate: false,
	...over,
});

test("absence reads reactive, and only the wire's own spelling reads proactive", () => {
	/*
	 * The absent value, the null an uninstalled starter's write half answers
	 * with, an empty string and a spelling this build does not know all read
	 * REACTIVE. The last one is the one worth having: an unrecognised value must
	 * never be the reason an agent starts messaging somebody, which is the
	 * backend's own stated rule for the same field.
	 */
	assert.equal(classOf({}), "reactive");
	assert.equal(classOf({ action_class: undefined }), "reactive");
	assert.equal(classOf({ action_class: null }), "reactive");
	assert.equal(classOf({ action_class: "" }), "reactive");
	assert.equal(classOf({ action_class: "PROACTIVE" }), "reactive");
	assert.equal(classOf({ action_class: "on" }), "reactive");
	assert.equal(classOf({ action_class: "proactive" }), "proactive");
	assert.equal(classOf({ action_class: "reactive" }), "reactive");
});

test("the two classes have one spelling each, in the app's sentence case", () => {
	assert.deepEqual(Object.values(CLASS_LABEL), ["Proactive", "Reactive"]);
	assert.equal(oppositeClass("proactive"), "reactive");
	assert.equal(oppositeClass("reactive"), "proactive");
});

test("the proactive copy says the nudge is bounded, and the switch-off copy says it stops", () => {
	/*
	 * The two halves a press owes the reader. The first is the behaviour the
	 * operator cannot see — a patience wait is hidden by design, so the sentence
	 * is the only place they can learn that an unanswered message produces a
	 * nudge AND that the nudging is bounded and then gives up. The second is the
	 * direction that stops something, which a label alone cannot carry.
	 */
	const proactive = CLASS_MEANING.proactive.toLowerCase();
	assert.match(proactive, /may message you on its own/);
	assert.match(proactive, /waits a few minutes/);
	assert.match(proactive, /nudges again/);
	assert.match(proactive, /fixed number of tries/);
	assert.match(proactive, /waits for you/);
	assert.match(
		CLASS_SWITCH_EFFECT.proactive.toLowerCase(),
		/stops its proactive messaging/,
	);
	assert.match(CLASS_SWITCH_EFFECT.reactive.toLowerCase(), /message you first/);
	/*
	 * And the copy does NOT promise the reactive state is silent about a
	 * conversation the reader opened: "ordinary chat is unchanged" is what keeps a
	 * reader from thinking the switch mutes an agent they are talking to.
	 */
	assert.match(
		CLASS_SWITCH_EFFECT.proactive.toLowerCase(),
		/ordinary chat is unchanged/,
	);
	assert.match(
		CLASS_SWITCH_EFFECT.reactive.toLowerCase(),
		/ordinary chat is unchanged/,
	);
});

test("a packaged starter is installed first; anything else is updated once", () => {
	assert.deepEqual(
		classSwitchSteps(profile({ source: "builtin" }), "proactive"),
		[
			{ op: "profiles.install", name: "aida" },
			{
				op: "profiles.update",
				name: "aida",
				fields: { action_class: "proactive" },
			},
		],
	);
	for (const source of ["installed", "custom"]) {
		assert.deepEqual(classSwitchSteps(profile({ source }), "reactive"), [
			{
				op: "profiles.update",
				name: "aida",
				fields: { action_class: "reactive" },
			},
		]);
	}
});

test("the update carries the class and nothing else", () => {
	/*
	 * THE MERGE RULE IS THE REASON. An omitted field means "leave it alone" on
	 * this wire, so a switch that sent a whole profile back would revert whatever
	 * else moved while the pane was open — the same defect the detail pane's own
	 * save was rebuilt to avoid. Asserted on the field LIST rather than on the
	 * value, because a stray key that happened to hold the current value would
	 * pass a value-shaped assertion and still be a write nobody asked for.
	 */
	const update = classSwitchSteps(profile(), "proactive").at(-1);
	assert.deepEqual(Object.keys(update.fields), ["action_class"]);
});

test("a switch sends its steps in order, with a fresh request id for each", async () => {
	const seen = [];
	const ids = ["id-1", "id-2"];
	const result = await switchAgentClass(
		profile({ source: "builtin" }),
		"proactive",
		async (step, requestId) => {
			seen.push([step.op, requestId]);
			return profile({ source: "installed", action_class: "proactive" });
		},
		() => ids[seen.length],
	);
	assert.deepEqual(seen, [
		["profiles.install", "id-1"],
		["profiles.update", "id-2"],
	]);
	assert.equal(result.action_class, "proactive");
});

test("a switch to the class the agent is already in writes nothing", async () => {
	let calls = 0;
	const result = await switchAgentClass(
		profile({ action_class: "proactive" }),
		"proactive",
		async () => {
			calls += 1;
			return profile();
		},
	);
	assert.equal(result, null);
	assert.equal(calls, 0);
	/*
	 * And the no-op is decided by the EFFECTIVE class, not by the spelling: a
	 * profile whose payload omits the field is reactive, so asking for reactive
	 * is the no-op and asking for proactive is not.
	 */
	let second = 0;
	assert.equal(
		await switchAgentClass(profile(), "reactive", async () => {
			second += 1;
			return profile();
		}),
		null,
	);
	assert.equal(second, 0);
});

test("a failed step reports the steps that had already landed", async () => {
	/*
	 * THE HALF-COMPLETED CASE, which is the one a surface can get wrong without
	 * noticing: the install succeeded and the class write did not, so the record
	 * moved (a packaged starter now has a row of its own, and is editable) while
	 * the class is exactly what it was. A caller told only "that did not work"
	 * would leave the pane showing "Built-in" against a list that says
	 * "Installed".
	 */
	const failure = await switchAgentClass(
		profile({ source: "builtin" }),
		"proactive",
		async (step) => {
			if (step.op === "profiles.update") throw new Error("backend said no");
			return profile({ source: "installed" });
		},
	).catch((error) => error);
	assert.ok(failure instanceof ClassSwitchError);
	assert.equal(failure.message, "backend said no");
	assert.deepEqual(
		failure.completed.map((step) => step.op),
		["profiles.install"],
	);
	assert.match(
		classSwitchFailure(failure, failure.completed),
		/backend said no/,
	);
	assert.match(classSwitchFailure(failure, failure.completed), /was installed/);
	/*
	 * A failure with nothing landed says only the refusal: there is no second
	 * clause to write, and inventing one would tell the reader something about
	 * their record that did not happen.
	 */
	const early = await switchAgentClass(
		profile({ source: "installed" }),
		"proactive",
		async () => {
			throw new Error("offline");
		},
	).catch((error) => error);
	assert.ok(early instanceof ClassSwitchError);
	assert.deepEqual(early.completed, []);
	assert.equal(classSwitchFailure(early, early.completed), "offline");
});

test("a bare, non-Error rejection still says something a reader can act on", () => {
	/*
	 * A transport can reject with a value that is not an Error (`desktop-api`
	 * throws typed errors, but the deadline path and a mocked bridge need not), so
	 * the sentence cannot be `cause.message` unguarded: an empty alert is the
	 * failure a reader cannot act on at all.
	 */
	const copy = classSwitchFailure({ status: 500 }, []);
	assert.equal(copy, "The class could not be changed.");
	assert.doesNotMatch(BUILTIN_SWITCH_DISCLOSURE, /undefined/);
});

test("the built-in disclosure names the install before the press, not after", () => {
	assert.match(BUILTIN_SWITCH_DISCLOSURE, /installs it first/);
	assert.match(BUILTIN_SWITCH_DISCLOSURE, /now editable/);
});
