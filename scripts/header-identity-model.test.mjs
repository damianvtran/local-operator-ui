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
		contents: [
			'export * from "./src/renderer/src/features/chat/components/chat-header-identity-model";',
			/* The menu model's predicate and constraint ride the same bundle: the
			 * strict-rule matrix below is about the two modules AGREEING. */
			'export { identityAgentClosedCaption, identityAgentConstraint, identityAgentSettable } from "./src/renderer/src/features/chat/components/chat-header-identity-menu-model";',
		].join("\n"),
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
	effectiveIdentityPublished,
	headerIdentityAgentFlagged,
	headerIdentityControlsShown,
	createHostPublishRecord,
	headerHostKey,
	identityAgentClosedCaption,
	identityAgentConstraint,
	identityAgentSettable,
	isColdFrame,
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

/*
 * ---------------------------------------------------------------- the
 * runtime's STRICT rule (issue #861, second slice; core PR #2050 at f98240bd42)
 *
 * `effective_identity: { speaker, team, role_of_speaker }` is the capability
 * signal: a host that publishes it refuses `/agent` for EVERY name while a team
 * is attached, the manager's own included. A host that does not (absent or `{}`)
 * is an OLDER runtime that still accepts the #866 set, and must keep getting
 * exactly the #866 answers - which is why the first half of this section is
 * the "unchanged" half.
 */

/* Hoisted: a literal inside a test is recompiled per call (lint rule). */
const ITS_MANAGER = /its manager is the speaker/;
const REPLACED_NOTICE = /replac/i;

/** What a strict host publishes for a team chat, and for a chat with no team. */
const STRICT_TEAM = {
	speaker: "manager",
	team: "lopdev",
	role_of_speaker: "manager",
};
const STRICT_NO_TEAM = { speaker: "", team: "", role_of_speaker: "" };

/** The four profiles the matrix tries to seat: the manager, a delegating profile, a leaf, and the manager's own name. */
const SEATS = [
	{ name: "manager", delegate: false, role: "the manager (flag reads false)" },
	{ name: "ops-lead", delegate: true, role: "a delegating profile" },
	{ name: "coder", delegate: false, role: "a leaf profile" },
	{ name: "ops-lead", delegate: null, role: "a profile whose flag is unknown" },
];

test("one predicate decides whether the host publishes the field", () => {
	// All three keys, empty strings included: a published statement of "no team".
	assert.deepEqual(effectiveIdentityPublished(STRICT_NO_TEAM), STRICT_NO_TEAM);
	assert.deepEqual(effectiveIdentityPublished(STRICT_TEAM), STRICT_TEAM);
	// One string key is enough: a frame is untrusted wire data.
	assert.deepEqual(effectiveIdentityPublished({ team: "lopdev" }), {
		speaker: "",
		team: "lopdev",
		role_of_speaker: "",
	});
	// An older host: absent, null, `{}` and non-string keys are NOT a statement.
	for (const older of [undefined, null, {}, { speaker: 3, team: null }, "x"]) {
		assert.equal(effectiveIdentityPublished(older), null);
	}
});

test("older host: {} and an absent field give exactly the #866 results, cue dark", () => {
	for (const older of [undefined, null, {}]) {
		const view = resolveHeaderIdentity({
			activeAgent: "coder",
			activeTeam: "lopdev",
			teams: TEAMS,
			effectiveIdentity: older,
		});
		assert.equal(view.seat, null);
		// The explicit agent still labels the slot, as it did on main.
		assert.equal(view.agentValue, "coder");
		assert.equal(view.teamManager, "manager");
		// The #866 predicate, unchanged: the manager and delegates are settable.
		for (const seat of SEATS) {
			assert.equal(
				identityAgentSettable({
					name: seat.name,
					manager: view.teamManager,
					delegate: seat.delegate,
				}),
				seat.name === "manager" || seat.delegate === true,
				`${seat.role} on an older host`,
			);
		}
		// The constraint is the exact two-field object #866 shipped.
		assert.deepEqual(
			identityAgentConstraint({
				teamLabel: view.teamLabel,
				manager: view.teamManager,
				closure: view.seat,
			}),
			{
				manager: "manager",
				caption:
					"lopdev is led by its manager; only the manager and profiles that can delegate may take this seat.",
			},
		);
	}
	// The #866 cue on the older host is EXACTLY what main shipped: lit for a
	// refused explicit agent whose delegate flag is known, dark for an accepted
	// seat and dark while the flag is unknown (no false cue from a name alone).
	// The strict rule's closure never appears (`seat` is null above), so nothing
	// new can light on a host that has not published the field.
	assert.equal(
		headerIdentityAgentFlagged({
			explicitAgent: "coder",
			manager: "manager",
			delegate: null,
		}),
		false,
	);
	assert.equal(
		headerIdentityAgentFlagged({
			explicitAgent: "coder",
			manager: "manager",
			delegate: false,
			teamOwnsSeat: false,
		}),
		true,
	);
	assert.equal(
		headerIdentityAgentFlagged({
			explicitAgent: "ops-lead",
			manager: "manager",
			delegate: true,
		}),
		false,
	);
});

