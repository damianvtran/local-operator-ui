import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
	TeamBridgeParticipant,
} from "../../../../shared/team-bridge-contract";
import {
	type TeamBridgeRecipient,
	participantLabel,
	personDisplayLabel,
	personRowState,
} from "./team-bridge-model";

/*
 * MEMBER AUTHORITY COMES FROM THE HUB'S OWN RULES, NOT `can_administer`.
 *
 * `can_administer` on the conversation view is the ARCHIVE/DELETE authority
 * (`lifecycleAuthority` in agent-server): the conversation owner, or an
 * organization owner/admin on a channel. It is deliberately NOT reused here,
 * because the member routes enforce two different rules:
 *
 *   - POST /conversations/{id}/members (invite): any ACTIVE human member. The
 *     service's only membership proof is `loadForMember`, plus refusals for a
 *     DM, a built-in channel and an archived conversation.
 *   - DELETE /conversations/{id}/members/{account}: `requireOwner` — the
 *     caller's own active human row must have role "owner". The route is
 *     HUMAN-keyed (`BridgeConversationMemberKey(accountID, "")`), so it can
 *     never address an agent row; an invited agent is answered through consent
 *     (decline) and an active one through withdraw, not through this route.
 *
 * Reading the caller's own published member row is therefore not a second
 * opinion about authority: it is the same row the server reads, sent to this
 * client. An unresolved account fails closed (no controls).
 */

function selfHumanMember(
	conversation: TeamBridgeConversation,
	selfAccountId: string | undefined,
): TeamBridgeParticipant | null {
	if (!selfAccountId) return null;
	return (
		conversation.members.find(
			(member) =>
				member.kind === "human" &&
				member.account_id === selfAccountId &&
				member.state === "active",
		) ?? null
	);
}

/** The invite route's prerequisites, as the hub enforces them. */
export function canInviteMembers(
	conversation: TeamBridgeConversation,
	selfAccountId: string | undefined,
): boolean {
	return (
		conversation.kind !== "dm" &&
		conversation.status === "open" &&
		!conversation.builtin &&
		selfHumanMember(conversation, selfAccountId) !== null
	);
}

/** The remove route's prerequisite: the caller's active human row is the owner. */
export function canRemoveMembers(
	conversation: TeamBridgeConversation,
	selfAccountId: string | undefined,
): boolean {
	const self = selfHumanMember(conversation, selfAccountId);
	return (
		conversation.kind !== "dm" &&
		conversation.status === "open" &&
		!conversation.builtin &&
		self !== null &&
		self.role === "owner"
	);
}

export type TeamBridgeMemberCandidate = {
	recipient: TeamBridgeRecipient;
	/**
	 * An ineligible row is visible with this reason instead of silently absent.
	 * There is no "already a member" reason: current members are FILTERED out of
	 * the invite list (design spec, 2026-10-30) because the left column already
	 * lists them, and a disabled duplicate row was half the noise in the
	 * operator's screenshot.
	 */
	disabledReason:
		| "bridge_unavailable"
		| "agent_unavailable"
		| "agent_not_permitted"
		| null;
};

/*
 * ONE COMPARATOR FOR BOTH COLUMNS. Rows read A-Z in the reader's locale
 * (`localeCompare` with the UI tag, base sensitivity so "ada" and "Ada" do not
 * split), never by account id: the id is opaque and the name is what the eye
 * scans for. `locale` is optional so the pure model stays callable without the
 * i18n runtime; undefined is the host default.
 */
function compareLabels(a: string, b: string, locale?: string): number {
	return a.localeCompare(b, locale, { sensitivity: "base" });
}

/**
 * The search both lists share: a case-insensitive substring of the row's label.
 * Whitespace-only is "no query", so a stray space does not empty the lists.
 */
export function matchesMemberQuery(label: string, query: string): boolean {
	const needle = query.trim().toLocaleLowerCase();
	return needle === "" || label.toLocaleLowerCase().includes(needle);
}

/**
 * Split rows into the People and Agents groups both columns render, in that
 * order. Each group keeps the order it was handed, so the sort stays the
 * caller's (owner-first for members, eligible-first for candidates).
 */
