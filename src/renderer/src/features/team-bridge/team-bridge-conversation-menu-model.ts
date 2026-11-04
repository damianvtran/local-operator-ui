import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
	TeamBridgeMemberInput,
	TeamBridgeParticipant,
} from "../../../../shared/team-bridge-contract";
import { canInviteMembers } from "./team-bridge-members-model";
import {
	type TeamBridgeTarget,
	defaultLandingConversation,
	isPreviewConversation,
} from "./team-bridge-model";

/*
 * THE CONVERSATION MENU'S ONE ITEM LIST (operator 2026-11-04: "there's no option
 * to leave a channel ... an ellipsis/context menu on each channel/group to ...
 * join/leave/see members, mute/update notification preferences"; and "remove
 * our agents from the channels in addition to ourselves").
 *
 * The header "…", the rail row "…" and the row's right-click all render THIS
 * list, so the three openers cannot drift into different orders or different
 * authority. The renderer (`team-bridge-conversation-menu.tsx`) only maps ids
 * to rows; every "may the reader do this here" decision is made below, from the
 * same served facts the members panel reads (`team-bridge-members-model.ts`).
 *
 * AUTHORITY, AS THE HUB ENFORCES IT (Team Bridge hub owner, 2026-11-04):
 *
 *   item            shown when                        route
 *   --------------  --------------------------------  --------------------------
 *   View members    a member, not a DM                (members panel, no write)
 *   Add members     `canInviteMembers`                POST .../members
 *   Join            discoverable, not a member        POST .../join
 *   Mute / levels   a member                          PUT .../notify
 *   Wake your agent own ACTIVE agent here + capability PUT .../agent-notify
 *   Remove {agent}  own agent active (withdraw) or    POST .../members/{self}/consent
 *                   invited (decline)                 (server refuses a non-own row)
 *   Add {agent}     own agent absent/departed:
 *                     #general  -> consent `accept` (re-admit after a withdraw)
 *                     otherwise -> invite own endpoint (joins at once)
 *   Leave           own active human row, not a DM    POST .../leave
 *   Archive         `canArchiveConversation`          (unchanged)
 *
 * REASONS, NEVER SILENT GAPS. Where the reader would reasonably look for an
 * item the hub will refuse, it is drawn DISABLED with the reason as its second
 * line instead of disappearing:
 *   - Leave in #general / #humans: membership is the organization's;
 *   - Remove {agent} in #agents: consent decisions are refused there, the
 *     agent leaves #agents only by being paused;
 *   - Remove {agent} in #general before the agent has a row: the hub's
 *     withdraw would 404 `member_not_found`;
 *   - Add {agent} where the conversation is not agent-capable.
 *
 * PERSONAS. There are no per-persona member rows (B3 DESIGN §1): one withdraw of
 * the agent's endpoint takes out every persona that speaks through it. If
 * persona sub-rows ever appear, they stay read-only and Remove remains on the
 * agent's own row only - never add a persona-keyed remove here.
 *
 * SOMEONE ELSE'S AGENT has no item: no route can address it until the hub's H4
 * endpoint-keyed DELETE ships (see `otherAgentRemovable`).
 */

/** Why a drawn item cannot be used here; each maps to one visible reason. */
export type TeamBridgeMenuDisabledReason =
	| "org_wide_membership"
	| "agents_builtin"
	| "general_not_member_yet"
	| "agent_not_permitted";

export type TeamBridgeOwnAgentAction =
	| "withdraw"
	| "decline"
	| "accept"
	| "add";

export type TeamBridgeConversationMenuItem =
	| { id: "view_members" }
	| { id: "add_members" }
	| { id: "join" }
	| { id: "notify" }
	| { id: "agent_notify" }
	| {
			id: "remove_agent" | "add_agent";
			agentName: string;
			action: TeamBridgeOwnAgentAction;
			endpointId?: string;
			disabledReason?: TeamBridgeMenuDisabledReason;
	  }
	| {
			id: "leave";
			kind: "channel" | "group";
			disabledReason?: TeamBridgeMenuDisabledReason;
	  }
	| { id: "archive" };

export type TeamBridgeConversationMenuItemId =
	TeamBridgeConversationMenuItem["id"];

/**
 * Which writes the mounting surface has wired. A story or an older container
 * that passes no handler simply draws no row for it; this is not authority
 * (the hub's rules above are), only "is there anything to call".
 */
