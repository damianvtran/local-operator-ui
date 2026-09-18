import { useCanvasStore } from "@shared/store/canvas-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import type { CanvasDocument } from "../../types/canvas";
import { resetBufferToFile, resolveBuffer } from "./document-buffers";
import {
	type FreshnessFact,
	type FreshnessOutcome,
	createFreshnessRunner,
	currentWriteEpoch,
	documentFact,
	isDocumentDirty,
	probeLocalFile,
	setDocumentFact,
	subscribeDocumentDirty,
	subscribeDocumentFact,
} from "./file-freshness";

/**
 * The canvas's one live document, kept current with the file on disk.
 *
 * WHAT THIS HOOK OWNS. The triggers, the timer and the write back into the
 * store; every decision about WHETHER to re-read lives in `file-freshness.ts`,
 * which is React-free and is what the headless suite drives. The split is the
 * point: a trigger is easy to see in a browser and impossible to assert, while
 * the rule under it is the part that has to be right.
 *
 * THE TRIGGERS, and why each is here rather than in a watcher:
 *
 * - **Mount and identity change.** The bar that calls this is rendered only for
 *   the document the panel is actually showing, so mounting IS the activation
 *   the operator asked for: switching to a tab, switching the canvas back to
 *   Documents, or opening the panel all mount it. A tab that is not on screen is
 *   not mounted and is therefore never checked - it is checked when it is
 *   switched to, which is the whole point of the design.
 * - **The window coming back.** `focus` and `visibilitychange` to visible. The
 *   window may have been behind another app for an hour, which is exactly when a
 *   file is most likely to have changed underneath it.
 * - **The poll.** Only while this document is on screen AND the window is
 *   visible, and only ever for this one path.
 *
 * No `fs.watch`: see `file-freshness.ts` for the three write paths that a
 * watcher misses and one `statSync` does not.
 */

/**
 * How often the on-screen document is re-checked, in ms.
 *
 * 2000, argued from the two things that bound it:
 *
 * - **The floor is the mtime's own resolution.** A check can only see a change
 *   the filesystem records, and the filesystems a canvas document can live on
 *   do not all have nanosecond timestamps: `statSync().mtimeMs` is exact on
 *   APFS (measured on this machine), but HFS+ and most network mounts record
 *   whole seconds, and a `cp -p` or an archive extraction can land two writes
 *   inside one tick. Checking faster than the granularity of the signal buys
 *   nothing at all - it is a `stat` that cannot answer differently - so the
 *   interval is set at a multiple of the coarsest common tick rather than as
 *   small as the event loop allows.
 * - **The ceiling is what a reader notices.** The poll only covers "the file
 *   changed while I was already looking at it"; the common case (I switched to
 *   the tab) is handled by mount, immediately. For the remaining case, two
 *   seconds is inside the window in which a person is still looking at the
 *   document for the change to appear in, and it is the cadence the app already
 *   uses for live values of this kind (`run-details-clock`, the tool rows).
 *
 * The cost of the number: 0.5 probes per second, for one path, on a panel that
 * is open and on screen. Each probe is one `statSync` in main (the same call the
 * Files grid already makes in batches of 64), and a probe that answers
 * "unchanged" writes nothing to the store - so an idle document costs a stat
 * every two seconds and no work anywhere else. A window that is HIDDEN is throttled
 * by Chromium long before this interval matters, which is one more reason the
 * `visibilitychange` trigger exists rather than relying on the timer alone.
 */
const POLL_MS = 2000;

type UseFileFreshnessOptions = {
	/** The document on screen, as the store currently holds it. */
	document: CanvasDocument;
	/** The canvas store's key, for writing a re-read document back. */
	conversationId?: string;
};

