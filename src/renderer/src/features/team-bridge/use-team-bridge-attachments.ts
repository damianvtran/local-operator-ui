/**
 * The composer's image staging: paste/drop/pick → prepare → upload → chip.
 *
 * ONE hook for both composers (channel and thread) so a thread reply cannot
 * grow a second, subtly different staging lifecycle.
 *
 * LIFECYCLE OF A CHIP
 *   preparing → (new DM/group with no conversation yet) held → uploading → ready
 *                                                                 ↘ error (retry)
 * - A draft that has NO conversation yet (a fresh To: draft) holds prepared
 *   bytes in memory and uploads them inside the send, AFTER the create and
 *   BEFORE the post (`uploadHeld`). Pasting must not create a conversation;
 *   nothing is written until the author sends (the compose bar's rule).
 * - `ready` chips persist as hub DESCRIPTORS through `onPersist` (the draft
 *   store), never as bytes (D9). A reload restores them without a preview
 *   unless this session still holds the original (`uploadPreview`).
 * - A staged id lives 72 h on the hub (D2). A restored descriptor past its
 *   `expires_at`, or one the send refuses as `attachment_not_found`, becomes
 *   `expired`: retryable when the bytes are still in memory (a re-upload binds
 *   a fresh id; the hub dedupes identical bytes), remove-only otherwise.
 *
 * Progress is indeterminate on purpose: bytes cross main's IPC relay in one
 * call, so there is no byte-level progress to report and inventing a
 * percentage would be a claim this app cannot back.
 */

import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import { createBlobUrl, revokeBlobUrl } from "@shared/lib/blob-url-cache";
import { useEffect, useRef, useState } from "react";
import type { TeamBridgeAttachmentCapability } from "../../../../shared/team-bridge-contract";
import {
	type AttachmentFailure,
	AttachmentPrepareError,
	type DraftAttachment,
	type PreparedImage,
	draftAttachment,
	isStagedExpired,
	maxAttachments,
	prepareImageForUpload,
	rememberUploadPreview,
	uploadFailure,
	uploadPreview,
} from "./team-bridge-attachments-model";

export type AttachmentChip = {
	/** Local identity, stable across retries; never sent anywhere. */
	key: string;
	status: "preparing" | "held" | "uploading" | "ready" | "error" | "expired";
	reason?: AttachmentFailure;
	/** A blob URL of THIS session's own bytes, or none for a restored descriptor. */
	previewUrl?: string;
	attachment?: DraftAttachment;
	/** In-memory only; what a retry or a deferred upload sends. */
	prepared?: PreparedImage;
};

export type AttachmentNotice = "limit" | "unsupported" | null;

const chipFromDraft = (
	accountId: string | undefined,
	attachment: DraftAttachment,
): AttachmentChip => {
	const held = uploadPreview(accountId, attachment.id);
	return {
		key: `draft:${attachment.id}`,
		status: isStagedExpired(attachment) ? "expired" : "ready",
		attachment,
		previewUrl: held ? createBlobUrl(held, held.type) : undefined,
	};
};

