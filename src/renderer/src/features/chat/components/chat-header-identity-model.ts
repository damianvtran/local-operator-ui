/**
 * The chat header's identity controls, as pure values: what the AGENT and TEAM
 * controls say, which menu row is the current one, and whether the controls
 * replace the plain description at all.
 *
 * WHY THIS IS ITS OWN MODULE, separate from the component beside it. The three
 * rules below are the change's whole behavioural claim - the label ladder, the
 * current marking and the gate - and each is the kind of rule that is easy to
 * break by accident in a JSX edit while every frame still "looks fine". Kept as
 * plain functions they are pinned by `scripts/header-identity-model.test.mjs`
 * without a DOM, and the component only maps their answers onto pixels.
 */

import type { CanonicalEffectiveIdentity } from "../../../../../shared/desktop-session-contract";
import { teamDisplayName } from "../../../shared/api/local-operator/team-display";
import {
	identityAgentClosedCaption,
	identityAgentClosedTitle,
	identityAgentSettable,
} from "./chat-header-identity-menu-model";

/**
 * One team as the label resolver needs it: the name the binding uses, the
 * manager the runtime would run for it, and - when the record carries one - the
 * label a person reads in place of the slug.
 *
 * `manager` is optional ONLY because the list may be absent or still loading;
 * every row the backend publishes carries it (the runtime's own `Team` model
 * declares `manager: str = "manager"`), which is where the fallback below
 * takes its value from rather than inventing one. `label` is optional by
 * CONTRACT as well - it is additive, and a backend that predates it omits the
 * field, which reads exactly as the slug did before (`teamDisplayName`).
 */
export type HeaderIdentityTeam = {
	name: string;
	label?: string | null;
	manager?: string | null;
};

export type HeaderIdentityInput = {
	/** Live stream values (`canonical.frontend`), which win while an owner is attached. */
	activeAgent?: string | null;
	activeTeam?: string | null;
	/** The catalogue row's durable binding, the cold-session source of truth. */
	boundAgent?: string | null;
	boundTeam?: string | null;
	/** The authored teams catalogue (`teams.list`), for the manager lookup. */
	teams?: readonly HeaderIdentityTeam[] | undefined;
	/**
	 * The host's `effective_identity` statement (`canonical.frontend`), or
	 * absent/`{}` from a host that predates it. See `effectiveIdentityPublished`
	 * for the one predicate that tells the two apart.
	 */
	effectiveIdentity?: CanonicalEffectiveIdentity | null | undefined;
	/**
	 * Whether THIS HOST has published `effective_identity` on some earlier frame
	 * in this app run (`hostPublishRecord`). It is what tells a COLD frame from
	 * an older host: a cold (resumed, never-promoted) session's frame is built
	 * without the field on a strict host and reads `{}`, exactly as an older
	 * host's does, but a host that has published it once is strict. See
	 * `resolveHeaderIdentity`'s cold branch.
	 */
	hostPublishes?: boolean;
};

/**
 * WHICH HOSTS HAVE PUBLISHED `effective_identity`, remembered for the app run.
 *
 * WHY THIS EXISTS. Core publishes the field only on warm frames (core PR #2050
 * at f98240bd42 builds the cold frame in `cold_model.py`/`attached.py` without
 * it), so on a strict host a resumed team session reads `{}` until the runtime
 * promotes it - indistinguishable, frame by frame, from an older host. A
 * capability is a fact about the HOST, not the frame, so the first frame that
 * carries the field records it and a later `{}` from the same host is read as
 * cold, never as "older". The proper fix is core deriving the keys on the cold
 * path (the anchor lane is doing that); until it lands this is a stopgap, and
 * its stated residual is that the FIRST cold team session opened on a strict
 * host before any warm frame has been seen is still #866's open list.
 *
 * WHY MODULE STATE AND NOT A STORE. The record is written once per host, never
 * read reactively - a write only ever happens on a render that already saw the
 * published statement, so no consumer needs a subscription - and nothing
 * persists it: a restart re-learns it from the next warm frame, which is the
 * right lifetime for a capability of a runtime that may have been updated.
 *
 * WHY THE KEY IS THE SESSION'S OWNER DEVICE. The frames of a peer's session
 * are relayed through this device's daemon but produced by the PEER's runtime,
 * which may be older; the catalogue row's `owner_device` (`""` on this device)
 * is the only datum that names the producer, so it is the key - one record per
 * runtime, never one for "the backend".
 */