export type TeamBridgeConversationMenuWiring = {
	viewMembers?: boolean;
	addMembers?: boolean;
	join?: boolean;
	notify?: boolean;
	agentNotify?: boolean;
	ownAgent?: boolean;
	leave?: boolean;
	archive?: boolean;
};

export type TeamBridgeConversationMenuInput = {
	conversation: TeamBridgeConversation;
	selfAccountId: string | undefined;
	/**
	 * The reader's own directory row (its `agent` is the endpoint "Add {name}"
	 * invites). Absent: no add item, because there is no endpoint to name.
	 */
	selfPerson?: TeamBridgeDirectoryMember;
	/** Bridge status `read_only`, or no owner guard: browse, never write. */
	readOnly?: boolean;
	/** `team_bridge_agent_notify` advertised (the wake group's route exists). */
	agentNotifyEnabled?: boolean;
	/** Only true when the caller also has `canArchiveConversation`. */
	archivable?: boolean;
	wiring: TeamBridgeConversationMenuWiring;
};

/** The built-ins whose membership is the organization's, not the reader's. */
const ORG_WIDE_BUILTINS = new Set(["general", "humans"]);

/** The reader's own agent's CURRENT row here (active or invited), if any. */
export function ownAgentRow(
	conversation: Pick<TeamBridgeConversation, "members">,
	selfAccountId: string | undefined,
): TeamBridgeParticipant | null {
	if (!selfAccountId) return null;
	return (
		conversation.members.find(
			(member) =>
				member.kind === "agent" &&
				member.account_id === selfAccountId &&
				(member.state === "active" || member.state === "invited"),
		) ?? null
	);
}

/** A participant's endpoint id, where the hub publishes one (passthrough). */
export function participantEndpoint(
	member: TeamBridgeParticipant | null | undefined,
): string | undefined {
	const endpoint = (member as { endpoint_id?: unknown } | null | undefined)
		?.endpoint_id;
	return typeof endpoint === "string" && endpoint !== "" ? endpoint : undefined;
}

/**
 * Whether `endpointId` is the reader's OWN agent's endpoint in `conversation`
 * (or the reader's own directory agent). The consent route is the owner's
 * self-service route; the server refuses any other row, and this check keeps
 * the client from ever ASKING with a stranger's endpoint (request-shape test
 * in scripts/team-bridge-conversation-menu.test.mjs).
 */
export function isOwnAgentEndpoint(
	conversation: Pick<TeamBridgeConversation, "members">,
	selfAccountId: string | undefined,
	selfPerson: TeamBridgeDirectoryMember | undefined,
	endpointId: string | undefined,
): boolean {
	if (!selfAccountId) return false;
	if (endpointId === undefined) {
		// The hub resolves the owner's own agent row when no endpoint is named,
		// so an unnamed request can only ever address the caller's own agent.
		return (
			conversation.members.some(
				(member) =>
					member.kind === "agent" && member.account_id === selfAccountId,
			) || Boolean(selfPerson?.agent)
		);
	}
	if (selfPerson?.account_id === selfAccountId && selfPerson.agent) {
		if (selfPerson.agent.endpoint_id === endpointId) return true;
	}
	return conversation.members.some(
		(member) =>
			member.kind === "agent" &&
			member.account_id === selfAccountId &&
			participantEndpoint(member) === endpointId,
	);
}

function selfHumanActive(
	conversation: TeamBridgeConversation,
	selfAccountId: string | undefined,
): boolean {
	return conversation.members.some(
		(member) =>
			member.kind === "human" &&
			member.account_id === selfAccountId &&
			member.state === "active",
	);
}

