import type { CanvasDocument } from "@features/chat/types/canvas";
import { READ_ENCODING, viewerFor } from "@features/chat/utils/viewer-routing";
import type { ProbedFile } from "../../../../../../shared/desktop-contract";

/**
 * Keeping an open document's bytes current with the file on disk.
 *
 * WHY mtime AND NOT A WATCHER. A canvas document is a path on this machine, and
 * the things that rewrite it do not all announce themselves in a way a watcher
 * can use: an agent's tool call writes through a Python process, an editor saves
 * by writing a temporary file and renaming it over the original (so the inode
 * `fs.watch` is holding disappears), and a shell pipeline truncates and rewrites
 * in place. `fs.watch` also costs a descriptor per open tab and behaves
 * differently on every platform. The modification time is the one signal all of
 * those share, it is already resolved by main (`probe-files` returns `mtimeMs`
 * from `statSync`), and one probe answers both "did it change" and "when was it
 * last changed" - and the second is on screen.
 *
 * WHY THE POLL IS NOT THE ONLY TRIGGER. Polling every open tab would spend a
 * stat per tab per tick on files nobody is looking at, and the panel's whole
 * point is that the document you are READING is the one worth spending on. So
 * the checks are: activation (the tab or the view becoming the one on screen,
 * and the window coming back to the front - which is exactly when your eye
 * returns to the file), plus a slow poll for the one document that is on screen
 * while the window is visible.
 *
 * WHAT THIS FILE IS NOT. No React, no store, and no decisions taken from a
 * clock: the rule below is a function of a document and a probe answer, the
 * runner takes its probe and read as ports, and the dirty registry is module
 * state. That is what lets `scripts/canvas-file-freshness.test.mjs` drive every
 * branch - including the two-read race and the dirty suppression - against the
 * shipped code rather than against a re-implementation of it. The one function
 * that does touch the preload bridge is `probeLocalFile`, and it exists because
 * three call sites would otherwise each write the same three-line guard.
 */

/** What a single check decided, before any bytes move. */
export type FreshnessDecision =
	/** Nothing to do: the probe cannot answer, or answers with our own mtime. */
	| { kind: "unavailable" }
	| { kind: "unchanged" }
	/** The path resolves to nothing: the viewer has to say so. */
	| { kind: "missing" }
	/*
	 * The probe could not LOOK - a permission bit, a broken mount. It reports
	 * `exists: false` like a deleted file does, and the contract's own note says
	 * why the two must not be conflated: "deleted" and "cannot look" deserve
	 * different words on screen, and a reader told their file is gone will go and
	 * look for a file that is sitting right there (QA round 1, Q1).
	 */
	| { kind: "unreadable" }
	/**
	 * A viewer that reads its own bytes (PDF, image, audio, video). Nothing is
	 * read here: the object URL is cached under `file:<path>:<mtime>`, so moving
	 * the mtime the document carries IS the re-read - the viewer asks again with
	 * a new key and gets a new blob.
	 */
	| { kind: "repoint" }
	/** Text the store holds: re-read the path through its own encoding. */
	| { kind: "reload"; encoding: "utf-8" | "base64" }
	/**
	 * The document has no baseline: it was created here, opened through the OS
	 * dialog, or restored from a version of this store that predates the field.
	 * Adopting the probe's mtime is deliberate and is the conservative half of
	 * the trade - see `freshnessDecision`.
	 */
	| { kind: "adopt" };

/**
 * The mtime the held bytes were read at, as far as anything here can tell.
 *
 * `readMtimeMs` is the field this change adds, and the reason it is not
 * `lastAgentModified` is that the two answer different questions. That field is
 * the blob cache's KEY, and it is written by paths that are not probes at all -
 * `file-attachment.tsx` stamps `Date.now()` on a document it has just attached,
 * which is a wall-clock instant with no relation to the file's metadata. A
 * baseline taken from it would be a time in the future, and a file written after
 * it would never look new. So the baseline is its own field, only ever written
 * from a probe answer.
 */
const baselineOf = (document: CanvasDocument): number | undefined =>
	document.readMtimeMs;

