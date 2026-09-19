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
 *   document commits the buffer to the store's copy of it if that document is still
 *   open - never by re-listing a document the reader closed, which is what an
 *   append here does (see `commitCanvasDocument`).
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
	/**
	 * The last bytes this buffer materialised, and the token they were built from.
	 *
	 * Written where `serialize` is ALREADY called - a save and a close - and never
	 * while a component renders: `serialize` exists precisely because building a
	 * workbook is too expensive to do on every edit, and a projection that called it
	 * from render would undo that. The token is compared before the text is used, so
	 * a cached text is never handed out for words it was not built from.
	 */
	materialised?: { token: string; text: string };
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
 * The store's copy of a document that is OPEN - and nothing else.
 *
 * A commit is the buffer owner's handoff of a document's current bytes and the
 * mtime they were derived from, and it has one job: keep the store's copy of an
 * OPEN document equal to what the reader sees. A document that is not in `files`
 * is not open - the reader closed its tab - so there is nothing to keep equal,
 * and APPENDING it back is how a closed tab returned from the dead. That append
 * ran from the viewer's own unmount cleanup, which fires AFTER the close removed
 * the document, so every close immediately re-opened what it had just closed:
 * the flicker the reader reported, and the reason `files` is the list that
 * decides both the strip and the pane.
 *
 * WHY AN UPDATE RATHER THAN A MAP OVER A SNAPSHOT (the case R4-7 named, kept):
 * the editors' unmount commits used to map over a `canvasState.files` they had
 * read earlier, so a commit that raced another store write dropped it - and on
 * the close path it matched nothing at all, because the close had already
 * removed the document. `updateOneFile` maps INSIDE the store's own `set` and is
 * a no-op for an id that is not listed, which is exactly the stance this needs.
 *
 * WHERE THE READER'S UN-WRITTEN WORDS GO INSTEAD. Not here, and not into `files`:
 * they stay in the buffer owner, which is the only thing that knows them, and
 * `documentsForCanvas` puts them back on screen if the same document is opened
 * again. That function states the promise in full.
 */
export function commitCanvasDocument(
	conversationId: string,
	document: CanvasDocument,
): void {
	const state = useCanvasStore.getState();
	const conversation = state.conversations[conversationId];
	/*
	 * NOT LISTED MEANS NOT OPEN, and a document that is not open has no store copy
	 * to keep current. This is the whole fix for the reported tab, stated in one
	 * line, and it is a guard rather than an append on purpose: the append is what
	 * a reader watches a tab they closed come back from.
	 */
	if (!conversation?.files.some((file) => file.id === document.id)) return;
	state.updateOneFile(conversationId, document);
}

const dirtyOf = (entry: BufferEntry): boolean =>
	entry.token !== entry.writtenToken;

/**
 * THE PROJECTION'S VERSION, and why the projection needs one (agent review round
 * 1, M2).
 *
 * `documentsForCanvas` is called from `ChatContent`'s render, so it runs on every
 * render of the chat column - and while any open document holds un-written words
 * (the ordinary state of typing, not a rare one) it used to build a new array and
 * new document objects on every call. Those identities are props: the canvas, the
 * strip, the pane and the mounted editor are all memoised on them, so every
 * parent render re-rendered four surfaces at once, precisely while the reader was
 * typing. Measured before the fix: identities stable on a clean store, unstable
 * after one `proposeBuffer`.
 *
 * So the projection is CACHED, and this counter is its only invalidator. It is
 * bumped by every mutation that can change what the projection hands out: the
 * buffer's own words (`token`), whether they differ from the file's (`publishDirty`
 * covers every write of either), the bytes materialised for those words, and the
 * entry's existence in the map at all. Between two such changes the same input
 * array returns the SAME output array by identity, however many renders happen in
 * between - which is the property the memoised consumers need, and the property
 * that made this worth fixing rather than merely noting.
 *
 * The input-array identity is checked too, because the store's documents are the
 * other half of the projection's input: a store write produces a new array
 * (`updateOneFile` maps inside `set`), so a fresh input can never be answered from
 * a stale cache. Nothing here mutates the input or the cache: the cached entry
 * holds the last input by reference, which is one array and its documents.
 */