/** The own-agent item (remove or add), or null when none applies here. */
function ownAgentItem(
	input: TeamBridgeConversationMenuInput,
): TeamBridgeConversationMenuItem | null {
	const { conversation, selfAccountId, selfPerson } = input;
	if (!selfAccountId || conversation.kind === "dm") return null;
	const row = ownAgentRow(conversation, selfAccountId);
	const directoryAgent =
		selfPerson?.account_id === selfAccountId ? selfPerson.agent : undefined;
	const agentName =
		directoryAgent?.name.trim() || row?.display_label.trim() || "";
	if (!row && !directoryAgent) return null;
	if (!agentName) return null;
	const builtin = conversation.builtin;
	if (builtin === "humans") return null;
	if (builtin === "agents") {
		// Consent decisions are refused in #agents; the agent leaves only by
		// being paused. Drawn disabled so the reader learns where the switch is.
		return row && row.state === "active"
			? {
					id: "remove_agent",
					agentName,
					action: "withdraw",
					endpointId: participantEndpoint(row),
					disabledReason: "agents_builtin",
				}
			: null;
	}
	if (builtin === "general") {
		if (row?.state === "active")
			return {
				id: "remove_agent",
				agentName,
				action: "withdraw",
				endpointId: participantEndpoint(row),
			};
		const departed = conversation.members.find(
			(member) =>
				member.kind === "agent" &&
				member.account_id === selfAccountId &&
				(member.state === "left" ||
					member.state === "removed" ||
					member.state === "invited"),
		);
		// A withdrawn agent is re-admitted by consent `accept`. With no row at all
		// the hub has not derived one yet: withdraw would 404 member_not_found.
		return departed
			? {
					id: "add_agent",
					agentName,
					action: "accept",
					endpointId:
						participantEndpoint(departed) ?? directoryAgent?.endpoint_id,
				}
			: {
					id: "remove_agent",
					agentName,
					action: "withdraw",
					disabledReason: "general_not_member_yet",
				};
	}
	if (row)
		return {
			id: "remove_agent",
			agentName,
			action: row.state === "active" ? "withdraw" : "decline",
			endpointId: participantEndpoint(row) ?? directoryAgent?.endpoint_id,
		};
	// Absent or departed: invite the reader's own endpoint (it joins at once).
	if (!directoryAgent || !canInviteMembers(conversation, selfAccountId))
		return null;
	return {
		id: "add_agent",
		agentName,
		action: "add",
		endpointId: directoryAgent.endpoint_id,
		disabledReason: conversation.agent_capable
			? undefined
			: "agent_not_permitted",
	};
}

/**
 * The menu, as ordered sections (a separator between each non-empty one):
 *   1. membership    View members, Add members, Join
 *   2. notifications Mute/levels, Wake your agent for
 *   3. departures    Remove/Add {agent}, Leave, Archive
 */
export function conversationMenuSections(
	input: TeamBridgeConversationMenuInput,
): TeamBridgeConversationMenuItem[][] {
	const { conversation, selfAccountId, wiring } = input;
	const preview = isPreviewConversation(conversation);
	const dm = conversation.kind === "dm";
	const open = conversation.status === "open";
	const member = !preview && selfHumanActive(conversation, selfAccountId);
	const writable = !input.readOnly && open;

	const membership: TeamBridgeConversationMenuItem[] = [];
	if (wiring.viewMembers && !dm && !preview)
		membership.push({ id: "view_members" });
	if (
		writable &&
		wiring.addMembers &&
		canInviteMembers(conversation, selfAccountId)
	)
		membership.push({ id: "add_members" });
	if (writable && wiring.join && preview) membership.push({ id: "join" });

	const notifications: TeamBridgeConversationMenuItem[] = [];
	if (writable && !preview && wiring.notify) {
		notifications.push({ id: "notify" });
		if (
			wiring.agentNotify &&
			input.agentNotifyEnabled &&
			conversation.members.some(
				(row) =>
					row.kind === "agent" &&
					row.account_id === selfAccountId &&
					row.state === "active",
			)
		)
			notifications.push({ id: "agent_notify" });
	}

	const departures: TeamBridgeConversationMenuItem[] = [];
	if (writable && member && wiring.ownAgent) {
		const agent = ownAgentItem(input);
		if (agent) departures.push(agent);
	}
	if (writable && member && wiring.leave && !dm) {
		const kind = conversation.kind === "group" ? "group" : "channel";
		departures.push(
			conversation.builtin && ORG_WIDE_BUILTINS.has(conversation.builtin)
				? { id: "leave", kind, disabledReason: "org_wide_membership" }
				: { id: "leave", kind },
		);
	}
	if (writable && wiring.archive && input.archivable)
		departures.push({ id: "archive" });

	return [membership, notifications, departures].filter(
		(section) => section.length > 0,
	);
}

/** The flat id order, for the parity assertion between header and row. */
export function conversationMenuItemIds(
	input: TeamBridgeConversationMenuInput,
): TeamBridgeConversationMenuItemId[] {
	return conversationMenuSections(input).flatMap((section) =>
		section.map((item) => item.id),
	);
}

/**
 * The one request an own-agent item may send, or null when it may send none.
 *
 * THE CLIENT NEVER ASKS WITH A STRANGER'S ENDPOINT. The consent route is the
 * owner's self-service route and the hub refuses any row that is not the
 * caller's own; this function keeps the client from making that request at all
 * (a disabled item, a stale item whose agent moved, or an endpoint that is not
 * the reader's yields null and the container rejects before any I/O).
 */
