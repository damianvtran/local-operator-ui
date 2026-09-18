import { useCanvasStore } from "@shared/store/canvas-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import type { CanvasDocument } from "../../types/canvas";
import {
	type FreshnessOutcome,
	createFreshnessRunner,
	explicitSaveAtFor,
	isDocumentDirty,
	probeLocalFile,
	subscribeDocumentDirty,
	subscribeExplicitSave,
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
	/** What a check found that could not be shown, in the panel's own words. */
	note: string | null;
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
export type FreshnessFact =
	| "missing"
	| "unreadable"
	| "failed"
	| "disk-changed"
	| "save-replaced";

export const FACT_TEXT: Record<FreshnessFact, string> = {
	missing:
		"This file is no longer on disk. The last version we read is still shown.",
	unreadable:
		"This file could not be read. The last version we read is still shown.",
	failed:
		"This file could not be re-read, so the version we last read is still shown.",
	/*
	 * THE HOLD'S OWN SENTENCE (UX round 2, U1's second half). It has to say three
	 * things and it has to lead with the one that survives a narrow row: the
	 * reader's words are safe, saving is paused, and there are exactly two ways
	 * out. Both of them exist: the control loads the file's version (and lets the
	 * unsaved edits go), and a save replaces the file's. "Discard", which the
	 * round-1 copy named, is not one of them.
	 */
	"disk-changed":
		"Your unsaved edits are kept, and saving is paused while the file has changed on disk. Load its version, or save to replace it.",
	/*
	 * What an explicit save leaves behind. The reader chose their bytes, so the
	 * change that was on disk is gone - the app owes them that sentence rather than
	 * letting it disappear (UX round 2, U1).
	 */
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

export function answerFor(
	outcome: FreshnessOutcome,
	forced: boolean,
): string | null | undefined {
	switch (outcome.status) {
		case "applied":
			return "Updated from disk";
		/*
		 * A byte-identical re-read is the answer to the one press that could not be
		 * answered before (design D3, QA Q5, UX U3): the runner rewrites a forced
		 * `unchanged` into a reload, the reload finds the same bytes, and this is the
		 * only slot that can say so. Without it a press on an unchanged text document
		 * produced nothing at all.
		 */
		case "identical":
			return "Already up to date";
		case "unchanged":
			return forced ? "Already up to date" : undefined;
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
			if (outcome.diskChanged) return "disk-changed";
			/* The mtime is back at the baseline: the change this fact was about is
			 * gone, so the fact goes with it - and the hold released in the runner
			 * means the reader's typing is being written again. */
			return current === "disk-changed" ? null : undefined;
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
	const [fact, setFactState] = useState<FreshnessFact | null>(null);
	const [answer, setAnswer] = useState<{ text: string; at: number } | null>(
		null,
	);
	/*
	 * The fact is ALSO held in a ref, so the three callbacks that read it stay
	 * referentially stable: `check` is a dependency of the activation, focus and
	 * poll effects, so a new identity per fact change would re-run the activation
	 * check on every sentence the row publishes - a probe per sentence, for ever.
	 */
	const factRef = useRef<FreshnessFact | null>(null);
	const setFact = useCallback((next: FreshnessFact | null) => {
		factRef.current = next;
		setFactState(next);
	}, []);
	/*
	 * Both slots belong to the document that reported them, so a tab switch starts
	 * the new document's row empty rather than inheriting the last one's sentence.
	 * Declared before the activation effect below so the reset lands first.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the document's identity is the trigger, not a value the body reads.
	useEffect(() => {
		setFact(null);
		setAnswer(null);
	}, [document.id, setFact]);
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
	 * The reader's explicit save, which is the one route that ends the hold on the
	 * reader's own terms. Watched here rather than inferred from the store moving,
	 * because the store also moves for an APPLY - and an apply is the file winning,
	 * not the reader.
	 */
	const explicitSaveAt = useSyncExternalStore(
		subscribeExplicitSave,
		() => explicitSaveAtFor(document.id),
		() => null,
	);
	useEffect(() => {
		if (explicitSaveAt === null) return;
		/*
		 * The reader's bytes are on disk now, so the file's version is not "still
		 * waiting to be loaded" - it is gone, and the row says so and stays saying so
		 * until the reader acknowledges it (UX round 2, U1's second half).
		 */
		if (factRef.current === "disk-changed") setFact("save-replaced");
	}, [explicitSaveAt, setFact]);
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
			try {
				const outcome = await runner.check(latest.current, force);
				if ("document" in outcome) apply(outcome.document);
				const nextFact = factAfter(outcome, factRef.current);
				if (nextFact !== undefined) setFact(nextFact);
				const nextAnswer = answerFor(outcome, force);
				if (nextAnswer !== undefined) {
					setAnswer(nextAnswer ? { text: nextAnswer, at: Date.now() } : null);
				}
			} finally {
				if (force) setRefreshing(false);
			}
		},
		[apply, runner, setFact],
	);

	/*
	 * LOAD THE FILE'S VERSION, the reader's answer to the hold (UX round 2, U1's
	 * second half). The runner clears the dirty registry and the hold, so this is
	 * the one press that makes the file's bytes win - and the row's control is the
	 * only surface that offers it, because it is the surface that raised the
	 * question.
	 */
	const loadFile = useCallback(async () => {
		setRefreshing(true);
		try {
			setFact(null);
			const outcome = await runner.load(latest.current);
			if ("document" in outcome) apply(outcome.document);
			const nextFact = factAfter(outcome, null);
			if (nextFact !== undefined) setFact(nextFact);
			const nextAnswer = answerFor(outcome, true);
			if (nextAnswer !== undefined) {
				setAnswer(nextAnswer ? { text: nextAnswer, at: Date.now() } : null);
			}
		} finally {
			setRefreshing(false);
		}
	}, [apply, runner, setFact]);

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
		if (factRef.current === "save-replaced") setFact(null);
		void check(true);
	}, [check, loadFile, setFact]);

	return {
		lastModifiedMs: document.readMtimeMs ?? null,
		refreshing,
		// A state of the file outranks a reply to a gesture, and only one line fits.
		note: fact ? FACT_TEXT[fact] : (answer?.text ?? null),
		dirty,
		// The control's meaning follows this: it LOADS the file's version in this
		// state rather than merely re-reading it, and the row says so.
		diskChanged: fact === "disk-changed",
		refresh,
	};
}