/**
 * What to do about one document, given one probe answer.
 *
 * `!==` RATHER THAN STRICTLY NEWER, and this is the one place the difference
 * shows. A file's mtime can move BACKWARDS in ordinary use: `git checkout` of an
 * older revision, `cp -p` or a `rsync -t` that preserves the source's time, an
 * archive extraction, or a writer whose clock is behind this machine's (a
 * container, a network mount). Under a strictly-newer test every one of those
 * leaves the panel showing bytes the file no longer has, for as long as it takes
 * the file to be written again - and it does it silently, which is the failure
 * this whole change exists to remove. `!==` re-reads in those cases, which is
 * the cheap and correct direction: the read is one `readFile` and the apply is
 * suppressed below when the bytes turn out to be identical.
 *
 * The case neither test can see is a write that leaves the mtime EXACTLY as it
 * was - two writes inside one filesystem tick, or a producer that restores the
 * timestamp deliberately. That is what the refresh control is for, and it is why
 * the control exists at all.
 *
 * NO BASELINE ADOPTS RATHER THAN READS. A document with no `readMtimeMs` is one
 * whose bytes were never read by a path that took a probe: created here (its
 * content is the empty string it was created with), opened through the OS
 * dialog, or restored from a persisted store written before this field existed.
 * Re-reading all of those on first sight would rewrite every restored buffer on
 * the first tick after an upgrade, for a file nobody has touched - the surprise
 * this feature must not introduce. Adopting costs exactly one thing: a write
 * that landed between the content being read and the first check is not picked
 * up until the file changes again.
 */
export function freshnessDecision(
	document: CanvasDocument,
	probe: ProbedFile | null | undefined,
): FreshnessDecision {
	if (!probe) return { kind: "unavailable" };
	// The error is checked FIRST: a failed `stat` answers `exists: false` too, and
	// reporting a permission error as a deleted file is the one wrong word here.
	if (probe.error) return { kind: "unreadable" };
	if (!probe.exists || !probe.isFile) return { kind: "missing" };
	const mtimeMs = probe.mtimeMs;
	if (mtimeMs === null) return { kind: "unavailable" };
	const baseline = baselineOf(document);
	if (baseline === undefined) return { kind: "adopt" };
	if (baseline === mtimeMs) return { kind: "unchanged" };
	const encoding =
		READ_ENCODING[viewerFor(document.path, document.type) ?? "code"];
	if (encoding === "utf-8" || encoding === "base64")
		return { kind: "reload", encoding };
	// `bytes` and `range` are the viewers that hold their own object URL or
	// stream. `video-preview` is the one that also needs the element itself
	// re-mounted, which it does off the same mtime.
	return { kind: "repoint" };
}

/** The bytes of one text document, or the reason there are none. */
export type FreshnessReadResult =
	| { ok: true; content: string }
	| { ok: false; error: string };

export type FreshnessPorts = {
	/** One path, through the existing batched probe. `null` when there is no bridge. */
	probe: (path: string) => Promise<ProbedFile | null>;
	/** Text bytes, through the same `read-file` the click path uses. */
	read: (
		path: string,
		encoding: "utf-8" | "base64",
	) => Promise<FreshnessReadResult>;
};

export type FreshnessOutcome =
	/** The probe answered with the mtime the held bytes were read at. */
	| { status: "unchanged" }
	/** No bridge, or a probe answer that cannot be used. */
	| { status: "unavailable" }
	/** A mounted editor has unsaved changes for this document, so nothing was
	 * applied. EVERY check probes, forced or not: a background tick that skipped
	 * the probe could not tell the reader that the file moved on underneath their
	 * typing, which is the one thing this state exists to say (UX round 1, U1). A
	 * tick that finds the file unmoved costs one `stat` and says nothing.
	 */
	| {
			status: "skipped-dirty";
			diskChanged: boolean;
			/**
			 * The file is not there, or cannot be looked at, WHILE the buffer is dirty
			 * (QA round 3, Q12). Both used to be clean-document-only facts, so a reader
			 * typing into a file an agent had deleted was told "your edits are kept"
			 * against an `ENOENT` for as long as they looked at it. They are raised from
			 * this outcome now, and neither blocks the reader's route out: an explicit
			 * save still writes.
			 */
			missing: boolean;
			unreadable: boolean;
	  }
	| { status: "missing"; document: CanvasDocument }
	/** The probe's `stat` itself failed: the file may well be there. */
	| { status: "unreadable"; document: CanvasDocument }
	| { status: "adopted"; document: CanvasDocument }
	/** The mtime moved and the bytes did not: the baseline advances, nothing repaints. */
	| { status: "identical"; document: CanvasDocument }
	| { status: "applied"; document: CanvasDocument }
	/** The re-read failed (permissions, a vanished file, an oversized file). */
	| { status: "failed"; error: string };

