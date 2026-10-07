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

import { teamDisplayName } from "../../../shared/api/local-operator/team-display";
import { identityAgentSettable } from "./chat-header-identity-menu-model";

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
	const teamValue = input.activeTeam || input.boundTeam || null;
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
	let agentValue = input.activeAgent || input.boundAgent || null;
	if (!agentValue && teamValue) {
		agentValue = teamRow?.manager || DEFAULT_TEAM_MANAGER;
	}
	return {
		teamValue,
		teamLabel: teamValue
			? teamDisplayName(teamRow ?? { name: teamValue })
			: NO_TEAM_LABEL,
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
}): boolean {
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
