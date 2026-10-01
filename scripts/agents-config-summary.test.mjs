import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The configuration run's "what changed" summary, as a pure function.
 *
 * WHY THIS FILE EXISTS RATHER THAN ONLY A RIG FRAME. The summary is computed
 * from two catalogue snapshots taken around a run, and the runs a capture rig
 * can produce are limited to what the deterministic mock provider can emit —
 * which is text plus an `echo` tool call, never a registry write. So the diff's
 * own rules are pinned here instead of being asserted through a socket: a create
 * is a name that appeared, an update is a name whose diffable fields moved, a
 * definition the run touched but did not move is reported as an update with no
 * visible change (the honest sentence for an instruction-only edit, which the
 * list view cannot show), and a name the run only READ is not reported at all.
 *
 * The module is bundled in memory, so the shipped code is what runs.
 */
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/agents/config-run/summary";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	write: false,
	tsconfig: "tsconfig.web.json",
});
const { diffCatalogue, projectRunToolRow, RUN_TOOL_NAMES, snapshotCatalogue } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);

const agent = (over = {}) => ({
	name: "reviewer",
	kind: "role",
	source: "custom",
	agent_id: null,
	description: "Reads code",
	tools: null,
	effort: null,
	delegate: false,
	...over,
});
const team = (over = {}) => ({
	id: "t1",
	name: "release-crew",
	description: "Ships it",
	manager: "manager",
	members: [{ role: "coder", count: 1, kind: "agent" }],
	...over,
});

const names = (results) =>
	results.map((result) => `${result.target.kind}:${result.target.name}`);

test("a name that appeared is a create, and a name that moved is an update", () => {
	const before = snapshotCatalogue([agent()], []);
	const after = snapshotCatalogue(
		[
			agent({ description: "Reads code and reports" }),
			agent({ name: "frame-probe" }),
		],
		[],
	);
	const results = diffCatalogue(before, after, [
		{ kind: "agent", name: "reviewer" },
		{ kind: "agent", name: "frame-probe" },
	]);
	assert.deepEqual(names(results), ["agent:reviewer", "agent:frame-probe"]);
	assert.equal(results[0].created, false);
	assert.deepEqual(
		results[0].changes.map((change) => change.label),
		["description changed"],
	);
	assert.equal(results[1].created, true);
});

test("a row that appeared without a readable tool row is still reported", () => {
	// The frames that name a tool call and its target are the run's own, and a
	// projection that could not read one must not lose the change: the operator
	// sees a row appear whether or not the run said its name.
	const before = snapshotCatalogue([agent()], []);
	const after = snapshotCatalogue(
		[agent(), agent({ name: "frame-probe" })],
		[],
	);
	const results = diffCatalogue(before, after, []);
	assert.deepEqual(names(results), ["agent:frame-probe"]);
	assert.equal(results[0].created, true);
});

test("a definition the run only read never reaches the summary", () => {
	/*
	 * `agent list`/`show` and `team list` ARE in the run's inventory, so the
	 * projection is where a lookup has to be told apart from a write — and if it
	 * is not, the settle-time diff reports the definition the run merely read as
	 * an update that "changed nothing". The class lives on the projection, and the
	 * hook only feeds WRITES into the touched set that `diffCatalogue` receives.
	 */
	const read = projectRunToolRow({
		toolName: "agent",
		args: { op: "show", name: "reviewer" },
		phase: "done",
		ts: 1,
	});
	assert.equal(read.writes, false);
	assert.equal(read.verb, "Reading reviewer");
	for (const op of ["list", "search", "show"]) {
		assert.equal(
			projectRunToolRow({
				toolName: "team",
				args: { op },
				phase: "done",
				ts: 2,
			}).writes,
			false,
			`${op} is a read`,
		);
	}
	for (const op of ["create", "update", "install"]) {
		assert.equal(
			projectRunToolRow({
				toolName: "agent",
				args: { op, name: "reviewer" },
				phase: "done",
				ts: 3,
			}).writes,
			true,
			`${op} is a write`,
		);
	}
	// An op this projection cannot read is treated as a write: reporting a change
	// nobody made is the safer failure than hiding one the operator will see.
	assert.equal(
		projectRunToolRow({
			toolName: "team",
			args: { op: "frobnicate" },
			phase: "done",
			ts: 4,
		}).writes,
		true,
	);
	// Only the two registry tools are projected at all.
	assert.deepEqual([...RUN_TOOL_NAMES], ["agent", "team"]);
});