export type DocumentFreshness = {
	/** The file's mtime as of the bytes on screen, or null when unknown. */
	lastModifiedMs: number | null;
	/**
	 * The manual re-read is out right now.
	 *
	 * ONLY the manual one, and that is a correction worth naming: a control that
	 * disabled itself for every background tick of a two-second poll is a control
	 * that changes state twice a second on a document nobody has pressed
	 * anything on - and, measured on this branch's first pass, it made a real
	 * press land in a disabled window and do nothing at all.
	 */
	refreshing: boolean;
	/** What a check found that could not be shown, in the panel's own words: the
	 * SHORT form, written to fit the row (design round 3, D10). */
	note: string | null;
	/** The same claim with its consequences spelled out, for the tooltip and the
	 * control's accessible description. Never null while `note` is not. */
	detail: string | null;
	/** A mounted editor holds unsaved changes for this document. */
	dirty: boolean;
	/**
	 * The file changed on disk while `dirty`, so the document is HELD: its
	 * autosave is paused and the control now loads the file's version rather than
	 * merely re-reading it. The row words itself from this, so the two must not
	 * drift.
	 */
	diskChanged: boolean;
	/** Re-read the file now, whether or not its mtime moved. */
	refresh: () => void;
};

/**
 * What one outcome leaves in the row's register.
 *
 * TWO SLOTS, and the split is round 1's flicker fixed at the source (review m2,
 * UX U1/U3/U4). A FACT is a state of the FILE - "no longer on disk", "changed on
 * disk while your buffer is unsaved" - and it stays until an outcome arrives
 * that says it no longer holds, because a background tick that found nothing new
 * has no business replacing a sentence the reader is acting on. An ANSWER is the
 * reply to something the reader DID - a press that found nothing to do, or the
 * apply a press or a tick produced - and it RETIRES (see `ANSWER_LIFETIME_MS`),
 * because an answer is about a moment rather than a state.
 *
 * WHY CLEARING IS PER-FACT RATHER THAN ONE BLANKET RULE (design D9, QA Q6, UX
 * U8). Round 1 retired every fact on any outcome that looked settled, which
 * killed "This file could not be re-read" on the next tick - a tick that never
 * re-read anything, so it could not have answered what the sentence was about.
 * Each fact now names what proves it false:
 *
 * - `missing` / `unreadable` are retired by any check whose probe answered (the
 *   file is there, or it is there and readable again);
 * - `failed` is retired only by a check that actually READ the file, because an
 *   `unchanged` answer never reads and therefore cannot answer it;
 * - `disk-changed` is retired by the file's mtime coming back to the baseline, or
 *   by the reader resolving it (see the hold and `load` in `file-freshness.ts`);
 * - `save-replaced` is retired when the reader acknowledges it with the control.
 *
 * `undefined` means "leave the slot alone", which is why this returns partial
 * registers: "found nothing new" and "say nothing new" are different
 * instructions, and the flicker lived in conflating them.
 */

/*
 * TWO FORMS OF EVERY FACT, and the split is design round 3's D10 measured on the
 * real row: the 32px bar gives the sentence about 320px at the default pane
 * (607px, minus the stamp, minus the control and its 8px inset), and the round-2
 * sentence needed 694px - so the part that says what the reader can DO was
 * permanently off screen, at every width, behind a scrollbar inside a chrome bar
 * that is not supposed to scroll. The visible string is therefore the SHORT one,
 * written to fit: the state first, then the way out, in as few words as the claim
 * survives. The full claim is `FACT_DETAIL`, which is what the tooltip shows and
 * what the control's accessible description carries, so nothing is lost - it is
 * one Tab or one hover away instead of never.
 */
export const FACT_TEXT: Record<FreshnessFact, string> = {
	missing: "No longer on disk — showing the version we last read.",
	unreadable: "Could not be read — showing the version we last read.",
	failed: "Could not be re-read — showing the version we last read.",
	/*
	 * THE HOLD'S OWN SENTENCE (UX round 2 U1, tightened in round 3). Two ways out,
	 * both of which exist: the control loads the file's version (letting the
	 * unsaved edits go), and a save replaces the file's. "Discard", which round 1
	 * named, is not one of them - and the actionable clause leads here rather than
	 * trailing, because it is the half a reader has to act on.
	 */
	"disk-changed": "Changed on disk — load it, or save to replace it.",
	"save-replaced": "Your save replaced the change on disk.",
};

