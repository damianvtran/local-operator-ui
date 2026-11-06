import { createBlobUrl, revokeBlobUrl } from "@shared/lib/blob-url-cache";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
	LinkPreviewArtifact,
	LinkPreviewArtifactResult,
	LinkPreviewBridge,
	LinkPreviewResolveResult,
} from "../../../../../shared/link-preview";
import {
	LINK_PREVIEW_ACCOUNT_MAX_CHARS,
	LINK_PREVIEW_ARTIFACT_ID,
} from "../../../../../shared/link-preview";
import {
	type LinkPreviewArtifactRefusal,
	type LinkPreviewCardView,
	linkPreviewArtifactRefusal,
	linkPreviewCardView,
	linkPreviewRequest,
} from "./link-preview-model";

/**
 * The two IPC-backed hooks the link-preview card needs, and nothing else.
 *
 * WHY THE BRIDGE IS A PROP. Production passes nothing and the card reads
 * `window.api.linkPreview`; a story or a test passes a fake, so the card's
 * states can be rendered without a main process and without patching a global.
 * That is the same seam the design round needs for its frames.
 *
 * THERE IS NO CACHE IN THIS FILE, deliberately. Every resolve is a call to core
 * (which owns the TTLs) and every artifact is a call to main's byte cache. An
 * answer held here would be a second expiry rule, and the two would disagree
 * first on the entry that matters — the one whose page changed.
 *
 * NOTHING HERE FETCHES A THIRD-PARTY ADDRESS. The resolve is an IPC hop and the
 * bytes come from main's own cache; the only URL this file ever creates is a
 * `blob:` URL over bytes main already returned. That is what keeps a preview
 * from telling the previewed site who read the message.
 */

/** The preload surface, or `null` where it is not installed (a renderer booted
 * without a main process). A card that cannot ask draws nothing. */
function linkPreviewBridge(): LinkPreviewBridge | null {
	return window.api?.linkPreview ?? null;
}

/** The account receipt, or `null` when there is not a usable one. Same bounds
 * the route takes on its header, and the value is never altered — see
 * `linkPreviewRequest`, which refuses rather than substitutes. */
function usableReceipt(
	expectedAccountId: string | null | undefined,
): string | null {
	return typeof expectedAccountId === "string" &&
		expectedAccountId.length > 0 &&
		expectedAccountId.length <= LINK_PREVIEW_ACCOUNT_MAX_CHARS
		? expectedAccountId
		: null;
}

export interface UseTeamBridgeLinkPreviewOptions {
	url: string;
	/** The link's 0-based position in its message. */
	index: number;
	/** Required. A card with no receipt asks nothing. */
	expectedAccountId: string | null | undefined;
	bridge?: LinkPreviewBridge;
}

export interface TeamBridgeLinkPreviewState {
	view: LinkPreviewCardView;
	/** Ask again now, for the manual (`retry`) state. */
	retry: () => void;
}

/**
 * Resolve ONE link and hold its state.
 *
 * THE DELAYED-RETRY ARM IS THE POINT OF THIS HOOK. A `retryable` error carrying
 * `retryAfterMs` is a `429` telling this app WHEN to come back, so the card waits
 * and draws nothing rather than showing a failure the reader cannot act on. The
 * wait is a timer this hook owns and clears, and the number of waits is bounded
 * by `LINK_PREVIEW_MAX_DELAYED_RETRIES` so a rate limiter cannot keep a row
 * asking for as long as it stays on screen.
 *
 * A resolve never rejects by contract; if one does anyway (a preload bug), the
 * card goes silent rather than throwing into the transcript.
 */
