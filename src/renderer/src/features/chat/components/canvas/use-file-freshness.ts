import { useCanvasStore } from "@shared/store/canvas-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import type { CanvasDocument } from "../../types/canvas";
import {
	type FreshnessOutcome,
	createFreshnessRunner,
	isDocumentDirty,
	probeLocalFile,
	subscribeDocumentDirty,
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
	/** Re-read the file now, whether or not its mtime moved. */
	refresh: () => void;
};

/**
 * What one outcome leaves in the row's register.
 *
 * TWO SLOTS, NOT ONE, and the split is round 1's flicker fixed at the source
 * (review m2, UX U1/U3/U4). A FACT is a state of the FILE - "no longer on disk",
 * "changed on disk while your buffer is unsaved" - and it stays until an outcome
 * arrives that says it no longer holds, because a background tick that found
 * nothing new has no business replacing a sentence the reader is acting on. An
 * ANSWER is the reply to something the reader DID - a press that found nothing
 * to do ("Already up to date") or the apply a press or a tick produced ("Updated
 * from disk") - and a tick with nothing to do leaves it standing rather than
 * trading it for silence a second and a half later.
 *
 * `undefined` means "leave that slot alone", which is why this returns a partial
 * register rather than a whole one: "found nothing new" and "say nothing new"
 * are different instructions and the flicker lived in conflating them.
 *
 * The dirty sentence LEADS WITH THE CLAUSE THAT SURVIVES TRUNCATION (design
 * round 1, D4): at the dock's 400px floor the row renders about 135px of it, and
 * the reader must keep the reassurance and the instruction, not lose them to the
 * diagnosis.
 */
function registerFor(
	outcome: FreshnessOutcome,
	forced: boolean,
): { fact?: string | null; answer?: string | null } {
	switch (outcome.status) {
		case "missing":
			return {
				fact: "This file is no longer on disk. The last version we read is still shown.",
			};
		case "unreadable":
			return {
				fact: "This file could not be read. The last version we read is still shown.",
			};
		case "failed":
			return {
				fact: "This file could not be re-read, so the version we last read is still shown.",
			};
		case "skipped-dirty":
			return outcome.diskChanged
				? {
						fact: "Your unsaved edits are kept - the file changed on disk. Save or discard them to load the change.",
					}
				: {};
		case "applied":
			return { fact: null, answer: "Updated from disk" };
		case "identical":
		case "adopted":
			return { fact: null };
		case "unchanged":
			return forced
				? { fact: null, answer: "Already up to date" }
				: { fact: null };
		case "unavailable":
			return forced
				? {
						answer:
							"Local file access is unavailable, so there is nothing to re-read from.",
					}
				: {};
		default:
			return {};
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
	const [fact, setFact] = useState<string | null>(null);
	const [answer, setAnswer] = useState<string | null>(null);
	/*
	 * Both slots belong to the document that reported them, so a tab switch starts
	 * the new document's row empty rather than inheriting the last one's sentence.
	 * Declared before the activation effect below so the reset lands first.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the document's identity is the trigger, not a value the body reads.
	useEffect(() => {
		setFact(null);
		setAnswer(null);
	}, [document.id]);
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
				const register = registerFor(outcome, force);
				if (register.fact !== undefined) setFact(register.fact);
				if (register.answer !== undefined) setAnswer(register.answer);
			} finally {
				if (force) setRefreshing(false);
			}
		},
		[apply, runner],
	);

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

	const refresh = useCallback(() => {
		void check(true);
	}, [check]);

	return {
		lastModifiedMs: document.readMtimeMs ?? null,
		refreshing,
		// A state of the file outranks a reply to a gesture, and only one line fits.
		note: fact ?? answer,
		dirty,
		refresh,
	};
}