test("strict host + team attached: NO agent is settable, the manager's own name included", () => {
	const view = resolveHeaderIdentity({
		activeAgent: "",
		activeTeam: "lopdev",
		teams: TEAMS,
		effectiveIdentity: STRICT_TEAM,
	});
	assert.notEqual(view.seat, null);
	const constraint = identityAgentConstraint({
		teamLabel: view.teamLabel,
		manager: view.teamManager,
		closure: view.seat,
	});
	assert.notEqual(constraint.closed, undefined);
	for (const seat of SEATS) {
		assert.equal(
			identityAgentSettable({
				name: seat.name,
				manager: view.teamManager,
				delegate: seat.delegate,
				teamOwnsSeat: constraint.closed !== undefined,
			}),
			false,
			`${seat.role} must be refused under the strict rule`,
		);
	}
	// The manager's own name is the case #866 offered and the runtime refuses.
	assert.equal(
		identityAgentSettable({
			name: view.teamManager,
			manager: view.teamManager,
			delegate: true,
			teamOwnsSeat: true,
		}),
		false,
	);
});

test("strict host, no team: the field changes nothing and the seat stays open", () => {
	const view = resolveHeaderIdentity({
		activeAgent: "coder",
		activeTeam: "",
		teams: TEAMS,
		effectiveIdentity: { speaker: "coder", team: "", role_of_speaker: "" },
	});
	assert.equal(view.seat, null);
	assert.equal(view.teamValue, null);
	assert.equal(view.agentValue, "coder");
	// "Nobody attached" is a statement, not an older host: no closure, no cue.
	assert.equal(
		identityAgentConstraint({
			teamLabel: view.teamLabel,
			manager: view.teamManager,
			closure: view.seat,
		}),
		null,
	);
	const empty = resolveHeaderIdentity({
		teams: TEAMS,
		effectiveIdentity: STRICT_NO_TEAM,
	});
	assert.equal(empty.seat, null);
	assert.equal(empty.agentValue, null);
});

test("strict host: one speaker statement, a stale explicit agent is never the speaker", () => {
	// The runtime replaces an earlier /agent with the manager at attach, but the
	// bound row (or a frame in flight) may still name it: the label is the
	// host's speaker, and there is no team + agent pair on screen.
	const view = resolveHeaderIdentity({
		activeAgent: "coder",
		boundAgent: "coder",
		activeTeam: "lopdev",
		teams: TEAMS,
		effectiveIdentity: { ...STRICT_TEAM, speaker: "ops-lead" },
	});
	assert.equal(view.agentValue, "ops-lead");
	assert.equal(view.agentLabel, "ops-lead");
	assert.equal(view.seat.speaker, "ops-lead");
	assert.equal(view.seat.speakerKnown, true);
	assert.equal(view.teamLabel, "lopdev");
});

test("strict host: the cue stays dark where #866 would have lit it", () => {
	const lit = {
		explicitAgent: "coder",
		manager: "manager",
		delegate: false,
	};
	assert.equal(headerIdentityAgentFlagged(lit), true);
	assert.equal(
		headerIdentityAgentFlagged({ ...lit, teamOwnsSeat: true }),
		false,
	);
	// And a would-be-lit pair through the view: the stale agent is not flagged.
	const view = resolveHeaderIdentity({
		activeAgent: "coder",
		activeTeam: "lopdev",
		teams: TEAMS,
		effectiveIdentity: STRICT_TEAM,
	});
	assert.equal(
		headerIdentityAgentFlagged({ ...lit, teamOwnsSeat: view.seat !== null }),
		false,
	);
});