export function createHostPublishRecord() {
	const seen = new Set<string>();
	return {
		note: (hostKey: string) => void seen.add(hostKey),
		has: (hostKey: string) => seen.has(hostKey),
		reset: () => seen.clear(),
	};
}

export const hostPublishRecord = createHostPublishRecord();

/**
 * What a host that PUBLISHES `effective_identity` said, normalised: all three
 * keys, strings. Produced only by `effectiveIdentityPublished`.
 */
export type PublishedEffectiveIdentity = {
	speaker: string;
	team: string;
	role_of_speaker: string;
};

/**
 * THE ONE PREDICATE for "this host publishes `effective_identity`" - the
 * capability signal the strict rule is gated on.
 *
 * It is `true` when at least one of the three keys is a string. A host that
 * publishes the field sends all three, with `""` for an empty value, so
 * `{ speaker: "", team: "", role_of_speaker: "" }` (no team, no profile) IS
 * published and means "nobody is attached". `{}`, `null` and an absent field
 * are a host that PREDATES the field, and must not be read as that statement:
 * the older runtime still accepts the manager and delegating profiles, so
 * closing the agent control on its silence would withdraw a working control.
 *
 * Returns the normalised statement (a key that is not a string reads `""`,
 * because a frame is untrusted wire data) or `null` for "not published".
 */
export function effectiveIdentityPublished(
	identity: CanonicalEffectiveIdentity | null | undefined,
): PublishedEffectiveIdentity | null {
	if (!identity || typeof identity !== "object") return null;
	const { speaker, team, role_of_speaker } = identity;
	if (
		typeof speaker !== "string" &&
		typeof team !== "string" &&
		typeof role_of_speaker !== "string"
	) {
		return null;
	}
	return {
		speaker: typeof speaker === "string" ? speaker : "",
		team: typeof team === "string" ? team : "",
		role_of_speaker: typeof role_of_speaker === "string" ? role_of_speaker : "",
	};
}

/**
 * The strict rule in force on this chat: the runtime closed the agent slot
 * because a team owns the session, and said who is speaking.
 */
export type HeaderSeatClosure = {
	/** What the agent chip shows: the speaker, or the team's name when the host named none. */
	speaker: string;
	/**
	 * Whether the host named a speaker distinct from the team. `false` is the
	 * fallback rung (blank speaker, or the runtime's own team-name fallback for
	 * a manager it cannot name), and the sentence then says `its manager`.
	 */
	speakerKnown: boolean;
	/** The team slug the host reported. */
	team: string;
	/** The explanation the closed control states (chip title, accessible name, panel). */
	sentence: string;
	/** The note's lead line, naming the team as the chip does (design D2/D3). */
	title: string;
};

