/**
 * "Request update": the frozen copy, and the ONE cooldown both entry points share.
 *
 * WHY THIS MODULE EXISTS AT ALL. The action has two doors - the board card's
 * `...` menu and the detail header's button - and the design freezes them as
 * one behaviour with one 60 s window per project. Component-local state would
 * let the two doors disagree about "already asked": press the card's menu, walk
 * to the detail page, press the button, and two identical check-ins would go
 * out - each one a mailbox drop with wake-on-deliver that starts an agent turn.
 * So the state is module-level and both doors subscribe to it.
 *
 * WHAT IS PURE AND WHAT IS NOT. Everything in this file is pure or module
 * state: the copy composition (a function of the wire answer), the sentence
 * builders, and a Map/Set pair with a subscribe/notify. The asynchronous flow -
 * the op, the toasts, the timer - lives in `hooks/use-request-update.ts`, so
 * the sentences a reviewer reads in a frame are the same code a test pins
 * (`scripts/projects-request-update.test.mjs`) with no transport in the way.
 *
 * NOT PERSISTED, deliberately. A reload drops the cooldown while the peer
 * messages stay in the recipients' mailboxes; the reload is the operator's own
 * act, and the LABEL and the SERVER must still agree, which is why the route
 * carries its own window and answers `state: "cooldown"` (the UI then re-arms
 * its map from the server's numbers - see the hook).
 *
 * THE COOLDOWN'S START RULE IS A UX FREEZE CONDITION (U4 of the consult):
 * delivered>=1 OR unconfirmed>=1. A batch where every session refused, or one
 * that reached nobody, leaves the user free to retry immediately; a batch that
 * put a message into at least one mailbox - or whose delivery could not be
 * CONFIRMED, which the peer layer says may still have landed - must not invite
 * a second round trip inside the window.
 */

import type {
	DesktopProjectRequestUpdateResult,
	DesktopProjectRequestUpdateSession,
} from "../../../../shared/desktop-control-contract";
import { projectDisplayName, sessionLabel } from "./project-model";

/** The window, in ms. The route carries the same 60 s server-side. */
export const REQUEST_UPDATE_COOLDOWN_MS = 60_000;

/** The info toast's lifetime (empty / cooldown): long enough to read, and gone. */
export const REQUEST_UPDATE_TOAST_DURATION_MS = 6_000;

/**
 * The loading toast: shown only if the request is still in flight after 400 ms,
 * so a fast round trip never flashes a card, and replaced in place by the
 * result through the SAME toast id.
 */
export const REQUEST_UPDATE_LOADING_COPY = "Requesting updates…";
export const REQUEST_UPDATE_LOADING_DELAY_MS = 400;

/** The detail button's tooltip. REQUIRED: the list view is the DEFAULT view and
 * has no card menu, so the button is the only door most users ever see. */
export const REQUEST_UPDATE_TOOLTIP =
	"Ask the sessions linked to this project to post a progress update";

/**
 * The backend's own sentence for a linked session that has never been engaged
 * (`peer_send.py`'s unengaged refusal, surfaced by the route). FROZEN cross-
 * repository: the route (PR-A) emits exactly this string for that case, and the
 * all-failed toast switches to its never-started variant only when EVERY failed
 * session carries it. A backend that rewords it degrades to the generic
 * sentence, which stays true - it does not fabricate anything.
 */
export const REQUEST_UPDATE_NEVER_STARTED_DETAIL =
	"linked but not yet in use — it becomes a recipient after the first message";

/*
 * The three stable ids. WHY STABLE: sonner allots every id-less call a fresh
 * numeric id, so repeats would STACK cards carrying different numbers (the
 * cooldown sentence is computed at press time). A stable id makes a repeat
 * REPLACE the card it supersedes - the same idiom the loading->result
 * replacement already uses, not a second one (UX consult U5).
 *
 * Two ids per project on purpose: the result and the cooldown are different
 * answers (a persistent partial-failure warning must survive a cooldown press,
 * and a cooldown press must not silently delete it).
 */
export const requestUpdateToastId = (projectId: string): string =>
	`project-request-update-${projectId}`;
export const requestUpdateCooldownToastId = (projectId: string): string =>
	`project-request-cooldown-${projectId}`;
/** The visually-hidden span the `aria-disabled` button points at while cooling. */
export const requestUpdateCooldownSpanId = (projectId: string): string =>
	`project-request-update-cooldown-${projectId}`;