test("strict host: the speaker ladder says who owns the session rather than render a blank", () => {
	// Speaker empty and the catalogue has no row: `its manager` stands in, on the
	// chip AND in the sentence (the runtime's own phrase for an unnamed manager).
	// It is never the team's name, which read as a second chip beside the team's
	// own (design D5).
	const blank = resolveHeaderIdentity({
		activeTeam: "lopdev",
		teams: [],
		effectiveIdentity: {
			speaker: "",
			team: "lopdev",
			role_of_speaker: "manager",
		},
	});
	assert.equal(blank.agentValue, "its manager");
	assert.equal(blank.seat.speakerKnown, false);
	assert.match(blank.seat.sentence, ITS_MANAGER);
	// ...but with a catalogue row, the row's manager is the named speaker.
	const withRow = resolveHeaderIdentity({
		activeTeam: "minerva",
		teams: TEAMS,
		effectiveIdentity: {
			speaker: "",
			team: "minerva",
			role_of_speaker: "manager",
		},
	});
	assert.equal(withRow.agentValue, "ops-lead");
	assert.equal(withRow.seat.speakerKnown, true);
	// core's fallback (speaker == team) is the unnamed-manager rung when the
	// catalogue names no other manager...
	const fallback = resolveHeaderIdentity({
		activeTeam: "lopdev",
		teams: [],
		effectiveIdentity: {
			speaker: "lopdev",
			team: "lopdev",
			role_of_speaker: "manager",
		},
	});
	assert.equal(fallback.seat.speakerKnown, false);
	// ...and a manager that is genuinely NAMED like its team is the speaker
	// (review N1: core says `its manager` only for a manager it cannot name).
	const sameName = resolveHeaderIdentity({
		activeTeam: "boss",
		teams: [{ name: "boss", manager: "boss" }],
		effectiveIdentity: {
			speaker: "boss",
			team: "boss",
			role_of_speaker: "manager",
		},
	});
	assert.equal(sameName.agentValue, "boss");
	assert.equal(sameName.seat.speakerKnown, true);
	assert.doesNotMatch(sameName.seat.sentence, ITS_MANAGER);
	// The host's team stands in for a stream that has not named one yet.
	const hostOnly = resolveHeaderIdentity({
		teams: [],
		effectiveIdentity: STRICT_TEAM,
	});
	assert.equal(hostOnly.teamValue, "lopdev");
	assert.equal(hostOnly.agentValue, "manager");
});

/*
 * COLD FRAMES (review R1, QA Q1). Core publishes `effective_identity` on warm
 * frames only; a resumed, never-promoted team session's frame carries `{}` on a
 * STRICT host exactly as an older host's does. A host that has published the
 * field once is strict, so its later `{}` is a cold frame; a host that never
 * has stays on #866. The team-bound determination keys on `active_team` / the
 * catalogue's bound team, never on the empty field.
 */
const COLD = {
	activeAgent: "",
	activeTeam: "",
	boundAgent: "manager",
	boundTeam: "lopdev",
	teams: TEAMS,
	effectiveIdentity: {},
};

test("cold frame on a host that HAS published: the strict seat stays closed", () => {
	const view = resolveHeaderIdentity({ ...COLD, hostPublishes: true });
	assert.notEqual(view.seat, null);
	assert.equal(view.teamValue, "lopdev");
	// The speaker is the catalogue row's manager, not the stale bound agent.
	assert.equal(view.agentValue, "manager");
	assert.equal(view.seat.speakerKnown, true);
	assert.equal(
		identityAgentSettable({
			name: "manager",
			manager: view.teamManager,
			delegate: true,
			teamOwnsSeat: view.seat !== null,
		}),
		false,
	);
	// A stale explicit agent on the cold frame is never the speaker.
	const stale = resolveHeaderIdentity({
		...COLD,
		boundAgent: "coder",
		hostPublishes: true,
	});
	assert.equal(stale.agentValue, "manager");
});

