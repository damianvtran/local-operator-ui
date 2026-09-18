import { useCanvasStore } from "@shared/store/canvas-store";
import type { CanvasDocument } from "../../types/canvas";
import {
	cancelPendingWrites,
	currentWriteEpoch,
	isAutosaveHeld,
	probeLocalFile,
	setAutosaveHeld,
	setDocumentDirty,
	setDocumentFact,
} from "./file-freshness";

/**
 * THE BUFFER OWNER.
 *
 * One module knows what a document's text is, and one module writes it. Round 4's
 * four harm classes were all the same failure in different clothes - *something
 * that is not the reader's current buffer for that document reaching a file* - and
 * every one of them came from a component holding its own copy of the text, its own
 * idea of the baseline, and its own moment to write. The three reproduced on the
 * previous head:
 *
 * - **another document's bytes** (UX U14): a markdown tab wrote `ts-a.md`'s content
 *   into `ts-b.md`, because the write read a buffer out of a closure that belonged
 *   to the document the reader had just left.
 * - **a stale proposal after a resolution** (UX U9): the press loaded the file's
 *   version, and ~130ms later the editor's debounced effect wrote the *pre-load*
 *   text back over it - it passed the gate because the load had just advanced the
 *   baseline the gate compares against.
 * - **a pre-edit snapshot on an explicit save** (QA Q13): Meta+S inside the debounce
 *   window wrote the text as of the debounce rather than the text on screen, and then
 *   marked the document clean, so the autosave that would have written the words
 *   never ran either - a silent loss with no fact and no toast.
 *
 * SO THE INVARIANTS LIVE HERE, once, and the editors are reduced to reporting:
 *
 * - **I1 - the text written is this document's current text.** `propose` is the only
 *   way text enters; `write` is the only way it leaves; both are keyed by document id
 *   and neither is a closure over anything a component held.
 * - **I2 - a write only happens while the file's mtime still equals the baseline the
 *   text was derived from.** Probed immediately before the write, never inferred.
 * - **I3 - an explicit save writes the current buffer** (not a debounced snapshot)
 *   and marks the document clean only because that content reached the file.
 * - **I4 - a resolution invalidates every pending proposal for that document.** The
 *   generation is bumped by `resolve`, and every save compares it again after each
 *   await, so a proposal born before the resolution cannot land after it.
 * - **I5 - lifecycle is monotone.** The generation bumps, never deletes; a cancelled
 *   write stays cancelled; the dirty flag is KEPT for a held document; and closing a
 *   document commits the buffer through a port that works even when the document has
 *   already left the store's file list.
 *
 * WHY AN OWNER RATHER THAN FIXING THE FOUR SITES. Each of the four was fixed in
 * round 3 by adjusting where a component read its text or when it fired; each fix
 * moved the harm to the next site (that is what rounds 3 and 4 are). A buffer that is
 * only written by the thing that owns it cannot be written from a stale copy of
 * something else, and the invariants above become properties of one module with one
 * test surface rather than of four components with four.
 */

/** The bridge, injectable so the headless suite drives every branch. */
export type BufferPorts = {
	probe: (path: string) => Promise<{
		exists: boolean;
		isFile: boolean;
		mtimeMs: number | null;
		error?: string;
	} | null>;
	write: (
		path: string,
		text: string,
		encoding?: "utf-8" | "base64",
	) => Promise<void>;
};

const defaultPorts: BufferPorts = {
	probe: (path) => probeLocalFile(path),
	write: async (path, text, encoding) => {
		await window.api.saveFile(path, text, encoding);
	},
};

let ports: BufferPorts = defaultPorts;

export function setBufferPorts(next: BufferPorts | null): void {
	ports = next ?? defaultPorts;
}

export type BufferSaveOutcome =
	/** The reader's text reached the file; the baseline is the write's mtime. */
	| { status: "written"; mtimeMs: number | null; replaced: boolean }
	/** Nothing to write: the buffer already matches the file's version. */
	| { status: "clean" }
	/** A held document and an automatic save: the reader decides, not a timer. */
	| { status: "held" }
	/** The file moved on, or is gone, or cannot be looked at: no write, a fact. */
	| {
			status: "blocked";
			fact: "disk-changed" | "missing" | "unreadable";
	  }
	/**
	 * A resolution landed while this save was in flight. THE BYTES MAY ALREADY BE ON
	 * THE FILE: the epoch is checked before and after the write, and a resolution that
	 * lands DURING `ports.write` cannot recall it. What is promised is that nothing
	 * further is applied from this save - no baseline advance, no store commit, no
	 * fact - so the reader's resolution is the state that stands.
	 */
	| { status: "cancelled" }
	/** The bridge is unavailable, so nothing can be known about the file. */
	| { status: "unavailable" }
	| { status: "failed"; error: string };

