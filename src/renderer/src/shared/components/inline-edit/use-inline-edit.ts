/**
 * The per-field inline editing machine, as a hook.
 *
 * WHAT IT OWNS, and what it deliberately does not: the phase (`idle ->
 * editing -> saving -> saved(transient) -> idle`, with `error` holding the
 * attempted value beside the field), the dirty derivation, the never-clobber
 * re-seed against the record's fresh value, the conflict hold, the commit and
 * its two failure classes (a local validation refusal, before any request; and
 * a rejected write, whose rejection the caller maps to a sentence), the
 * keyboard contract, the focus rules, and the one `aria-live` announcement.
 * It does NOT own any control, any copy beyond the labels it is handed, any
 * request shape, or any store: every consumer mounts it by props, which is
 * what lets the same machine serve the projects detail today and the
 * agents/teams lane next (`docs/design/agents-inplace-shared-composer.md` § 2).
 *
 * THE BLUR RULES, precisely. Blur accepts iff the draft changed and is valid;
 * an unchanged blur leaves edit state with no request (§ 2.2). A blur whose
 * `relatedTarget` is still inside the field's own wrapper is not a blur at
 * all: the check/x buttons, a Write|Preview toggle and an estimate's unit
 * select are all inside the editor's chrome, and a commit fired on the way to
 * one of them would fight the gesture the user is making. `relatedTarget`
 * suffices because every control in the chrome is focusable; a pointer press
 * on a non-focusable part of the chrome (none exists today) would fall through
 * to a commit, which is why the chrome's buttons also `preventDefault` their
 * own `mousedown`.
 *
 * THE FOCUS RULES. An explicit gesture that closes the field (Enter, the
 * check, the x, Escape) hands the keyboard to the field's slot control
 * (`slotRef`), so focus never falls to `<body>` and a keyboard walk continues
 * where the user was; a blur-close leaves focus wherever the user put it (the
 * rule `chat-header.tsx` states for its inline rename, whose look and feel this
 * machine generalises). The editor is focused when the field ENTERS editing,
 * and a submitted save keeps it (read-only) until it resolves.
 *
 * THE LATCH. Every transition that can race itself (a double-pressed check, an
 * Escape arriving in the same tick as a click, a stale resolution after a
 * cancel) goes through `phaseRef`, written before the state update, exactly as
 * `chat-header.tsx`'s rename documents: state is for rendering, the ref is
 * for deciding.
 */

