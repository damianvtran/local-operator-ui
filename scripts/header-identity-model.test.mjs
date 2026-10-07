/**
 * The chat header's identity controls as VALUES: the label ladder for the agent
 * and team controls, the current marking, and the gate that decides whether the
 * controls replace the plain description at all.
 *
 * WHY THIS FILE EXISTS. The operator's request (2026-09-26) is behavioural
 * before it is visual: which name each control shows, what "none" says, and
 * when a control may appear. Each of those is a rule that a JSX edit can break
 * while every captured frame still "looks fine" - a header that says "No team"
 * over a session whose stream simply failed is a wrong statement rendered
 * cleanly - so the rules live as pure functions
 * (`chat-header-identity-model.ts`) and are pinned here without a DOM.
 *
 * WHAT THIS CANNOT SAY: that the controls look right, that the menu opens, or
 * that picking runs the command. Those are the rendered set's and the QA
 * pass's to answer (`docs/evidence` frames on the PR, and the real-app run),
 * not this file's.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/components/chat-header-identity-model";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	DEFAULT_TEAM_MANAGER,
	NO_AGENT_LABEL,
	NO_TEAM_LABEL,
	headerIdentityAgentFlagged,
	headerIdentityControlsShown,
	resolveHeaderIdentity,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const TEAMS = [
	{ name: "lopdev", manager: "manager" },
	{ name: "minerva", manager: "ops-lead" },
];

test("the live stream's values win over the catalogue binding, for both controls", () => {
	const view = resolveHeaderIdentity({
		activeAgent: "coder",
		activeTeam: "lopdev",
		boundAgent: "old-agent",
		boundTeam: "old-team",
		teams: TEAMS,
	});
	assert.equal(view.teamValue, "lopdev");
	assert.equal(view.agentValue, "coder");
	assert.equal(view.teamLabel, "lopdev");
	assert.equal(view.agentLabel, "coder");
});

test("a cold session reads the durable binding (the live values are nulls)", () => {
	const view = resolveHeaderIdentity({
		activeAgent: null,
		activeTeam: null,
		boundAgent: "coder",
		boundTeam: "lopdev",
		teams: TEAMS,
	});
	assert.equal(view.teamValue, "lopdev");
	assert.equal(view.agentValue, "coder");
});

test("an empty string is the wire's 'unset', not a label of nothing", () => {
	// The runtime publishes `active_agent: ""` on an unattached session; `??`
	// alone would render a blank chip where "No agent" belongs.
	const view = resolveHeaderIdentity({
		activeAgent: "",
		activeTeam: "",
		boundAgent: "",
		boundTeam: "lopdev",
		teams: TEAMS,
	});
	assert.equal(view.teamValue, "lopdev");
	assert.equal(view.agentValue, "manager");
});

test("team bound with no /agent reads the team's manager, from the catalogue row", () => {
	const view = resolveHeaderIdentity({
		activeAgent: null,
		activeTeam: "minerva",
		teams: TEAMS,
	});
	assert.equal(view.agentValue, "ops-lead");
	assert.equal(view.agentLabel, "ops-lead");
});

test("the manager comes from the row, never from a constant: two teams, two managers", () => {
	for (const [team, manager] of [
		["lopdev", "manager"],
		["minerva", "ops-lead"],
	]) {
		const view = resolveHeaderIdentity({ activeTeam: team, teams: TEAMS });
		assert.equal(view.agentValue, manager);
	}
});

test("the manager rung reads the MERGED team value, not just the live one (review round 1, finding 3)", () => {
	// The bound-only twin: every manager case above drives `activeTeam`, so an
	// implementation that keyed the rung on the live value alone would pass all
	// of them while mislabelling the COLD session - the one the durable binding
	// exists to describe, and the operator's own case ("typically would be
	// 'manager' in the case that a team is assigned"). These two cases are the
	// mutation's own kill.
	assert.equal(
		resolveHeaderIdentity({ boundTeam: "minerva", teams: TEAMS }).agentValue,
		"ops-lead",
	);
	assert.equal(
		resolveHeaderIdentity({ boundTeam: "lopdev" }).agentValue,
		"manager",
	);
});

test("the default manager is the runtime's own value, pinned here (review round 1, finding 3)", () => {
	// A cross-repo fact, pinned the way this repo pins them: the value is the
	// runtime's `Team.manager` default (`local_operator/teams.py` declares
	// `manager: str = "manager"`), and the header reaches for it only when the
	// catalogue has not answered. If the runtime's default moves, this test and
	// the model's docblock are the two places to move with it - the point of
	// the pin is that the move cannot be silent.
	assert.equal(DEFAULT_TEAM_MANAGER, "manager");
});

test("a catalogue that has not loaded answers with the runtime's own default", () => {
	// `Team.manager` in the runtime declares `manager: str = "manager"`, so
	// this is the value the backend would run, not an invented placeholder.
	const view = resolveHeaderIdentity({
		activeTeam: "minerva",
		teams: undefined,
	});
	assert.equal(view.agentValue, DEFAULT_TEAM_MANAGER);
});

test("an explicit /agent override outranks the team's manager", () => {
	const view = resolveHeaderIdentity({
		activeAgent: "reviewer",
		activeTeam: "minerva",
		teams: TEAMS,
	});
	assert.equal(view.agentValue, "reviewer");
});

test("nothing bound reads the two assign affordances, with no value to mark", () => {
	const view = resolveHeaderIdentity({
		activeAgent: null,
		activeTeam: null,
		boundAgent: null,
		boundTeam: null,
		teams: TEAMS,
	});
	assert.equal(view.teamValue, null);
	assert.equal(view.teamLabel, NO_TEAM_LABEL);
	assert.equal(view.agentValue, null);
	assert.equal(view.agentLabel, NO_AGENT_LABEL);
});

test("no team means no manager: the agent control does not borrow one from the catalogue", () => {
	// The manager is a fact about a BOUND team. With no team bound, reading a
	// manager from nowhere would be the fabricated-name defect the model's
	// docblock names.
	const view = resolveHeaderIdentity({
		boundTeam: null,
		teams: TEAMS,
	});
	assert.equal(view.agentValue, null);
	assert.equal(view.agentLabel, NO_AGENT_LABEL);
});

test("the current marking is the label's own value, including the implicit manager", () => {
	// The menus mark one row as current, and the rule is "what the control's
	// label reports" - the operator's own reading ("typically would be
	// 'manager' in the case that a team is assigned"). So the team-bound case
	// must yield a markable value, not null.
	const view = resolveHeaderIdentity({ activeTeam: "lopdev", teams: TEAMS });
	assert.equal(view.agentValue, "manager");
	assert.equal(view.teamValue, "lopdev");
});

test("a team's label is what the control READS; the value stays the slug", () => {
	/*
	 * The label split's rule for this control: `teamValue` - what a switch
	 * sends and what the menu marks current - is the slug, and `teamLabel` -
	 * what a person sees and what the accessible name contains - is the
	 * catalogue row's label when it has one. A slug the list cannot resolve
	 * (still loading, or deleted since it was bound) reads as itself, which is
	 * the pre-labels string rather than a blank.
	 */
	const labelled = [
		{ name: "lopdev", label: "Local Operator Dev", manager: "manager" },
	];
	const view = resolveHeaderIdentity({ boundTeam: "lopdev", teams: labelled });
	assert.equal(view.teamValue, "lopdev");
	assert.equal(view.teamLabel, "Local Operator Dev");

	const unknown = resolveHeaderIdentity({ boundTeam: "gone", teams: labelled });
	assert.equal(unknown.teamValue, "gone");
	assert.equal(unknown.teamLabel, "gone");

	// A label of nothing but spaces is the absent field, not a blank name.
	const blank = resolveHeaderIdentity({
		boundTeam: "lopdev",
		teams: [{ name: "lopdev", label: "   ", manager: "manager" }],
	});
	assert.equal(blank.teamLabel, "lopdev");
});

