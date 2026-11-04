import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
	TeamBridgeParticipant,
} from "../../../../shared/team-bridge-contract";
import {
	type TeamBridgeConversationMenuInput,
	conversationMenuSections,
} from "./team-bridge-conversation-menu-model";

/*
 * Story fixtures for the conversation menu. Every story draws its items from
 * the REAL `conversationMenuSections`, never a hand-written list, so a story
 * shows what the model decides for that viewer and conversation (a disabled
 * reason on #general, the absent wake group on a non-member) rather than what
 * someone remembered it deciding.
 */

const SELF = "acct_self";

const human = (
	account_id: string,
	display_label: string,
	role: "owner" | "member" = "member",
	state: TeamBridgeParticipant["state"] = "active",
): TeamBridgeParticipant => ({
	account_id,
	kind: "human",
	display_label,
	role,
	state,
});
const agent = (
	account_id: string,
	display_label: string,
	state: TeamBridgeParticipant["state"] = "active",
	endpoint_id = `bep_${display_label.toLowerCase()}`,
): TeamBridgeParticipant =>
	({
		account_id,
		kind: "agent",
		display_label,
		role: "member",
		state,
		endpoint_id,
		notify: "all",
	}) as TeamBridgeParticipant;

export const menuSelfPerson: TeamBridgeDirectoryMember = {
	account_id: SELF,
	display_label: "Damian Tran",
	role: "owner",
	bridge_enabled: true,
	bridge_state: "active",
	agent: { endpoint_id: "bep_aida", name: "Aida", state: "active" },
} as TeamBridgeDirectoryMember;

export const menuConversation = (
	overrides: Partial<TeamBridgeConversation> = {},
): TeamBridgeConversation =>
	({
		id: "bcv_launch",
		tenant_id: "tnt_minerva",
		kind: "channel",
		name: "launch",
		visibility: "tenant",
		agent_capable: true,
		status: "open",
		created_by: SELF,
		last_message_at: "2026-11-04T12:00:00.000Z",
		latest_seq: 12,
		members: [
			human(SELF, "Damian Tran", "owner"),
			human("acct_ben", "Ben Tran"),
			agent(SELF, "Aida"),
			agent("acct_ben", "Juno"),
		],
		last_read_seq: 12,
		unread_count: 0,
		muted: false,
		notify: "all",
		can_administer: true,
		...overrides,
	}) as TeamBridgeConversation;

export const menuGeneral = menuConversation({
	id: "bcv_general",
	name: "general",
	builtin: "general",
	can_administer: false,
	members: [human(SELF, "Damian Tran"), agent(SELF, "Aida")],
});

export const menuAgents = menuConversation({
	id: "bcv_agents",
	name: "agents",
	builtin: "agents",
	can_administer: false,
	members: [human(SELF, "Damian Tran"), agent(SELF, "Aida")],
});

export const menuFullWiring: TeamBridgeConversationMenuInput["wiring"] = {
	viewMembers: true,
	addMembers: true,
	join: true,
	notify: true,
	agentNotify: true,
	ownAgent: true,
	leave: true,
	archive: true,
};

/** The model's sections for `conversation` as the reader with full wiring. */
export const menuSectionsFor = (conversation: TeamBridgeConversation) =>
	conversationMenuSections({
		conversation,
		selfAccountId: SELF,
		selfPerson: menuSelfPerson,
		agentNotifyEnabled: true,
		archivable: conversation.can_administer === true && !conversation.builtin,
		wiring: menuFullWiring,
	});
