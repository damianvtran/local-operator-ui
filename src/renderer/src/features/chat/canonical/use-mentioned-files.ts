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
	type ScanBook,
	mentionScanState,
	newScanBook,
	restartScan,
	scanLane,
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
		/**
		 * The reader's OWN older-history page is in flight.
		 *
		 * `loadOlder` stands down with `false` while one is, and a `false` from it is
		 * otherwise indistinguishable from "no more history", so the scan has to be
		 * told which of the two it is looking at. Without this, a Files view opened
		 * while the chat column is scrolling spent the whole budget on the reader's
		 * request (round 2, R2-5).
		 */
		blocked: boolean;
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

/**
 * Per-conversation scan bookkeeping, separate from the probe book on purpose.
 *
 * The budget/cursor half is `ScanBook` in `mentioned-files-scan.ts`, where the
 * lane's rules live; this is that book plus the conversation it belongs to, so a
 * session switch starts a new one instead of inheriting a cursor.
 */
type PageBook = ScanBook & { id: string };

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
		// with nothing at it earns the missing-file receipt.
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
	/**
	 * An older-history request is in flight, as of the latest render.
	 *
	 * `loadOlder` sets the reader's `loadingOlder` flag for EVERY caller,
	 * including the scan's own request, so a `false` from it cannot distinguish
	 * "your own page is out" from "the history did not answer" - the field
	 * carries no such distinction (round 3, R3-3). All this has to know is that
	 * a request is out, which is what the lane's `wait` arm is for.
	 */
	const blocked = useRef(false);
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

	// `resume` raises the page budget and re-arms the cursor, then re-runs the
	// effect: the state object is what React watches, so the book itself lives in
	// the ref. Both halves are `restartScan`'s, because raising the budget alone
	// leaves a stop-with-an-unmoved-cursor unable to re-issue anything.
	const [scanTick, setScanTick] = useState(0);
	const resume = useCallback(() => {
		const book = pageBook.current;
		if (book) restartScan(book);
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
	 *
	 * Why the reader's own page is a WAIT rather than a failure: `loadOlder`
	 * stands down with `false` while it has a request of its own in flight, and
	 * that `false` says nothing about this scan. Spending the budget on it ended
	 * the scan on someone else's scroll - the Files view opened while the chat
	 * column is paging lit "earlier messages are not searched yet" before this
	 * effect had asked for anything (round 2, R2-5). The page that lands moves the
	 * cursor and re-runs this effect on its own; a page that fails clears the flag
	 * and re-runs it too, which is when a stale cursor really does mean "not
	 * searched".
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `scanTick` is the re-run trigger this effect is built around - it is bumped by `resume` and after every page request, and the cursor/budget bookkeeping it re-reads lives in refs so that neither can cause a render on its own.
	useEffect(() => {
		const scanned = records?.length ?? 0;
		/*
		 * The latest reader-paging state, for the async continuation below: an
		 * effect that started while the chat column was idle can still find the
		 * reader paging when its answer comes back.
		 */
		blocked.current = Boolean(scan?.blocked);
		if (!enabled || !conversationId || !scan) {
			publish(IDLE_SCAN);
			return;
		}
		if (pageBook.current?.id !== conversationId)
			pageBook.current = { id: conversationId, ...newScanBook() };
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
		/*
		 * One decision, in one place: whether this cursor earns a request, has to
		 * wait for the reader's own page, is already out, or is a stop to declare.
		 * The rules and the bookkeeping they imply are `scanLane`'s - see the
		 * `stop` and `request` arms in `mentioned-files-scan.ts`, where the dead
		 * retry this replaced is recorded.
		 */
		const lane = scanLane(book, {
			canRequest: shouldRequestPage(step),
			blocked: blocked.current,
			oldestId: scan.oldestId,
		});
		if (lane === "stop") {
			publish(mentionScanState({ ...step, pagesFetched: book.pages }));
			return;
		}
		if (lane !== "request") return;

		inFlight.current = true;
		void (async () => {
			try {
				const applied = await scan.loadOlder();
				if (pageBook.current?.id !== conversationId) return;
				if (applied) book.pages += 1;
				// Nothing arrived: either there is no older page or the request
				// failed, and neither is a state to keep spinning in. Spending the
				// budget is what turns it into the honest "earlier messages not
				// searched" line, whose own action is the retry - except when the
				// reader's own page was what stood this request down, which is a fact
				// about their scroll and not about the history (round 2, R2-5).
				else if (!blocked.current) book.pages = book.budget;
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