test("the gate: shown only for a live session on a capable backend", () => {
	const shown = (over = {}) =>
		headerIdentityControlsShown({
			hasSession: true,
			pending: false,
			teamCatalogue: true,
			identityKnown: false,
			streamLive: false,
			...over,
		});
	// The one positive case, and both sources of "somebody named the identity"
	// (a live value/binding, or the stream itself saying nobody is bound).
	assert.equal(shown({ identityKnown: true }), true);
	assert.equal(shown({ streamLive: true }), true);
	// Every other term is load-bearing on its own.
	assert.equal(shown({ hasSession: false, identityKnown: true }), false);
	assert.equal(
		shown({ pending: true, identityKnown: true, streamLive: true }),
		false,
	);
	assert.equal(
		shown({ teamCatalogue: false, identityKnown: true, streamLive: true }),
		false,
	);
	// The case this gate exists for: a stream that failed before its first
	// snapshot never said the session is unattached, so the assign affordance
	// must not stand over it (the description chip holds the slot instead).
	assert.equal(shown({}), false);
});

test("the team's manager is the row's own value, known only while the row is", () => {
	/*
	 * `teamManager` is what the agent slot's constraint reads (issue #861), so
	 * its states are load-bearing: a bound team whose row has answered yields
	 * the row's manager; a row that carries none yields the runtime's own
	 * default (`Team.manager` declares `manager: str = "manager"`, the same
	 * value the label fallback below pins); and a catalogue that has not
	 * answered AT ALL yields null - never the default. The last one is the
	 * whole reason this field is not the label's own fallback: a constraint
	 * stated over an unknown team is a wrong claim about that team, while the
	 * label only reports what the runtime would run anyway.
	 */
	assert.equal(
		resolveHeaderIdentity({ activeTeam: "minerva", teams: TEAMS }).teamManager,
		"ops-lead",
	);
	assert.equal(
		resolveHeaderIdentity({
			activeTeam: "minerva",
			teams: [{ name: "minerva" }],
		}).teamManager,
		DEFAULT_TEAM_MANAGER,
	);
	// No row, no manager - loading, refused, or deleted are all this case.
	assert.equal(
		resolveHeaderIdentity({ activeTeam: "minerva" }).teamManager,
		null,
	);
	assert.equal(
		resolveHeaderIdentity({ activeTeam: "gone", teams: TEAMS }).teamManager,
		null,
	);
	// No team: no manager, whatever the catalogue holds.
	assert.equal(resolveHeaderIdentity({ teams: TEAMS }).teamManager, null);
});