export function groupByKind<T>(
	rows: readonly T[],
	kindOf: (row: T) => "human" | "agent",
): { people: T[]; agents: T[] } {
	return {
		people: rows.filter((row) => kindOf(row) === "human"),
		agents: rows.filter((row) => kindOf(row) === "agent"),
	};
}

function memberKey(kind: "human" | "agent", accountId: string): string {
	return `${kind}:${accountId}`;
}

/** Active and invited both block a duplicate invitation. */
function currentMemberKeys(
	members: readonly TeamBridgeParticipant[],
): ReadonlySet<string> {
	return new Set(
		members
			.filter(
				(member) => member.state === "active" || member.state === "invited",
			)
			.map((member) => memberKey(member.kind, member.account_id)),
	);
}

/**
 * The add-member roster is derived from the whole organization directory, not
 * the direct-message candidate list. In particular `chiefsOfStaff` deliberately
 * excludes the reader's own agent for DMs; inviting it into a group is a valid,
 * distinct action, so this function includes it. The label is the directory's
 * CURRENT agent name ("Aida (Ben)"), never a stored add-time label.
 *
 * Active and invited members are left out entirely (see `disabledReason`); a
 * departed or declined one stays, which is how they are re-invited. Order is
 * eligible rows A-Z, then ineligible rows A-Z: what can be ticked comes first,
 * and an unreachable peer is still findable at the bottom of its group.
 */
export function memberCandidates(
	conversation: TeamBridgeConversation,
	people: readonly TeamBridgeDirectoryMember[],
	selfAccountId: string | undefined,
	chiefLabel: (agentName: string, ownerLabel: string) => string,
	locale?: string,
): TeamBridgeMemberCandidate[] {
	const current = currentMemberKeys(conversation.members);
	const candidates: TeamBridgeMemberCandidate[] = [];
	for (const person of people) {
		const personLabel = personDisplayLabel(person);
		const humanState = personRowState(person, selfAccountId);
		if (!current.has(memberKey("human", person.account_id))) {
			candidates.push({
				recipient: {
					kind: "human",
					accountId: person.account_id,
					label: personLabel,
				},
				disabledReason:
					humanState === "openable" ||
					humanState === "paused" ||
					humanState === "self"
						? null
						: "bridge_unavailable",
			});
		}

		// The reader's own chief is intentionally NOT skipped. Adding it creates
		// an invitation only; owner consent remains a separate human action.
		const agent = person.agent;
		if (!agent || current.has(memberKey("agent", person.account_id))) continue;
		candidates.push({
			recipient: {
				kind: "agent",
				accountId: person.account_id,
				endpointId: agent.endpoint_id,
				agentName: agent.name.trim(),
				ownerLabel: personLabel,
				label: chiefLabel(agent.name.trim(), personLabel),
			},
			disabledReason: !conversation.agent_capable
				? "agent_not_permitted"
				: agent.state === "active" || agent.state === "paused"
					? null
					: "agent_unavailable",
		});
	}
	return candidates.sort(
		(a, b) =>
			Number(a.disabledReason !== null) - Number(b.disabledReason !== null) ||
			compareLabels(a.recipient.label, b.recipient.label, locale),
	);
}

/*
 * Current membership only: active and invited.
 *
 * The conversation also carries `left` and `removed` participants: the server
 * keeps them so history reads correctly and so a person who left can be
 * invited back. Neither is a member of the room now, and listing them under a
 * "Current members" heading puts departed people beside a room they are not
 * in - the opposite of what the heading promises. `removed` is the invitation
 * outcome after a decline (see team-bridge-invitations-model), so the same
 * argument applies: a declined invitation is not an occupied seat.
 *
 * Both states stay ADDIABLE as candidates (`currentMemberKeys` blocks only
 * active and invited), which is how a declined or departed person is
 * re-invited from this same dialog.
 */

/** One row of the current-members list. */
export type TeamBridgeCurrentMember = {
	member: TeamBridgeParticipant;
	label: string;
	state: "active" | "invited";
	/** The reader's own row, which reads "(you)" and is never removable. */
	self: boolean;
	/*
	 * The remove route is human-keyed, so an agent row is never removable here:
	 * DELETE .../members/{account} would resolve the OWNER's human row, not the
	 * agent's. Invited agents are answered through consent, not this dialog.
	 */
	removable: boolean;
};

