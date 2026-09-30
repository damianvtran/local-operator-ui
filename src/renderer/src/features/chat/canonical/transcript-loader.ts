/**
 * The shared backward loader: one home for the fetch-until-resident policy
 * that three callers used to each carry a copy of — the reader's own paging,
 * the align path's fetch, and the jump's `ensureReachable` — plus the
 * whole-session turn OUTLINE the condensation lane's model-side fix consumes
 * (the rail's rungs come from the store's own rows, not from here).
 *
 * WHY IT EXISTS. The transcript is newest-anchored and lazy: a row the reader
 * jumps to may be pages behind the loaded window, and before this module the
 * walk to it was written per-caller. Three copies meant three budgets, three
 * stop conditions and three chances to spin; the collapse lane's diagnosis
 * (credited — their repro of settled turns that never condense because the
 * opening user row is unloaded) names the same root: the walk to a row belongs
 * to ONE pager, and every caller asks it for the row it needs.
 *
 * WHAT IT OWNS AND WHAT IT DELEGATES. The loader owns POLICY: the page and
 * row budgets, the single shared in-flight fetch, the "a page that applied
 * nothing ends the walk" guard, and the frame waits that let a state write
 * reach the DOM. It owns no state and no DOM: the caller injects `reachable`
 * (its own DOM test), `rowDistance` (the model's distance-to-tail), `mount`
 * (the window write) and `loadOlder` (its pager). `transcript-reducer.ts`
 * stays the store; this module never duplicates it.
 *
 * THE OUTLINE'S STABLE ID (the collapse lane's keying). Their expansion state
 * keys on a turn's identity, and a run first seen with its head cut off — the
 * newer half of a page split — must keep that identity when the older page
 * arrives with its opening user row, or the expansion is lost exactly when the
 * head lands. So `OutlineTurn.id` is the CLOSING ANSWER's id whenever the turn
 * has one (it is known from the first sight of the newer half and never
 * changes), falling back to the opening record's id only for a turn whose
 * answer is not loaded yet. `scripts/transcript-loader.test.mjs` pins the
 * head-arrival case.
 *
 * The walk's shape is `reveal-record.ts`'s near path, generalized: load until
 * the row is held, fetch the margin's page while the store ends at the row (a
 * centred landing needs rows ABOVE the target; QA Q-2's measured −254 px
 * top-clamp), mount the window wide enough, wait for the commit, and refuse in
 * both currencies the design names — pages fetched and rows mounted. A refusal
 * is an outcome, never a throw: every path resolves.
 */

import type { Row } from "./transcript-rows";
import { runsOf } from "./transcript-rows";

/**
 * How many frames a mount or an applied page is given to reach the DOM.
 *
 * Both land through a state write, so the DOM does not know about either until
 * a commit after the promise resolves. Six frames (~100 ms) is generous for a
 * commit and still bounds a walk whose row will never appear; the loop re-reads
 * its state after each wait, so a slow frame costs latency, never correctness.
 * (`reveal-record.ts` derives its number from this constant, so the two cannot
 * drift.)
 */
export const LOADER_SETTLE_FRAMES = 6;

/*
 * Exported because the jump's anchor settle (`reveal-record.ts`, issue #680)
 * waits on the same frame boundary: two private copies of "one rAF" would be
 * two answers to what a settle frame is.
 */
export const nextFrame = (): Promise<void> =>
	new Promise((resolve) => {
		window.requestAnimationFrame(() => {
			resolve();
		});
	});

const settleFrames = async (done: () => boolean): Promise<void> => {
	for (let i = 0; i < LOADER_SETTLE_FRAMES; i += 1) {
		if (done()) return;
		await nextFrame();
	}
};

/**
 * The caller's half of the loader: four functions over ITS model, named by
 * what they answer rather than how they are implemented.
 */
export type LoaderPager = {
	/** The row's element is in the DOM (the caller's own reachability test). */
	reachable: () => boolean;
	/**
	 * How many rows from the tail the row sits, i.e. the window width that
	 * would include it. `null` when the model does not hold it (yet).
	 */
	rowDistance: () => number | null;
	/** Mount the window `distance` rows wide (newest-anchored). */
	mount: (distance: number) => void;
	/** Fetch one older page; `false` when nothing was applied. */
	loadOlder: () => Promise<boolean>;
	/**
	 * When the row is held: whether the model already holds the margin above
	 * it (older rows) that a CENTRED landing needs. Optional; `true` is the
	 * default for a caller with no margin requirement, and the walk fetches
	 * while it is false, inside the page budget.
	 */
	hasHeadroom?: () => boolean;
};

/*
 * The pager's functions take no row id: every caller closes over the row it is
 * asking about (the jump's target lives in the component that called it), so an
 * id parameter no implementation could fill would be ceremony. A future caller
 * that holds ids shapes its own closures around this type.
 */

export type LoadThroughBudget = {
	/** Pages this walk may fetch. */
	maxPages: number;
	/**
	 * Mount budget, in rows from the tail. Omitted for no row cap. A target
	 * beyond it is refused (`"over-budget"`) rather than mounted: the render
	 * window would have to grow past what the caller allows.
	 */
	maxRows?: number;
};

/**
 * `"landed"`: the row is in the DOM. `"exhausted"`: history ended before the
 * row arrived, or a mount did not settle — both a sentence for the caller,
 * never an error. `"over-budget"`: the row is held but further back than
 * `maxRows` allows.
 */