test("the cue: an explicit leaf on a team is flagged; every accepted seat is not", () => {
	/*
	 * The defect's own state (issue #861): an explicit, non-delegating agent
	 * under a team whose manager is somebody else - the pair one press used to
	 * assemble with nothing said about it. Beside it, the two seats the rule
	 * ACCEPTS, and one of them is the case a name-inequality test gets wrong:
	 * a delegating profile is legal beside the manager, so only the row's
	 * `delegate` datum (via the one predicate) may say otherwise.
	 */
	const flagged = (over = {}) =>
		headerIdentityAgentFlagged({
			explicitAgent: "coder",
			manager: "manager",
			delegate: false,
			...over,
		});
	assert.equal(flagged(), true);
	// The manager itself is always accepted, whatever its flag reads.
	assert.equal(flagged({ explicitAgent: "manager" }), false);
	// A delegating profile is not a flag - `delegate: true` is the second half
	// of the acceptance rule, not a near-miss.
	assert.equal(flagged({ delegate: true }), false);
});

test("the cue waits for its facts: no agent, no manager, no delegate datum is silent", () => {
	/*
	 * Each `null` is a different load or absence, and each must be SILENT
	 * rather than guessed: the implicit seat (no explicit agent) is the
	 * manager's own and always accepted; a catalogue that has not answered
	 * cannot say who the manager is; and the delegate datum is what separates
	 * a legal delegating profile from a leaf - so a cue computed without it
	 * would be exactly the name-inequality guess the brief forbids. The cue is
	 * a statement about the pair, and it may only be made once all three facts
	 * have arrived.
	 */
	const flagged = (over = {}) =>
		headerIdentityAgentFlagged({
			explicitAgent: "coder",
			manager: "manager",
			delegate: false,
			...over,
		});
	assert.equal(flagged({ explicitAgent: null }), false);
	assert.equal(flagged({ manager: null }), false);
	assert.equal(flagged({ delegate: null }), false);
});
