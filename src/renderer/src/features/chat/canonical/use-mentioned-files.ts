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
 */

import type { CanvasDocument } from "@features/chat/types/canvas";
import { canvasDocumentForPath } from "@features/chat/utils/canvas-document";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useEffect, useRef } from "react";
import {
	MAX_PROBE_PATHS,
	type ProbedFile,
} from "../../../../../shared/desktop-contract";
import { type MentionedPath, extractMentionedPaths } from "./mentioned-files";
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
}: MentionedFilesOptions): void {
	const session = useRef<ProbeBook | null>(null);
	const addMentionedFilesBatch = useCanvasStore(
		(s) => s.addMentionedFilesBatch,
	);

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
}
