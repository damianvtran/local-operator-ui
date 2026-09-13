/**
 * The Files panel's producer, wired to the canonical transcript.
 *
 * `extractMentionedPaths` decides what the transcript mentions; this hook is the
 * React edge that turns that into store entries: extract, probe the batch over
 * IPC, write the answer back.
 *
 * Why the store write lives here and not in `CanonicalTranscript`:
 * `ChatContent` is the only component holding BOTH the canonical transcript and
 * the canvas-store key. `CanonicalTranscript` is a view of the transcript and
 * imports no store, and putting a persistent write inside it would make its
 * memoised row list depend on persistent state — the one thing its identity
 * contract cannot survive. `SessionPanel` has the transcript but not the canvas
 * key, which is `agentId`/`identity` and differs for a staged draft.
 *
 * Five behaviours that are not obvious, each one a bug if it is missing:
 *
 * 1. **Tiles render before the probe answers.** A stat on an unmounted network
 *    path can take seconds, and a grid that waits for it is a grid that appears
 *    to be broken. Documents are added with no `availability` (the tile renders
 *    normally) and the probe fills in `missing` when it lands.
 * 2. **A probe is issued once per path per conversation.** The effect re-runs on
 *    every transcript delta, and re-probing a path per delta would be a stat
 *    storm during a streaming turn. `requested` is the set of spellings already
 *    asked about.
 * 3. **A path that probed missing is re-probed when the transcript GROWS.** This
 *    is the ordinary shape of a turn: the model says "I'll write
 *    /tmp/report.md", the mention is extracted, the probe finds nothing, and the
 *    `write` call that creates the file arrives a moment later. Re-probing on
 *    every text delta would be a storm, so the trigger is the record COUNT
 *    changing — one re-probe per new record, not per token. The retry uses the
 *    resolved spelling, which is also the document's id by then.
 * 4. **A late answer is dropped when the conversation moved on.** A stat issued
 *    for conversation A must never write into B; the check is against the
 *    conversation the request was issued for, not against the current one.
 * 5. **The identity written back is the RESOLVED path.** The transcript spells
 *    one file two ways (`~/notes/plan.md` and `/Users/you/notes/plan.md`), and
 *    only the probe's resolved form makes them the same tile. Reconciling here
 *    is what keeps the panel from listing one file twice.
 * 6. **The scan reaches the whole conversation, and says so when it cannot.**
 *    This hook is fed the loaded transcript, and the loaded transcript is a
 *    window: the panel showed 14 tiles for a session whose own durable history
 *    holds 160 distinct paths. So while the Files view is open the hook drives
 *    the reader's own older-history paging (`sessions.history`) until the
 *    transcript is whole, publishing a progress state the panel head renders.
 *    The bound that remains is a SCAN bound with a stated end — see
 *    `mentioned-files-scan.ts` — never a silent truncation of the output.
 */

import type { CanvasDocument } from "@features/chat/types/canvas";
import { canvasDocumentForPath } from "@features/chat/utils/canvas-document";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	MAX_PROBE_PATHS,
	type ProbedFile,
} from "../../../../../shared/desktop-contract";
import { type MentionedPath, extractMentionedPaths } from "./mentioned-files";
import {
	type MentionScanState,
	SCAN_PAGE_BUDGET,
	mentionScanState,
	shouldRequestPage,
} from "./mentioned-files-scan";
import type { TranscriptRecord } from "./transcript-reducer";

type MentionedFilesOptions = {
	/** The canvas-store key: `agentId` for a live session, the draft key for a draft. */
	conversationId: string | null | undefined;
	/** The canonical transcript's full record list, or `null` with no session. */
	records: readonly TranscriptRecord[] | null;
	/** The session's working directory, for resolving a relative candidate. */
	cwd?: string | null;
	/** False for a legacy backend, a draft with no session, or a still-loading view. */
	enabled: boolean;
	/**
	 * The completeness driver, or `null` when nothing should be paged.
	 *
	 * `active` is "the Files view is open": paging splices rows into the
	 * transcript the reader is looking at, which is a visible side effect and
	 * happens because the user asked to see every file, not because a
	 * conversation is mounted. `oldestId` keys the requests — it changes when a
	 * page lands, and it does NOT change for a live delta, which is what keeps a
	 * streaming turn from re-asking for the same page.
	 */
	scan?: {
		active: boolean;
		hasMore: boolean;
		oldestId: string | null;
		loadOlder: () => Promise<boolean>;
	} | null;
};