export type HeaderIdentityView = {
	/** The team the control's label reports; `null` renders the assign affordance. */
	teamValue: string | null;
	/**
	 * The words the control SHOWS for `teamValue`: the catalogue row's label
	 * when it has one, the slug otherwise. Never the value a command sends.
	 */
	teamLabel: string;
	/** The agent the control's label reports; `null` renders the assign affordance. */
	agentValue: string | null;
	agentLabel: string;
	/**
	 * The bound team's manager - the profile that runs it, and the one the agent
	 * slot's constraint always accepts (issue #861). `null` when the manager is
	 * not KNOWN: no team is bound, or the catalogue has not answered with the
	 * team's row (or has answered without it).
	 *
	 * THE MANAGER VALUE IS THE ROW'S, WITH THE RUNTIME'S DEFAULT ONLY FOR A ROW
	 * THAT CARRIES NONE - `Team.manager` declares `manager: str = "manager"`, so
	 * a row without the field means the default rather than an unknown. But a
	 * row that is NOT THERE leaves this `null`, unlike the LABEL fallback down
	 * in `resolveHeaderIdentity`, which keeps answering with the default for a
	 * catalogue that has not loaded. The two differ because they make different
	 * claims: the label describes what the runtime would run anyway (its own
	 * documented default), while this value gates a CONSTRAINT - marks and copy
	 * that say "only these profiles" about a specific team - and a constraint
	 * stated over data this app does not have is a wrong claim, not a fallback.
	 * See `chat-header-identity-menu-model.ts`'s `identityAgentConstraint`.
	 */
	teamManager: string | null;
	/**
	 * Non-null when the host publishes `effective_identity` AND names a team: the
	 * runtime's strict rule, under which no agent is settable (the manager's own
	 * name included) and the agent control states why instead of listing rows.
	 * `null` on an older host - the #866 behaviour, unchanged.
	 */
	seat: HeaderSeatClosure | null;
};

/**
 * The copy for "nothing is bound yet" - an ASSIGN affordance, not a status
 * claim about a named-but-unknown value.
 *
 * It is deliberately parallel across the two controls (the operator's request:
 * "or if there's no team, to be able to assign one"), and it is what the
 * catalogue-bound session with neither live value shows. It is only ever
 * rendered where nothing named the identity from either source; a state that
 * could not be asked is held or falls back to the description chip instead
 * (`headerIdentityControlsShown`).
 */
export const NO_TEAM_LABEL = "No team";
export const NO_AGENT_LABEL = "No agent";

/**
 * The runtime's own default for a team that names no manager (`Team.manager` in
 * `local_operator/teams.py`: `manager: str = "manager"`).
 *
 * It is the FALLBACK rather than the source: a team present in the catalogue
 * contributes its own manager and this value is never reached, so the label
 * cannot disagree with a catalogue that says otherwise. It exists for the
 * catalogue that has not loaded yet - the alternative would be holding the
 * whole control behind a query the label does not need.
 */
export const DEFAULT_TEAM_MANAGER = "manager";

/**
 * The speaker chip's words when neither the host nor the catalogue names the
 * manager: the runtime's own phrase for an unnamed manager (`its manager is the
 * speaker`), which is distinguishable from the team chip beside it where the
 * team's name was not (design D5).
 */
export const ITS_MANAGER_LABEL = "its manager";

/**
 * The label ladder, for both controls, from the two sources in their
 * precedence order (live first, then the durable binding).
 *
 * WHY THE MANAGER IS THE AGENT LABEL when a team is bound and no agent is set
 * anywhere: that is what the runtime runs - a team's manager governs the
 * session - and it is the case the operator described in as many words
 * ("typically would be 'manager' in the case that a team is assigned"). The
 * value is NOT invented here: it is read from the same catalogue the sidebar
 * groups teams by, and it is marked current in the agent menu, because "the
 * profile in force" is exactly what that marking means.
 *
 * IT IS THE FALLBACK AFTER BOTH AGENT SOURCES, not after the live one. A
 * session can carry a durable agent binding AND a team at once (a chat staged
 * with an agent that later attached a team; `attach_team` layers the manager's
 * brief without touching `active_agent`), and in that state the explicit agent
 * is the one answering - so reading the manager before the binding would
 * misname the answering profile on exactly the cold sessions the binding
 * exists to describe. The chain is agent-live, agent-binding, then the team's
 * manager.
 *
 * The bindings are joined with `||` rather than `??` on purpose: an empty
 * string is the wire's spelling of "unset" (`active_agent` is `""` on an
 * unattached session in the runtime's own state), and `??` would let it
 * through as a label of nothing.
 */