/**
 * The document as it stands after a probe we are NOT re-reading for.
 *
 * Used for the three outcomes that learn facts without reading bytes: adopting a
 * baseline, advancing past an mtime whose bytes turned out to be identical, and
 * the repoint a bytes viewer needs. `lastAgentModified` moves for the repoint
 * (that is the blob cache key, and moving it is the re-read) and for the
 * identical case (the controller in `wysiwyg-markdown-editor` re-reads the
 * document it is handed off that field, so a markdown document whose file was
 * touched without changing must still be told that the version on screen is the
 * file's current version). It does NOT move for the adopt case, where the point
 * is precisely to leave the document's own view of itself alone.
 */
function withProbeFacts(
	document: CanvasDocument,
	probe: ProbedFile,
	{ moveBlobKey }: { moveBlobKey: boolean },
): CanvasDocument {
	const next: CanvasDocument = {
		...document,
		availability: "present",
		readMtimeMs: probe.mtimeMs ?? undefined,
	};
	if (probe.sizeBytes !== null) next.sizeBytes = probe.sizeBytes;
	if (moveBlobKey && probe.mtimeMs !== null) {
		next.lastAgentModified = probe.mtimeMs;
	}
	return next;
}

/** The document after a successful re-read of its text bytes. */
function withFreshContent(
	document: CanvasDocument,
	probe: ProbedFile,
	content: string,
): CanvasDocument {
	return {
		...withProbeFacts(document, probe, { moveBlobKey: false }),
		content,
		/*
		 * A CLOCK VALUE, not the file's mtime, and the why is one editor's reload
		 * rule. `wysiwyg-markdown-editor` repaints the document it is handed when
		 * `lastAgentModified` CHANGES (its content lives in a contenteditable, so
		 * the prop alone is not enough), and it is the only signal a markdown
		 * document has: the code editor and the spreadsheet re-read on
		 * `content`. A forced re-read is exactly the case where the bytes moved
		 * and the mtime did NOT - the file's timestamp was restored, two writes
		 * landed in one filesystem tick - so the mtime cannot carry the signal
		 * there, and the store would hold new bytes under a screen showing the
		 * old ones. The file's own truth is still `readMtimeMs`; this field means
		 * "these bytes changed", which is what its name has always meant and what
		 * `file-attachment.tsx` already writes `Date.now()` into it for.
		 */
		lastAgentModified: Date.now(),
	};
}

/**
 * Per-document "a mounted editor is holding unsaved changes".
 *
 * WHY A REGISTRY AND NOT A FLAG THE RUNNER READS OFF THE DOCUMENT. The editors
 * hold their buffer in component state and write to disk on a debounce
 * (`code-editor` at 1000ms, `wysiwyg-markdown-editor` at 3000ms), so for that
 * window the store's `content` and the screen disagree - and the store's copy is
 * the STALE one. An automatic apply landing in that window would replace what
 * the user is typing with the file's older bytes, and the editor's own pending
 * save would then write those bytes to disk: a silent data loss with no error
 * anywhere. The store cannot answer this question, because the store is what the
 * typing has not reached yet, so the editors publish it and the runner consults
 * it. Each editor clears its own flag the moment it has no unsaved changes, and
 * on unmount, so a closed document can never leave a stale suppression behind.
 */
const dirtyDocuments = new Set<string>();
const dirtyListeners = new Set<() => void>();

function publishDirtyChange(): void {
	for (const listener of dirtyListeners) listener();
}

/** Publish that a document's buffer differs from the file on disk. */
export function setDocumentDirty(documentId: string, dirty: boolean): void {
	const had = dirtyDocuments.has(documentId);
	if (dirty === had) return;
	if (dirty) dirtyDocuments.add(documentId);
	else dirtyDocuments.delete(documentId);
	publishDirtyChange();
}