export type TeamBridgeOwnAgentRequest =
	| { op: "withdraw" | "decline" | "accept"; endpointId?: string }
	| { op: "add"; member: TeamBridgeMemberInput };

export function ownAgentRequest(
	conversation: TeamBridgeConversation,
	selfAccountId: string | undefined,
	selfPerson: TeamBridgeDirectoryMember | undefined,
	item: Extract<
		TeamBridgeConversationMenuItem,
		{ id: "remove_agent" | "add_agent" }
	>,
): TeamBridgeOwnAgentRequest | null {
	if (!selfAccountId || item.disabledReason) return null;
	if (
		!isOwnAgentEndpoint(
			conversation,
			selfAccountId,
			selfPerson,
			item.endpointId,
		)
	)
		return null;
	if (item.action !== "add")
		return { op: item.action, endpointId: item.endpointId };
	const agent =
		selfPerson?.account_id === selfAccountId ? selfPerson.agent : undefined;
	if (
		!agent ||
		agent.endpoint_id !== item.endpointId ||
		!canInviteMembers(conversation, selfAccountId)
	)
		return null;
	return {
		op: "add",
		member: {
			account_id: selfAccountId,
			kind: "agent",
			endpoint_id: agent.endpoint_id,
			display_label: item.agentName.slice(0, 64),
		},
	};
}

/**
 * Where the reader lands after LEAVING a conversation: the default landing
 * (#general, else #humans, else the first row) among the rows that remain.
 * Not the rail neighbour `landingAfterRemoval` picks for archive: leaving is a
 * departure, and the operator asked for #general as the place it returns to.
 */
export function landingAfterLeave(
	rows: readonly TeamBridgeConversation[],
	leftId: string,
	organizationOrder: readonly string[] = [],
): TeamBridgeTarget | null {
	const next = defaultLandingConversation(
		rows.filter((row) => row.id !== leftId),
		organizationOrder,
	);
	return next ? { type: "conversation", id: next.id } : null;
}

/*
 * LEAVE, AND THE READER'S AGENT WITH IT (hub owner contract, H4 slice).
 *
 * A person who leaves a conversation expects their agent to go too: it was
 * there on their behalf. The hub is gaining a server-side cascade, advertised
 * as `team_bridge_leave_withdraws_agent`:
 *   - advertised     -> call leave ONLY; the hub withdraws the agent in the
 *                       same transaction (a second withdraw would 409).
 *   - not advertised -> call leave, then a consent `withdraw` of the reader's
 *                       own ACTIVE agent row in that conversation, if any.
 * The second write can fail after the first succeeded. That is reported as
 * "partial", never as success: the page says "You left. Your agent is still
 * in this conversation." and offers Retry (which re-runs only the withdraw).
 * The leave itself failing rejects, exactly like the members panel's leave.
 */
export type TeamBridgeLeaveOutcome =
	| { status: "left" }
	| { status: "partial"; endpointId?: string; error: unknown };

export async function leaveWithAgentCascade(input: {
	leave: () => Promise<unknown>;
	withdraw: (endpointId: string | undefined) => Promise<unknown>;
	/** The served `team_bridge_leave_withdraws_agent` answer is `enabled`. */
	serverWithdrawsAgent: boolean;
	/** The reader's own ACTIVE agent row, read BEFORE the leave. */
	ownActiveAgent: TeamBridgeParticipant | null;
}): Promise<TeamBridgeLeaveOutcome> {
	await input.leave();
	// H4: the hub cascades itself; a client withdraw on top would be refused.
	if (input.serverWithdrawsAgent || !input.ownActiveAgent)
		return { status: "left" };
	// Pre-H4 hub: the client performs the cascade as a second, separate write.
	const endpointId = participantEndpoint(input.ownActiveAgent);
	try {
		await input.withdraw(endpointId);
		return { status: "left" };
	} catch (error) {
		return { status: "partial", endpointId, error };
	}
}

/**
 * A withdraw that found nothing to withdraw already reached the state the
 * reader asked for (a lost answer, or the agent removed elsewhere); a Retry
 * that draws one of these is success, not a second failure.
 */
export function withdrawAlreadyDone(error: unknown): boolean {
	const code = (error as { code?: unknown } | null)?.code;
	return code === "not_active" || code === "member_not_found";
}

/** The hub's 404 for a #general withdraw before the agent has a row. */
export function isMemberNotFound(error: unknown): boolean {
	return (error as { code?: unknown } | null)?.code === "member_not_found";
}