/** What the panel head renders: the state plus the way to fetch the rest. */
export type MentionScanHandle = MentionScanState & {
	/** Raise the page budget and continue where the scan stopped. */
	resume: () => void;
};

const IDLE_SCAN: MentionScanState = {
	active: false,
	scanned: 0,
	hasMore: false,
	paging: false,
	stopped: false,
};

/** Per-conversation bookkeeping. A ref, because none of it may cause a render. */
type ProbeBook = {
	id: string;
	/** Spellings already asked about, so a delta does not re-ask. */
	requested: Set<string>;
	/** RESOLVED paths that probed missing, for the growth-triggered retry. */
	missing: Set<string>;
	/** Last observed record count; a growth is what re-arms a missing path. */
	recordCount: number;
};

/** Per-conversation scan bookkeeping, separate from the probe book on purpose. */
type PageBook = {
	id: string;
	/** Pages fetched since the budget was last raised. */
	pages: number;
	/** The current budget, in pages. `resume` raises it. */
	budget: number;
	/** A page request is in flight. */
	inFlight: boolean;
	/** The `oldestId` a request was last issued for. */
	requestedFor: string | null;
};

/**
 * Write probe answers into the store, keyed by the INPUT the probe was asked
 * about.
 *
 * The pairing is by input rather than by resolved path on purpose: the tile that
 * was added carried the unresolved spelling (`~/x`), and the answer is the only
 * thing that knows what it resolved to. Two spellings of one file converge here
 * — the second is dropped rather than kept as a duplicate tile — and the
 * document's `id` becomes the resolved path, which is the identity the store
 * dedupes on from then on.
 */
function applyProbeResults(
	conversationId: string,
	results: ProbedFile[],
): void {
	if (results.length === 0) return;
	const store = useCanvasStore.getState();
	const current = store.conversations[conversationId]?.mentionedFiles;
	if (!current || current.length === 0) return;

	const byInput = new Map(results.map((result) => [result.input, result]));
	const seenResolved = new Set<string>();
	const next: CanvasDocument[] = [];
	let changed = false;

	for (const document of current) {
		const result = byInput.get(document.id);
		const resolved = result?.resolved ?? document.id;
		if (seenResolved.has(resolved)) {
			// The same file, reached by a second spelling. Dropping it here is
			// what makes `~/x.md` and `/Users/you/x.md` one tile.
			changed = true;
			continue;
		}
		seenResolved.add(resolved);
		if (!result) {
			next.push(document);
			continue;
		}
		// A directory is not a missing file: it exists, it is simply not
		// something a viewer can open - the click hands it to the OS. Only a path
		// with nothing at it earns the Not found receipt.
		const availability: CanvasDocument["availability"] =
			result.exists && result.isFile
				? "present"
				: result.exists
					? undefined
					: "missing";
		const updated: CanvasDocument = {
			...document,
			id: resolved,
			path: resolved,
			availability,
		};
		if (result.sizeBytes !== null) updated.sizeBytes = result.sizeBytes;
		if (result.mtimeMs !== null) updated.lastAgentModified = result.mtimeMs;
		if (
			updated.id !== document.id ||
			updated.path !== document.path ||
			updated.availability !== document.availability ||
			updated.sizeBytes !== document.sizeBytes
		)
			changed = true;
		next.push(updated);
	}

	// A batch whose answers changed nothing must not write: the store is
	// persisted, and zustand only skips the storage write when the state object
	// is identical.
	if (changed) store.setMentionedFiles(conversationId, next);
}

