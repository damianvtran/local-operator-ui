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