import {
	useCallback,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import type { KeyboardEvent, RefObject } from "react";
import {
	type InlineEditPhase,
	inlineEditAcceptSends,
	inlineEditDirty,
	inlineEditEditorShown,
	inlineEditKeyAction,
	inlineEditReseed,
} from "./inline-edit-model";
import { InlineEditAnnounceContext } from "./inline-edit-pane";

/** The words one field's chrome speaks. The field names itself in all of them. */
export type InlineEditLabels = {
	/**
	 * The field's own name, e.g. "Title" - the editing control's ACCESSIBLE
	 * NAME, which is the field, not the gesture: an input labelled "Edit
	 * title" describes the button that opened it.
	 */
	name: string;
	/** e.g. "Edit title" - the idle affordance and its aria-label. */
	begin: string;
	/** e.g. "Save title" - the check, and what Enter does. */
	accept: string;
	/** e.g. "Discard the title edit" - the x. */
	cancel: string;
	/** e.g. "Saving the title" - the spinner slot while the write is in flight. */
	busy: string;
	/** e.g. "Title saved" - the transient acknowledgement and its announcement. */
	saved: string;
	/** The check's name in `error`, where it re-attempts; defaults to `accept`. */
	retry?: string;
};

export type InlineEditOptions<T> = {
	/** The committed value, fresh from the record on every render. */
	value: T;
	/** Runs the write. Reject to hold the draft in `error` with mapped copy. */
	commit: (next: T) => Promise<void>;
	/** Draft identity; required for drafts that are not primitives. */
	equals?: (a: T, b: T) => boolean;
	/** A local refusal sentence, or null. Runs before any request is made. */
	validate?: (next: T) => string | null;
	/** Enter is a newline; Cmd/Ctrl+Enter accepts. */
	multiline?: boolean;
	/** False where Enter belongs to the control itself (a select trigger). */
	keyboardCommit?: boolean;
	/** Select the whole value when a single-line editor opens. */
	selectAllOnBegin?: boolean;
	/** Open the editor as soon as the field mounts (the `+ Add` path). */
	beginOnMount?: boolean;
	/**
	 * Called as the field ENTERS editing, after the state is set (the status
	 * select opens its menu here; the gesture that began the edit is the same
	 * click a reader made).
	 */
	onBegin?: () => void;
	/** The field's own words; see `InlineEditLabels`. */
	labels: InlineEditLabels;
	/** A caller-owned ref for the editing control; the hook focuses it. */
	editorRef?: RefObject<HTMLElement>;
	/** How a rejected commit becomes a sentence. Defaults to the error's message. */
	errorCopy?: (error: unknown) => string;
	/** How long `saved` stays before decaying to `idle`. */
	savedDwellMs?: number;
	/**
	 * Called when the field leaves the editing states. `saved` is a commit that
	 * landed; `cancelled` is a close with no write (Escape, the x, an unchanged
	 * accept). The `+ Add` rows use it to retire a row that was never filled.
	 */
	onSettle?: (outcome: "saved" | "cancelled") => void;
};

export type InlineEditApi<T> = {
	phase: InlineEditPhase;
	/** The draft differs from the value it is compared against. */
	dirty: boolean;
	/** The record moved under a dirty draft; the commit is held until answered. */
	conflict: T | null;
	/** The refusal sentence beside the field: local validation or a failed write. */
	error: string | null;
	/** The draft the editor control renders. */
	draft: T;
	setDraft: (next: T) => void;
	/** What the READ view paints: the record, or this field's own save until it lands. */
	displayValue: T;
	/** True while the editor control should be on screen instead of the display. */
	editing: boolean;
	begin: () => void;
	/**
	 * The commit door: the check, Enter, Cmd/Ctrl+Enter and click-away all
	 * arrive here. `next` is the explicit-value path (a select's pick);
	 * `refocus` is false for the blur path, which must not steal the keyboard
	 * back from wherever the user just put it.
	 */
	accept: (next?: T, refocus?: boolean) => void;
	cancel: () => void;
	/** Resolve a held conflict by committing the draft. */
	keepMine: () => void;
	/** Resolve a held conflict by adopting the out-of-band value. */
	useTheirs: () => void;
	handleKeyDown: (event: KeyboardEvent) => void;
	/** Focus leaving the field commits iff changed and valid. */
	handleBlur: (event: { relatedTarget: EventTarget | null }) => void;
	/**
	 * The wrapper's own wiring: the key handler, the blur handler and the
	 * `aria-busy` while a write is in flight. Spread onto the field element.
	 */
	fieldProps: {
		onKeyDown: (event: KeyboardEvent) => void;
		onBlur: (event: { relatedTarget: EventTarget | null }) => void;
		"aria-busy": true | undefined;
	};
	/** The editing control's aria wiring; spread onto the control itself. */
	editorAria: {
		"aria-invalid": true | undefined;
		"aria-describedby": string | undefined;
	};
	/** The field wrapper. Blur containment and the wrapper's own ref. */
	fieldRef: RefObject<HTMLDivElement>;
	/**
	 * The editing control's element, for the consumer to attach to its
	 * `Input`/`Textarea`/trigger: the hook focuses it when the field opens and
	 * compares `event.target` against it to scope Enter.
	 */
	editorRef: RefObject<HTMLElement>;
	/** The slot control that takes focus back after an explicit close. */
	slotRef: RefObject<HTMLButtonElement>;
	/** The feedback region's id (errors and the conflict choice). */
	feedbackId: string;
	labels: InlineEditLabels;
};

/** 1.2s: long enough to read, short enough that a fast editor never sees two. */
const SAVED_DWELL_MS = 1200;

function defaultErrorCopy(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	return "The change was not saved.";
}

export function useInlineEdit<T>(
	options: InlineEditOptions<T>,
): InlineEditApi<T> {
	const {
		value,
		multiline = false,
		keyboardCommit = true,
		selectAllOnBegin = false,
		beginOnMount = false,
		savedDwellMs = SAVED_DWELL_MS,
		labels,
	} = options;

	/*
	 * The callbacks live in refs, so the machine's transitions read the LATEST
	 * ones without re-creating themselves (and without the callers having to
	 * memoise). Same pattern for `equals`, whose default is `Object.is`.
	 */
	const equalsRef = useRef<(a: T, b: T) => boolean>(
		options.equals ?? Object.is,
	);
	equalsRef.current = options.equals ?? Object.is;
	const commitRef = useRef(options.commit);
	commitRef.current = options.commit;
	const validateRef = useRef(options.validate);
	validateRef.current = options.validate;
	const errorCopyRef = useRef(options.errorCopy);
	errorCopyRef.current = options.errorCopy;
	const onSettleRef = useRef(options.onSettle);
	onSettleRef.current = options.onSettle;
	const onBeginRef = useRef(options.onBegin);
	onBeginRef.current = options.onBegin;
	const labelsRef = useRef(labels);
	labelsRef.current = labels;

	const [phase, setPhaseState] = useState<InlineEditPhase>(
		beginOnMount ? "editing" : "idle",
	);
	const [draft, setDraftState] = useState<T>(value);
	const [base, setBaseState] = useState<T>(value);
	const [conflict, setConflictState] = useState<T | null>(null);
	const [error, setError] = useState<string | null>(null);

	/*
	 * The deciding copies. `phaseRef` is the latch; `baseRef`/`draftRef`/
	 * `conflictRef` and `valueRef` let a handler that spans a render boundary
	 * (a resolution landing after a blur, a double-press) decide against the
	 * values it actually saw, not the ones its closure captured.
	 */
	const phaseRef = useRef<InlineEditPhase>(phase);
	const draftRef = useRef<T>(draft);
	const baseRef = useRef<T>(base);
	const conflictRef = useRef<T | null>(conflict);
	const valueRef = useRef(value);
	valueRef.current = value;

	const setPhaseBoth = useCallback((next: InlineEditPhase) => {
		phaseRef.current = next;
		setPhaseState(next);
	}, []);
	const setDraftBoth = useCallback((next: T) => {
		draftRef.current = next;
		setDraftState(next);
	}, []);
	const setBaseBoth = useCallback((next: T) => {
		baseRef.current = next;
		setBaseState(next);
	}, []);
	const setConflictBoth = useCallback((next: T | null) => {
		conflictRef.current = next;
		setConflictState(next);
	}, []);

	const fieldRef = useRef<HTMLDivElement>(null);
	const slotRef = useRef<HTMLButtonElement>(null);
	const ownEditorRef = useRef<HTMLElement>(null);
	const editorRef = options.editorRef ?? ownEditorRef;
	const editorRefRef = useRef(editorRef);
	editorRefRef.current = editorRef;

	const feedbackId = `${useId()}-inline-edit`;
	const announce = useContext(InlineEditAnnounceContext);

	/*
	 * THE STALE-REFRESH WINDOW. A save resolves before the record's re-read
	 * lands, so for a moment the `value` prop is still the PRE-save snapshot
	 * and the field would flicker back to it the instant `saved` decays (or
	 * sit there for good on a slow or failed re-read). The one honest way out
	 * without a store: remember this field's own save and what it replaced,
	 * keep painting the saved value while the record still reads as the
	 * snapshot, and let any OTHER value - the re-read's, or a third writer's -
	 * win immediately. Clearing the memory is hygiene, not logic: both places
	 * the two diverge already compute the same reading either way.
	 */
	const pendingSavedRef = useRef<{ saved: T; previous: T } | null>(null);
	const pending = pendingSavedRef.current;
	const staleSnapshot =
		pending !== null &&
		(options.equals ?? Object.is)(value, pending.previous) &&
		!(options.equals ?? Object.is)(value, pending.saved);
	const recordValue = staleSnapshot && pending !== null ? pending.saved : value;
	const recordValueRef = useRef<T>(recordValue);
	recordValueRef.current = recordValue;
	useEffect(() => {
		const memory = pendingSavedRef.current;
		if (memory === null) return;
		const same = equalsRef.current;
		if (same(value, memory.saved) || !same(value, memory.previous)) {
			pendingSavedRef.current = null;
		}
	}, [value]);

	/*
	 * The editor opens FOCUSED, and a single-line field opens SELECTED: the
	 * gesture's point is to type a replacement, and the selection makes the
	 * first keystroke replace rather than append (the chat header's rename
	 * rule). A multiline field keeps its caret - selecting a description so
	 * the first key wipes it is not the same convenience.
	 */
	const justBeganRef = useRef(beginOnMount);
	useEffect(() => {
		if (phase !== "editing" || !justBeganRef.current) return;
		justBeganRef.current = false;
		const element = editorRefRef.current.current;
		if (!element) return;
		element.focus();
		if (selectAllOnBegin) {
			if (
				element instanceof HTMLInputElement ||
				element instanceof HTMLTextAreaElement
			) {
				element.select();
			}
		}
	}, [phase, selectAllOnBegin]);

	/* The explicit-close focus hand-back, run after the slot has re-rendered. */
	const refocusRef = useRef(false);
	useEffect(() => {
		if (!refocusRef.current) return;
		if (phase !== "idle" && phase !== "saved") return;
		refocusRef.current = false;
		slotRef.current?.focus();
	});

	/* The `saved` dwell. Cleared on unmount, and on a re-begin that beats it. */
	const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const clearDwell = useCallback(() => {
		if (dwellTimer.current === null) return;
		clearTimeout(dwellTimer.current);
		dwellTimer.current = null;
	}, []);
	useEffect(() => () => clearDwell(), [clearDwell]);

	/* The settle announcement, watched rather than threaded through every
	 * exit: a close with no write reports `cancelled`, and a landed write
	 * reports `saved`. A FAILED write settles nothing - the field stays in
	 * `error` holding the attempt - so it reports neither. */
	const previousPhaseRef = useRef(phase);
	useEffect(() => {
		const previous = previousPhaseRef.current;
		previousPhaseRef.current = phase;
		if (previous === "saving" && phase === "saved") {
			onSettleRef.current?.("saved");
			return;
		}
		if ((previous === "editing" || previous === "error") && phase === "idle") {
			onSettleRef.current?.("cancelled");
		}
		/* `saved -> idle` is the dwell expiring: already settled. */
	}, [phase]);

	/*
	 * The re-seed (§ 2.4). Runs whenever the record's value arrives, and again
	 * on a phase change so a value that moved DURING `saved` reconciles when
	 * the dwell ends. `adopt` can move `draft` as well as `base`: adopting the
	 * fresh value into a clean draft is invisible, and adopting it into a
	 * draft that already equals it is a no-op. The fresh value is the record's
	 * AS THIS FIELD READS IT (`recordValueRef`), so the stale snapshot a
	 * just-saved field is still being served does not adopt over its own save.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `value` and `phase` ARE the triggers - the body reads them through refs (`phaseRef`, `recordValueRef`) so the reconcile runs on the arrival and on the phase that ends the `saved` dwell, and biome cannot see those reads.
	useEffect(() => {
		const decision = inlineEditReseed({
			phase: phaseRef.current,
			base: baseRef.current,
			draft: draftRef.current,
			fresh: recordValueRef.current,
			equals: equalsRef.current,
		});
		if (decision === "adopt") {
			if (!equalsRef.current(baseRef.current, recordValueRef.current))
				setBaseBoth(recordValueRef.current);
			/*
			 * The DRAFT is the SECOND argument here too (the comparator's
			 * directional rule is defined over that position; review round 2,
			 * m-A). For an emptied draft that moved under a moved record this
			 * means `fresh` reads as already carried and the user's empty box is
			 * kept - consistent with the adopted decision, which exists because
			 * the draft asks for no write.
			 */
			if (!equalsRef.current(recordValueRef.current, draftRef.current))
				setDraftBoth(recordValueRef.current);
		} else if (decision === "conflict") {
			if (
				conflictRef.current === null ||
				!equalsRef.current(conflictRef.current, recordValueRef.current)
			) {
				setConflictBoth(recordValueRef.current);
			}
		}
	}, [value, phase, setBaseBoth, setDraftBoth, setConflictBoth]);

	const closeWithFocus = useCallback(
		(refocus: boolean) => {
			setConflictBoth(null);
			setError(null);
			setDraftBoth(baseRef.current);
			setPhaseBoth("idle");
			if (refocus) refocusRef.current = true;
		},
		[setConflictBoth, setDraftBoth, setPhaseBoth],
	);

	const cancel = useCallback(() => {
		/* A submitted save is committed (the chat header's U1 rule): once the
		 * write is in flight its outcome is the backend's, and an exit that
		 * only closed the editor would promise an abort it cannot make. The
		 * Escape preventDefault still runs at the call site, so the key cannot
		 * reach anything else either. */
		if (phaseRef.current === "saving") return;
		if (phaseRef.current === "idle" || phaseRef.current === "saved") return;
		clearDwell();
		closeWithFocus(true);
	}, [clearDwell, closeWithFocus]);

	const accept = useCallback(
		(next?: T, refocus = true) => {
			const currentPhase = phaseRef.current;
			if (currentPhase === "saving" || currentPhase === "saved") return;
			/* The conflict holds the commit until the choice is answered. */
			if (conflictRef.current !== null) return;
			/* `next` is the explicit-value path (a select's pick has no draft yet);
			 * its absence reads the ref, never a stale closure. Callers never pass
			 * `undefined` meaning something of their own, so the two are the same
			 * decision a `hasOwn` check would make. */
			const candidate = next !== undefined ? next : draftRef.current;
			if (
				!inlineEditAcceptSends(baseRef.current, candidate, equalsRef.current)
			) {
				/* Unchanged: exit with no request (§ 2.2). An explicit gesture
				 * closes it; there is nothing to save. */
				closeWithFocus(refocus && currentPhase !== "idle");
				return;
			}
			const refusal = validateRef.current?.(candidate) ?? null;
			if (refusal !== null) {
				/* A local refusal never leaves the field: no request is made,
				 * and the sentence lands beside the control (§ 2.5). */
				setPhaseBoth("error");
				setError(refusal);
				return;
			}
			setDraftBoth(candidate);
			setError(null);
			setPhaseBoth("saving");
			void commitRef.current(candidate).then(
				() => {
					/* Only this save may finish the field: a resolution arriving
					 * after a cancel must not reopen or close anything. */
					if (phaseRef.current !== "saving") return;
					/* Remember what this save replaced before the base moves: the
					 * window between this resolution and the record's re-read is
					 * the one `pendingSavedRef` paints through. */
					pendingSavedRef.current = {
						saved: candidate,
						previous: baseRef.current,
					};
					setBaseBoth(candidate);
					setDraftBoth(candidate);
					if (refocus) refocusRef.current = true;
					setPhaseBoth("saved");
					clearDwell();
					dwellTimer.current = setTimeout(() => {
						dwellTimer.current = null;
						if (phaseRef.current === "saved") setPhaseBoth("idle");
					}, savedDwellMs);
					announce?.current?.(labelsRef.current.saved);
				},
				(reason: unknown) => {
					if (phaseRef.current !== "saving") return;
					setPhaseBoth("error");
					setError(
						errorCopyRef.current
							? errorCopyRef.current(reason)
							: defaultErrorCopy(reason),
					);
				},
			);
		},
		[
			announce,
			clearDwell,
			closeWithFocus,
			savedDwellMs,
			setBaseBoth,
			setDraftBoth,
			setPhaseBoth,
		],
	);

	const begin = useCallback(() => {
		if (phaseRef.current === "editing" || phaseRef.current === "saving") return;
		clearDwell();
		justBeganRef.current = true;
		/* The seed is what the reader SAW (`recordValueRef`), not the raw prop:
		 * after a save whose re-read is still in flight, the two differ and the
		 * editor must open on the displayed value. */
		setDraftBoth(recordValueRef.current);
		setBaseBoth(recordValueRef.current);
		setConflictBoth(null);
		setError(null);
		setPhaseBoth("editing");
		onBeginRef.current?.();
	}, [clearDwell, setBaseBoth, setConflictBoth, setDraftBoth, setPhaseBoth]);

	const keepMine = useCallback(() => {
		const fresh = conflictRef.current;
		if (fresh === null) return;
		setConflictBoth(null);
		/* The out-of-band value becomes the base, so the commit that follows
		 * writes the draft against the record as it now stands - a partial
		 * PATCH of this field, which cannot revert their change to it. */
		setBaseBoth(fresh);
		accept();
	}, [accept, setBaseBoth, setConflictBoth]);

	const useTheirs = useCallback(() => {
		const fresh = conflictRef.current;
		if (fresh === null) return;
		/*
		 * Adopt the record's value, then CLOSE the field exactly the way an
		 * unchanged accept does (design round 1 D1 / UX round 1 U1 / QA
		 * round 1 Q1): the conflict row unmounts under the pointer, so a
		 * solve that only re-seeded the values left the slot in `editing`
		 * with focus on `<body>` - the button that had focus was gone, the
		 * editor had no working keyboard exit, and only a route round trip
		 * brought the pencil back. Adopting their value leaves nothing to
		 * write, so the field settles to rest with focus on its own slot
		 * control (`closeWithFocus`'s hand-back), same as `Keep mine` lands
		 * on the pencil after its commit.
		 */
		setBaseBoth(fresh);
		closeWithFocus(true);
	}, [closeWithFocus, setBaseBoth]);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			const action = inlineEditKeyAction(event, {
				multiline,
				keyboardCommit,
				onEditor: event.target === editorRefRef.current.current,
			});
			if (action === "revert") {
				/* Claimed, the way every layer that must win claims Escape: the
				 * field owns the key, so a cancel cannot also reach the turn's
				 * interrupt or a dialog's close. */
				event.preventDefault();
				cancel();
				return;
			}
			if (action === "accept") {
				event.preventDefault();
				accept();
			}
		},
		[accept, cancel, keyboardCommit, multiline],
	);

	const handleBlur = useCallback(
		(event: { relatedTarget: EventTarget | null }) => {
			if (phaseRef.current !== "editing") return;
			/*
			 * Focus moving WITHIN the field is the user operating its chrome
			 * (the check/x, a Write|Preview toggle, the estimate's unit): not a
			 * blur. Anything else - another control, the page, nothing - is the
			 * accept-on-click-away rule.
			 */
			const next = event.relatedTarget as Node | null;
			if (next !== null && fieldRef.current?.contains(next)) return;
			/*
			 * A menu the field owns lives in a PORTAL outside this wrapper (Radix),
			 * so the trigger->item focus move it performs on open looks like a
			 * click-away: the status Select's unchanged draft would close the
			 * editor the moment its menu appeared, and the estimate's unit menu
			 * would commit the field mid-gesture (review round 1, M3). Radix wraps
			 * every portalled surface in `[data-radix-popper-content-wrapper]`;
			 * focus landing inside one is focus on the field's own chrome. At
			 * most one popper is open at a time in this app, and the Select
			 * unmounts its menu when the field closes, so the containment cannot
			 * keep a retired field alive.
			 */
			if (
				next instanceof Element &&
				next.closest("[data-radix-popper-content-wrapper]") !== null
			)
				return;
			if (conflictRef.current !== null) return;
			if (
				!inlineEditAcceptSends(
					baseRef.current,
					draftRef.current,
					equalsRef.current,
				)
			) {
				closeWithFocus(false);
				return;
			}
			/* The blur path: a commit, but the keyboard stays where the user put
			 * it (the explicit-gesture hand-back is `accept()`'s default). */
			accept(undefined, false);
		},
		[accept, closeWithFocus],
	);

	const displayValue = phase === "saved" ? draft : recordValue;

	return {
		phase,
		dirty: inlineEditDirty(base, draft, equalsRef.current),
		conflict,
		error,
		draft,
		setDraft: setDraftBoth,
		displayValue,
		editing: inlineEditEditorShown(phase),
		begin,
		accept,
		cancel,
		keepMine,
		useTheirs,
		handleKeyDown,
		handleBlur,
		fieldProps: {
			onKeyDown: handleKeyDown,
			onBlur: handleBlur,
			"aria-busy": phase === "saving" ? true : undefined,
		},
		editorAria: {
			"aria-invalid": error !== null ? true : undefined,
			"aria-describedby":
				error !== null || conflict !== null ? feedbackId : undefined,
		},
		fieldRef,
		editorRef,
		slotRef,
		feedbackId,
		labels,
	};
}