/** Called by an editor as it unmounts, so a closed tab cannot leave a suppression. */
export function clearDocumentDirty(documentId: string): void {
	setDocumentDirty(documentId, false);
}

export function isDocumentDirty(documentId: string): boolean {
	return dirtyDocuments.has(documentId);
}

/** Subscribe to the registry, for `useSyncExternalStore` in the bar. */
export function subscribeDocumentDirty(listener: () => void): () => void {
	dirtyListeners.add(listener);
	return () => {
		dirtyListeners.delete(listener);
	};
}

/*
 * ---------------------------------------------------------------------------
 * The autosave hold, and the explicit save that overrides it
 * ---------------------------------------------------------------------------
 *
 * WHY A HOLD EXISTS AT ALL (UX round 2, U1's second half). Once the row has told
 * a reader that the file changed on disk while their buffer has unsaved edits,
 * the editor's own debounced autosave is the one thing that can destroy the
 * question: ~1s later it writes the reader's bytes over the file's, the external
 * version is gone from disk, and the sentence is about a change that no longer
 * exists anywhere - the reader cannot load it even if they want to, and nothing
 * records that it was ever there. Measured, before this: the fact appeared at
 * 456ms and the autosave landed at 2627ms with the external bytes gone.
 *
 * So the hold is a NEGATIVE registry, like the dirty one: a document whose
 * "changed on disk" fact stands keeps its buffer in memory and does not write,
 * and the reader's two real choices are the row's control (load the file, let
 * their edits go) or an EXPLICIT save (their bytes win - which the row then says
 * plainly). Nothing else releases it, and in particular no timer does: the fact
 * is cleared by an action or by the file's mtime coming back to the baseline,
 * never by a tick that merely happened.
 *
 * THE COST, stated here because it is real: while a document is held, the
 * reader's typing exists only in memory, so a crash in that window loses it.
 * That is the price of not destroying the file's version behind their back, and
 * it is disclosed in the pull request rather than left for someone to discover.
 */
const heldAutosave = new Set<string>();

/** Whether this document's debounced autosave is being held. */
export function isAutosaveHeld(documentId: string): boolean {
	return heldAutosave.has(documentId);
}

/**
 * Hold or release a document's autosaves. Exported for the buffer owner, which is
 * the thing that decides why a hold exists; the runner still sets it from the
 * dirty-tick's own reading, so the two agree by construction rather than by
 * convention.
 */
export function setAutosaveHeld(documentId: string, held: boolean): void {
	if (held) heldAutosave.add(documentId);
	else heldAutosave.delete(documentId);
}

/*
 * ---------------------------------------------------------------------------
 * THE FACTS, THE WRITE EPOCH, AND THE WRITE GATE
 * ---------------------------------------------------------------------------
 *
 * WHY THE FACTS MOVED INTO A REGISTRY (QA round 3, Q11). They used to live in
 * the hook's own state, which meant they died with the component: closing a tab
 * or leaving the chat route dropped the sentence, the hold and the reason the
 * reader's buffer was not on disk. The buffer itself now survives that (the
 * editors commit it to the store on unmount), so the fact has to survive it too -
 * otherwise a reader who comes back sees a document that disagrees with the file
 * and no explanation, which is worse than the silent loss it replaced. Same
 * registry shape as the dirty set: module-level, per document, subscribable, so
 * the row and the editors read one source.
 */
export type FreshnessFact =
	| "missing"
	| "unreadable"
	| "failed"
	| "disk-changed"
	| "save-replaced";

const documentFacts = new Map<string, FreshnessFact>();
const factListeners = new Set<() => void>();

export function documentFact(documentId: string): FreshnessFact | null {
	return documentFacts.get(documentId) ?? null;
}

export function setDocumentFact(
	documentId: string,
	fact: FreshnessFact | null,
): void {
	if (fact === null) documentFacts.delete(documentId);
	else documentFacts.set(documentId, fact);
	for (const listener of factListeners) listener();
}

export function subscribeDocumentFact(listener: () => void): () => void {
	factListeners.add(listener);
	return () => {
		factListeners.delete(listener);
	};
}