test("the same cold frame on a host that NEVER published stays #866", () => {
	for (const hostPublishes of [false, undefined]) {
		const view = resolveHeaderIdentity({ ...COLD, hostPublishes });
		assert.equal(view.seat, null);
		assert.equal(
			identityAgentSettable({
				name: "manager",
				manager: view.teamManager,
				delegate: false,
				teamOwnsSeat: false,
			}),
			true,
		);
	}
});

test("a cold frame with no team bound is not a closed seat, even on a strict host", () => {
	const view = resolveHeaderIdentity({
		activeAgent: "coder",
		teams: TEAMS,
		effectiveIdentity: {},
		hostPublishes: true,
	});
	assert.equal(view.seat, null);
	assert.equal(view.agentValue, "coder");
});

/*
 * THE TWO CORE COLD SHAPES, pinned side by side (review R3, QA Q4). Both are
 * core PR #2050's frame for a session no runtime has engaged, stamped
 * `epoch: "cold-<session_id>"`:
 *
 * - f98240bd42: `effective_identity` is `{}` (the field is not set at all);
 * - 7905eab965: `effective_identity` is the EMPTY STATEMENT
 *   `{speaker:"", team:"", role_of_speaker:""}` and `active_team` is `""`
 *   (`attached.py` `saved_preview`, `cold_model.py` `synthesise_cold_state`),
 *   with core's own comment that the header should read the catalogue row's
 *   stored team/agent until the first warm frame.
 *
 * Both are team-bound in the catalogue (`boundTeam`), and in neither may the
 * chips blank (`No team` / `No agent`) or the seat open. What differs is why the
 * seat is closed: `{}` needs the host's sticky record, the empty statement is
 * itself a published statement and needs nothing.
 */
const COLD_BOUND = {
	activeAgent: "",
	activeTeam: "",
	boundAgent: "",
	boundTeam: "lopdev",
	teams: TEAMS,
};

test("core 7905eab965's cold frame (the published-EMPTY statement) never blanks a team-bound chat", () => {
	for (const hostPublishes of [undefined, false, true]) {
		const view = resolveHeaderIdentity({
			...COLD_BOUND,
			effectiveIdentity: STRICT_NO_TEAM,
			coldFrame: true,
			hostPublishes,
		});
		// The chips read the BINDING, as core's own comment instructs.
		assert.equal(view.teamValue, "lopdev");
		assert.equal(view.teamLabel, "lopdev");
		assert.equal(view.agentValue, "manager");
		// The empty statement is a published statement: strict, closed, and the
		// speaker is the catalogue row's manager.
		assert.notEqual(view.seat, null);
		assert.equal(view.seat.speaker, "manager");
		assert.equal(view.seat.speakerKnown, true);
	}
});

test("core f98240bd42's cold frame (`{}`) on a host that has published: chips from the binding, seat closed", () => {
	const view = resolveHeaderIdentity({
		...COLD_BOUND,
		effectiveIdentity: {},
		coldFrame: true,
		hostPublishes: true,
	});
	assert.equal(view.teamValue, "lopdev");
	assert.equal(view.agentValue, "manager");
	assert.notEqual(view.seat, null);
});

test("core f98240bd42's cold frame (`{}`) on a host that never published: #866, chips from the binding", () => {
	const view = resolveHeaderIdentity({
		...COLD_BOUND,
		effectiveIdentity: {},
		coldFrame: true,
		hostPublishes: false,
	});
	assert.equal(view.seat, null);
	assert.equal(view.teamValue, "lopdev");
	assert.equal(view.agentValue, "manager");
});

test('a LIVE published `team: ""` outranks a stale bound team, and a COLD one does not (review N2 / R3)', () => {
	// After `/team clear` the host says no team on a live frame while the
	// catalogue row has not refreshed: the stale binding must lose.
	const live = resolveHeaderIdentity({
		...COLD_BOUND,
		effectiveIdentity: STRICT_NO_TEAM,
		coldFrame: false,
	});
	assert.equal(live.seat, null);
	assert.equal(live.teamValue, null);
	// On a cold frame the same statement says nothing about the team.
	const cold = resolveHeaderIdentity({
		...COLD_BOUND,
		effectiveIdentity: STRICT_NO_TEAM,
		coldFrame: true,
	});
	assert.equal(cold.teamValue, "lopdev");
});