export function useTeamBridgeLinkPreview({
	url,
	index,
	expectedAccountId,
	bridge,
}: UseTeamBridgeLinkPreviewOptions): TeamBridgeLinkPreviewState {
	const plan = useMemo(
		() => linkPreviewRequest({ url, index, expectedAccountId }),
		[url, index, expectedAccountId],
	);
	/**
	 * The question this state belongs to: a different link, index or receipt is a
	 * different question, and the retry budget the previous one spent must not be
	 * charged to it.
	 */
	const key = `${index}\u0000${expectedAccountId ?? ""}\u0000${url}`;

	const [view, setView] = useState<LinkPreviewCardView>({ kind: "silent" });
	const [delayedRetries, setDelayedRetries] = useState(0);
	const [nonce, setNonce] = useState(0);
	const [answerFor, setAnswerFor] = useState(key);

	// One render of the previous answer, discarded: shown blank rather than
	// carrying the old link's card under the new link's text.
	if (answerFor !== key) {
		setAnswerFor(key);
		setDelayedRetries(0);
		setView({ kind: "silent" });
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` is the manual-retry trigger and not a value this body reads - a person asking again must re-run the ask, while `delayedRetries` keeps its own count for the delayed budget.
	useEffect(() => {
		if (plan.kind !== "ask") return;
		const api = bridge ?? linkPreviewBridge();
		if (!api) return;

		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const run = async () => {
			let result: LinkPreviewResolveResult;
			try {
				result = await api.resolve(plan.request);
			} catch {
				if (!cancelled) setView({ kind: "silent" });
				return;
			}
			if (cancelled) return;
			const next = linkPreviewCardView(result, delayedRetries);
			setView(next);
			if (next.kind === "waiting") {
				// Core named when to come back; coming back sooner is how a rate
				// limiter becomes a permanent refusal.
				timer = setTimeout(
					() => setDelayedRetries((n) => n + 1),
					next.retryInMs,
				);
			}
		};
		void run();

		return () => {
			cancelled = true;
			if (timer !== undefined) clearTimeout(timer);
		};
	}, [plan, delayedRetries, nonce, bridge]);

	const retry = useCallback(() => {
		setDelayedRetries(0);
		setView({ kind: "silent" });
		setNonce((n) => n + 1);
	}, []);

	return { view, retry };
}

export interface LinkPreviewArtifactState {
	/** A `blob:` URL for the bytes, or `null` while they are missing. */
	url: string | null;
	refusal: LinkPreviewArtifactRefusal | null;
}

/**
 * The bytes of one artifact, as an object URL this hook owns.
 *
 * Both refusals and successes are held as state rather than thrown: a preview
 * whose picture is gone is still a card with a title, which is the whole reason
 * the two slots are drawn separately.
 *
 * The id is checked against the contract's `^[0-9a-f]{32}$` BEFORE the call, so
 * a malformed id costs nothing — main would answer the `422` core answers, and
 * this app should not ask a question it can already see fails.
 */
export function useLinkPreviewArtifact(
	artifact: LinkPreviewArtifact | null,
	expectedAccountId: string | null | undefined,
	bridge?: LinkPreviewBridge,
): LinkPreviewArtifactState {
	const id =
		artifact && LINK_PREVIEW_ARTIFACT_ID.test(artifact.id) ? artifact.id : null;
	const receipt = usableReceipt(expectedAccountId);

	const [state, setState] = useState<LinkPreviewArtifactState>({
		url: null,
		refusal: null,
	});

	useEffect(() => {
		if (!id || !receipt) return;
		const api = bridge ?? linkPreviewBridge();
		if (!api) return;

		let cancelled = false;
		let created: string | null = null;

		const run = async () => {
			let answer: LinkPreviewArtifactResult;
			try {
				answer = await api.artifact({ id, expectedAccountId: receipt });
			} catch {
				if (!cancelled) {
					setState({ url: null, refusal: { kind: "transient", status: 0 } });
				}
				return;
			}
			if (cancelled) return;
			const refusal = linkPreviewArtifactRefusal(answer);
			if (answer.kind !== "bytes") {
				setState({ url: null, refusal });
				return;
			}
			// The same cast every byte-relay call site in this app makes: the
			// contract's `Uint8Array` is a `BlobPart` at runtime, and TypeScript's
			// `ArrayBufferLike` is wider than `BlobPart` admits.
			created = createBlobUrl(answer.data as BlobPart, answer.mimeType);
			setState({ url: created, refusal: null });
		};
		void run();

		return () => {
			cancelled = true;
			// Only this hook's own URL: a blob URL revoked by its neighbour blanks
			// the picture that neighbour is still showing.
			if (created) revokeBlobUrl(created);
		};
	}, [id, receipt, bridge]);

	return state;
}