/**
 * The write epoch: how a resolution cancels the write a debounce already started.
 *
 * THE RACE THIS EXISTS FOR (UX round 3, U9). A press that means "load the file's
 * version" can land in the same millisecond as the editor's own pending write,
 * and the ordering decides whether the reader sees the file or their own stale
 * bytes land on top of it. The gate below refuses any write whose file has moved
 * on since the baseline - which is the protection - and this is the belt to that
 * braces: `load` bumps the epoch before it reads, and any save that captured an
 * older epoch abandons itself instead of writing, whatever the filesystem says.
 */
const writeEpochs = new Map<string, number>();

export function currentWriteEpoch(documentId: string): number {
	return writeEpochs.get(documentId) ?? 0;
}

/**
 * Cancel every write already started for this document.
 *
 * The HOLD IS DELIBERATELY LEFT ALONE: cancelling a write says nothing about
 * whether the document may write next time, and a resolution that fails still
 * needs the hold standing (round 2 released it here, which would have let the
 * next autosave run over a file the reader had just been told about).
 */
export function cancelPendingWrites(documentId: string): void {
	writeEpochs.set(documentId, currentWriteEpoch(documentId) + 1);
}

/**
 * The hold cleanup an editor's unmount owes the registry (code review round 3).
 *
 * Called AFTER the editor has committed its buffer to the store, so releasing the
 * hold here cannot lose anything: the words are in the persisted store, and the
 * fact (which also survives now) is what tells the reader on their return that
 * the file on disk is not what they are looking at. The dirty flag is deliberately
 * KEPT for a held document - that is the state the fact is about - and cleared
 * for every other one, which is what the registry's own cleanup has always done.
 */
export function releaseDocumentHold(documentId: string): void {
	/*
	 * THE EPOCH IS NOT TOUCHED (code review round 4, R4-2). This used to DELETE it,
	 * which reset the counter to zero: every save in flight - including the flush
	 * this very cleanup had just started - then failed its own epoch comparison and
	 * abandoned itself, so the reader's last second of typing never landed on a
	 * document that had ever been saved before. Cancelling a write belongs to the
	 * resolution that means it (`cancelPendingWrites`, called by the control's load),
	 * and releasing a hold says nothing about writes at all.
	 */
	setAutosaveHeld(documentId, false);
}

/**
 * ONE WRITE PATH, GATED ON THE FILE (QA round 3, Q9; code review round 3, A).
 *
 * Every editable surface writes through this: the code editor, the markdown
 * WYSIWYG, the spreadsheet, the HTML viewer's edit mode (which IS the code
 * editor), and the inline-edit finalizer. Before a single byte leaves the app it
 * stats the document's path and compares the file's mtime with the mtime the
 * held content was read at:
 *
 * - **the mtime matches the baseline** → the write proceeds, and the baseline
 *   advances to the mtime the write produced, exactly as before;
 * - **the mtime has moved** → **no write happens**. The sticky `disk-changed` fact
 *   is raised and the document's further autosaves are held, so the reader's
 *   route out is a decision (their bytes, or the file's) rather than a race.
 *
 * WHY THE GATE AND NOT THE POLL. The poll is a 2s timer; the editors' debounces
 * are 1s (code) and 3s (markdown, spreadsheet). A file rewritten on disk shortly
 * before the reader's own debounce fires was therefore overwritten by the app's
 * own save BEFORE any probe could read it - QA measured 5 of 8 orderings
 * destroyed silently, and no fact raised, because the save then recorded its own
 * mtime as the baseline. A timer cannot fix a race it is slower than; a check
 * inside the write can, and it costs one `stat` per write rather than per 2s.
 *
 * AN EXPLICIT SAVE IS NEVER REFUSED (Q10, and the sentence's own promise): the
 * reader's bytes win, and because they have just replaced a version that had
 * changed the fact converts to `save-replaced` instead of vanishing. That is the
 * one case where the reader is told their write overwrote something.
 *
 * A FILE THAT IS GONE is its own refusal: an autosave does not resurrect a file
 * the reader has not decided about - the `missing` fact is raised instead, and an
 * explicit save still writes (which is how the reader gets their content back).
 */
export type DocumentWritePorts = {
	probe: (path: string) => Promise<ProbedFile | null>;
	write: (
		path: string,
		content: string,
		encoding?: "utf-8" | "base64",
	) => Promise<void>;
};