let projectionRevision = 0;
let cachedProjection: {
	documents: CanvasDocument[];
	revision: number;
	projected: CanvasDocument[];
} | null = null;

/** Every change to a buffer, whatever it changes, invalidates the projection. */
function projectionChanged(): void {
	projectionRevision += 1;
}
function publishDirty(entry: BufferEntry): void {
	projectionChanged();
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

/**
 * The documents as the canvas should RENDER them: where the buffer owner still
 * holds words of its own, those are the document.
 *
 * WHAT THIS IS FOR, in the shape of the case that needs it. A close whose write
 * the gate REFUSED (the file moved on disk under the reader, or is missing, or
 * cannot be looked at) must not drop the words the reader typed, and the tab
 * said it closed - so `files` no longer lists the document and no comment there
 * can carry them. They are not lost: `closeBuffer` leaves the buffer, dirty and
 * held, in this module. What was missing is a way BACK to them, because opening
 * a document again goes through the files grid, whose click handler re-reads the
 * FILE and REPLACES the entry ("the entry on screen may hold stale bytes from an
 * earlier read of the same file"), so the store's copy is the file's version and
 * the editor mounts from it.
 *
 * So the words win here, at the one place the store's open documents become the
 * canvas's documents: a document whose buffer holds un-written words is handed
 * over as those words, at the mtime they were derived from - which is the truth
 * about the version on screen, and what makes the freshness check report the
 * file as moved on rather than as current. The dirty and held registries are
 * untouched, so the write gate still refuses the file's version over them.
 *
 * THE PROMISE, so it is stated once and can be argued with: the words survive
 * the close and are back on screen when the same PATH is opened again IN THIS
 * SESSION. They do not survive an app restart - the registry is module state -
 * and that is the pre-existing shape of the hold rather than something a close
 * adds: an OPEN held document loses the same words at the same moment, because
 * the two registries that protect them die with the process while the store's
 * bytes do not.
 *
 * WHAT THIS IS NOT. It is not a second `files`: the list it walks is still the
 * open documents, it never adds one, and a document with nothing un-written is
 * handed over as the store's own object. It is a projection over the READ, which
 * is why it can read module state the store cannot observe - and why the same
 * input array comes back by identity when nothing is projected, so a canvas with
 * no un-written words renders exactly as it did before.
 */
export function documentsForCanvas(
	documents: CanvasDocument[],
): CanvasDocument[] {
	/*
	 * SAME INPUTS, SAME ARRAY (agent review round 1, M2). Without this the memoised
	 * canvas subtree was handed fresh identities on every parent render while any
	 * document was dirty; see `projectionRevision` above for why that is worth a
	 * cache rather than a note. Both halves are checked: the input array's identity,
	 * because the store's documents are the other half of the input, and the
	 * registry's revision, because the buffers are the half the store cannot see.
	 */
	if (
		cachedProjection &&
		cachedProjection.documents === documents &&
		cachedProjection.revision === projectionRevision
	) {
		return cachedProjection.projected;
	}
	const projected = projectDocumentsForCanvas(documents);
	cachedProjection = { documents, revision: projectionRevision, projected };
	return projected;
}

function projectDocumentsForCanvas(
	documents: CanvasDocument[],
): CanvasDocument[] {
	let projected: CanvasDocument[] | null = null;
	documents.forEach((document, index) => {
		const entry = buffers.get(document.id);
		if (!entry || !dirtyOf(entry)) return;
		/*
		 * A surface whose bytes are expensive to build (the grid's workbook) hands over
		 * only what was ALREADY materialised for these exact words, i.e. at a save or a
		 * close - which is where a held document's words come from. Nothing is built
		 * here: this runs inside a render.
		 */
		const text = entry.serialize
			? entry.materialised?.token === entry.token
				? entry.materialised.text
				: null
			: entry.token;
		if (text === null) return;
		/* The store already holds these words: the projected document would be a
		 * copy of it, and a new object identity per render for nothing. */
		if (text === document.content) return;
		if (!projected) projected = [...documents];
		projected[index] = {
			...document,
			content: text,
			readMtimeMs: entry.baselineMtime,
		};
	});
	return projected ?? documents;
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
	/* The bytes are materialised now, so the projection can hand them out without
	 * building them again - see `materialised`. The token is the one these bytes came
	 * from, so a keystroke that lands during the awaits below invalidates the cache
	 * rather than mislabelling it. */
	entry.materialised = { token: sent, text };
	/* The bytes the projection will hand out just changed, without a dirty-state
	 * change of their own (the caller publishes that separately). */
	projectionChanged();
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
 * WHAT A CLOSE DID WITH THE WORDS, which is the half that used to be discarded.
 *
 * `keptWords` is true when the buffer still holds words the file does not after the
 * flush has settled - a write that was refused (the file moved on disk under the
 * reader), failed, or was superseded leaves the buffer dirty, and a write that
 * landed makes it clean. The reader-facing half of this is `close-report.ts`; the
 * distinction lives here because this module is the only one that knows.
 */
export type CloseBufferOutcome = {
	keptWords: boolean;
};

/**
 * Close a document: flush what should be written, keep what must not be lost, and
 * REPORT which of the two happened.
 *
 * I5. The commit is the port the editor registered, and it hands the store the
 * words THIS buffer holds. Whether that document is still open is the store's
 * question, not this one's: the close path has already taken it out of `files`
 * (which is why a commit that mapped over a snapshot matched nothing at all -
 * the case R4-7 measured), and re-listing it there is the reader's closed tab
 * coming back. When the write is refused the words stay HERE - dirty and held -
 * and `documentsForCanvas` puts them back on screen if the document is opened
 * again in this session.
 *
 * The dirty flag is deliberately NOT cleared here while the document is held: the
 * fact is still true, and a following activation must not apply the file's version
 * over the reader's words (R4-1).
 *
 * THE OUTCOME IS RETURNED RATHER THAN SWALLOWED (UX round 1, U1). The refused arm
 * used to end in `.catch(() => {})` with its fact raised into a freshness row that
 * has, by then, unmounted with the document - so the reader was told nothing at
 * exactly the moment they needed to be told. The fact is still raised (it is what
 * the row says if the document is opened again), and the outcome now also reaches
 * whoever asked for the close, which is how the reader gets a sentence about it.
 */
export async function closeBuffer(
	documentId: string,
): Promise<CloseBufferOutcome> {
	const entry = buffers.get(documentId);
	if (!entry) return { keptWords: false };
	entry.closed = true;
	const committed = entry.serialize ? entry.serialize().text : entry.token;
	/* The close materialises the bytes anyway, so they are cached for the projection
	 * (the words a refused write leaves on screen are handed back from here). */
	entry.materialised = { token: entry.token, text: committed };
	projectionChanged();
	if (dirtyOf(entry)) {
		await saveBuffer(documentId).catch(() => {
			/* Refused or failed: the fact is raised and the buffer stays. */
		});
		entry.commit?.(committed, entry.baselineMtime ?? null);
		/*
		 * Read AFTER the flush: a write that landed cleared the dirty flag, and every
		 * arm that did not (refused, failed, superseded by a resolution) left it set,
		 * which is exactly "these words are still only here".
		 */
		return { keptWords: dirtyOf(entry) };
	}
	entry.commit?.(committed, entry.baselineMtime ?? null);
	return { keptWords: false };
}

/**
 * Forget every buffer. Exists for the headless suite, which drives this module in a
 * process that outlives one document's lifetime.
 */
export function resetBuffers(): void {
	buffers.clear();
	projectionChanged();
}

/** Drop the entry entirely: the panel is gone and nothing is pending. */
export function forgetBuffer(documentId: string): void {
	const entry = buffers.get(documentId);
	if (!entry) return;
	if (dirtyOf(entry)) return;
	buffers.delete(documentId);
	projectionChanged();
}
