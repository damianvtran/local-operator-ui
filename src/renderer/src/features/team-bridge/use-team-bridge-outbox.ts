import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import { observedRadientAuthority } from "@shared/hooks/radient-account-authority";
import { revokeBlobUrl } from "@shared/lib/blob-url-cache";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
	type TeamBridgeAttachment,
	type TeamBridgeConversation,
	type TeamBridgeConversationList,
	type TeamBridgeMessage,
	type TeamBridgeMessagePage,
	teamBridgeConversationSchema,
} from "../../../../shared/team-bridge-contract";
import { draftAttachment, isAttachmentNotFound, isStagedExpired } from "./team-bridge-attachments-model";
import { teamBridgeKeys } from "./team-bridge-keys";
import { type TeamBridgeTarget, draftCreateInput, recipientKey } from "./team-bridge-model";
import { bridgeOwnerCurrent } from "./team-bridge-owner";
import { TeamBridgeSendJournal, type TeamBridgeSendAuthority, type TeamBridgeSendEffects, type TeamBridgeSendRow } from "./team-bridge-send-journal";
import type { TeamBridgeLocalRowPresentation } from "./team-bridge-send-presentation";
import type { AttachmentChip } from "./use-team-bridge-attachments";

/** One renderer-local journal per cache owner, NOT per route or keyed thread.
 * Only explicitly authored outgoing data lives here. Account and tenant are
 * mandatory on every lookup; no shared "current conversation" controls a retry.
 * #1334 was reverted by #1353 because pending private bodies crossed accounts.
 * This adapter fences dispatch, every awaited step, and every cache settlement
 * against live auth AND the captured epoch, independently of mounted views. */
const journals = new WeakMap<QueryClient, TeamBridgeSendJournal<AttachmentChip[]>>();
function journalFor(client: QueryClient) {
	let journal = journals.get(client);
	if (!journal) {
		journal = new TeamBridgeSendJournal<AttachmentChip[]>({ now: () => performance.now() });
		journals.set(client, journal);
	}
	return journal;
}

/** Isolated mounted fixtures reuse the shipped QueryClient singleton. Its cache
 * clear is intentionally NOT an application outbox reset (navigation/auth must
 * not lose unsent work), so fixtures explicitly end their own account journal. */
export function resetTeamBridgeOutboxAccountForTests(client: QueryClient, accountId: string): void {
	journals.get(client)?.clearAccount(accountId, { receipts: true });
}

export function outboxTargetKey(target: TeamBridgeTarget | null): string {
	if (!target) return "none";
	if (target.type === "conversation") return `conversation:${target.id}`;
	if (target.type === "compose") return `compose:${target.recipients.map(recipientKey).sort().join(",")}`;
	return `${target.type}:${target.accountId}`;
}

type SendContext = {
	accountId: string;
	tenantId: string;
	targetKey: string;
	conversationId?: string;
	input: NonNullable<ReturnType<typeof draftCreateInput>> | null;
	/** Shared with scheduling's already-created receipt memory. Never cleared by a post. */
	remembered: Map<string, { id: string; tenantId: string | undefined }>;
	receiptKey: string;
};

/** Convert our own staged/held image into the existing tile descriptor. The
 * descriptor reserves exactly the eventual upload's geometry; the preview URL
 * is passed separately and never enters the server/cache contract. */
function descriptor(chip: AttachmentChip): TeamBridgeAttachment {
	return {
		id: chip.attachment?.id ?? chip.key,
		mime: chip.attachment?.mime ?? chip.prepared?.mime ?? "image/png",
		size: chip.attachment?.size ?? chip.prepared?.bytes.byteLength ?? 0,
		width: chip.attachment?.width ?? chip.prepared?.width ?? 0,
		height: chip.attachment?.height ?? chip.prepared?.height ?? 0,
	};
}

/*
 * CONFIRMED ROWS KEEP THEIR LOCAL PICTURE, BUT NOT FOREVER. A just-confirmed
 * row must not flash through a loading tile, so the in-memory preview outlives
 * the id swap; a session that sends many images however must not hold every
 * blob it ever uploaded. The newest eight confirmed rows per account keep
 * theirs, and an evicted row falls back to the member-gated byte route - the
 * same picture, one fetch later, which is what a row restored from history
 * shows anyway.
 */