/*
 * THE ROUND-3 GATE THAT TOOK THE CALLER'S BYTES IS GONE (code review rounds 4 and 5,
 * R5-2). `saveDocument(document, content, ...)` was a second, exported, tested
 * implementation of the same gate whose signature was the round-4 harms' whole cause:
 * it wrote whatever text the caller passed, so a stale snapshot or another document's
 * buffer reached a file through it. `document-buffers.ts` is the one writer now, and
 * its gate reads the text from the buffer it owns. Nothing in `src/` called this; four
 * tests did, and they are gone with it.
 */
/**
 * The answer for a check that found a mounted editor's unsaved buffer.
 *
 * TWO THINGS DEPEND ON THIS BEING A PROBE AND NOT A SHORTCUT. The reader's
 * question is "has the file moved on underneath me", and only a `stat` answers
 * it - the store still holds the bytes from before the first keystroke, so a
 * check that read the store would answer "nothing has changed" about a file that
 * has. And a tick that finds the file unmoved costs exactly one `stat` and
 * writes nothing anywhere, which is what makes probing on every dirty tick
 * affordable at all (UX round 1, U1).
 *
 * `known` is the probe a caller already has in hand, so the second ask inside
 * one run does not stat twice.
 */
async function dirtyOutcome(
	document: CanvasDocument,
	ports: FreshnessPorts,
	known?: ProbedFile | null,
): Promise<FreshnessOutcome> {
	const probe = known ?? (await ports.probe(document.path));
	const baseline = baselineOf(document);
	const unreadable = Boolean(probe?.error);
	const missing = probe !== null && !probe.exists && !unreadable;
	const diskChanged = Boolean(
		probe?.exists && probe.mtimeMs !== null && probe.mtimeMs !== baseline,
	);
	/*
	 * The hold follows the state, in both directions and in one place: a dirty
	 * document whose file moved on, or vanished, or cannot be looked at stops
	 * writing, and a dirty document whose file came back to the baseline starts
	 * again (nothing was lost, so nothing needs holding). Set here rather than by
	 * the callers so the runner's decision and the editor's behaviour cannot
	 * disagree.
	 */
	setAutosaveHeld(document.id, diskChanged || missing || unreadable);
	return { status: "skipped-dirty", diskChanged, missing, unreadable };
}
export function createFreshnessRunner(
	ports: FreshnessPorts,
	isDirty: (documentId: string) => boolean = isDocumentDirty,
) {
	const inFlight = new Map<string, Promise<FreshnessOutcome>>();

	const run = async (
		document: CanvasDocument,
		{
			force,
			applyOverDirty = false,
		}: { force: boolean; applyOverDirty?: boolean },
	): Promise<FreshnessOutcome> => {
		if (!applyOverDirty && isDirty(document.id))
			return dirtyOutcome(document, ports);
		const probe = await ports.probe(document.path);
		/*
		 * AND AGAIN IF IT BECAME DIRTY WHILE WE WERE LOOKING (code review round 1,
		 * M3). The gate above is read at the top of the run; the probe and, below,
		 * the read are awaits, and a keystroke that lands inside one of them makes
		 * the buffer dirty while this check is already committed to replacing it.
		 * Reproduced against this module: `setDocumentDirty(id, true)` during a
		 * gated read, then release, and the file's bytes were applied over the
		 * typing. The reader's characters never reached disk and were gone from the
		 * screen, which is the one outcome this feature must never produce.
		 *
		 * So the registry is asked a second time, immediately before any outcome
		 * that carries bytes back into the store.
		 */
		if (!applyOverDirty && isDirty(document.id))
			return dirtyOutcome(document, ports, probe);
		let decision: FreshnessDecision | { kind: "bust" } = freshnessDecision(
			document,
			probe,
		);
		/*
		 * A FORCED check is the control's own promise: read again even though the
		 * file's metadata says nothing has changed. That is the case the control
		 * exists for - a write that left the mtime where it was - and it is why the
		 * control cannot simply re-run the ordinary decision.
		 */
		if (force && decision.kind === "unchanged") {
			const encoding =
				READ_ENCODING[viewerFor(document.path, document.type) ?? "code"];
			decision =
				encoding === "utf-8" || encoding === "base64"
					? { kind: "reload", encoding }
					: { kind: "bust" };
		}
		if (decision.kind === "unavailable") return { status: "unavailable" };
		if (!probe) return { status: "unavailable" };
		if (decision.kind === "missing") {
			/*
			 * The baseline is deliberately NOT moved here. A file that is gone and
			 * comes back is a new file to this panel, and the bytes that come back
			 * may be anything - including the same mtime, if it was restored from a
			 * backup that preserved one.
			 */
			return {
				status: "missing",
				document: { ...document, availability: "missing" },
			};
		}
		if (decision.kind === "unreadable") {
			/*
			 * The file may be sitting right there; what failed was the look. The held
			 * bytes and the baseline both stay as they are, because nothing was learned
			 * about either - and `availability` is left alone rather than set to
			 * "missing", which would push "No longer on disk" onto the tile and the tab
			 * for a file that has not gone anywhere (QA round 1, Q1).
			 */
			return { status: "unreadable", document };
		}
		if (decision.kind === "adopt") {
			return {
				status: "adopted",
				document: withProbeFacts(document, probe, { moveBlobKey: false }),
			};
		}
		if (decision.kind === "unchanged") return { status: "unchanged" };
		if (decision.kind === "bust") {
			/*
			 * A forced re-read of a viewer that holds its own bytes, where the mtime
			 * did not move. There is nothing to read in the renderer - the object URL
			 * IS the bytes, and it is cached under `file:<path>:<mtime>` - so the way
			 * to make the viewer ask again is to move the KEY, and the only value that
			 * can move it without lying about the file is a wall-clock nonce. The
			 * baseline is deliberately left alone: `readMtimeMs` is a fact about the
			 * file, and the file has not changed its timestamp.
			 */
			return {
				status: "applied",
				document: {
					...withProbeFacts(document, probe, { moveBlobKey: false }),
					lastAgentModified: Date.now(),
				},
			};
		}
		if (decision.kind === "repoint") {
			/*
			 * A byte viewer whose mtime moved: the object URL is cached under
			 * `file:<path>:<mtime>`, so moving the KEY is what makes the viewer ask
			 * again. WHY THERE IS NO IDENTICAL-BYTES BACKSTOP HERE, and what it costs:
			 * these bytes never pass through this process, so the only cheap comparison
			 * available is the size the probe already reports - and gating on size would
			 * MISS the case that matters most, an in-place edit that keeps the byte
			 * count. A `touch` therefore costs a full re-read and, for video, a restart
			 * of playback; that is the honest price of not being able to look at the
			 * bytes without pulling them across IPC (code review round 1, m3).
			 */
			return {
				status: "applied",
				document: withProbeFacts(document, probe, { moveBlobKey: true }),
			};
		}
		const read = await ports.read(document.path, decision.encoding);
		if (!read.ok) return { status: "failed", error: read.error };
		/*
		 * THE SECOND ASK (code review round 1, M3), and it is the read that makes it
		 * necessary: reading a large file over IPC is the longest await in this run,
		 * and a keystroke landing inside it must win over the bytes it was racing.
		 * Checked before BOTH byte-carrying outcomes below - the apply and the
		 * identical-bytes baseline move - because either one writes to the store.
		 * `applyOverDirty` is the one caller that has already decided the reader's
		 * bytes may go: see `load` below.
		 */
		if (!applyOverDirty && isDirty(document.id))
			return dirtyOutcome(document, ports, probe);
		/*
		 * THE BACKSTOP. An mtime that moved while the bytes did not is ordinary:
		 * `touch`, a `cp -p` from an identical source, an editor's save with no
		 * change, or a build step rewriting a file with the same output. Applying
		 * the read result unconditionally would replace a document the user is
		 * reading with a byte-identical copy - a repaint, a caret reset in an
		 * editor, and for the markdown editor a full re-render - for no change.
		 * The baseline still advances, because it is now true that the held bytes
		 * are the file's current bytes.
		 */
		if (read.content === document.content) {
			return {
				status: "identical",
				document: withProbeFacts(document, probe, { moveBlobKey: true }),
			};
		}
		return {
			status: "applied",
			document: withFreshContent(document, probe, read.content),
		};
	};

	const check = (
		document: CanvasDocument,
		force = false,
	): Promise<FreshnessOutcome> => {
		const existing = inFlight.get(document.path);
		if (existing) {
			/*
			 * A FORCED check must not be answered by a background one. Joining it
			 * would return "unchanged" for a press that asked for a re-read, which
			 * is the control silently doing nothing - and it is reachable in
			 * ordinary use, because the poll fires every two seconds and a press can
			 * land in one. The read stays singular either way: the forced check
			 * waits for the one in flight to settle and then runs.
			 */
			return force ? existing.then(() => check(document, true)) : existing;
		}
		const started = run(document, { force }).finally(() => {
			inFlight.delete(document.path);
		});
		inFlight.set(document.path, started);
		return started;
	};

	/*
	 * LOAD, the reader's own answer to "the file changed on disk" (UX round 2, U1's
	 * second half; hardened in round 3). One of the two routes the row names: this
	 * one takes the FILE's version and lets the buffer's unsaved edits go, which is
	 * the only way to actually load the change - a save writes over it instead, and
	 * an undo does not make the document clean.
	 *
	 * THREE THINGS HAVE TO HAPPEN IN THIS ORDER (code review round 3, major B; UX
	 * round 3, U9), and round 2's version got the first and third wrong:
	 *
	 * 1. **Cancel the writes already in flight**, before anything is read. A press
	 *    can land in the same millisecond as the editor's own debounce, and the
	 *    ordering decided which version won - QA watched the app's pending write
	 *    destroy the very version the press was loading (and, in the unsettled
	 *    case, land the STALE pre-conflict bytes). The epoch bump makes any save
	 *    that is already past its check abandon itself.
	 * 2. **Read**, and let the read fail honestly: a missing or unreadable file
	 *    changes nothing about what the reader's buffer is worth.
	 * 3. **Clear the dirty registry and the hold only on an outcome that carries
	 *    bytes.** Clearing them up front - which is what round 2 did - meant a
	 *    failed read left the buffer protected by nothing, with its dirty flag
	 *    gone and the next tick free to apply whatever it found.
	 */
	const load = async (document: CanvasDocument): Promise<FreshnessOutcome> => {
		cancelPendingWrites(document.id);
		const outcome = await run(document, {
			force: true,
			applyOverDirty: true,
		});
		if (outcome.status === "applied" || outcome.status === "identical") {
			clearDocumentDirty(document.id);
			setAutosaveHeld(document.id, false);
		}
		return outcome;
	};

	return { check, load };
}