export type RequestUpdateToastVariant = "success" | "warning" | "error" | "info";

export type RequestUpdateToast = {
	variant: RequestUpdateToastVariant;
	title: string;
	/**
	 * Sonner's own `duration` (ms). `undefined` = the container's default
	 * lifetime, which success rides; the persistent outcomes pass `Infinity`
	 * (dismissible - the container always renders its close button).
	 */
	duration?: number;
};

/** Up to two names, then a count: `A and B`, or `A, B and 2 more`. */
const namesClause = (names: string[]): string => {
	if (names.length === 1) return names[0];
	if (names.length === 2) return `${names[0]} and ${names[1]}`;
	return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
};

const outcomeNames = (
	result: DesktopProjectRequestUpdateResult,
	outcome: DesktopProjectRequestUpdateSession["outcome"],
): string[] =>
	result.sessions
		.filter((session) => session.outcome === outcome)
		.map((session) =>
			sessionLabel({ session_id: session.session_id, title: session.title }),
		);

const isNeverStarted = (session: DesktopProjectRequestUpdateSession): boolean =>
	session.outcome === "failed" &&
	session.detail === REQUEST_UPDATE_NEVER_STARTED_DETAIL;

/**
 * The cooldown sentence, from the remaining ms alone.
 *
 * ONE RULE FOR TWO SOURCES (the local map's deadline and the server's
 * `cooldown_remaining_s`): `left` is CEILED (never claim less time than there
 * is) and `ago` is the window minus `left`, so the two numbers always sum to
 * the window and the sentence cannot read "requested 20 s ago ... try again in
 * 39 s" for a 60 s window. At the arming moment that is "0 s ago ... 60 s".
 */
export function requestUpdateCooldownSentence(
	display: string,
	remainingMs: number,
): string {
	const left = Math.max(1, Math.ceil(remainingMs / 1000));
	const ago = Math.max(0, Math.ceil(REQUEST_UPDATE_COOLDOWN_MS / 1000) - left);
	return `Update already requested ${ago} s ago on ${display}. Try again in ${left} s.`;
}

/**
 * The one sentence the whole press resolves to, from the wire answer.
 *
 * FROZEN COPY (spec PR-B; {X} = the project's display name - title, else key -
 * because the toast appears far from the card the user pressed). The verbs stay
 * at "requested"/"ask": a mailbox drop is a request, not a receipt.
 *
 * The three-way vocabulary is honest about uncertainty (the UX freeze): a
 * delivery that could not be CONFIRMED is its own outcome and gets its own
 * clause, never the "could not be reached" wording that would assert a fact
 * nobody knows - and that clause plus the cooldown are the only guard against
 * the duplicate the peer layer's own refusal sentence warns about.
 */
export function requestUpdateResultToast(
	result: DesktopProjectRequestUpdateResult,
): RequestUpdateToast | null {
	const display = projectDisplayName({
		title: result.project.title,
		name: result.project.key,
	});
	const { delivered, unconfirmed, failed, total } = result.counts;

	if (result.state === "empty") {
		return {
			variant: "info",
			title: `No linked sessions to ask. Link a session to ${display} first.`,
			duration: REQUEST_UPDATE_TOAST_DURATION_MS,
		};
	}
	if (result.state === "cooldown") {
		return {
			variant: "info",
			title: requestUpdateCooldownSentence(
				display,
				Math.max(0, result.cooldown_remaining_s ?? 0) * 1000,
			),
			duration: REQUEST_UPDATE_TOAST_DURATION_MS,
		};
	}
	if (result.state !== "sent") return null;

	const failedNames = outcomeNames(result, "failed");
	const unconfirmedNames = outcomeNames(result, "unconfirmed");

	if (delivered >= 1 && failed === 0 && unconfirmed === 0) {
		return {
			variant: "success",
			title:
				delivered === 1
					? `Requested an update from 1 session on ${display}.`
					: `Requested updates from ${delivered} sessions on ${display}.`,
		};
	}
	if (delivered >= 1) {
		let title = `Requested updates from ${delivered} of ${total} sessions on ${display}.`;
		if (failed > 0) title += ` ${namesClause(failedNames)} could not be reached.`;
		if (unconfirmed > 0)
			title += ` Delivery to ${namesClause(unconfirmedNames)} could not be confirmed.`;
		return { variant: "warning", title, duration: Infinity };
	}
	if (failed === 0) {
		/* Every target unconfirmed: nothing may be asserted about arrival. */
		return {
			variant: "warning",
			title: `Could not confirm delivery on ${display} — the requests may still reach its sessions.`,
			duration: Infinity,
		};
	}
	if (unconfirmed === 0) {
		const neverStarted = result.sessions.every(isNeverStarted);
		/*
		 * FROZEN COPY (backend QA round, 2026-10-01): the never-started sentence
		 * has a SINGULAR branch for the one-link batch so both lanes read the
		 * same on N=1; the plural stays for N>1. A batch where any session
		 * refused for another reason is not "not started" and keeps the generic
		 * sentence.
		 */
		let title: string;
		if (neverStarted) {
			title =
				total === 1
					? "The linked session has not started yet — it becomes a recipient after its first message."
					: `The ${total} linked sessions have not started yet — they become recipients after their first message.`;
		} else {
			title = `Could not reach any of the ${total} linked sessions on ${display}.`;
		}
		return { variant: "error", title, duration: Infinity };
	}
	/* Nothing delivered and nothing confirmed: some refused, some uncertain.
	 * The mixed sentence is composed here (the frozen set names the two pure
	 * ends); it counts the refusals rather than naming them, because naming a
	 * subset as "the ones not reached" is what the "any of" wording cannot say. */
	return {
		variant: "warning",
		title: `Could not reach ${failed} of the ${total} linked sessions on ${display}. Delivery to ${namesClause(unconfirmedNames)} could not be confirmed.`,
		duration: Infinity,
	};
}