export function useTeamBridgeAttachments(args: {
	/** Changes when the composer's destination does; the strip restarts. */
	scopeKey: string;
	accountId: string | undefined;
	tenantId: string | undefined;
	/** `null` for a draft whose conversation does not exist yet. */
	conversationId: string | null;
	capability: TeamBridgeAttachmentCapability | null;
	/** Descriptors restored from the draft store (channel composer only). */
	persisted?: readonly DraftAttachment[];
	onPersist?: (next: DraftAttachment[]) => void;
}) {
	const {
		scopeKey,
		accountId,
		tenantId,
		conversationId,
		capability,
		persisted,
		onPersist,
	} = args;
	const [chips, setChips] = useState<AttachmentChip[]>(() =>
		(persisted ?? []).map((row) => chipFromDraft(accountId, row)),
	);
	/*
	 * THE RECEIPT IS CAPTURED, NOT LOOKED UP. Every attachment route now carries
	 * `expected_account_id`, and the runtime refuses a call without it (422) or
	 * with another account's receipt (409). The account this composer was
	 * RENDERED under is the receipt; resolving whoever is signed in when the
	 * request runs would compare an account to itself and prove nothing. A ref,
	 * so a re-render under a different account cannot silently re-point an
	 * in-flight upload.
	 */
	const capturedAccount = useRef(accountId).current;
	const [notice, setNotice] = useState<AttachmentNotice>(null);
	// The latest list for async completions, which must not act on a stale render.
	const live = useRef(chips);
	live.current = chips;
	// Bumped on every scope change so a completion for the previous destination
	// cannot write its chip into this one.
	const generation = useRef(0);
	const persist = useRef(onPersist);
	persist.current = onPersist;

	const revokeAll = (list: readonly AttachmentChip[]) => {
		for (const chip of list)
			if (chip.previewUrl) revokeBlobUrl(chip.previewUrl);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: the destination is the event; `persisted` is read at that moment only.
	useEffect(() => {
		generation.current += 1;
		const restored = (persisted ?? []).map((row) =>
			chipFromDraft(accountId, row),
		);
		setChips((previous) => {
			revokeAll(previous);
			return restored;
		});
		setNotice(null);
	}, [scopeKey, accountId]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: unmount only.
	useEffect(() => () => revokeAll(live.current), []);

	const write = (next: AttachmentChip[]) => {
		live.current = next;
		setChips(next);
		persist.current?.(
			next.flatMap((chip) =>
				chip.status === "ready" && chip.attachment ? [chip.attachment] : [],
			),
		);
	};
	const patch = (key: string, change: Partial<AttachmentChip>) => {
		write(
			live.current.map((chip) =>
				chip.key === key ? { ...chip, ...change } : chip,
			),
		);
	};

	const upload = async (
		key: string,
		prepared: PreparedImage,
		into: string,
		started = generation.current,
		tenant = tenantId,
	): Promise<DraftAttachment | null> => {
		if (!tenant || !capturedAccount) {
			patch(key, { status: "error", reason: "failed" });
			return null;
		}
		patch(key, { status: "uploading", reason: undefined });
		try {
			const answer = await TeamBridgeApi.uploadAttachment(
				tenant,
				into,
				prepared.bytes,
				capturedAccount,
			);
			if (generation.current !== started) return null;
			const descriptor = draftAttachment(answer, into);
			rememberUploadPreview(
				accountId,
				descriptor.id,
				new Blob([prepared.bytes as BlobPart], { type: prepared.mime }),
			);
			patch(key, { status: "ready", attachment: descriptor });
			return descriptor;
		} catch (error) {
			if (generation.current !== started) return null;
			patch(key, {
				status: "error",
				reason: uploadFailure((error as { status?: number | null })?.status),
			});
			return null;
		}
	};

	const add = (files: readonly Blob[]) => {
		if (files.length === 0) return;
		if (!capability) {
			setNotice("unsupported");
			return;
		}
		const room = maxAttachments(capability) - live.current.length;
		const accepted = files.slice(0, Math.max(0, room));
		setNotice(accepted.length < files.length ? "limit" : null);
		const started = generation.current;
		const fresh: AttachmentChip[] = accepted.map(() => ({
			key: crypto.randomUUID(),
			status: "preparing",
		}));
		write([...live.current, ...fresh]);
		accepted.forEach((file, index) => {
			const key = fresh[index].key;
			void prepareImageForUpload(file, capability.max_bytes).then(
				(prepared) => {
					if (generation.current !== started) return;
					const previewUrl = createBlobUrl(
						prepared.bytes as BlobPart,
						prepared.mime,
					);
					patch(key, { prepared, previewUrl });
					if (conversationId)
						void upload(key, prepared, conversationId, started);
					else patch(key, { status: "held" });
				},
				(error) => {
					if (generation.current !== started) return;
					patch(key, {
						status: "error",
						reason:
							error instanceof AttachmentPrepareError
								? error.reason
								: "invalid",
					});
				},
			);
		});
	};

	const remove = (key: string) => {
		const chip = live.current.find((row) => row.key === key);
		if (!chip) return;
		if (chip.previewUrl) revokeBlobUrl(chip.previewUrl);
		write(live.current.filter((row) => row.key !== key));
		setNotice(null);
		// Best effort: an orphaned staged upload is reaped by the hub's 72 h sweep
		// anyway, so a failed delete costs storage for a while, never correctness.
		if (
			chip.attachment &&
			tenantId &&
			chip.status === "ready" &&
			capturedAccount
		)
			void TeamBridgeApi.deleteAttachment(
				tenantId,
				chip.attachment.conversationId,
				chip.attachment.id,
				capturedAccount,
			).catch(() => {});
	};

	const retry = (key: string) => {
		const chip = live.current.find((row) => row.key === key);
		const into = conversationId ?? chip?.attachment?.conversationId;
		if (!chip?.prepared) return;
		if (!into) {
			patch(key, { status: "held", reason: undefined });
			return;
		}
		void upload(key, chip.prepared, into);
	};

	/**
	 * Upload every held chip into the conversation a first send just created.
	 * Returns the full id list, or throws when any image did not stage: the
	 * send must NOT go out text-only behind the author's back (manager rule).
	 */
	const uploadHeld = async (
		into: string,
		tenant: string | undefined = tenantId,
	): Promise<string[]> => {
		const pending = live.current.filter(
			(chip) =>
				(chip.status === "held" || chip.status === "error") && chip.prepared,
		);
		await Promise.all(
			pending.map((chip) =>
				chip.prepared
					? upload(chip.key, chip.prepared, into, generation.current, tenant)
					: null,
			),
		);
		if (live.current.some((chip) => chip.status !== "ready"))
			throw new Error("attachments not staged");
		return readyIds();
	};

	const readyIds = () =>
		capability === null
			? []
			: live.current.flatMap((chip) =>
					chip.status === "ready" && chip.attachment
						? [chip.attachment.id]
						: [],
				);

	/**
	 * The send's uniform 404: every id THAT REQUEST carried is suspect (no
	 * oracle says which). A chip added while it was in flight was never sent,
	 * so it stays as it is (review round 3, R3-02). `ids` omitted = all ready.
	 */
	const markExpired = (ids?: readonly string[]) => {
		const carried = ids ? new Set(ids) : null;
		write(
			live.current.map((chip) =>
				chip.status === "ready" &&
				(!carried || (chip.attachment && carried.has(chip.attachment.id)))
					? { ...chip, status: "expired", attachment: undefined }
					: chip,
			),
		);
	};

	/**
	 * After a confirmed send: the hub bound these ids, so they leave the strip.
	 * Persisted through `write` like every other change, so a later reload can
	 * never restore an already-bound id as a ready chip (R1-02).
	 */
	const clearSent = (ids: readonly string[]) => {
		const sent = new Set(ids);
		const keep = live.current.filter(
			(chip) => !(chip.attachment && sent.has(chip.attachment.id)),
		);
		revokeAll(live.current.filter((chip) => !keep.includes(chip)));
		write(keep);
		setNotice(null);
	};

	const busy = chips.some(
		(chip) => chip.status === "preparing" || chip.status === "uploading",
	);
	/*
	 * No capability (an old or rolled-back hub) makes every restored chip
	 * unsendable: that hub answers `attachment_ids` with a 400. The chips stay
	 * visible and removable, but block the send rather than going out (R1-04).
	 */
	const blocked =
		chips.some(
			(chip) => chip.status === "error" || chip.status === "expired",
		) ||
		(capability === null && chips.length > 0);
	const held = chips.some((chip) => chip.status === "held");
	return {
		chips,
		notice,
		dismissNotice: () => setNotice(null),
		add,
		remove,
		retry,
		uploadHeld,
		readyIds,
		markExpired,
		clearSent,
		/** Something is still on its way: send waits rather than dropping it. */
		busy,
		/** A failed/expired chip must be retried or removed before sending. */
		blocked,
		/** Bytes waiting for a first send to create their conversation. */
		held,
		count: chips.length,
		max: maxAttachments(capability),
		enabled: capability !== null,
		/** Restored chips on a hub that cannot take images (R1-04). */
		unsupported: capability === null && chips.length > 0,
	};
}

export type TeamBridgeAttachmentsState = ReturnType<
	typeof useTeamBridgeAttachments
>;
