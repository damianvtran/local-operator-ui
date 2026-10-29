import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import type {
	TeamBridgeAttachment,
	TeamBridgeScheduledMessage,
} from "../../../../shared/team-bridge-contract";
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
	/* Images already staged in `conversationId`. */
	attachmentIds?: readonly string[];
	/*
	 * Images held in memory for a draft with no conversation yet: staged into
	 * the conversation right after it exists and BEFORE the schedule POST. A
	 * failure throws, so a schedule never goes out text-only behind the
	 * author's back; the remembered id makes the retry reuse the same group.
	 */
	stageHeld?: (conversationId: string, tenantId: string) => Promise<string[]>;
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
		attachment_ids?: string[];
		thread_root_id?: string;
	}) => Promise<unknown>;
}) {
	const post = async (
		id: string,
		message: { tenantId: string | undefined },
	) => {
		args.onCreated(id);
		const tenant = message.tenantId ?? args.tenantId;
		const ids = args.stageHeld
			? await args.stageHeld(id, tenant)
			: [...(args.attachmentIds ?? [])];
		const result = await args.schedule({
			tenant_id: tenant,
			conversation_id: id,
			client_ref: args.clientRef,
			body: args.body,
			send_at: args.sendAt,
			...(ids.length > 0 ? { attachment_ids: ids } : {}),
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
	attachmentIds?: readonly string[],
): { body?: string; send_at?: string; attachment_ids?: string[] } {
	const before = (message.attachments ?? []).map((row) => row.id);
	// The PATCH carries the WHOLE set when it changes (`[]` removes every image,
	// which the hub releases in the same update); an unchanged set is omitted so
	// a time-only edit stays byte-identical for an older hub.
	const imagesChanged =
		attachmentIds !== undefined && !sameAttachmentIds(attachmentIds, before);
	/*
	 * An edit that empties the caption but keeps the images is image-only, and
	 * the contract (like the hub) accepts an empty body only beside a non-empty
	 * set, so the set rides along even when unchanged (review round 1, R1-03).
	 */
	const imageOnly =
		body !== undefined &&
		body.trim() === "" &&
		body !== message.body &&
		(attachmentIds?.length ?? 0) > 0;
	return {
		...(body !== undefined && body !== message.body ? { body } : {}),
		...(sendAt !== message.send_at ? { send_at: sendAt } : {}),
		...(imagesChanged || imageOnly
			? { attachment_ids: [...(attachmentIds ?? [])] }
			: {}),
	};
}

/*
 * Image sets are compared BY ID, in order, never by length: the PATCH replaces
 * the whole set, so a same-length swap made on another device is a change, and
 * an image another device added is not "this user removed nothing" (agent-server
 * #223 QA r2, Q3). The dialog and the patch builder share this one comparison so
 * they cannot disagree about whether an edit touches the images.
 */
export function sameAttachmentIds(
	a: readonly string[],
	b: readonly string[],
): boolean {
	return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** The server row an open edit dialog was seeded from (or last rebased onto). */
export type ScheduledEditBase = {
	body: string;
	sendAt: string;
	attachments: readonly TeamBridgeAttachment[];
	/*
	 * The hub's edit counter for THIS row, when the hub reports one (agent-server
	 * #223). Sent back as `expected_version` so an edit made from a stale view is
	 * refused with `concurrent_edit` even on its FIRST submit (review R1-02).
	 */
	version?: number;
};

/** What the dialog currently holds: `when` is its `datetime-local` value. */
export type ScheduledEditDraft = {
	body: string;
	when: string;
	kept: readonly TeamBridgeAttachment[];
};

/*
 * Move an open edit onto a newer server row instead of keeping a stale draft.
 *
 * WHY: the hub's PATCH replaces whole fields (`attachment_ids` is the full set),
 * so a draft seeded from an older row and resent after a refresh silently
 * undoes the other device's edit - erasing an image it added or reverting its
 * text (agent-server #223 QA r2, Q2: U1/U2), or naming an image that no longer
 * exists and looping on 404 (U3). Only the author's own DELTAS survive:
 *
 * - time / text: kept when this user changed it and the server did not; when
 *   both changed, the server's value wins and the dialog says the message
 *   changed elsewhere, because silently keeping either side hides the other.
 * - images: this user can only REMOVE in this dialog, so the delta is the set
 *   of ids they removed; it is subtracted from the new row's set, which keeps
 *   anything another device added and drops removals that are already moot.
 */
export function rebaseScheduledEdit(
	previous: ScheduledEditBase,
	next: ScheduledEditBase,
	draft: ScheduledEditDraft,
): ScheduledEditDraft {
	const bodyEdited = draft.body.trim() !== previous.body;
	const timeEdited = draft.when !== scheduledLocalInput(previous.sendAt);
	const keptIds = new Set(draft.kept.map((row) => row.id));
	const removed = new Set(
		previous.attachments.map((row) => row.id).filter((id) => !keptIds.has(id)),
	);
	return {
		body: bodyEdited && next.body === previous.body ? draft.body : next.body,
		when:
			timeEdited && next.sendAt === previous.sendAt
				? draft.when
				: scheduledLocalInput(next.sendAt),
		kept: next.attachments.filter((row) => !removed.has(row.id)),
	};
}

/*
 * What a rebase did, so the dialog can SAY it rather than let fields change
 * silently (design review round 1, D2). `*Replaced` means this user's own edit
 * of that field lost to the other device; `*Changed` means the other device
 * changed a field this user had not touched. `lostBody` is the text the user
 * typed and lost, kept so they can recover it.
 */
export type ScheduledRebaseReport = {
	bodyReplaced: boolean;
	bodyChanged: boolean;
	lostBody?: string;
	timeReplaced: boolean;
	timeChanged: boolean;
	imagesAdded: number;
	imagesRemoved: number;
};

export function describeScheduledRebase(
	previous: ScheduledEditBase,
	next: ScheduledEditBase,
	draft: ScheduledEditDraft,
): ScheduledRebaseReport {
	const bodyEdited = draft.body.trim() !== previous.body;
	const bodyMoved = next.body !== previous.body;
	const timeEdited = draft.when !== scheduledLocalInput(previous.sendAt);
	const timeMoved = next.sendAt !== previous.sendAt;
	const before = new Set(attachmentIdsOf(previous.attachments));
	const after = new Set(attachmentIdsOf(next.attachments));
	// A user-removed image that the other device ALSO removed is not news; only
	// images this user still had in view count as removed elsewhere.
	const kept = new Set(attachmentIdsOf(draft.kept));
	return {
		bodyReplaced: bodyEdited && bodyMoved && draft.body.trim() !== next.body,
		bodyChanged: !bodyEdited && bodyMoved,
		...(bodyEdited && bodyMoved && draft.body.trim() !== next.body
			? { lostBody: draft.body }
			: {}),
		timeReplaced:
			timeEdited &&
			timeMoved &&
			draft.when !== scheduledLocalInput(next.sendAt),
		timeChanged: !timeEdited && timeMoved,
		imagesAdded: [...after].filter((id) => !before.has(id)).length,
		imagesRemoved: [...before].filter((id) => !after.has(id) && kept.has(id))
			.length,
	};
}

export function scheduledRebaseIsNews(report: ScheduledRebaseReport) {
	return (
		report.bodyReplaced ||
		report.bodyChanged ||
		report.timeReplaced ||
		report.timeChanged ||
		report.imagesAdded > 0 ||
		report.imagesRemoved > 0
	);
}

const attachmentIdsOf = (rows: readonly TeamBridgeAttachment[]) =>
	rows.map((row) => row.id);

/*
 * Which refusal an edit met, for the dialog's copy. Only the hub's stale-edit
 * answer is distinguished (`409 invalid_transition`, `details.rule =
 * "concurrent_edit"`, relayed intact by core's `_refusal_detail`): every other
 * refusal is a generic edit failure. A 404 needs no code of its own here - the
 * refreshed list already says whether the row changed (the dialog rebases) or
 * vanished (the list marks it gone).
 */
export function scheduledEditFailure(error: unknown): "conflict" | "other" {
	if (
		error instanceof DesktopControlError &&
		error.status === 409 &&
		error.code === "invalid_transition" &&
		typeof error.detail === "object" &&
		error.detail !== null &&
		(error.detail as { details?: { rule?: unknown } }).details?.rule ===
			"concurrent_edit"
	)
		return "conflict";
	return "other";
}

type ScheduledPatch = ReturnType<typeof scheduledEditPatch>;

/*
 * Send an edit pinned to the row version it was derived from (review R1-02).
 *
 * WHY THE PIN: the hub's own concurrency check only covers the gap between its
 * read and its write, so an edit built from a list fetched minutes ago could
 * still replace an image set another device had changed. `expected_version`
 * makes the hub refuse that edit with 409 `concurrent_edit` instead.
 *
 * WHY THE FALLBACK: the pin is sent only when the row carried a numeric
 * `version` (a newer hub). The local core relays the PATCH through a STRICT
 * body model, and a core that predates the field refuses it as 422
 * `invalid_request` before anything reaches the hub - nothing was written - so
 * that refusal is retried once without the pin, which is exactly the edit an
 * older stack accepted before. Core answers the SAME 422 for any of its own
 * pre-hub validation refusals, so one of those is also retried once; it fails
 * again identically (the retry body is a subset) with nothing written - one
 * redundant request, never a loop (review R2-02; narrowing it needs core to tag
 * the unknown-field refusal). The hub's own answers are never 422: a version
 * mismatch is a 409 and is thrown unchanged.
 */
export async function updateScheduledEdit(
	update: (
		tenantId: string,
		scheduledId: string,
		patch: ScheduledPatch & { expected_version?: number },
	) => Promise<unknown>,
	tenantId: string,
	scheduledId: string,
	patch: ScheduledPatch,
	expectedVersion: number | null | undefined,
): Promise<unknown> {
	if (typeof expectedVersion !== "number")
		return update(tenantId, scheduledId, patch);
	try {
		return await update(tenantId, scheduledId, {
			...patch,
			expected_version: expectedVersion,
		});
	} catch (error) {
		if (
			error instanceof DesktopControlError &&
			error.status === 422 &&
			error.code === "invalid_request"
		)
			return update(tenantId, scheduledId, patch);
		throw error;
	}
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