/* ------------------------------------------------------------------ the store */

type Cooldown = { startedMs: number; untilMs: number };

const cooldowns = new Map<string, Cooldown>();
const inFlight = new Set<string>();
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

/**
 * The snapshot identity `useSyncExternalStore` compares. It changes on every
 * mutation of the two collections, so a component that derives `sending` /
 * `cooling` re-renders exactly when an answer could have changed them.
 */
let snapshot = 0;

const emit = (): void => {
	snapshot += 1;
	for (const listener of listeners) listener();
};

export const subscribeRequestUpdate = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export const requestUpdateSnapshot = (): number => snapshot;

export const isRequestUpdateInFlight = (projectId: string): boolean =>
	inFlight.has(projectId);

export const requestUpdateCooldown = (
	projectId: string,
): Cooldown | undefined => cooldowns.get(projectId);

export function beginRequestUpdate(projectId: string): void {
	inFlight.add(projectId);
	emit();
}

export function endRequestUpdate(projectId: string): void {
	inFlight.delete(projectId);
	emit();
}

/**
 * Arm (or extend) the window. A later, shorter deadline NEVER replaces a longer
 * one: the flow reports the same batch through one answer, but a slow second
 * arm (a server `cooldown_remaining_s` that raced) must not hand the user a
 * fresh 60 s, and an overlapping answer must not shave the window either.
 */
export function armRequestUpdateCooldown(
	projectId: string,
	startedMs: number,
	untilMs: number,
): void {
	const nowMs = Date.now();
	if (untilMs <= nowMs) return;
	const current = cooldowns.get(projectId);
	if (current && current.untilMs >= untilMs) return;
	cooldowns.set(projectId, { startedMs, untilMs });
	const prior = expiryTimers.get(projectId);
	if (prior) clearTimeout(prior);
	const timer = setTimeout(() => {
		expiryTimers.delete(projectId);
		const held = cooldowns.get(projectId);
		if (held && held.untilMs <= Date.now()) {
			cooldowns.delete(projectId);
			emit();
		}
	}, untilMs - nowMs);
	/*
	 * `unref` exists on Node's timer handle and not the DOM's. The jsdom suite
	 * bundles this module for real, and a 60 s timer that outlives the last
	 * assertion holds `node --test` open; a browser timer has no `unref` and
	 * does not need one.
	 */
	(timer as unknown as { unref?: () => void }).unref?.();
	expiryTimers.set(projectId, timer);
	emit();
}

/**
 * Forget everything: both maps, every timer, and the snapshot. NOT called by
 * production code - it exists for the fixtures and tests that mount the same
 * tree twice in one document (the `resetToastDedup` precedent in
 * `toast-manager.ts`), where a window left armed by one mount would silently
 * disable the next mount's first press.
 */
export const resetRequestUpdateState = (): void => {
	for (const timer of expiryTimers.values()) clearTimeout(timer);
	expiryTimers.clear();
	cooldowns.clear();
	inFlight.clear();
	emit();
};

export type { Cooldown as RequestUpdateCooldown };
