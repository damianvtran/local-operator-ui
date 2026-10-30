import {
	ownerAuditConversationPageSchema,
	ownerAuditMessagePageSchema,
	ownerAuditThreadSchema,
} from "../../../../../shared/team-bridge-owner-audit-contract";
import { desktopResult } from "./desktop-api";

export type OwnerAuditScope = { accountId: string; tenantId: string };
const owner = ({ accountId, tenantId }: OwnerAuditScope) => ({
	expected_account_id: accountId,
	tenant_id: tenantId,
});

/** Deliberately no member-history or agent-tool fallback. A refusal must remain
 * a refusal, not become a read under different authority. Attachment metadata
 * is shown as unavailable in this text-only surface; no private byte URL is
 * handed to a browser, markdown renderer, agent, or persisted store. */
export const TeamBridgeOwnerAuditApi = {
	async conversations(scope: OwnerAuditScope, cursor?: string) {
		return ownerAuditConversationPageSchema.parse(
			await desktopResult<unknown>({
				op: "team_bridge.owner_audit.conversations",
				...owner(scope),
				limit: 50,
				...(cursor === undefined ? {} : { cursor }),
			}),
		);
	},
	async messages(
		scope: OwnerAuditScope,
		conversationId: string,
		beforeSeq?: number,
	) {
		return ownerAuditMessagePageSchema.parse(
			await desktopResult<unknown>({
				op: "team_bridge.owner_audit.messages",
				...owner(scope),
				conversation_id: conversationId,
				limit: 50,
				...(beforeSeq === undefined ? {} : { before_seq: beforeSeq }),
			}),
		);
	},
	async replies(
		scope: OwnerAuditScope,
		conversationId: string,
		messageId: string,
		afterSeq?: number,
	) {
		return ownerAuditThreadSchema.parse(
			await desktopResult<unknown>({
				op: "team_bridge.owner_audit.replies",
				...owner(scope),
				conversation_id: conversationId,
				message_id: messageId,
				limit: 50,
				...(afterSeq === undefined ? {} : { after_seq: afterSeq }),
			}),
		);
	},
};