test("a cold frame is told by core's `cold-<session_id>` epoch, and nothing else", () => {
	assert.equal(isColdFrame("cold-2d5ad5da0025"), true);
	for (const warm of ["a1b2c3", "", null, undefined, "colder"]) {
		assert.equal(isColdFrame(warm), false);
	}
});

test("the capability record is per host and never leaks across hosts", () => {
	const record = createHostPublishRecord();
	assert.equal(record.has(""), false);
	record.note("");
	assert.equal(record.has(""), true);
	// A peer's runtime may be older: its sessions key on their own host.
	assert.equal(record.has("peer:laptop-b"), false);
	record.reset();
	assert.equal(record.has(""), false);
});

test("the host key: a peer is never the local host, and an absent row is nobody (review R5)", () => {
	assert.equal(headerHostKey({ locality: "local" }), "");
	// A plain listing carries no locality: only this device's daemon answers one.
	assert.equal(headerHostKey({}), "");
	assert.equal(
		headerHostKey({ locality: "remote", owner_device: "laptop-b" }),
		"peer:laptop-b",
	);
	// A remote row that names no owner cannot be attributed: no key at all.
	assert.equal(headerHostKey({ locality: "remote", owner_device: "" }), null);
	assert.equal(headerHostKey(undefined), null);
	assert.equal(headerHostKey(null), null);
});

/*
 * THE RECORD FAILS OPEN (review R4, QA Q3). The renderer is not reloaded when a
 * daemon is replaced in place, so a strict host followed by an older runtime on
 * the same port must not leave the older host classified strict. The record is
 * wiped on the feed's process epoch changing, on the connection dropping and on
 * the capability being withdrawn, and is re-established ONLY from a warm frame.
 * `frame()` is the header component's own two steps: a warm frame notes the host
 * (an effect), and `hostPublishes` is the frame's own statement or the record.
 */
const COLD_TEAM_BOUND_EMPTY = {
	...COLD_BOUND,
	effectiveIdentity: {},
	coldFrame: true,
};
const frameOf = (record, input, key = "") => {
	const published =
		effectiveIdentityPublished(input.effectiveIdentity) !== null;
	if (published) record.note(key);
	return resolveHeaderIdentity({
		...input,
		hostPublishes: published || record.has(key),
	});
};
const WARM_TEAM_FRAME = {
	activeAgent: "manager",
	activeTeam: "lopdev",
	boundTeam: "lopdev",
	teams: TEAMS,
	effectiveIdentity: STRICT_TEAM,
};

test("strict host, then an invalidation signal, then `{}` -> #866; then a warm frame -> strict again", () => {
	for (const signal of [
		(record) => record.observeProcess("epoch-b"),
		(record) => record.reset(),
	]) {
		const record = createHostPublishRecord();
		record.observeProcess("epoch-a");
		assert.notEqual(frameOf(record, WARM_TEAM_FRAME).seat, null);
		// Cold `{}` while the record stands: strict, as before.
		assert.notEqual(frameOf(record, COLD_TEAM_BOUND_EMPTY).seat, null);
		// The host may have changed (older runtime on the same port):
		signal(record);
		const afterSwap = frameOf(record, COLD_TEAM_BOUND_EMPTY);
		assert.equal(afterSwap.seat, null);
		assert.equal(
			identityAgentSettable({
				name: "manager",
				manager: afterSwap.teamManager,
				delegate: false,
				teamOwnsSeat: afterSwap.seat !== null,
			}),
			true,
		);
		// Only a warm frame re-establishes it.
		assert.notEqual(frameOf(record, WARM_TEAM_FRAME).seat, null);
		assert.notEqual(frameOf(record, COLD_TEAM_BOUND_EMPTY).seat, null);
	}
});

/*
 * THE WIPE IS NOT UNDONE BY THE FRAME THAT PREDATES IT (review R6). The header
 * subscribes to the record and re-renders when it is wiped; the frame still
 * painted at that moment says "published" but is older than the wipe. `paint`
 * is the header's write step in its WORST case: it re-runs on EVERY record
 * notification, holding the same statement object, exactly the re-render that
 * used to re-note the record from the stale frame.
 */