/**
 * The member list is server state, not the directory's roster. Invitation state
 * is rendered explicitly so an invited person/agent never appears active.
 * `canRemove` is the caller-level owner check; `selfAccountId` keeps the
 * owner's own "remove" out of the list (leaving is its own action).
 *
 * Order: the owner first (the one person whose role changes what the room can
 * do), then A-Z. The view splits People from Agents with `groupByKind`, which
 * keeps this order inside each group.
 */
export function currentMembers(
	conversation: TeamBridgeConversation,
	people: readonly TeamBridgeDirectoryMember[],
	selfAccountId: string | undefined,
	chiefLabel: (agentName: string, ownerLabel: string) => string,
	canRemove: boolean,
	locale?: string,
): TeamBridgeCurrentMember[] {
	return conversation.members
		.flatMap((member) =>
			member.state === "active" || member.state === "invited"
				? [{ member, state: member.state }]
				: [],
		)
		.map(({ member, state }) => ({
			member,
			label:
				participantLabel(
					member,
					people,
					{
						named: chiefLabel,
						// Empty is the directory's unnamed-agent case; let the locale
						// formatter produce its own "X's chief of staff" wording.
						unnamed: (ownerLabel) => chiefLabel("", ownerLabel),
					},
					null,
				) ?? member.account_id,
			state,
			self: member.kind === "human" && member.account_id === selfAccountId,
			// `state` is active or invited here, so the only removal the route can
			// address is a human row that is not the reader's own.
			removable:
				canRemove &&
				member.kind === "human" &&
				member.account_id !== selfAccountId,
		}))
		.sort(
			(a, b) =>
				Number(b.member.role === "owner") - Number(a.member.role === "owner") ||
				compareLabels(a.label, b.label, locale),
		);
}

/*
 * THE MEMBERS PANEL (header count -> right drawer, operator 2026-11-04).
 *
 * The add-members dialog above is an INVITE surface that happens to list the
 * room; the panel is the room itself: who is here, in which state, and the one
 * action the reader may take on each row. Everything below is pure so the
 * authority table is asserted by name (scripts/team-bridge-members-panel.test.mjs)
 * rather than by clicking.
 *
 * AUTHORITY, AS THE HUB ENFORCES IT (agreed with the Team Bridge hub owner,
 * 2026-11-04). Each row resolves to at most ONE action:
 *
 *   row                          action          route
 *   ---------------------------  --------------  -------------------------------
 *   another human                "remove"        DELETE .../members/{account}
 *                                                (`requireOwner`: canRemoveMembers)
 *   the reader's own human row   "leave"         POST .../leave
 *   the reader's own agent       "withdraw"      POST .../members/{self}/consent
 *     (active)                                   decision=withdraw
 *   the reader's own agent       "decline"       same route, decision=decline
 *     (invited, awaiting consent)
 *   someone else's agent         none today      see `otherAgentRemovable`
 *
 * Refusals that hold for every row: a DM (membership is the pair, there is
 * nothing to change), an archived conversation (the hub refuses member writes
 * on it), a preview (no rows). Built-in channels are DERIVED membership, so
 * nobody is removed from them and nobody leaves #general/#humans; agent-server
 * `builtinDerives` lets a human who joined #agents by their own act leave it,
 * so leave is mirrored there and nowhere else among the built-ins. An own
 * agent in a built-in is derived the same way and gets no control (fail
 * closed: the hub has not said withdraw is valid there).
 *
 * None of this is a second opinion: the server re-checks every write, and a
 * refusal is shown inline in the panel. The table only keeps the UI from
 * offering a control the server is certain to refuse.
 */

/** What the panel offers on one row. */
export type TeamBridgeMemberRowAction =
	| "remove"
	| "leave"
	| "withdraw"
	| "decline";

/**
 * Where a row stands. `pending_approval` is an INVITED AGENT: agent
 * invitations are answered only by the agent owner's consent (the agent can
 * never accept for itself, see `TeamBridgeApi.answerAgentInvitation`), so an
 * invited agent row is by construction waiting on its owner. The wire carries
 * no separate field for it; the kind is the distinguishing fact.
 */
export type TeamBridgeMemberRowState =
	| "active"
	| "invited"
	| "pending_approval";