export function useMentionedFiles({
	conversationId,
	records,
	cwd,
	enabled,
	scan,
}: MentionedFilesOptions): MentionScanHandle {
	const session = useRef<ProbeBook | null>(null);
	const pageBook = useRef<PageBook | null>(null);
	const inFlight = useRef(false);
	const addMentionedFilesBatch = useCanvasStore(
		(s) => s.addMentionedFilesBatch,
	);

	/*
	 * The published scan state.
	 *
	 * Kept in React state because the panel head is React; written through a
	 * comparator because this hook runs on every transcript delta and a fresh
	 * object per delta would re-render the grid (and re-render it again for the
	 * identity alone).
	 */
	const [scanState, setScanState] = useState<MentionScanState>(IDLE_SCAN);
	const published = useRef<MentionScanState>(IDLE_SCAN);
	const publish = useCallback((next: MentionScanState) => {
		const previous = published.current;
		if (
			previous.active === next.active &&
			previous.scanned === next.scanned &&
			previous.hasMore === next.hasMore &&
			previous.paging === next.paging &&
			previous.stopped === next.stopped
		)
			return;
		published.current = next;
		setScanState(next);
	}, []);

	// `resume` raises the page budget and re-runs the effect: the state object is
	// what React watches, so the budget itself lives in the ref book.
	const [scanTick, setScanTick] = useState(0);
	const resume = useCallback(() => {
		const book = pageBook.current;
		if (book) book.budget += SCAN_PAGE_BUDGET;
		setScanTick((tick) => tick + 1);
	}, []);

	useEffect(() => {
		if (!enabled || !conversationId || !records || records.length === 0) return;
		// A new conversation starts a new book of requests. The previous book is
		// discarded rather than merged, so a stale set cannot suppress a probe
		// for the conversation now on screen.
		if (session.current?.id !== conversationId)
			session.current = {
				id: conversationId,
				requested: new Set(),
				missing: new Set(),
				recordCount: 0,
			};
		const book = session.current;
		const grew = records.length > book.recordCount;
		book.recordCount = records.length;

		const mentions = extractMentionedPaths(records, cwd ?? undefined);
		const fresh: MentionedPath[] = [];
		for (const mention of mentions) {
			if (book.requested.has(mention.path)) continue;
			book.requested.add(mention.path);
			fresh.push(mention);
		}
		// Retries are asked in their RESOLVED spelling, which is the document id
		// the first answer wrote back.
		const retry =
			grew && book.missing.size > 0 ? [...book.missing] : ([] as string[]);
		if (fresh.length === 0 && retry.length === 0) return;

		// First paint for anything new: the tiles, with no availability yet.
		// `content: ""` because a mention is a pointer - the store is persisted to
		// localStorage and the viewers read bytes over IPC when opened.
		if (fresh.length > 0)
			addMentionedFilesBatch(
				conversationId,
				fresh.map((mention) => canvasDocumentForPath(mention.path)),
			);

		// `probeFiles` is absent outside the Electron preload (browser
		// development), where there is nothing to stat; the tiles stay as added.
		if (typeof window.api?.probeFiles !== "function") return;

		const asked = [...fresh.map((mention) => mention.path), ...retry];
		const chunks: string[][] = [];
		for (let index = 0; index < asked.length; index += MAX_PROBE_PATHS)
			chunks.push(asked.slice(index, index + MAX_PROBE_PATHS));

		void (async () => {
			for (const chunk of chunks) {
				let results: ProbedFile[];
				try {
					results = await window.api.probeFiles(chunk, cwd ?? undefined);
				} catch (error) {
					// A probe that failed says nothing about whether the file exists,
					// so the tiles stay and keep their unmarked state. Losing the panel
					// because a stat call threw would be the worse failure.
					console.warn("probe-files failed:", error);
					return;
				}
				// The conversation this request was issued for is gone. Writing the
				// answer now would file conversation A's files under B.
				if (session.current?.id !== conversationId) return;
				applyProbeResults(conversationId, results);
				for (const result of results) {
					if (result.exists && result.isFile)
						book.missing.delete(result.resolved);
					else if (!result.exists) book.missing.add(result.resolved);
				}
			}
		})();
	}, [enabled, conversationId, records, cwd, addMentionedFilesBatch]);

	/*
	 * The completeness driver.
	 *
	 * Runs while the Files view is open and the transcript still has durable rows
	 * the reader has not loaded, one page at a time, re-running as each page
	 * lands. The whole rule - when to ask, when to stop, and what that means for
	 * the panel's honesty - is `mentioned-files-scan.ts`; this effect is the
	 * wiring.
	 *
	 * Why `requestedFor` rather than a page counter alone: a streaming turn
	 * changes `records` on every frame, and a naive "records grew, ask again"
	 * would issue the same `beforeId` page dozens of times. `oldestId` is the
	 * cursor `loadOlder` uses, so it is the honest key for "is there a page I have
	 * not asked for yet".
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `scanTick` is the re-run trigger this effect is built around - it is bumped by `resume` and after every page request, and the cursor/budget bookkeeping it re-reads lives in refs so that neither can cause a render on its own.
	useEffect(() => {
		const scanned = records?.length ?? 0;
		if (!enabled || !conversationId || !scan) {
			publish(IDLE_SCAN);
			return;
		}
		if (pageBook.current?.id !== conversationId)
			pageBook.current = {
				id: conversationId,
				pages: 0,
				budget: SCAN_PAGE_BUDGET,
				inFlight: false,
				requestedFor: null,
			};
		const book = pageBook.current;
		const step = {
			active: scan.active,
			scanned,
			hasMore: scan.hasMore,
			inFlight: inFlight.current,
			pagesFetched: book.pages,
			budget: book.budget,
		};
		publish(mentionScanState(step));
		if (!shouldRequestPage(step)) return;
		// A cursor already asked for. A live delta re-runs this effect without
		// moving it, and re-asking would fetch the same page twice; a page that
		// landed moves it, and a request still in flight will move it or spend the
		// budget when it fails.
		if (scan.oldestId !== null && book.requestedFor === scan.oldestId) {
			if (book.inFlight) return;
			// Nothing is in flight and the cursor has not moved since the last
			// request: no page arrived. Stop asking and let the head say so — a cue
			// that keeps promising more is worse than an honest "not searched",
			// whose own action is the retry.
			book.pages = book.budget;
			publish(mentionScanState({ ...step, pagesFetched: book.pages }));
			return;
		}

		book.requestedFor = scan.oldestId;
		book.inFlight = true;
		inFlight.current = true;
		void (async () => {
			try {
				const applied = await scan.loadOlder();
				if (pageBook.current?.id !== conversationId) return;
				if (applied) book.pages += 1;
				// Nothing arrived: either there is no older page or the request
				// failed, and neither is a state to keep spinning in. Spending the
				// budget is what turns it into the honest "earlier messages not
				// searched" line, whose own action is the retry.
				else book.pages = book.budget;
			} finally {
				book.inFlight = false;
				inFlight.current = false;
				// No `return` in here: a return inside `finally` swallows the promise's
				// own outcome, and this block has a job whether or not the session moved
				// on. The guard is the condition instead.
				if (pageBook.current?.id === conversationId) {
					publish(
						mentionScanState({
							...step,
							inFlight: false,
							pagesFetched: book.pages,
							budget: book.budget,
						}),
					);
					// Re-evaluate once per request. The page that landed changes
					// `records`, which re-runs this effect on its own — but an empty page
					// at the end of a history that still claims `has_more` changes
					// nothing, and without this the cue would stay up forever.
					setScanTick((tick) => tick + 1);
				}
			}
		})();
	}, [enabled, conversationId, records, scan, publish, scanTick]);

	return useMemo(() => ({ ...scanState, resume }), [scanState, resume]);
}