export const FACT_DETAIL: Record<FreshnessFact, string> = {
	missing:
		"This file is no longer on disk. The last version we read is still shown, and your unsaved edits are kept - saving writes them back.",
	unreadable:
		"This file could not be read. The last version we read is still shown, and your unsaved edits are kept - saving writes them back.",
	failed:
		"This file could not be re-read, so the version we last read is still shown.",
	"disk-changed":
		"Your unsaved edits are kept, and saving is paused while the file has changed on disk. Load its version to see the change (your unsaved edits are discarded), or save to replace the file with your version.",
	"save-replaced":
		"Your save replaced the version that had changed on disk. Re-read the file to see what is there now.",
};

/**
 * How long an ANSWER stays in the row, in ms.
 *
 * WHY A LIFETIME AT ALL (UX U8, QA Q6, design D9): "Updated from disk" was still
 * on screen after fourteen seconds of ordinary ticks, and reappeared stale in
 * three independent observations, because nothing ever retired it. An answer is
 * about a moment, so it gets one: long enough to be read twice (the app's own
 * toasts are the same order of magnitude), short enough that a reader who looks
 * away and back does not read it as current. Lives in the hook rather than the
 * row so the timer is one per document rather than one per render.
 */
export const ANSWER_LIFETIME_MS = 8000;

/**
 * The row's ANSWER to a gesture: a short label, with the full claim beside it.
 *
 * WHY SHORT (design round 4, D12). At the dock's 400px floor the visible answer is
 * whatever is left of the row after the stamp and the control, and "Updated from
 * disk" came back as `Updated from di…` - ellipsised mid-word, which reads as a
 * defect rather than as a sentence. A label that is a couple of words fits at every
 * size the app allows, and `answerDetailFor` below carries the sentence a reader
 * needs into the tooltip and the control's accessible description, one hover or Tab
 * away - the same split `FACT_TEXT`/`FACT_DETAIL` already uses for state.
 */
export function answerFor(
	outcome: FreshnessOutcome,
	forced: boolean,
): string | null | undefined {
	switch (outcome.status) {
		case "applied":
			return "Re-read";
		/*
		 * A byte-identical re-read is the answer to the one press that could not be
		 * answered before (design D3, QA Q5, UX U3): the runner rewrites a forced
		 * `unchanged` into a reload, the reload finds the same bytes, and this is the
		 * only slot that can say so. Without it a press on an unchanged text document
		 * produced nothing at all.
		 */
		case "identical":
			return "Up to date";
		case "unchanged":
			return forced ? "Up to date" : undefined;
		case "unavailable":
			return forced ? "No local file access" : undefined;
		default:
			return undefined;
	}
}

/** The answer's full sentence, for the tooltip and the accessible description. */
export function answerDetailFor(
	outcome: FreshnessOutcome,
	forced: boolean,
): string | null | undefined {
	switch (outcome.status) {
		case "applied":
			return "The file's version was re-read from disk and is now on screen.";
		case "identical":
		case "unchanged":
			return forced ? "Already up to date — the file is unchanged." : undefined;
		case "unavailable":
			return forced
				? "Local file access is unavailable, so there is nothing to re-read from."
				: undefined;
		default:
			return undefined;
	}
}