test("a write that failed, was skipped, or never ran is not a change", () => {
	/*
	 * REVIEW ROUND 1, M4. `agent create name=reviewer` against an existing name is
	 * REFUSED, and `install` on an already-installed agent is a no-op — both rows
	 * name a definition, both are `writes: true` by op, and neither changed
	 * anything. Counting them produced "Updated reviewer: its settings changed.
	 * The list does not show instructions, so open it to see what was written."
	 * on the one surface whose whole job is to say exactly what changed.
	 *
	 * The three ways a call can fail to land are distinct facts on the record and
	 * each is checked on its own: the tool errored, the harness said it would
	 * never run, or the turn died with it still in flight.
	 */
	const write = (extra) =>
		projectRunToolRow({
			toolName: "agent",
			args: { op: "create", name: "reviewer" },
			phase: "done",
			ts: 1,
			...extra,
		});
	assert.equal(write({ isError: true }).writes, false);
	assert.equal(write({ notRunReason: "duplicate_id" }).writes, false);
	assert.equal(write({ neverSent: true }).writes, false);
	assert.equal(write({}).writes, true);
	// And an unsettled call is not a change yet: composing and queued rows have
	// no outcome at all, and a `running` one has not returned.
	for (const phase of ["composing", "queued", "running"]) {
		assert.equal(
			projectRunToolRow({
				toolName: "team",
				args: { op: "update", name: "release-crew" },
				phase,
				ts: 2,
			}).writes,
			false,
			`${phase} has not landed`,
		);
	}
	// The step line is still painted for a failed call: the Watch list is where
	// "it tried and was refused" belongs, and it is not the summary's business.
	assert.equal(write({ isError: true }).verb, "Creating agent reviewer");
});

test("a touched definition whose list fields did not move is an update with nothing visible", () => {
	// The common instruction-only edit: `profile_catalogue` builds detail-free, so
	// the list cannot show the change. The strip owes the honest sentence, which
	// it can only do if the result exists and carries no changes.
	const before = snapshotCatalogue([agent()], []);
	const after = snapshotCatalogue([agent()], []);
	const results = diffCatalogue(before, after, [
		{ kind: "agent", name: "reviewer" },
	]);
	assert.equal(results.length, 1);
	assert.equal(results[0].created, false);
	assert.deepEqual(results[0].changes, []);
});

test("tools, delegation, effort and a team's manager and members are said in words", () => {
	const before = snapshotCatalogue(
		[agent({ tools: ["read"], delegate: false, effort: "inherit" })],
		[team()],
	);
	const after = snapshotCatalogue(
		[agent({ tools: null, delegate: true, effort: "hi" })],
		[
			team({
				manager: "architect",
				members: [{ role: "coder", count: 2, kind: "agent" }],
			}),
		],
	);
	const results = diffCatalogue(before, after, [
		{ kind: "agent", name: "reviewer" },
		{ kind: "team", name: "release-crew" },
	]);
	const agentLabels = results[0].changes.map((change) => change.label);
	assert.deepEqual(agentLabels, [
		"tools widened to every tool",
		"effort tier changed",
		"delegation turned on",
	]);
	const teamLabels = results[1].changes.map((change) => change.label);
	assert.deepEqual(teamLabels, ["manager changed", "members changed (1 to 1)"]);
});

test("an empty tool list and an absent one are the same fact", () => {
	// `tools: []` and `tools: null` both mean "every tool" on this wire
	// (`write_profile` writes `tuple(params.tools) or None`), so a diff between
	// them would be a change the operator can neither make nor see.
	const before = snapshotCatalogue([agent({ tools: [] })], []);
	const after = snapshotCatalogue([agent({ tools: null })], []);
	assert.deepEqual(
		diffCatalogue(before, after, [{ kind: "agent", name: "reviewer" }])[0]
			.changes,
		[],
	);
});

test("a class change is reported, and its direction is said out loud", () => {
	/*
	 * The class is a definition field the run can write (`agent_tool`'s
	 * `action_class`), and a signature that left it out would report a run that
	 * flipped an agent to proactive as one whose "list fields did not move" — the
	 * summary quietly endorsing an agent that has just started messaging the
	 * operator. The direction is in the sentence because it is the half that
	 * carries a consequence.
	 */
	const before = snapshotCatalogue([agent()], []);
	const after = snapshotCatalogue([agent({ action_class: "proactive" })], []);
	const [result] = diffCatalogue(before, after, [
		{ kind: "agent", name: "reviewer" },
	]);
	assert.deepEqual(
		result.changes.map((change) => change.label),
		["class changed to proactive"],
	);
	/*
	 * And the absent spelling is `reactive`, so a payload that simply omits the
	 * field is not a change away from a stored `reactive` — the same collapse the
	 * wire makes.
	 */
	assert.deepEqual(
		snapshotCatalogue([agent()], []).agents.reviewer.action_class,
		"reactive",
	);
	assert.deepEqual(
		diffCatalogue(
			snapshotCatalogue([agent()], []),
			snapshotCatalogue([agent({ action_class: "reactive" })], []),
			[{ kind: "agent", name: "reviewer" }],
		)[0].changes,
		[],
	);
	const [back] = diffCatalogue(
		snapshotCatalogue([agent({ action_class: "proactive" })], []),
		snapshotCatalogue([agent()], []),
		[{ kind: "agent", name: "reviewer" }],
	);
	assert.deepEqual(
		back.changes.map((change) => change.label),
		["class changed to reactive — proactive messaging stopped"],
	);
});
