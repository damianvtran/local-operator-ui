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

/** A catalogue field that changed, in the operator's words. */
export type RunChange = { label: string; before: string; after: string };

/** One result of the run: a definition it created or changed. */
export type RunResult = {
	target: RunTarget;
	created: boolean;
	/** Empty for a create, and possibly empty for an update — see `summary.ts`. */
	changes: RunChange[];
};

export type ConfigRunStore = {
	sessionId: string | null;
	status: ConfigRunStatus;
	/** What the operator asked for, so the strip can say it back. */
	topic: string;
	/**
	 * The compose box's text, retained across a refusal.
	 *
	 * A draft that survives a failure is the difference between "the backend was
	 * down" and "I lost what I typed" (UX brief, must-nots), and the box is
	 * cleared only by a send that was actually accepted.
	 */
	draft: string;
	/** The row the next send is about, when one is selected on the page. */
	about: RunTarget | null;
	error: string | null;
	startedAt: number | null;
	settledAt: number | null;
	/** Definitions the run has touched so far, as its tool rows named them. */
	touched: RunTarget[];
	/** The settled summary; empty until the run settles. */
	results: RunResult[];
	/** Rows to mark "Updated by a configuration run" until each is opened. */
	marks: RunTarget[];
	/** Signature of the catalogues at send time, for the settle-time diff. */
	before: unknown;

	setDraft: (draft: string) => void;
	setAbout: (about: RunTarget | null) => void;
	/** A send was accepted: the run exists. */
	adopt: (sessionId: string, topic: string, before: unknown) => void;
	noteTouched: (target: RunTarget) => void;
	stopping: () => void;
	settle: (results: RunResult[], status: "done" | "stopped") => void;
	fail: (message: string) => void;
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
	draft: "",
	about: null,
	error: null,
	startedAt: null,
	settledAt: null,
	touched: [],
	results: [],
	marks: [],
	before: null,

	setDraft: (draft) => set({ draft }),
	setAbout: (about) => set({ about }),

	adopt: (sessionId, topic, before) =>
		set({
			sessionId,
			status: "running",
			topic,
			error: null,
			startedAt: Date.now(),
			settledAt: null,
			touched: [],
			results: [],
			before,
			// The draft is spent by a send that was accepted; a FOLLOW-UP starts
			// from an empty box rather than from the previous request's text.
			draft: "",
		}),

	noteTouched: (target) =>
		set((state) =>
			state.touched.some((each) => sameTarget(each, target))
				? state
				: { touched: [...state.touched, target] },
		),

	stopping: () =>
		set((state) =>
			state.status === "running" ? { status: "stopping" } : state,
		),

	settle: (results, status) =>
		set(() => ({
			status,
			settledAt: Date.now(),
			results,
			/*
			 * The marks are the rows the operator has not LOOKED at yet, so a run
			 * that changed nothing marks nothing — and a create marks too, because
			 * "a row appeared while I was not looking" is the same question as "a
			 * row changed while I was not looking".
			 */
			marks: results.map((result) => result.target),
			sessionId: null,
			// `before` is spent by the diff it was taken for.
			before: null,
		})),

	fail: (message) => set({ status: "error", error: message, sessionId: null }),

	dismiss: () =>
		set({
			status: "idle",
			sessionId: null,
			error: null,
			topic: "",
			touched: [],
			results: [],
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
