import type { TeamBridgeScheduledMessage } from "../../../../shared/team-bridge-contract";
import {
	type TeamBridgeRecipient,
	type TeamBridgeTarget,
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
	/* Present only when the scheduled message is a thread reply. */
	threadRootId?: string;
	remembered: Map<string, { id: string; tenantId: string | undefined }>;
	onCreated: (id: string) => void;
	onScheduled?: (id: string) => void;
	create: (
		input: NonNullable<ReturnType<typeof draftCreateInput>>,
	) => Promise<{ id?: string; tenant_id?: string }>;
	schedule: (input: {
		tenant_id: string;
		conversation_id: string;
		client_ref: string;
		body: string;
		send_at: string;
		thread_root_id?: string;
	}) => Promise<unknown>;
}) {
	const post = async (
		id: string,
		message: { tenantId: string | undefined },
	) => {
		args.onCreated(id);
		const result = await args.schedule({
			tenant_id: message.tenantId ?? args.tenantId,
			conversation_id: id,
			client_ref: args.clientRef,
			body: args.body,
			send_at: args.sendAt,
			...(args.threadRootId ? { thread_root_id: args.threadRootId } : {}),
		});
		// Publish the conversation identity only after schedule success. Clearing
		// the compose draft must not leave its next message creating another group.
		args.onScheduled?.(id);
		return result;
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

/** Preserve the first attempt's token after any ambiguous outcome. A later
 * refusal says nothing about whether the earlier scheduling POST landed. */
export function canResetScheduleAttempt(
	previousSendAt: string | undefined,
	status: number | null | undefined,
): boolean {
	return (
		!previousSendAt &&
		Boolean(status && status >= 400 && status < 500 && status !== 409)
	);
}

export function scheduledLocalInput(sendAt: string): string {
	const date = new Date(sendAt);
	return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
		.toISOString()
		.slice(0, 16);
}

/** Independent organizations fail independently; a refusal must not hide
 * another organization's pending message and its cancellation control. */
export async function listScheduledTenants(
	tenantIds: string[],
	list: (
		tenantId: string,
	) => Promise<{ scheduled: TeamBridgeScheduledMessage[] }>,
) {
	const pages = await Promise.allSettled(tenantIds.map(list));
	const scheduled: TeamBridgeScheduledMessage[] = [];
	const failedTenants: string[] = [];
	pages.forEach((page, index) => {
		if (page.status === "fulfilled") scheduled.push(...page.value.scheduled);
		else failedTenants.push(tenantIds[index]);
	});
	return {
		scheduled: scheduled.sort((a, b) => a.send_at.localeCompare(b.send_at)),
		failedTenants,
	};
}

export function scheduledEditPatch(
	message: TeamBridgeScheduledMessage,
	sendAt: string,
	body?: string,
): { body?: string; send_at?: string } {
	return {
		...(body !== undefined && body !== message.body ? { body } : {}),
		...(sendAt !== message.send_at ? { send_at: sendAt } : {}),
	};
}

export function scheduledTargetAfterSuccess(
	startedOn: TeamBridgeTarget,
	current: TeamBridgeTarget | null,
	id: string,
): TeamBridgeTarget | null {
	return startedOn.type === "compose" && current === startedOn
		? { type: "conversation", id }
		: null;
}