type BufferEntry = {
	documentId: string;
	path: string;
	/**
	 * The reader's current content TOKEN: the text itself for the text surfaces, and
	 * a cheap revision marker for a surface whose bytes are expensive to build (the
	 * spreadsheet's workbook). `dirty` compares it with `writtenToken`, so an undo
	 * that puts a text surface back to the file's own bytes clears it (UX U11) while
	 * a grid edit always reads as unsaved.
	 */
	token: string;
	/** The token as of the file's version at `baselineMtime`. */
	writtenToken: string;
	/**
	 * How to materialise the bytes, called AT WRITE TIME from the surface's live
	 * state - never from a snapshot the caller took earlier (I1).
	 */
	serialize?: () => { text: string; encoding?: "utf-8" | "base64" };
	/** The mtime of the file version the text on screen was read at. */
	baselineMtime: number | undefined;
	encoding?: "utf-8" | "base64";
	/** The store handoff: how the buffer and its new baseline get persisted. */
	commit?: (text: string, mtimeMs: number | null) => void;
	/** Set while an unmount is in progress, so a late adopt cannot revive it. */
	closed: boolean;
};

const buffers = new Map<string, BufferEntry>();

/**
 * Put one document back into the store, whether or not it is still listed.
 *
 * The editors' unmount commits used to map over `canvasState.files`, and closing a
 * tab removes the document from that list BEFORE the cleanup runs - so on the close
 * path the commit did nothing at all (code review R4-7). An upsert cannot lose the
 * case it exists for.
 */
export function commitCanvasDocument(
	conversationId: string,
	document: CanvasDocument,
): void {
	const state = useCanvasStore.getState();
	const conversation = state.conversations[conversationId];
	if (!conversation) return;
	const listed = conversation.files.some((file) => file.id === document.id);
	state.setFiles(
		conversationId,
		listed
			? conversation.files.map((file) =>
					file.id === document.id ? document : file,
				)
			: [...conversation.files, document],
	);
}

const dirtyOf = (entry: BufferEntry): boolean =>
	entry.token !== entry.writtenToken;

function publishDirty(entry: BufferEntry): void {
	setDocumentDirty(entry.documentId, dirtyOf(entry));
}

/**
 * Register (or re-register) the document a surface is showing.
 *
 * Called on mount and whenever the store hands the editor a different document
 * object. It adopts the file's content ONLY when this buffer has nothing unsaved:
 * a store write is the file's version by definition, and adopting it over a dirty
 * buffer is exactly the harm class this module exists to remove.
 */
export function adoptBuffer(input: {
	documentId: string;
	path: string;
	text: string;
	mtimeMs: number | undefined;
	encoding?: "utf-8" | "base64";
	/** A change token, when the surface's bytes are not its own text. */
	token?: string;
	serialize?: () => { text: string; encoding?: "utf-8" | "base64" };
	commit?: (text: string, mtimeMs: number | null) => void;
}): void {
	const existing = buffers.get(input.documentId);
	if (!existing) {
		const token = input.token ?? input.text;
		buffers.set(input.documentId, {
			documentId: input.documentId,
			path: input.path,
			token,
			writtenToken: token,
			baselineMtime: input.mtimeMs,
			encoding: input.encoding,
			serialize: input.serialize,
			commit: input.commit,
			closed: false,
		});
		publishDirty(buffers.get(input.documentId) as BufferEntry);
		return;
	}
	existing.path = input.path;
	existing.encoding = input.encoding;
	existing.serialize = input.serialize ?? existing.serialize;
	existing.commit = input.commit ?? existing.commit;
	existing.closed = false;
	if (!dirtyOf(existing)) {
		const token = input.token ?? input.text;
		existing.token = token;
		existing.writtenToken = token;
		existing.baselineMtime = input.mtimeMs;
	}
	publishDirty(existing);
}

/**
 * The reader's current content for this document. The ONLY way content enters.
 *
 * The text surfaces call it on every change with the text itself; the spreadsheet
 * calls it with a revision token and a serialiser, whose bytes are built at write
 * time (a workbook is too expensive to build on every cell edit, and the bytes that
 * get written must still be the live ones).
 */
export function proposeBuffer(
	documentId: string,
	token: string,
	serialize?: () => { text: string; encoding?: "utf-8" | "base64" },
): void {
	const entry = buffers.get(documentId);
	if (!entry) return;
	entry.token = token;
	if (serialize) entry.serialize = serialize;
	publishDirty(entry);
}

