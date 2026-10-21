import {
	type TeamBridgeRecipient,
	draftCreateInput,
	recipientKey,
	sendFirstMessage,
} from "./team-bridge-model";

/** Schedule and Send share the same two-write transaction. The acknowledged
 * conversation ID must reach durable draft storage BEFORE the scheduling POST:
 * a lost schedule response or renderer reload must not create another group.
 * Group create itself has no idempotency key; its ambiguous failure requires
 * the editor's explicit Groups-check acknowledgement, never automatic retry.
 */
export async function scheduleTeamBridgeDraft(args: {
	tenantId: string;
	conversationId?: string;
	recipients: TeamBridgeRecipient[];
	body: string;
	clientRef: string;
	sendAt: string;
	remembered: Map<string, { id: string; tenantId: string | undefined }>;
	onCreated: (id: string) => void;
	create: (
		input: NonNullable<ReturnType<typeof draftCreateInput>>,
	) => Promise<{ id?: string; tenant_id?: string }>;
	schedule: (input: {
		tenant_id: string;
		conversation_id: string;
		client_ref: string;
		body: string;
		send_at: string;
	}) => Promise<unknown>;
}) {
	const post = async (
		id: string,
		message: { tenantId: string | undefined },
	) => {
		args.onCreated(id);
		return args.schedule({
			tenant_id: message.tenantId ?? args.tenantId,
			conversation_id: id,
			client_ref: args.clientRef,
			body: args.body,
			send_at: args.sendAt,
		});
	};
	if (args.conversationId)
		return post(args.conversationId, { tenantId: args.tenantId });
	const input = draftCreateInput(args.recipients);
	if (!input) throw new Error("schedule requires recipients");
	const draftKey = `${args.tenantId}|${input.kind}|${args.recipients.map(recipientKey).sort().join(",")}`;
	return sendFirstMessage({
		draftKey,
		input,
		body: args.body,
		clientRef: args.clientRef,
		tenantId: args.tenantId,
		remembered: args.remembered,
		create: args.create,
		post,
	});
}