export type FreshnessRunner = ReturnType<typeof createFreshnessRunner>;

/**
 * The document after one of ITS OWN writes, so the next check does not read it
 * back.
 *
 * Every save this panel makes - the editors' debounced writes, a manual save -
 * changes the file's mtime, and without this the next tick would see "newer than
 * what I hold", re-read the file we just wrote, and apply it. The bytes would be
 * identical, so nothing would appear to happen, but the panel would be reading
 * its own writes back forever and the check would be noise. The probe is the
 * only thing that can say what the write's mtime actually is (the renderer
 * cannot stat, and `Date.now()` is not the file's time), so a save is followed
 * by exactly one probe, whose answer becomes the new baseline. `content` is
 * threaded in because the caller is the one holding the bytes it just wrote.
 *
 * A failed probe leaves the previous baseline: the next check then does one
 * ordinary read, which is the correct fallback rather than a suppressed one.
 */
export function documentAfterSelfWrite(
	document: CanvasDocument,
	probe: ProbedFile | null | undefined,
	content: string,
): CanvasDocument {
	if (!probe || !probe.exists || !probe.isFile || probe.mtimeMs === null) {
		return { ...document, content };
	}
	return {
		...withProbeFacts(document, probe, { moveBlobKey: true }),
		content,
	};
}

/**
 * One path, through the app's own batched probe.
 *
 * `null` covers both "no bridge" (a browser build, or the renderer under a bare
 * Vite server - not a fact about the file, and never reported as one) and "the
 * bridge answered nothing", which nothing here can act on either. Callers that
 * need the distinction ask the bridge themselves.
 */
export async function probeLocalFile(path: string): Promise<ProbedFile | null> {
	if (typeof window.api?.probeFiles !== "function") return null;
	const [probe] = await window.api.probeFiles([path]);
	return probe ?? null;
}