/**
 * Adopt the FILE's version as this buffer's content, because a resolution delivered it.
 *
 * WHY THIS EXISTS BESIDE `adoptBuffer`. `adoptBuffer` refuses to take new text while the
 * buffer has unsaved edits - that refusal is the whole point of it, and it is what stops a
 * store write from replacing what the reader is typing. The control's load is the one
 * caller that MAY replace them, because it is the action the row words "your unsaved edits
 * are discarded": the bytes it read ARE the document's content now, so the owner takes
 * them, marks the buffer clean by definition, and releases the hold. Without this the load
 * applied the file's version to the STORE while the editor kept the reader's text (the
 * round-4 run measured exactly that: the press left the screen unchanged), which is the
 * harm U9 named arriving from the other side.
 */
export function resetBufferToFile(
	documentId: string,
	text: string,
	mtimeMs: number | null,
): void {
	const entry = buffers.get(documentId);
	if (!entry) return;
	entry.token = text;
	entry.writtenToken = text;
	entry.baselineMtime = mtimeMs ?? entry.baselineMtime;
	publishDirty(entry);
	setAutosaveHeld(documentId, false);
}

/**
 * Bump the generation: every proposal that predates this call is dead.
 *
 * I4. Called by the control's load, by an explicit save's own success, and by a
 * close - anything that means "the version this buffer was about is settled".
 * Monotone on purpose (I5): the previous round's `releaseDocumentHold` DELETED the
 * epoch, which cancelled the flush its own cleanup had just started and revived a
 * save the reader's press had cancelled.
 */
export function resolveBuffer(documentId: string): void {
	cancelPendingWrites(documentId);
}

export function bufferGeneration(documentId: string): number {
	return currentWriteEpoch(documentId);
}

export function bufferText(documentId: string): string | null {
	const entry = buffers.get(documentId);
	if (!entry) return null;
	return entry.serialize ? entry.serialize().text : entry.token;
}

export function bufferIsDirty(documentId: string): boolean {
	const entry = buffers.get(documentId);
	return entry ? dirtyOf(entry) : false;
}