export function factAfter(
	outcome: FreshnessOutcome,
	current: FreshnessFact | null,
): FreshnessFact | null | undefined {
	switch (outcome.status) {
		case "missing":
			return "missing";
		case "unreadable":
			return "unreadable";
		case "failed":
			return "failed";
		case "skipped-dirty":
			/*
			 * A dirty buffer whose file is GONE or unreadable is its own fact now (QA
			 * round 3, Q12): the row used to say "your edits are kept" against an
			 * `ENOENT` for as long as the reader looked at it, because both facts were
			 * clean-document-only. Neither one is cleared by the other's arrival -
			 * `missing` is not "changed on disk", and the reader's route out (an
			 * explicit save) is the same in both.
			 */
			if (outcome.unreadable) return "unreadable";
			if (outcome.missing) return "missing";
			if (outcome.diskChanged) return "disk-changed";
			/* The state this fact was about is gone - the file is back at the baseline,
			 * or back at all - so the fact goes with it, and the hold released in the
			 * runner means the reader's typing is being written again. */
			return current === "disk-changed" ||
				current === "missing" ||
				current === "unreadable"
				? null
				: undefined;
		case "applied":
		case "identical":
			/* The held bytes are the file's now, whatever was standing. */
			return null;
		case "unchanged":
		case "adopted":
			/* The probe answered, so the file is there and readable; nothing was read,
			 * so "could not be re-read" is not this outcome's to retire. */
			return current === "missing" || current === "unreadable"
				? null
				: undefined;
		default:
			return undefined;
	}
}