const paintHeader = (record, statement, key = "") => {
	const write = () => {
		if (effectiveIdentityPublished(statement) !== null)
			record.noteFrame(key, statement);
	};
	write();
	const off = record.subscribe(write);
	return { off };
};

test("a wipe is not undone by re-rendering the SAME published frame; a NEW frame re-establishes it (R6)", () => {
	for (const signal of [
		(record) => record.reset(),
		(record) => record.observeProcess("epoch-b"),
	]) {
		const record = createHostPublishRecord();
		record.observeProcess("epoch-a");
		const painted = { ...STRICT_TEAM };
		const view = paintHeader(record, painted);
		assert.equal(record.has(""), true);
		signal(record);
		// The header re-rendered on the wipe, holding the old frame: still empty.
		assert.equal(record.has(""), false);
		// An older host's cold `{}` is therefore #866, not a closed seat.
		const older = resolveHeaderIdentity({
			...COLD_TEAM_BOUND_EMPTY,
			hostPublishes: record.has(""),
		});
		assert.equal(older.seat, null);
		// A NEW warm frame (a new statement object) is what re-establishes it.
		record.noteFrame("", { ...STRICT_TEAM });
		assert.equal(record.has(""), true);
		assert.notEqual(
			resolveHeaderIdentity({
				...COLD_TEAM_BOUND_EMPTY,
				hostPublishes: record.has(""),
			}).seat,
			null,
		);
		view.off();
	}
});

test("a frame first evaluated after a wipe with no producer key is still stamped as old (R6)", () => {
	const record = createHostPublishRecord();
	const painted = { ...STRICT_TEAM };
	// Painted before the wipe while the row (and so the key) was unknown.
	record.noteFrame(null, painted);
	record.reset();
	// The row arrives after the wipe: the same old frame must not write.
	assert.equal(record.noteFrame("", painted), false);
	assert.equal(record.has(""), false);
});

test("a late frame from a stale epoch cannot re-establish a wiped record", () => {
	const record = createHostPublishRecord();
	record.observeProcess("epoch-a");
	record.note("");
	record.observeProcess("epoch-b");
	assert.equal(record.has(""), false);
	// A late frame of the OLD process: the feed hook only ever feeds the epoch
	// (it never writes the record), and seeing the old epoch again wipes again.
	record.observeProcess("epoch-a");
	assert.equal(record.has(""), false);
});

test("the process epoch wipes the record only when it CHANGES, and notifies subscribers", () => {
	const record = createHostPublishRecord();
	let notified = 0;
	const off = record.subscribe(() => {
		notified += 1;
	});
	// The first epoch seen learned nothing under an earlier one: nothing to wipe.
	record.observeProcess("a");
	record.note("");
	const afterNote = notified;
	record.observeProcess("a");
	assert.equal(record.has(""), true);
	assert.equal(notified, afterNote);
	record.observeProcess("b");
	assert.equal(record.has(""), false);
	assert.equal(notified, afterNote + 1);
	off();
	record.note("");
	assert.equal(notified, afterNote + 1);
});

test("a local reset wipes the peers' records too: the feed cannot vouch for a peer (fail open)", () => {
	const record = createHostPublishRecord();
	record.note("peer:laptop-b");
	record.note("");
	record.reset();
	// The feed is this device's daemon's, so it cannot vouch for a peer either.
	assert.equal(record.has("peer:laptop-b"), false);
	assert.equal(record.has(""), false);
});

test("the closure sentence is the runtime's refusal, pinned byte for byte", () => {
	// Core PR #2050, `Session._team_agent_slot_refusal("attach")`, with <team>
	// the chip's name for the team and <manager> the published speaker.
	assert.equal(
		identityAgentClosedCaption("lopdev", "manager"),
		"team lopdev owns this session: manager is the speaker, so /agent is closed. Run /team clear to detach the team first.",
	);
	assert.equal(
		identityAgentClosedCaption("lopdev", null),
		"team lopdev owns this session: its manager is the speaker, so /agent is closed. Run /team clear to detach the team first.",
	);
	// No sentence about a silently replaced profile: core emits none (#2050).
	assert.doesNotMatch(
		identityAgentClosedCaption("lopdev", "manager"),
		REPLACED_NOTICE,
	);
});