/** The write. Every surface's save goes through here, and nothing else writes. */
export async function saveBuffer(
	documentId: string,
	{ explicit = false }: { explicit?: boolean } = {},
): Promise<BufferSaveOutcome> {
	const entry = buffers.get(documentId);
	if (!entry) return { status: "unavailable" };
	/*
	 * An automatic save has nothing to do while the document is held: the row has
	 * told the reader the file moved on, and their two routes out are the control
	 * and an explicit save (I2's refusal, stated where it is decided).
	 */
	if (!explicit && isAutosaveHeld(documentId)) return { status: "held" };
	if (!dirtyOf(entry)) return { status: "clean" };

	const generation = currentWriteEpoch(documentId);
	/*
	 * The bytes are materialised HERE, from the surface's live state through the
	 * serialiser it registered - never from a snapshot a caller took (I1), and never
	 * from a debounce's value (I3).
	 */
	const payload = entry.serialize
		? entry.serialize()
		: { text: entry.token, encoding: entry.encoding };
	const text = payload.text;
	/*
	 * THE TOKEN THE BYTES CAME FROM (code review round 5, R5-1). Everything the write
	 * needs is captured HERE, in one place, because the awaits below are a window a
	 * keystroke can land in: a `propose` during the probe or the write moves
	 * `entry.token`, and marking the buffer clean against the token as it is AFTER
	 * those awaits would report a buffer as saved whose latest words were never
	 * written - clean, no fact, and a next save answering `clean`. Round 4's shape was
	 * exactly that (`entry.writtenToken = entry.token` at the end); QA could not
	 * reproduce it end to end, which is why the suite holds it instead.
	 */
	const sent = entry.token;
	const path = entry.path;

	const before = await ports.probe(path);
	if (currentWriteEpoch(documentId) !== generation)
		return { status: "cancelled" };
	if (!before) {
		/*
		 * Nothing was learned about the file, so nothing is written (R4-5: this is
		 * the truth of "an explicit save is never refused" - it is never refused by a
		 * VERSION CONFLICT, and a bridge that cannot look at the file at all is not a
		 * conflict but a different failure, reported as one).
		 */
		return { status: "unavailable" };
	}

	const unreadable = Boolean(before.error);
	const missing = !before.exists && !unreadable;
	const moved =
		!missing && !unreadable && before.mtimeMs !== entry.baselineMtime;

	/*
	 * THE REFUSALS, and the ORDER matters because the row's words do (R4-4): a
	 * `stat` that failed is its own state - the file may well be there - and a path
	 * that is no longer a file is not "changed on disk" either. Both were reported as
	 * the wrong fact, so the row contradicted itself one tick later.
	 */
	if (!explicit && unreadable) {
		setDocumentFact(documentId, "unreadable");
		setAutosaveHeld(documentId, true);
		return { status: "blocked", fact: "unreadable" };
	}
	if (!explicit && missing) {
		setDocumentFact(documentId, "missing");
		setAutosaveHeld(documentId, true);
		return { status: "blocked", fact: "missing" };
	}
	if (!explicit && !before.isFile) {
		/*
		 * A path that is no longer a FILE is not "changed on disk" (code review round 4,
		 * R4-4): the row's `disk-changed` sentence tells the reader to load a version or
		 * save over it, and neither describes a directory. It is unreadable as a file,
		 * which is exactly what `unreadable` says, and the press that follows it tells
		 * the same story instead of contradicting this one.
		 */
		setDocumentFact(documentId, "unreadable");
		setAutosaveHeld(documentId, true);
		return { status: "blocked", fact: "unreadable" };
	}
	if (!explicit && moved) {
		setDocumentFact(documentId, "disk-changed");
		setAutosaveHeld(documentId, true);
		return { status: "blocked", fact: "disk-changed" };
	}

	try {
		await ports.write(path, text, payload.encoding ?? entry.encoding);
	} catch (error) {
		return {
			status: "failed",
			error: error instanceof Error ? error.message : String(error),
		};
	}
	if (currentWriteEpoch(documentId) !== generation)
		return { status: "cancelled" };

	const after = await ports.probe(path);
	const mtimeMs = after?.mtimeMs ?? entry.baselineMtime ?? null;
	/*
	 * I3: the buffer becomes the file's version only now, with its bytes ON DISK. The
	 * baseline is the write's own mtime, so the next check does not re-read our save,
	 * and a resolution that lands here is honoured by the generation checks above.
	 */
	entry.writtenToken = sent;
	entry.baselineMtime = mtimeMs ?? undefined;
	publishDirty(entry);
	entry.commit?.(text, mtimeMs);

	const replaced = explicit && (moved || missing);
	if (replaced) setDocumentFact(documentId, "save-replaced");
	else if (!explicit && moved) {
		/* Unreachable by construction (a moved file is refused above), kept
		 * deliberately as the assertion that the gate is the only path here. */
		setDocumentFact(documentId, "disk-changed");
	} else if (setDocumentFact && explicit) {
		/* An explicit save over an unmoved file answers nothing new, but it does mean
		 * the bytes on disk are the buffer's own again. */
		setDocumentFact(documentId, null);
	}
	setAutosaveHeld(documentId, false);
	/*
	 * THE EPOCH BUMPS AFTER THE WRITE LANDS (code review round 5, R5-3). Round 3's
	 * gate did this, and the apply-side guard reads that counter, so leaving it alone
	 * made the guard inert for saves: a check that started before this write could
	 * still apply the version the write just superseded. It is bumped HERE rather than
	 * before the write so this save's own post-write checks compare against the epoch
	 * it began with - the write has landed, and everything it owes (the baseline, the
	 * store commit, the fact) is already done.
	 */
	cancelPendingWrites(documentId);
	return { status: "written", mtimeMs, replaced };
}

/**
 * Close a document: flush what should be written, keep what must not be lost.
 *
 * I5. The commit is the port the editor registered, and it is an upsert - which is
 * why it works even when the document has already left `canvasState.files`, the case
 * R4-7 measured (closing a tab removes it from that list BEFORE the cleanup runs, so
 * a commit that mapped over the list did nothing).
 *
 * The dirty flag is deliberately NOT cleared here while the document is held: the
 * fact is still true, and a following activation must not apply the file's version
 * over the reader's words (R4-1).
 */
export function closeBuffer(documentId: string): void {
	const entry = buffers.get(documentId);
	if (!entry) return;
	entry.closed = true;
	const committed = entry.serialize ? entry.serialize().text : entry.token;
	if (dirtyOf(entry)) {
		void saveBuffer(documentId)
			.catch(() => {
				/* Refused or failed: the fact is raised and the buffer stays. */
			})
			.finally(() => {
				entry.commit?.(committed, entry.baselineMtime ?? null);
			});
		return;
	}
	entry.commit?.(committed, entry.baselineMtime ?? null);
}

/**
 * Forget every buffer. Exists for the headless suite, which drives this module in a
 * process that outlives one document's lifetime.
 */
export function resetBuffers(): void {
	buffers.clear();
}

/** Drop the entry entirely: the panel is gone and nothing is pending. */
export function forgetBuffer(documentId: string): void {
	const entry = buffers.get(documentId);
	if (!entry) return;
	if (dirtyOf(entry)) return;
	buffers.delete(documentId);
}
