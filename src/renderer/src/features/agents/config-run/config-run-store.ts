/**
 * The state of the page's configuration run, owned OUTSIDE the page.
 *
 * WHY A MODULE-SCOPE STORE RATHER THAN COMPONENT STATE. The run is a real
 * server-side session that outlives this route: an operator who asks for a team,
 * walks to a conversation to check something, and comes back must find the run
 * still reported — and one who opens the page mid-run, in another window, must
 * find that run rather than start a rival. Component state cannot survive the
 * first, and the run's id cannot be re-derived from a listing, because the run
 * is deliberately NOT in any listing (that is the whole point of its hidden
 * origin). So the id lives here, in module scope, and the page re-attaches to it.
 *
 * WHAT IS NOT HERE, deliberately:
 *
 * - the transcript. The run's own conversation is the server's (`events` /
 *   `watch`), read by `useCanonicalSessionStream` in `use-config-run.ts`; a copy
 *   in this store would be a second, staler source for the same rows.
 * - anything persisted. The store is memory-scope, so a reload forgets the run
 *   and the next send re-attaches through the backend's single-flight refusal
 *   (409 carrying the active id) rather than through a stored id that may be
 *   minutes stale — the reason the design keeps no renderer-side persistence.
 * - a `session_id` in the canonical sessions store. The composer calls
 *   `desktopResult` directly; `createSession` in `canonical-sessions-store.ts`
 *   would `upsertSession` the run and make it a conversation the sidebar tracks,
 *   which is exactly the leak this feature is built to prevent.
 */

import { create } from "zustand";

/** The operator's vocabulary for a run's state (`docs/branding.md` § 7). */
export type ConfigRunStatus =
	| "idle"
	| "running"
	| "stopping"
	| "done"
	| "stopped"
	| "error";

/** One definition the run is working on, as its tool rows named it. */
export type RunTarget = { kind: "agent" | "team"; name: string };

import type { WireImage } from "@features/chat/utils/bound-image";

/** A catalogue field that changed, in the operator's words. */
export type RunChange = { label: string; before: string; after: string };

/** One result of the run: a definition it created or changed. */
export type RunResult = {
	target: RunTarget;
	created: boolean;
	/** Empty for a create, and possibly empty for an update — see `summary.ts`. */
	changes: RunChange[];
};

/** A definition the run changed, as a row mark carries it. */
export type RunMark = RunTarget & {
	/** A row that APPEARED, so its badge says New rather than Updated (D8). */
	created: boolean;
};

export type ConfigRunStore = {
	sessionId: string | null;
	status: ConfigRunStatus;
	/** What the operator asked for, so the strip can say it back. */
	topic: string;
	/** The row the next send is about, when one is selected on the page. */
	about: RunTarget | null;
	error: string | null;
	/**
	 * A Stop the backend REFUSED, while the run is still going.
	 *
	 * WHY THIS IS NOT `error` (UX review round 3, U1). Folding a refused stop into
	 * the error state rendered the settled shape for a run that had NOT stopped:
	 * the live Stop control and the elapsed time both disappeared, so Dismiss was
	 * the only control left while the run went on writing definitions. A refused
	 * interrupt RPC is not the run stopping, so the status stays `running` (Stop
	 * stays pressable, the elapsed keeps counting) and this carries the reason the
	 * refusal gave, which the strip shows under its own sentence.
	 */
	stopError: string | null;
	/**
	 * The request was never delivered to the run, so re-sending it is safe.
	 *
	 * WHY THIS IS A FLAG RATHER THAN "sessionId is set". The id survives every
	 * failure (see `fail`), because the run must stay nameable — and that made
	 * "Retry" appear on failures where the request HAD been delivered: a
	 * settle-read failure after a run that may have written definitions, a
	 * dropped transport while the run is still going, a failed Stop. Retrying
	 * those posts the original request a SECOND time onto a session that already
	 * has it (agent review round 2, M-new). Only the `sessions.message` catch —
	 * and the retry's own catch — set this, and only while it is set is there
	 * anything to send again.
	 */
	unsent: boolean;
	startedAt: number | null;
	settledAt: number | null;
	/** Definitions the run has touched so far, as its tool rows named them. */
	touched: RunTarget[];
	/** The settled summary; empty until the run settles. */
	results: RunResult[];
	/**
	 * What the run answered, captured at settle time because the transcript is
	 * unreadable afterwards. A run that changed nothing has only this to show
	 * (review round 1, U3).
	 */
	answer: string;
	/** Rows to mark "Updated by a configuration run" until each is opened. */
	marks: RunMark[];
	/** Signature of the catalogues at send time, for the settle-time diff. */
	before: unknown;

	setAbout: (about: RunTarget | null) => void;
	/**
	 * The encoded images the ACCEPTED request carried, so a retry repeats it.
	 *
	 * The retry rule is that it re-sends the same body byte-for-byte or answers 409
	 * (`Prompt`, `desktop_sessions.py:1030`), and an attachment-carrying send whose
	 * retry dropped the images would be a different request — the silent payload
	 * drop the mount exists to avoid. Kept beside `topic`, which is that rule's
	 * other half.
	 */
	images: WireImage[];
	/**
	 * A run exists and is live.
	 *
	 * THE DRAFT IS NOT SPENT HERE, and that is the rule this store used to hold with
	 * a `draft` field of its own: the box's text lives in `useConversationInputStore`
	 * (keyed `agents-config`), which spends it only on a send the backend actually
	 * took — never on the create alone (review round 1, M2: the attach path said
	 * "it is still in the box" and then emptied it). The store's own `draft` field
	 * was left behind by that move and rendered by nothing, so it was removed in QA
	 * round 2 (Q1) rather than kept as a second, silent copy of the operator's text.
	 */
	adopt: (
		sessionId: string,
		topic: string,
		before: unknown,
		images?: WireImage[],
	) => void;
	noteTouched: (target: RunTarget) => void;
	stopping: () => void;
	/** The interrupt was refused: the run is still going, and the strip says so. */
	stopFailed: (message: string) => void;
	settle: (
		results: RunResult[],
		status: "done" | "stopped",
		answer: string,
	) => void;
	/** A failure that keeps the run's session, so a Retry can reach it again. */
	fail: (message: string) => void;
	/** The send itself failed: the request is still unsent and retryable. */
	failUnsent: (message: string) => void;
	dismiss: () => void;
	clearMark: (target: RunTarget) => void;
};

