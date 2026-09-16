/**
 * Local Operator API - the wake surface (the Schedules page).
 *
 * Four operations against the machine-wide wake routes, all through the
 * authenticated desktop contract rather than a bare `fetch`: the write ops arm
 * work that a detached turn will later run as the user, so they sit behind the
 * desktop bearer and a same-origin check exactly as the legacy schedules
 * family does.
 *
 * `schedules-api.ts` stays, and is not a duplicate of this file: the fenced
 * legacy group on the page still reads and edits rows on the older
 * agent-schedule engine, and those rows keep running until the engine is
 * retired. One client per engine, each named for the engine it speaks to.
 */
import type {
	DesktopWakeCreateResponse,
	DesktopWakeEntry,
	DesktopWakeScheduleRow,
	DesktopWakeSupervisor,
	DesktopWakesListResponse,
} from "../../../../../shared/desktop-contract";
import { UserFacingError, desktopResult } from "./desktop-api";

/**
 * Re-exported so a consumer of this module reads one import for one operation
 * family: the response types are the contract's (they describe the wire), and a
 * second definition here is how the page and the wire would come to disagree.
 */
export type {
	DesktopWakeCreateResponse,
	DesktopWakeEntry,
	DesktopWakeScheduleRow,
	DesktopWakeSupervisor,
	DesktopWakesListResponse,
};

/**
 * What a create may say about WHEN the wake first fires.
 *
 * Exactly one of the two, and the pair is the interface's (`in` a duration the
 * backend parses relative to now, `at` an instant or a clock time it parses
 * against the next local occurrence). Kept as a union rather than two optional
 * strings so a caller cannot send neither - which the backend would only
 * discover as a 422 - or both, which has no meaning at all.
 */
export type WakeFirstRun = { in: string } | { at: string };

/**
 * What a create may say about WHERE it runs.
 *
 * The two shapes the route accepts, and they are mutually exclusive by
 * construction: `sessionId` arms into a conversation that exists, `cwd`
 * (with the optional `target` profile) has the backend create one and arm it in
 * the same request. The exclusivity is structural here rather than validated
 * later because this is the only place the request is built.
 */
export type WakeDestination =
	| { sessionId: string }
	| { cwd: string; target?: { kind: "agent" | "team"; name: string } };

export type WakeCreateInput = WakeDestination & {
	/** At-most-once receipt key: a retried request must not arm two wakes. */
	requestId: string;
	message: string;
	firstRun: WakeFirstRun;
	/** A repeat interval in the tool's own durations (`30m`, `1h`, `2d`, `1w`). */
	every?: string;
	/** The repeat's end, as an instant the backend parses. Only with `every`. */
	until?: string;
	/** The repeat's end, as a delivery count. Only with `every`. */
	limit?: number;
};

export type WakeEditInput = {
	sessionId: string;
	wakeId: string;
	message?: string;
	/** A timing change REPLACES the anchor, so the caller sends the new value. */
	firstRun?: WakeFirstRun;
	every?: string;
	until?: string;
	limit?: number;
};

/**
 * A create request's body, in the DESKTOP CONTRACT's field names.
 *
 * Deliberately not the wire's snake_case: `desktopEndpoint` is the one place
 * that maps each contract op to its HTTP body, and doing that translation here
 * as well would put the same rename in two files that could then disagree.
 * The shape is what the exported helper below returns.
 */
export type WakeCreateBody = {
	requestId: string;
	sessionId?: string;
	cwd?: string;
	target?: { kind: "agent" | "team"; name: string };
	message: string;
	in?: string;
	at?: string;
	every?: string;
	until?: string;
	limit?: number;
};

/**
 * A create request's body, with the destination's two shapes resolved.
 *
 * Exported and separate from `WakesApi.create` because it is the half of the
 * XOR the contract's schema cannot state: a `.refine()` on the op object would
 * make it a `ZodEffects`, which the discriminated union cannot take (the note
 * at `mcp.credentials.store` records that trap), so the rule is enforced where
 * the body is built. A body that names neither is refused HERE with a sentence
 * rather than reaching the wire as a request the backend answers 422 to.
 */
export function wakeCreateBody(input: WakeCreateInput): WakeCreateBody {
	if (!("sessionId" in input) && !input.cwd) {
		throw new UserFacingError(
			"A scheduled task needs somewhere to run. Pick a conversation or a new one.",
		);
	}
	return {
		requestId: input.requestId,
		...("sessionId" in input
			? { sessionId: input.sessionId }
			: {
					cwd: input.cwd,
					...(input.target ? { target: input.target } : {}),
				}),
		message: input.message,
		...input.firstRun,
		...(input.every !== undefined ? { every: input.every } : {}),
		...(input.until !== undefined ? { until: input.until } : {}),
		...(input.limit !== undefined ? { limit: input.limit } : {}),
	};
}

export const WakesApi = {
	/**
	 * Every conversation on this machine that has wakes, with its wakes.
	 *
	 * Dormant rows are included: a stopped conversation's wakes are PARKED, not
	 * gone, and the page says so rather than dropping the row.
	 */
	async list(): Promise<DesktopWakesListResponse> {
		return desktopResult<DesktopWakesListResponse>({
			op: "wakes.list",
			includeDormant: true,
		});
	},

	/**
	 * Create a scheduled task, in one call.
	 *
	 * The conversation is created by the backend when the caller named a `cwd`,
	 * and the arm happens in the same request, so a failure cannot leave an
	 * armed wake with no transcript to fire into.
	 */
	async create(input: WakeCreateInput): Promise<DesktopWakeCreateResponse> {
		return desktopResult<DesktopWakeCreateResponse>({
			op: "wakes.create",
			...wakeCreateBody(input),
		});
	},

	/**
	 * Change an armed wake.
	 *
	 * The answer is deliberately not read: the interface pins no response shape
	 * for an edit, and the page re-reads the listing after the write, so the row
	 * the user sees is the row the store holds rather than whatever a mutation
	 * payload happened to echo. A wake's schedule identity (`id`, `fired_count`,
	 * the due anchor) is the backend's to preserve or re-anchor - the caller only
	 * says what should change.
	 */
	async edit(input: WakeEditInput): Promise<void> {
		await desktopResult<unknown>({
			op: "wakes.edit",
			sessionId: input.sessionId,
			wakeId: input.wakeId,
			...(input.message !== undefined ? { message: input.message } : {}),
			...(input.firstRun ?? {}),
			...(input.every !== undefined ? { every: input.every } : {}),
			...(input.until !== undefined ? { until: input.until } : {}),
			...(input.limit !== undefined ? { limit: input.limit } : {}),
		});
	},

	/**
	 * Cancel one wake, leaving the conversation in place.
	 *
	 * The read is discarded for the same reason an edit's is: the listing after
	 * the write is the evidence that the wake is gone, and it is the same read
	 * that would show a cancel the backend refused.
	 */
	async remove(sessionId: string, wakeId: string): Promise<void> {
		await desktopResult<unknown>({
			op: "wakes.remove",
			sessionId,
			wakeId,
		});
	},
};