export function resolveHeaderIdentity(
	input: HeaderIdentityInput,
): HeaderIdentityView {
	const published = effectiveIdentityPublished(input.effectiveIdentity);
	/*
	 * WHICH TEAM OWNS THE SESSION. The determination keys on the stream's
	 * `active_team` and the catalogue row's bound team - the two sources that
	 * stay reliable on a COLD frame, where `effective_identity` is `{}` - with a
	 * published statement's team as the last rung (a closed seat must never sit
	 * over a "No team" chip). The exception is a PUBLISHED statement that says
	 * `team: ""`: the host has just said no team is attached, so a durable
	 * binding the catalogue has not yet refreshed (the gap between a detach and
	 * the row catching up) is stale and must not constrain the seat.
	 */
	const publishedNoTeam = published !== null && published.team === "";
	const teamValue = publishedNoTeam
		? input.activeTeam || null
		: input.activeTeam || input.boundTeam || published?.team || null;
	const strictTeam = published?.team || teamValue || "";
	/*
	 * The catalogue row, read ONCE for the two answers it holds: the team's
	 * readable name (the label below) and the manager (the agent fallback). A
	 * team the list does not know - the query is off, still landing, or the row
	 * was deleted since it was bound - leaves both answers to their existing
	 * fallbacks rather than blanking either.
	 */
	const teamRow = teamValue
		? input.teams?.find((team) => team.name === teamValue)
		: undefined;
	const teamLabel = teamValue
		? teamDisplayName(teamRow ?? { name: teamValue })
		: NO_TEAM_LABEL;
	/*
	 * ONE STATEMENT OF WHO IS SPEAKING. Under the strict rule the agent slot
	 * is the team's, so the label is the speaker and NOT `active_agent`: the
	 * runtime replaces any earlier profile with the manager when a team
	 * attaches, so a stale explicit agent is never the speaker and a chip
	 * reading it would be the "team + agent pair" this rule retires.
	 *
	 * THE STRICT RULE APPLIES when the frame publishes the field, OR when this
	 * host has published it before and this frame is its cold shape (`{}` with a
	 * team bound): a cold frame is not an older host. An older host - one that
	 * has NEVER published the field in this run - keeps #866.
	 *
	 * THE SPEAKER LADDER, most to least specific: the host's `speaker`; the
	 * catalogue row's manager (what the runtime's own `_team_manager_name`
	 * returns, and the only name a cold frame has); then the words `its manager`
	 * - never the team's name, which read as a second chip beside the team's
	 * own (design D5) - and the sentence says so in the runtime's own phrase.
	 * A speaker equal to the team's name is a real manager named like its team
	 * unless the catalogue says the manager is someone else (core's fallback to
	 * the team name fires only for a manager it cannot name).
	 */
	const cold = published === null && input.hostPublishes === true;
	let seat: HeaderSeatClosure | null = null;
	if ((published !== null || cold) && strictTeam && teamValue) {
		/* The row's own manager, with the runtime's documented default for a row
		 * that carries none (`Team.manager`); `null` only while the row is absent. */
		const catalogueManager = teamRow
			? teamRow.manager || DEFAULT_TEAM_MANAGER
			: null;
		const hostSpeaker = published?.speaker ?? "";
		const hostSpeakerIsFallback =
			hostSpeaker === strictTeam && catalogueManager !== strictTeam;
		const named =
			hostSpeaker !== "" && !hostSpeakerIsFallback
				? hostSpeaker
				: catalogueManager;
		seat = {
			speaker: named ?? ITS_MANAGER_LABEL,
			speakerKnown: named !== null,
			team: strictTeam,
			sentence: identityAgentClosedCaption(strictTeam, named),
			title: identityAgentClosedTitle(teamLabel),
		};
	}
	let agentValue = seat
		? seat.speaker
		: input.activeAgent || input.boundAgent || null;
	if (!agentValue && teamValue) {
		agentValue = teamRow?.manager || DEFAULT_TEAM_MANAGER;
	}
	return {
		teamValue,
		teamLabel,
		agentValue,
		agentLabel: agentValue ?? NO_AGENT_LABEL,
		/*
		 * The manager value the CONSTRAINT reads (see the field's own docblock for
		 * why it is quieter than the label fallback above: a row that is not there
		 * answers `null`, never the default).
		 */
		teamManager: teamValue
			? teamRow
				? teamRow.manager || DEFAULT_TEAM_MANAGER
				: null
			: null,
		seat,
	};
}

