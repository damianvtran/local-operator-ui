/**
 * The conversation's user attachments: backend inventory merged with live rows.
 *
 * OWNED ONCE, by the chat (like `useSessionFiles`), and handed to the canvas so
 * the rail count, the Files segment count and the Attachments section cannot
 * disagree. A canvas rendered without a chat (stories) runs its own copy with
 * no records.
 *
 * WHEN IT RE-READS. On mount, on a settled turn (`revisionHint`), and when the
 * loaded rows gain an attachment: the live row paints at once from the records
 * (requirement: a new send appears without reload), and the re-read then adds
 * the facts only the backend has (digest, origin/retained-copy existence).
 *
 * CAPABILITY ABSENT is the only door to loaded-row aggregation, and that view
 * says `complete: false` - never an empty "nothing attached" claim. A capable
 * backend's error is reported as an error, not silently replaced.
 */
import { desktopRequest } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TranscriptRecord } from "./transcript-reducer";
import {
	type UserAttachmentsListing,
	type UserAttachmentsView,
	attachmentsFromRecords,
	mergeUserAttachments,
} from "./user-attachments";

export type UserAttachmentsState = UserAttachmentsView & {
	state: "loading" | "ready" | "error";
	/** The backend can materialise a retained copy (`session_attachments`). */
	capable: boolean;
	/** Retry a failed or stale inventory without remounting the canvas. */
	retry: () => void;
};

export function useUserAttachments(
	sessionId: string | undefined,
	records: readonly TranscriptRecord[] | null | undefined,
	revisionHint = 0,
	/** `false` for a canvas whose chat already owns the inventory (no second read). */
	enabled = true,
): UserAttachmentsState {
	const capabilities = useDesktopCapabilities();
	const known = capabilities.data !== undefined;
	const capable = desktopFeatureEnabled(
		capabilities.data,
		"session_attachments",
	);
	/*
	 * Records change on every streaming delta; the attachment part of them almost
	 * never does. A signature of just that part keeps the merge (and every
	 * consumer's memo) from recomputing per token.
	 */
	const local = useMemo(() => attachmentsFromRecords(records), [records]);
	const signature = local
		.map((item) => `${item.key}:${item.digest ?? ""}`)
		.join("|");
	const [listing, setListing] = useState<{
		key: string;
		value: UserAttachmentsListing | null;
		state: UserAttachmentsState["state"];
	}>({ key: "", value: null, state: "loading" });
	const sourceKey = `${sessionId ?? "draft"}:${capable}`;
	const [retryCount, setRetryCount] = useState(0);
	/*
	 * A retry is a visible state change (UX R2 U11): the failed listing goes
	 * back to `loading` the moment it is pressed, so the banner can show the
	 * loading line and a second failure arrives as a NEW `error`, not as the
	 * same frame it replaced. The listing's value is kept; only its state moves.
	 */
	const retry = useCallback(() => {
		setListing((current) =>
			current.state === "error" ? { ...current, state: "loading" } : current,
		);
		setRetryCount((count) => count + 1);
	}, []);
	useEffect(() => {
		// Read inside so the effect re-runs on a new attachment without depending on
		// the whole records array.
		void signature;
		void revisionHint;
		void retryCount;
		if (!known || !enabled) return;
		if (!sessionId || !capable) {
			setListing({ key: sourceKey, value: null, state: "ready" });
			return;
		}
		let live = true;
		void desktopRequest({ op: "sessions.userAttachments", sessionId })
			.then((response) => {
				if (!live) return;
				const body = (response.body as { result?: UserAttachmentsListing })
					?.result;
				if (response.status !== 200 || !body || !Array.isArray(body.items)) {
					setListing({ key: sourceKey, value: null, state: "error" });
					return;
				}
				setListing({ key: sourceKey, value: body, state: "ready" });
			})
			.catch(() => {
				if (live) setListing({ key: sourceKey, value: null, state: "error" });
			});
		return () => {
			live = false;
		};
	}, [
		known,
		enabled,
		sessionId,
		capable,
		sourceKey,
		signature,
		revisionHint,
		retryCount,
	]);
	// A previous session's listing never paints under the new one.
	const owned = listing.key === sourceKey ? listing : null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: `signature` stands for `records`' attachment content.
	const view = useMemo(
		() =>
			mergeUserAttachments(
				owned?.value ?? null,
				records,
				/*
				 * A capable backend judges every row, so until its listing has,
				 * nothing is allowed (QA R6 Q3). While the capability answer is
				 * still in flight the backend MAY be one, and the sent-file card's
				 * origin-path actions do not wait on the capability, so that window
				 * is withheld too. An older backend (answered, no capability), a
				 * failed capabilities read and a document with no query client
				 * (not fetching) keep the capability-only rule.
				 */
				capable || capabilities.isLoading,
			),
		[owned?.value, signature, capable, capabilities.isLoading],
	);
	return {
		...view,
		state: !known ? "loading" : (owned?.state ?? "loading"),
		capable,
		retry,
	};
}

/**
 * Copy one attachment's retained bytes to a real, named scratchpad file and
 * answer its path. The ONE door every surface uses for open/reveal/copy-path on
 * an attachment that has no live origin (a pasted screenshot, a moved file).
 */
export async function materialiseUserAttachment(
	sessionId: string,
	digest: string,
): Promise<string> {
	const response = await desktopRequest({
		op: "sessions.userAttachments.materialise",
		sessionId,
		digest,
	});
	const path = (response.body as { result?: { path?: string } })?.result?.path;
	if (response.status !== 200 || !path)
		throw new Error(`materialise failed: ${response.status}`);
	return path;
}
