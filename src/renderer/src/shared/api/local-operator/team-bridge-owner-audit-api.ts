import { t } from "../../../../../i18n/messages";
import {
	ownerAuditConversationPageSchema,
	ownerAuditMessagePageSchema,
	ownerAuditThreadSchema,
} from "../../../../../shared/team-bridge-owner-audit-contract";
import { desktopMedia, desktopResult } from "./desktop-api";

export type OwnerAuditScope = { accountId: string; tenantId: string };
const owner = ({ accountId, tenantId }: OwnerAuditScope) => ({
	expected_account_id: accountId,
	tenant_id: tenantId,
});

export class OwnerAuditAttachmentError extends Error {
	constructor(readonly status: number | null) {
		super(t("ui.teamBridge.attachmentCard.unavailable"));
		this.name = "OwnerAuditAttachmentError";
	}
}

export type OwnerAuditAttachmentInput = OwnerAuditScope & {
	conversationId: string;
	messageId: string;
	attachmentId: string;
};
const attachmentTuple = (scope: OwnerAuditAttachmentInput) => ({
	tenantId: scope.tenantId,
	expectedAccountId: scope.accountId,
	conversationId: scope.conversationId,
	messageId: scope.messageId,
	attachmentId: scope.attachmentId,
});

/** Deliberately no member-history or agent-tool fallback. A refusal must remain
 * a refusal, not become a read under different authority. Attachment bytes use
 * only the dedicated owner-audit relay. Generic files were metadata-only until
 * the operator's decision a-fdf0 (download, never preview): `fileBytes` is the
 * owner's Save of one file, through this same relay and receipt, and its bytes
 * go to a save dialog only - no blob cache, preview or inline rendering. */
export const TeamBridgeOwnerAuditApi = {
	/** One audited generic file for the owner's Save: exactly octet-stream, up
	 * to 25 MiB; main answers 413 over that ceiling (see `fileBytes` on the
	 * member API for the shared status vocabulary). */
	async fileBytes(scope: OwnerAuditAttachmentInput): Promise<Uint8Array> {
		const result = await desktopMedia(
			{
				op: "team_bridge.owner_audit.attachment",
				mode: "file",
				...attachmentTuple(scope),
			},
			null,
		);
		if (
			result.kind !== "bytes" ||
			result.status !== 200 ||
			result.mimeType !== "application/octet-stream"
		)
			throw new OwnerAuditAttachmentError(
				result.kind === "error" ? result.status : 422,
			);
		return result.data;
	},
	async attachmentBytes(
		scope: OwnerAuditAttachmentInput,
	): Promise<{ data: Uint8Array; mimeType: string }> {
		const result = await desktopMedia(
			{ op: "team_bridge.owner_audit.attachment", ...attachmentTuple(scope) },
			null,
		);
		if (
			result.kind !== "bytes" ||
			result.status !== 200 ||
			(result.mimeType !== "image/png" && result.mimeType !== "image/jpeg")
		)
			throw new OwnerAuditAttachmentError(
				result.kind === "error" ? result.status : 422,
			);
		return { data: result.data, mimeType: result.mimeType };
	},
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
		window?: { beforeSeq?: number; order?: "asc" | "desc"; limit?: 1 | 50 },
	) {
		return ownerAuditThreadSchema.parse(
			await desktopResult<unknown>({
				op: "team_bridge.owner_audit.replies",
				...owner(scope),
				conversation_id: conversationId,
				message_id: messageId,
				limit: window?.limit ?? 50,
				...(afterSeq === undefined ? {} : { after_seq: afterSeq }),
				...(window?.beforeSeq === undefined
					? {}
					: { before_seq: window.beforeSeq }),
				...(window?.order === undefined ? {} : { order: window.order }),
			}),
		);
	},
};
