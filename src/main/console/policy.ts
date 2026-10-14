/** Admission is about native work, not history. These are conservative managed
 * resource envelopes, NOT bounds on arbitrary child-process RSS. Retained files
 * are outside the in-memory budget and must never be deleted to admit work.
 * Keep defaults aligned with the backend's console settings registry. */
export const DEFAULT_LIVE_LIMIT = 128;
export const DEFAULT_OWNER_LIMIT = 8;
export const DEFAULT_USER_RESERVED = 16;
export const LOG_BUDGET_BYTES = 512 * 1024 * 1024;
export const LOG_RESERVATION_BYTES = 4 * 1024 * 1024;
export const PENDING_BUDGET_BYTES = 32 * 1024 * 1024;
export const HISTORY_CACHE_BYTES = 64 * 1024 * 1024;
export const HISTORY_CACHE_ENTRIES = 4;
export const CELL_BUDGET = 64 * 1024 * 1024;
export const SCRATCH_BUDGET_BYTES = 64 * 1024 * 1024;
export const MANAGED_BUDGET_BYTES = 768 * 1024 * 1024;
// Pinned xterm 6 BufferLine allocates Uint32Array(3 * columns): 12 bytes per
// cell before line objects, combined characters and extended attributes. Charge
// 16 for admission instead of an optimistic eight; this is still a MODEL, not
// an actual heap/RSS guarantee. Preserve 5,000 scrollback lines rather than
// silently shrinking history merely to make the configured ceiling attainable.
export const CELL_RESERVATION_BYTES = 16;
export const EXIT_ACK_GRACE_MS = 30_000;

export interface ConsolePolicy {
	maxLive: number;
	maxOwner: number;
	userReserved: number;
}

function bounded(
	value: unknown,
	fallback: number,
	low: number,
	high: number,
): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(low, Math.min(high, Math.floor(value)))
		: fallback;
}

/** Hand-edited YAML gets the same safety envelope as validated settings writes.
 * Reducing a cap changes future admission only; existing processes stay owned. */
export function consolePolicy(value: unknown = {}): ConsolePolicy {
	const input =
		value && typeof value === "object"
			? (value as Record<string, unknown>)
			: {};
	const maxLive = bounded(input.max_live, DEFAULT_LIVE_LIMIT, 32, 256);
	return {
		maxLive,
		maxOwner: bounded(input.max_owner, DEFAULT_OWNER_LIMIT, 1, 32),
		userReserved: Math.min(
			Math.floor(maxLive / 4),
			bounded(input.user_reserved, DEFAULT_USER_RESERVED, 4, 32),
		),
	};
}
