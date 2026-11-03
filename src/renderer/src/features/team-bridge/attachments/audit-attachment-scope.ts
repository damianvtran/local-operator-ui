import type { OwnerAuditScope } from "@shared/api/local-operator/team-bridge-owner-audit-api";
import type { BridgeAttachmentDescriptor } from "./attachment-model";

/** Audit authority is the rendered HUMAN owner, not a conversation member or
 * the audited agent. Keep it in both the request receipt and resource identity:
 * a tenant/conversation id alone cannot isolate an account switch. */
export type AuditAttachmentScope = OwnerAuditScope & {
	conversationId: string;
	messageId: string;
	attachmentId: string;
};

export function auditAttachmentKey(scope: AuditAttachmentScope): string {
	return JSON.stringify([
		"owner-audit",
		scope.accountId,
		scope.tenantId,
		scope.conversationId,
		scope.messageId,
		scope.attachmentId,
	]);
}

/** Presence/count-only metadata is not byte authority. Unlike historical member
 * descriptors, audit descriptors require an explicit bound state. Unknown,
 * withheld, expired and revoked values never commission even a preview read. */
export function auditAttachmentAction(
	attachment: BridgeAttachmentDescriptor,
): "preview" | "download" | null {
	if (attachment.state !== "bound") return null;
	if (attachment.mime === "image/png" || attachment.mime === "image/jpeg")
		return "preview";
	if (attachment.mime === "application/octet-stream") return "download";
	return null;
}

/** Receipt and rendered row must describe the SAME tenant/conversation. Never
 * borrow the current active tenant, sender identity or another row's authority. */
export function auditMessageScope(
	scope: OwnerAuditScope | null,
	conversation: { id: string; tenant_id: string },
	message: { id: string; conversation_id: string },
): (OwnerAuditScope & { conversationId: string; messageId: string }) | null {
	if (
		!scope?.accountId ||
		!scope.tenantId ||
		scope.tenantId !== conversation.tenant_id ||
		message.conversation_id !== conversation.id
	)
		return null;
	return {
		accountId: scope.accountId,
		tenantId: scope.tenantId,
		conversationId: conversation.id,
		messageId: message.id,
	};
}