const CONFIRMED_PREVIEWS = 8;
const confirmedPreviews = {
	order: 0,
	held: new Map<string, { order: number; urls: readonly string[] }>(),
};
function retainConfirmedPreview(
	accountId: string,
	clientRef: string,
	urls: readonly string[],
) {
	const key = `${accountId}\u0000${clientRef}`;
	confirmedPreviews.held.delete(key);
	confirmedPreviews.held.set(key, { order: ++confirmedPreviews.order, urls });
	while (confirmedPreviews.held.size > CONFIRMED_PREVIEWS) {
		const oldest = confirmedPreviews.held.keys().next().value;
		if (oldest === undefined) break;
		const evicted = confirmedPreviews.held.get(oldest);
		confirmedPreviews.held.delete(oldest);
		// The row keeps its hub descriptor; only this session's own copy ends.
		// Its tiles fetch the bound picture on the next render.
		for (const url of evicted?.urls ?? []) revokeBlobUrl(url);
	}
}
const keepsConfirmedPreview = (accountId: string, clientRef: string) =>
	confirmedPreviews.held.has(`${accountId}\u0000${clientRef}`);
/** A REPLACED account's pictures end with it, exactly as its drafts do. A
 * sign-out of the SAME account does not: returning to it must still show the
 * rows it left, and a retry there must reuse the conversation it created. */
function revokeConfirmedPreviews(accountId: string) {
	for (const [key, entry] of confirmedPreviews.held)
		if (key.startsWith(`${accountId}\u0000`)) {
			confirmedPreviews.held.delete(key);
			for (const url of entry.urls) revokeBlobUrl(url);
		}
}