export type LoadThroughOutcome = "landed" | "exhausted" | "over-budget";

/**
 * One fetch at a time, shared: a caller arriving while a fetch is in flight
 * awaits THAT fetch instead of being told nothing applied.
 *
 * WHY IT IS NOT JUST "THE GUARD THE PAGER ALREADY HAS". The reader's pager
 * refuses a concurrent ask with `false` — "no page applied" — which is the
 * right answer for a scroll that would otherwise double-apply a page. But
 * `false` is also what a walk reads as "history ends here", so a jump that
 * fired while a paging fetch was in flight used to fall through to a clamped
 * mount instead of awaiting the page already on its way. Sharing the promise
 * makes the collision a WAIT for the callers that opt in, and leaves the
 * refusals to the callers that want them.
 */
export const shareInFlight = (
	load: () => Promise<boolean>,
): (() => Promise<boolean>) => {
	let inFlight: Promise<boolean> | null = null;
	return () => {
		if (inFlight !== null) return inFlight;
		inFlight = load().finally(() => {
			inFlight = null;
		});
		return inFlight;
	};
};

/**
 * One backward loader over one pager.
 *
 * The reason it is a factory rather than a bare function is the SHARED
 * IN-FLIGHT PROMISE: every caller of the same loader awaits the same fetch, so
 * a reader paging and a jump firing together spend one page, not two. The
 * promise clears when it settles — the next ask is a new fetch, and a caller a
 * settle behind re-checks its own model rather than trusting a stale result.
 */
export const createBackwardLoader = (pager: LoaderPager) => {
	/** One older page, deduplicated across concurrent callers. */
	const loadOne = shareInFlight(pager.loadOlder);

	/**
	 * Fetch the margin above the target, or say the store ends here.
	 *
	 * A page that cannot be applied ends the margin walk: either history
	 * starts here or the fetch was raced, and in both cases the landing is
	 * clamped at the content's top — which, at the start of history, is where
	 * the row IS. The walk then mounts instead of refusing a row the model
	 * already holds.
	 */
	const settleOnModel = (): Promise<void> =>
		settleFrames(() => pager.reachable() || pager.rowDistance() !== null);

	const loadThrough = async (
		budget: LoadThroughBudget,
	): Promise<LoadThroughOutcome> => {
		const hasHeadroom = pager.hasHeadroom ?? (() => true);
		let pages = 0;
		while (true) {
			if (pager.reachable()) return "landed";
			const distance = pager.rowDistance();
			if (distance !== null) {
				if (budget.maxRows !== undefined && distance > budget.maxRows) {
					return "over-budget";
				}
				if (!hasHeadroom() && pages < budget.maxPages) {
					pages += 1;
					if (await loadOne()) {
						await settleOnModel();
						continue;
					}
				}
				pager.mount(distance);
				await settleFrames(() => pager.reachable());
				return pager.reachable() ? "landed" : "exhausted";
			}
			if (pages >= budget.maxPages) return "exhausted";
			pages += 1;
			if (!(await loadOne())) return "exhausted";
			/*
			 * The applied page lands a commit later; waiting for the model to
			 * show it is what stops the walk fetching the next page blind (and
			 * what stops a fast loop from spending its whole page budget in one
			 * task).
			 */
			await settleOnModel();
		}
	};

	return { loadOne, loadThrough };
};

/**
 * One turn of the whole-session outline: identity and previews, independent of
 * the resident window (a row in the store but not mounted still has its turn).
 */
export type OutlineTurn = {
	/**
	 * Stable per-turn identity — the collapse lane's state key. The closing
	 * answer's id when the turn has one, else the opening record's id. See the
	 * module header for why the answer's id wins and why this never changes
	 * when the head arrives.
	 */
	id: string;
	/** The opening user row's id, or null while that row is unloaded. */
	openingRecordId: string | null;
	/** The turn's closing answer id, or null while the turn is open. */
	closingAnswerId: string | null;
	opensWithUserRow: boolean;
	/** The opening user row's text, when that row is loaded. */
	userText: string | null;
	/** The closing answer's text, when that row is loaded. */
	answerText: string | null;
};

/**
 * The outline over the rows a caller holds.
 *
 * Deliberately NOT "loaded/unloaded per turn": residency is the mount's
 * business, and the outline describes the STORE. A caller that needs the
 * window distinction overlays it from its own mount state rather than asking
 * this function to guess. Previews come only from loaded rows — a turn whose
 * text is pages away contributes identity, not invented copy.
 */
export function turnsOutline(rows: Row[]): OutlineTurn[] {
	return runsOf(rows).map((run) => {
		const first = rows[run.openingIndex]?.record ?? null;
		const opening = run.opensWithUserRow ? first : null;
		const closing = run.closingAnswerId;
		const answer = closing
			? rows.find(
					(entry) =>
						entry.record.id === closing && entry.record.kind === "assistant",
				)
			: undefined;
		return {
			id: closing ?? first?.id ?? run.key,
			openingRecordId: opening?.id ?? null,
			closingAnswerId: closing,
			opensWithUserRow: run.opensWithUserRow,
			userText:
				opening !== null && opening.kind === "user" ? opening.text : null,
			answerText:
				answer !== undefined && answer.record.kind === "assistant"
					? answer.record.text
					: null,
		};
	});
}