export function useFileFreshness({
	document,
	conversationId,
}: UseFileFreshnessOptions): DocumentFreshness {
	const updateOneFile = useCanvasStore((state) => state.updateOneFile);
	const dirty = useSyncExternalStore(
		subscribeDocumentDirty,
		() => isDocumentDirty(document.id),
		() => false,
	);
	const [refreshing, setRefreshing] = useState(false);
	/*
	 * THE FACT IS THE REGISTRY'S NOW, not this component's (QA round 3, Q11). As
	 * hook state it died with the hook, so closing a tab or leaving the chat route
	 * dropped the sentence and the hold while the buffer it was about survived in the
	 * store - a reader returning to a document that disagrees with the file, with
	 * nothing saying so. The registry outlives the mount, the row still reads it
	 * through `useSyncExternalStore`, and the resolution path clears it.
	 */
	const fact = useSyncExternalStore(
		subscribeDocumentFact,
		() => documentFact(document.id),
		() => null,
	);
	/* The callbacks below read the fact without depending on it: `check` is a
	 * dependency of the activation, focus and poll effects, so a new identity per
	 * fact change would re-run the activation check on every sentence the row
	 * publishes - a probe per sentence, for ever. */
	const factRef = useRef<FreshnessFact | null>(null);
	factRef.current = fact;
	const [answer, setAnswer] = useState<{
		text: string;
		detail: string | null;
		at: number;
	} | null>(null);
	/*
	 * An ANSWER belongs to the document that produced it, so a tab switch starts the
	 * new document's row without the last one's reply. A FACT deliberately does not:
	 * it is the registry's, and it is still true after the switch.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the document's identity is the trigger, not a value the body reads.
	useEffect(() => {
		setAnswer(null);
	}, [document.id]);
	/*
	 * An answer retires - see `ANSWER_LIFETIME_MS`. Driven from the answer's own
	 * timestamp rather than from a tick that happens to arrive: a stale
	 * "Updated from disk" is a claim about a moment, and nothing else in this hook
	 * knows when that moment was.
	 */
	useEffect(() => {
		if (!answer) return;
		const remaining = ANSWER_LIFETIME_MS - (Date.now() - answer.at);
		const timer = window.setTimeout(
			() => {
				setAnswer((current) => (current?.at === answer.at ? null : current));
			},
			Math.max(0, remaining),
		);
		return () => window.clearTimeout(timer);
	}, [answer]);
	/*
	 * The document as of the LATEST render, so a check started by a timer reads
	 * the store's current content rather than whatever the closure captured. Read
	 * through a ref rather than listed as an effect dependency: a check that
	 * applies a re-read writes the store, which re-renders this hook with a new
	 * document object, which would re-run the effect - a probe per apply, for
	 * ever, on a file that is not changing.
	 */
	const latest = useRef(document);
	useEffect(() => {
		latest.current = document;
	});

	const runner = useMemo(
		() =>
			createFreshnessRunner({
				probe: (path) => probeLocalFile(path),
				read: async (path, encoding) => {
					if (typeof window.api?.readFile !== "function") {
						return {
							ok: false,
							error:
								"Local file access is unavailable outside the desktop app.",
						};
					}
					try {
						const result = await window.api.readFile(path, encoding);
						if (!result.success) {
							return {
								ok: false,
								error:
									result.error instanceof Error
										? result.error.message
										: String(result.error),
							};
						}
						return { ok: true, content: result.data };
					} catch (error) {
						return {
							ok: false,
							error: error instanceof Error ? error.message : String(error),
						};
					}
				},
			}),
		[],
	);

	/*
	 * Write the re-read document back, and only when something actually moved.
	 *
	 * The store is PERSISTED, and `updateOneFile` always produces a new
	 * conversation object - so a write per tick would put a `localStorage` write
	 * behind a two-second timer and re-render the whole panel for a document that
	 * has not changed. The field comparison is what keeps an unchanged probe free.
	 */
	const apply = useCallback(
		(fresh: CanvasDocument) => {
			/*
			 * No key, no write. The canvas is drawn by a pane that HAS an identity -
			 * a draft key before the session exists, the session id after - and the
			 * route that has neither renders the empty-chat surface rather than a
			 * dock, so this is the belt to that brace rather than a live case.
			 */
			if (!conversationId) return;
			const held = latest.current;
			if (
				held.id === fresh.id &&
				held.content === fresh.content &&
				held.readMtimeMs === fresh.readMtimeMs &&
				held.lastAgentModified === fresh.lastAgentModified &&
				held.sizeBytes === fresh.sizeBytes &&
				held.availability === fresh.availability
			) {
				return;
			}
			updateOneFile(conversationId, fresh);
		},
		[conversationId, updateOneFile],
	);

	const check = useCallback(
		async (force: boolean) => {
			if (force) setRefreshing(true);
			/*
			 * THE EPOCH GUARD ON THE APPLY SIDE (round 3). A check's read is an await,
			 * and a save that lands inside it is NEWER than what the check read: without
			 * this, the check's stale bytes were written into the store after the save
			 * had already put the reader's bytes on disk, and the editor then adopted
			 * the stale version and autosaved it straight back over the file. The epoch
			 * is bumped by `saveDocument`'s own writes and by `load`, so this is the
			 * same signal that cancels a pending write.
			 */
			const epoch = currentWriteEpoch(document.id);
			try {
				const outcome = await runner.check(latest.current, force);
				if (currentWriteEpoch(document.id) !== epoch) return;
				if ("document" in outcome) apply(outcome.document);
				const nextFact = factAfter(outcome, factRef.current);
				if (nextFact !== undefined) setDocumentFact(document.id, nextFact);
				const nextAnswer = answerFor(outcome, force);
				if (nextAnswer !== undefined) {
					setAnswer(
						nextAnswer
							? {
									text: nextAnswer,
									detail: answerDetailFor(outcome, force) ?? null,
									at: Date.now(),
								}
							: null,
					);
				}
			} finally {
				if (force) setRefreshing(false);
			}
		},
		[apply, document.id, runner],
	);

	/*
	 * LOAD THE FILE'S VERSION, the reader's answer to the hold (UX round 2, U1's
	 * second half). `runner.load` cancels the writes already in flight and clears
	 * the dirty registry and the hold ONLY when the read carried bytes - so the
	 * press cannot be overtaken by the app's own pending save, and a read that
	 * fails leaves the buffer exactly as protected as it was (code review round 3,
	 * major B; UX round 3, U9). Nothing is cleared here before the read.
	 */
	const loadFile = useCallback(async () => {
		setRefreshing(true);
		try {
			/*
			 * CANCEL FIRST, THROUGH THE MECHANISM THE DISPOSITION NAMED (nit N2). Round
			 * 4's note named `resolveBuffer` as the thing that kills every proposal born
			 * before a resolution; the load cancelled through the registry directly, so
			 * the named entry point had no caller under `src/`. It is the one that runs
			 * now, and it does the same thing by construction.
			 */
			resolveBuffer(document.id);
			const outcome = await runner.load(latest.current);
			if ("document" in outcome) {
				/*
				 * THE OWNER IS TOLD FIRST, and by the same rule the store is: the load's
				 * bytes are the document's content now, so the buffer takes them and the
				 * editor's own adopt (which refuses while the buffer is dirty) has nothing
				 * left to refuse. Both halves in one place, in this order, so the screen
				 * and the store cannot disagree about which version is on it.
				 */
				resetBufferToFile(
					outcome.document.id,
					outcome.document.content,
					outcome.document.readMtimeMs ?? null,
				);
				apply(outcome.document);
			}
			const nextFact = factAfter(outcome, factRef.current);
			if (nextFact !== undefined) setDocumentFact(document.id, nextFact);
			const nextAnswer = answerFor(outcome, true);
			if (nextAnswer !== undefined) {
				setAnswer(
					nextAnswer
						? {
								text: nextAnswer,
								detail: answerDetailFor(outcome, true) ?? null,
								at: Date.now(),
							}
						: null,
				);
			}
		} finally {
			setRefreshing(false);
		}
	}, [apply, document.id, runner]);

	// Activation: mount, tab change, conversation change.
	//
	// WHY THE DOCUMENT'S OWN FIELDS ARE DEPENDENCIES even though the body reads the
	// document through a ref: this effect IS the activation trigger, and a tab
	// switch does not remount this component - `canvas/index.tsx` renders one bar
	// for whichever document is active, so switching tabs is a PROP change and the
	// effect has to be told about it. The same holds for the conversation: opening
	// another chat reuses the pane. `check` alone would not do it, because it reads
	// the current document out of a ref and therefore keeps its identity.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the dependencies are the trigger, not values the body reads - see above.
	useEffect(() => {
		void check(false);
	}, [check, document.id, document.path, conversationId]);

	/** The window coming back to the front. */
	useEffect(() => {
		const onReturn = () => {
			if (window.document.visibilityState !== "visible") return;
			void check(false);
		};
		window.addEventListener("focus", onReturn);
		window.document.addEventListener("visibilitychange", onReturn);
		return () => {
			window.removeEventListener("focus", onReturn);
			window.document.removeEventListener("visibilitychange", onReturn);
		};
	}, [check]);

	// The poll, for the one document on screen, while the window is visible.
	useEffect(() => {
		const timer = window.setInterval(() => {
			if (window.document.visibilityState !== "visible") return;
			void check(false);
		}, POLL_MS);
		return () => window.clearInterval(timer);
	}, [check]);

	/**
	 * The control, whose meaning depends on what it is being pressed about.
	 *
	 * While the `disk-changed` fact stands it LOADS the file's version - the only
	 * action that shows the reader the change they were told about, and the reason
	 * the row words the control "Load the file's version (your unsaved edits are
	 * discarded)" in that state. Everywhere else it is the belt-and-braces re-read
	 * the request asked for: a forced check, which answers even when it finds
	 * nothing to do.
	 */
	const refresh = useCallback(() => {
		if (factRef.current === "disk-changed") {
			void loadFile();
			return;
		}
		// A press is also the acknowledgement `save-replaced` asks for.
		if (factRef.current === "save-replaced") setDocumentFact(document.id, null);
		void check(true);
	}, [check, document.id, loadFile]);

	return {
		lastModifiedMs: document.readMtimeMs ?? null,
		refreshing,
		// A state of the file outranks a reply to a gesture, and only one line fits.
		note: fact ? FACT_TEXT[fact] : (answer?.text ?? null),
		/** The same claim with its consequence spelled out, for the tooltip and the
		 * accessible description. The row's visible string has to fit a 32px chrome
		 * bar at ordinary pane widths (design round 3, D10), so the short form is the
		 * one on screen and the full one is the one a reader can ask for. */
		detail: fact ? FACT_DETAIL[fact] : (answer?.detail ?? answer?.text ?? null),
		dirty,
		// The control's meaning follows this: it LOADS the file's version in this
		// state rather than merely re-reading it, and the row says so.
		diskChanged: fact === "disk-changed",
		refresh,
	};
}