/**
 * When the two controls replace the plain description.
 *
 * The slot is only the identity's when there is a session to command and
 * something has settled the question of who is answering:
 *
 * - a draft (`hasSession` false) has no owner to command, exactly as the
 *   archive and console controls are omitted there;
 * - `pending` is the connecting state with no identity from either source -
 *   the header's own skeleton, which a menu must not replace with "No team",
 *   because nobody has answered the question yet (the D3 defect class);
 * - without the `team_catalogue` capability the team menu cannot list
 *   anything, and half a control pair is not a lesser feature but a dead one,
 *   so the header keeps today's plain text instead;
 * - with neither source naming an identity, the stream has to have SAID so
 *   (`streamLive`) before "No team" is a fact rather than a guess. A stream
 *   that failed before its first snapshot never claimed the session is
 *   unattached, and the assign affordance over that pane would be a fallback
 *   string presented as a fact - which is the trade this gate refuses.
 */
export function headerIdentityControlsShown(input: {
	hasSession: boolean;
	pending: boolean;
	teamCatalogue: boolean;
	identityKnown: boolean;
	streamLive: boolean;
}): boolean {
	if (!input.hasSession || input.pending || !input.teamCatalogue) return false;
	return input.identityKnown || input.streamLive;
}

/**
 * Whether the pair BOUND TO THIS CHAT cannot stand: a team leads it, an
 * EXPLICIT agent sits in the agent slot, and that agent is not one the team's
 * constraint accepts (issue #861's second half).
 *
 * WHY THIS IS NOT "THE LABEL'S VALUE". The header must not hide a persona that
 * is in the prompt: with no explicit `/agent`, the agent slot's label IS the
 * team's manager (the implicit seat), which is always accepted - there is
 * nothing to flag. The flag is about a pair: an explicit agent that the
 * constraint does not accept while a team leads.
 *
 * WHAT MAKES IT QUIET. Every clause is a fact this function refuses to guess:
 *
 * - no explicit agent, no team, or no manager from the catalogue row (see
 *   `teamManager`'s docblock) - nothing to compare against;
 * - `delegate` `null` - the roster's answer for the agent either has not
 *   arrived (`commands.entities` still in flight) or does not carry the field,
 *   and a warning computed from the NAME alone would be exactly the false cue
 *   this guard exists to prevent: a delegating profile is legal in this seat,
 *   and nothing but the row can tell the two apart.
 *
 * The one predicate that remains once the facts are in is
 * `identityAgentSettable`, from the menu model - one rule, two surfaces (this
 * cue and the panel's per-row marks) that cannot disagree about who may take
 * the seat.
 */
export function headerIdentityAgentFlagged(input: {
	/** The EXPLICIT agent in force (`active_agent || bound_agent`), never the implicit manager. */
	explicitAgent: string | null;
	/** The bound team's manager, `null` while the catalogue has not answered. */
	manager: string | null;
	/** The explicit agent's `delegate` flag; `null` while it is not known. */
	delegate: boolean | null;
	/**
	 * The strict rule is in force (`HeaderIdentityView.seat !== null`). THE CUE
	 * STAYS DARK: the runtime normalises a team chat to the manager alone, so a
	 * stale explicit agent is never the speaker and there is no "pair that needs
	 * resolving" to flag. Short-circuited HERE rather than by calling
	 * `identityAgentSettable` with the strict flag, which would answer "refused"
	 * for every name and light the cue on exactly the chats it must not.
	 */
	teamOwnsSeat?: boolean;
}): boolean {
	if (input.teamOwnsSeat === true) return false;
	if (
		input.explicitAgent === null ||
		input.manager === null ||
		input.delegate === null
	) {
		return false;
	}
	return !identityAgentSettable({
		name: input.explicitAgent,
		manager: input.manager,
		delegate: input.delegate,
	});
}
