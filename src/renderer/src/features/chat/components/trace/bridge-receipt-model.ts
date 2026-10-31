import { senderField } from "./receipt-row-model";

/** Incoming Bridge display facts are separate from outgoing tool receipts.
 * The envelope is model context, not an admission proof. Only positively typed
 * producer metadata may supply identity. Bodies/media stay on the separately
 * admitted channel_history result; receipt presence is not clearance.
 */
export type BridgeReceipt = {
	sender: { name: string; kind?: "human" | "agent"; organization?: string };
	conversation: { kind?: "dm" | "group" | "channel"; label?: string };
	attachmentCount?: number;
};

const object = (value: unknown): Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
const label = (value: unknown): string =>
	typeof value === "string" ? senderField(value) : "";

/** No body parsing, @mention inference, or account-id-as-sender fallback. */
export function bridgeReceiptOf(
	details: Record<string, unknown>,
): BridgeReceipt {
	const wire = object(details.bridge_receipt);
	const current = wire.v === 1;
	const sender = current ? object(wire.sender) : object(details.sender);
	const conversation = current ? object(wire.conversation) : {};
	const count = current ? wire.attachment_count : undefined;
	return {
		sender: {
			name: label(sender.name),
			...(sender.kind === "human" || sender.kind === "agent"
				? { kind: sender.kind }
				: {}),
			...(label(sender.organization)
				? { organization: label(sender.organization) }
				: {}),
		},
		conversation: {
			...(conversation.kind === "dm" ||
			conversation.kind === "group" ||
			conversation.kind === "channel"
				? { kind: conversation.kind }
				: {}),
			...(label(conversation.label)
				? { label: label(conversation.label) }
				: {}),
		},
		...(typeof count === "number" && Number.isSafeInteger(count) && count >= 0
			? { attachmentCount: count }
			: {}),
	};
}