const sameTarget = (a: RunTarget, b: RunTarget) =>
	a.kind === b.kind && a.name === b.name;

export function targetKey(target: RunTarget): string {
	return `${target.kind}:${target.name}`;
}

export const useConfigRunStore = create<ConfigRunStore>((set) => ({
	sessionId: null,
	status: "idle",
	topic: "",
	images: [],
	about: null,
	error: null,
	stopError: null,
	unsent: false,
	startedAt: null,
	settledAt: null,
	touched: [],
	results: [],
	answer: "",
	marks: [],
	before: null,

	setAbout: (about) => set({ about }),

	adopt: (sessionId, topic, before, images = []) =>
		set({
			sessionId,
			status: "running",
			topic,
			images,
			error: null,
			stopError: null,
			startedAt: Date.now(),
			settledAt: null,
			touched: [],
			results: [],
			answer: "",
			before,
			unsent: false,
		}),

	noteTouched: (target) =>
		set((state) =>
			state.touched.some((each) => sameTarget(each, target))
				? state
				: { touched: [...state.touched, target] },
		),

	stopping: () =>
		set((state) =>
			/*
			 * A second press clears the previous refusal: the operator has asked
			 * again, so the old sentence is no longer what happened last.
			 */
			state.status === "running"
				? { status: "stopping", stopError: null }
				: state,
		),

	stopFailed: (message) =>
		/*
		 * THE RUN KEEPS GOING, AND THE STRIP KEEPS ITS CONTROLS (UX review round 3,
		 * U1). `running` rather than `error`, deliberately: the stop did not take,
		 * so Stop must still be pressable and the elapsed must keep counting —
		 * a supervised run the operator can no longer cancel is the failure this
		 * whole state exists to prevent.
		 */
		set({ status: "running", stopError: message }),

	settle: (results, status, answer) =>
		set(() => ({
			status,
			settledAt: Date.now(),
			results,
			answer,
			/*
			 * The marks are the rows the operator has not LOOKED at yet, so a run
			 * that changed nothing marks nothing — and a create marks too, because
			 * "a row appeared while I was not looking" is the same question as "a
			 * row changed while I was not looking". The badge follows the same flag:
			 * a created row is New, not Updated (review round 1, D8).
			 */
			marks: results.map((result) => ({
				...result.target,
				created: result.created,
			})),
			sessionId: null,
			// A settled run has no request left to repeat, images included.
			images: [],
			// A run that settled has nothing left to refuse: the stop is moot.
			stopError: null,
			// `before` is spent by the diff it was taken for.
			before: null,
			// Nothing to re-send once the run has finished.
			unsent: false,
		})),

	fail: (message) =>
		/*
		 * THE RUN'S ID SURVIVES A FAILED CALL. The create may already have made a
		 * real session, and dropping the id left it unreachable: no Stop and no way
		 * to name the run (review round 1, M2). `sessionId` is only ever non-null
		 * here when a create did land, because `adopt` is the only writer and a
		 * failed create never reaches it.
		 *
		 * `unsent: false` IS THE OTHER HALF, and it is not a formality: these are the
		 * paths where the request WAS delivered (a settle read that failed, a dropped
		 * transport, a refused Stop), so re-sending it would run it twice. Only
		 * `failUnsent` marks a request that never left.
		 */
		set({ status: "error", error: message, unsent: false, stopError: null }),

	failUnsent: (message) =>
		set({ status: "error", error: message, unsent: true, stopError: null }),

	dismiss: () =>
		set({
			status: "idle",
			sessionId: null,
			error: null,
			stopError: null,
			unsent: false,
			topic: "",
			images: [],
			touched: [],
			results: [],
			answer: "",
			marks: [],
			startedAt: null,
			settledAt: null,
			before: null,
		}),

	clearMark: (target) =>
		set((state) => ({
			marks: state.marks.filter((each) => !sameTarget(each, target)),
		})),
}));