/** One row of the members panel. */
export type TeamBridgeMemberPanelRow = {
	member: TeamBridgeParticipant;
	label: string;
	state: TeamBridgeMemberRowState;
	/** The reader's own human row ("(you)"). */
	self: boolean;
	/** An agent whose owner is the reader. */
	ownAgent: boolean;
	action: TeamBridgeMemberRowAction | null;
	/** React key, also the pending-mutation key's suffix. */
	key: string;
};

/**
 * THE SEAM FOR REMOVING SOMEONE ELSE'S AGENT. Always false today: the hub's
 * member DELETE is human-keyed, so it cannot address an agent row, and there is
 * no other route. The hub owner is adding an endpoint-keyed DELETE whose
 * authority is `can_administer` OR the caller's own row, advertised by a
 * capability and a per-view / per-row flag (`can_manage_members` /
 * `can_remove` are the working names, not settled). When that ships, read the
 * served flag HERE - never invent the field ahead of it - and add a
 * `"remove_agent"` action wired to the new op.
 */
export function otherAgentRemovable(
	_conversation: TeamBridgeConversation,
	_member: TeamBridgeParticipant,
): boolean {
	return false;
}

/** The built-in a reader may leave: membership there can be their own act. */
const LEAVABLE_BUILTIN = "agents";

/**
 * The one action the reader may take on `member`, or null. See the authority
 * table above; `conversation` is the cached view the panel renders.
 */
export function memberRowAction(
	conversation: TeamBridgeConversation,
	member: TeamBridgeParticipant,
	selfAccountId: string | undefined,
): TeamBridgeMemberRowAction | null {
	if (!selfAccountId) return null;
	if (conversation.kind === "dm" || conversation.status !== "open") return null;
	if (member.state !== "active" && member.state !== "invited") return null;
	const mine = member.account_id === selfAccountId;
	if (member.kind === "human") {
		if (mine) {
			if (member.state !== "active") return null;
			return !conversation.builtin || conversation.builtin === LEAVABLE_BUILTIN
				? "leave"
				: null;
		}
		return canRemoveMembers(conversation, selfAccountId) ? "remove" : null;
	}
	if (mine) {
		if (conversation.builtin) return null;
		return member.state === "active" ? "withdraw" : "decline";
	}
	// Someone else's agent: no route can address it yet. THIS is where the
	// future flag plugs in: when the hub's endpoint-keyed DELETE ships,
	// `otherAgentRemovable` reads its served flag and this line returns the
	// new action (and its op) when it answers true.
	return null;
}

/** The quiet line the panel shows instead of controls, when one applies. */
export function memberPanelNote(
	conversation: Pick<TeamBridgeConversation, "kind" | "builtin">,
): "general" | "humans" | "agents" | "dm" | null {
	if (conversation.kind === "dm") return "dm";
	switch (conversation.builtin) {
		case "general":
		case "humans":
		case "agents":
			return conversation.builtin;
		default:
			return null;
	}
}

/** The search box earns its space only past one screenful of rows. */
export const MEMBER_PANEL_SEARCH_THRESHOLD = 8;

/**
 * The panel's rows: current membership (active + invited, the same rule and
 * the same owner-first, A-Z order as `currentMembers`), each with its state
 * and its one permitted action. Derived from `conversation.members` alone, so
 * the panel re-renders whenever the conversation query or a join/leave
 * membership event refreshes the cached conversation - there is no second
 * copy of the room to go stale.
 */
export function memberPanelRows(
	conversation: TeamBridgeConversation,
	people: readonly TeamBridgeDirectoryMember[],
	selfAccountId: string | undefined,
	chiefLabel: (agentName: string, ownerLabel: string) => string,
	locale?: string,
): TeamBridgeMemberPanelRow[] {
	return currentMembers(
		conversation,
		people,
		selfAccountId,
		chiefLabel,
		false,
		locale,
	).map(({ member, label, state, self }) => ({
		member,
		label,
		state:
			state === "invited" && member.kind === "agent"
				? "pending_approval"
				: state,
		self,
		ownAgent: member.kind === "agent" && member.account_id === selfAccountId,
		action: memberRowAction(conversation, member, selfAccountId),
		key: memberKey(member.kind, member.account_id),
	}));
}