export function useTeamBridgeOutbox(accountId: string | undefined) {
	const client = useQueryClient();
	const journal = journalFor(client);
	useSyncExternalStore(journal.subscribe, journal.getRevision, journal.getRevision);
	// Owner replacement is a lifetime boundary for PRIVATE rows, not a view
	// boundary: drafts already erases a replaced account's stored bodies, and
	// this erases the outgoing rows and pictures in the same transition. The
	// remount is fenced by auth epoch, so an A callback can never write under B.
	const previousAccount = useRef(accountId);
	useEffect(() => {
		const previous = previousAccount.current;
		if (previous && accountId && previous !== accountId) {
			journal.clearAccount(previous, { receipts: true });
			revokeConfirmedPreviews(previous);
		}
		if (accountId) previousAccount.current = accountId;
	}, [accountId, journal]);

	const capture = (context: SendContext) => {
		const captured = observedRadientAuthority(client);
		const authority: TeamBridgeSendAuthority = {
			accountId: context.accountId,
			tenantId: context.tenantId,
			epoch: captured.epoch,
		};
		let revoked = false;
		const isCurrent = () => {
			const live = observedRadientAuthority(client);
			return !revoked && live.epoch === captured.epoch &&
				live.accountId === context.accountId && bridgeOwnerCurrent(client, context.accountId);
		};
		const assertCurrent = () => {
			if (!isCurrent()) throw new Error("Team Bridge send authority changed");
		};
		assertCurrent();
		// A transient opt-out/read-only/auth transition revokes this attempt even
		// if the person re-enables the surface before an outstanding await returns.
		const unsubscribe = client.getQueryCache().subscribe(() => {
			if (!isCurrent()) revoked = true;
		});
		const effects: TeamBridgeSendEffects<AttachmentChip[]> = {
			assertCurrent,
			create: async () => {
				const remembered = context.remembered.get(context.receiptKey);
				if (remembered) {
					// Scheduling may have created the group before this send. Resolve
					// its full receipt rather than creating a second group.
					if (remembered.tenantId !== context.tenantId) throw new Error("Team Bridge receipt tenant changed");
					return TeamBridgeApi.getConversation(remembered.id, context.tenantId);
				}
				if (!context.input) throw new Error("Team Bridge send has no recipients");
				return TeamBridgeApi.startConversation({
					...context.input,
					tenantId: context.tenantId,
					expectedAccountId: context.accountId,
				});
			},
			onCreated: (receipt) => {
				assertCurrent();
				const conversation = teamBridgeConversationSchema.parse(receipt);
				context.remembered.set(context.receiptKey, { id: conversation.id, tenantId: conversation.tenant_id });
				// Seed the active owner-qualified list directly. A list round trip is
				// never a prerequisite to posting, rendering, or accepting the next send.
				client.setQueryData<TeamBridgeConversationList>(
					teamBridgeKeys.conversations(context.tenantId, context.accountId),
					(old) => ({ ...old, conversations: [
						...(old?.conversations ?? []).filter((row) => row.id !== conversation.id),
						conversation,
					] }),
				);
			},
			stage: async (conversation, row) => {
				// Snapshot ownership is transferred at send, so navigation/new paste
				// cannot change this set. Keep each successful upload for partial retry.
				for (const chip of row.attachments) {
					assertCurrent();
					if (chip.attachment && !isStagedExpired(chip.attachment)) continue;
					if (!chip.prepared) throw new Error("Team Bridge image bytes unavailable");
					const uploaded = await TeamBridgeApi.uploadAttachment(context.tenantId, conversation.id, chip.prepared.bytes, context.accountId);
					assertCurrent();
					chip.attachment = draftAttachment(uploaded, conversation.id);
				}
				return row.attachments;
			},
			post: async (conversation, row) => {
				assertCurrent();
				try {
					return await TeamBridgeApi.send(conversation.id, {
						clientRef: row.clientRef,
						body: row.body,
						tenantId: context.tenantId,
						expectedAccountId: context.accountId,
						attachmentIds: row.attachments.flatMap((chip) => chip.attachment ? [chip.attachment.id] : []),
					});
				} catch (error) {
					assertCurrent();
					// The hub's uniform missing-attachment refusal identifies no one
					// image; retry stages this attempt's originals, never a new draft.
					if (isAttachmentNotFound(error))
						for (const chip of row.attachments) chip.attachment = undefined;
					throw error;
				}
			},
			onConfirmed: (row) => {
				// A confirmation that settles after the owner changed is DONE: the
				// row stays confirmed for its own account, and nothing of it may be
				// written into the next owner's cache. Never turn it into a failure.
				if (!isCurrent() || !row.conversationId) return;
				retainConfirmedPreview(
					context.accountId,
					row.clientRef,
					row.attachments.flatMap((chip) =>
						chip.previewUrl ? [chip.previewUrl] : [],
					),
				);
				const key = teamBridgeKeys.messages(row.conversationId, context.tenantId, context.accountId);
				if (row.serverMessage) {
					const message = row.serverMessage;
					client.setQueryData<TeamBridgeMessagePage>(key, (old) => ({
						...old,
						messages: [...(old?.messages ?? []).filter((item) => item.id !== message.id), message],
					}));
				}
				// Background owner-qualified invalidations. No mutation promise waits
				// for history/sidebar/badge reads; each query independently fences its
				// response before admitting it to the current owner's cache.
				void client.invalidateQueries({ queryKey: key });
				void client.invalidateQueries({ queryKey: teamBridgeKeys.conversations(context.tenantId, context.accountId) });
				void client.invalidateQueries({ queryKey: teamBridgeKeys.unread(context.tenantId, context.accountId) });
			},
			onSettled: unsubscribe,
		};
		return { authority, effects, unsubscribe };
	};

	const enqueue = (context: SendContext, body: string, clientRef: string, chips: readonly AttachmentChip[], sender: TeamBridgeMessage["sender"]) => {
		if (accountId !== context.accountId) throw new Error("Team Bridge outbox owner changed");
		const attempt = capture(context);
		try {
			journal.enqueue({
				authority: attempt.authority, targetKey: context.targetKey,
				conversationId: context.conversationId, clientRef, body, sender,
				attachments: chips.map((chip) => ({ ...chip })),
			}, attempt.effects);
		} catch (error) {
			attempt.unsubscribe();
			throw error;
		}
	};

	const presentation = (row: TeamBridgeSendRow<AttachmentChip[]>, context: SendContext): TeamBridgeLocalRowPresentation => ({
		clientRef: row.clientRef,
		state: row.state === "failed" || row.state === "confirmed" ? row.state : "pending",
		previewUrls:
			row.state === "confirmed" &&
			!keepsConfirmedPreview(row.accountId, row.clientRef)
				? undefined
				: row.attachments.map((chip) => chip.previewUrl),
		onRetry: () => {
			if (accountId !== row.accountId || context.tenantId !== row.tenantId) return;
			const attempt = capture(context);
			try {
				if (!journal.retry(row.clientRef, attempt.authority, attempt.effects)) attempt.unsubscribe();
			} catch {
				attempt.unsubscribe();
				// A revoked click is not a new send: retain the failed row and bytes.
			}
		},
		onDiscard: () => {
			if (accountId !== row.accountId || !bridgeOwnerCurrent(client, row.accountId)) return;
			if (journal.discard(row.clientRef, row.accountId, row.tenantId))
				for (const chip of row.attachments) if (chip.previewUrl) revokeBlobUrl(chip.previewUrl);
		},
	});

	return {
		journal, enqueue,
		conversation: (tenantId: string, targetKey: string): TeamBridgeConversation | null => {
			if (!accountId) return null;
			const receipt = journal.getConversation(accountId, tenantId, targetKey);
			const parsed = teamBridgeConversationSchema.safeParse(receipt);
			return parsed.success ? parsed.data : null;
		},
		project: (context: SendContext, canonical: readonly TeamBridgeMessage[]) => {
			if (accountId !== context.accountId) return { messages: [], sendRows: new Map<string, TeamBridgeLocalRowPresentation>() };
			const items = journal.project(accountId, context.tenantId, context.targetKey, context.conversationId, canonical);
			const sendRows = new Map<string, TeamBridgeLocalRowPresentation>();
			const messages = items.map(({ message, row }) => {
				if (!row) return message;
				sendRows.set(message.id, presentation(row, context));
				return { ...message, attachments: row.attachments.length ? row.attachments.map(descriptor) : message.attachments };
			});
			return { messages, sendRows };
		},
	};
}
