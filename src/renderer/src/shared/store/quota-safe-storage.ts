/**
 * What a persisted store writes when localStorage is full.
 *
 * WHY. PostHog (desktop project, 30 days to 2026-11-17): `QuotaExceededError`
 * on `conversation-input-store` 58 times and on `canonical-sessions-storage`
 * (Windows). Chromium gives an origin a fixed localStorage quota (about 5 MB of
 * UTF-16), and both stores can hold pasted images inline as `data:` URLs -
 * megabytes each - so a few screenshots across a handful of drafts fill it.
 * From then on EVERY write of that key throws: zustand's persist does not catch
 * it, so the session store's write surfaced as an uncaught error, and the
 * composer's own writer (which did catch) simply stopped persisting anything,
 * text included, for the rest of the session.
 *
 * THE RULE: the IN-MEMORY state is never touched - the draft on screen, images
 * and all, stays exactly as the user left it. Only what reaches disk degrades,
 * in steps, each tried only if the previous write was refused:
 *
 *   1. the full value (the normal path - nothing changes while there is room);
 *   2. the value with inline `data:` payloads removed: text drafts survive a
 *      reload, pasted images do not (they are still on screen this session);
 *   3. the store's own last-resort shrink (each caller names what is safe to
 *      drop), still without inline data.
 *
 * If every step is refused the write is skipped and reported once per streak;
 * it never throws, because a failed persist must not fail the action (a send, a
 * keystroke) that caused it. No size threshold is invented here: the platform's
 * quota is the only bound, and a step runs only when the platform says so.
 */

/** Whether a storage write failed because the origin's quota is full. */
export function isQuotaExceeded(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const { name, code } = error as { name?: unknown; code?: unknown };
	// 22: the DOMException legacy code; 1014: Firefox's NS_ERROR_DOM_QUOTA_REACHED.
	return (
		name === "QuotaExceededError" ||
		name === "NS_ERROR_DOM_QUOTA_REACHED" ||
		code === 22 ||
		code === 1014
	);
}

/* The keys an attachment-like object carries its payload under. A `data:` URL
 * anywhere else (a draft's typed text) is the user's words and is kept. */
const PAYLOAD_KEYS = new Set(["path", "url", "src", "dataUrl", "data_url"]);
const isInlineData = (value: unknown): value is string =>
	typeof value === "string" && value.startsWith("data:");

/**
 * A deep copy with inline `data:` payloads removed: a bare `data:` string in an
 * array is dropped, and an object whose payload key holds one (an attachment
 * chip) is dropped from its array/record. Everything else is kept as is.
 */
export function withoutInlineData<T>(value: T): T {
	const DROP = Symbol("drop");
	const walk = (node: unknown): unknown => {
		if (Array.isArray(node)) {
			return node.map(walk).filter((item) => item !== DROP);
		}
		if (isInlineData(node)) return DROP;
		if (node && typeof node === "object") {
			for (const key of PAYLOAD_KEYS) {
				if (isInlineData((node as Record<string, unknown>)[key])) return DROP;
			}
			const out: Record<string, unknown> = {};
			for (const [key, child] of Object.entries(node)) {
				const next = walk(child);
				// A data string on a non-payload key is the user's text: keep it.
				out[key] = next === DROP ? child : next;
			}
			return out;
		}
		return node;
	};
	const result = walk(value);
	return (result === DROP ? value : result) as T;
}

export type QuotaWriteOutcome =
	| "full"
	| "without_inline_data"
	| "shrunk"
	| "skipped";

/**
 * Write `value` under `key`, degrading per the rule above on a quota refusal.
 *
 * @param lastResort the caller's own reduction for step 3, applied to the value
 * that already has inline data removed; omit it to stop after step 2
 * @returns which step landed, or `skipped`
 * @throws only a non-quota error from the storage, unchanged
 */
export function writeWithQuotaFallback<T>(
	storage: Pick<Storage, "setItem">,
	key: string,
	value: T,
	lastResort?: (value: T) => T,
): QuotaWriteOutcome {
	const attempt = (candidate: T): boolean => {
		try {
			storage.setItem(key, JSON.stringify(candidate));
			return true;
		} catch (error) {
			if (!isQuotaExceeded(error)) throw error;
			return false;
		}
	};
	if (attempt(value)) return "full";
	const lean = withoutInlineData(value);
	if (attempt(lean)) return "without_inline_data";
	if (lastResort && attempt(lastResort(lean))) return "shrunk";
	return "skipped";
}

/**
 * A zustand `PersistStorage` over localStorage that applies the fallback.
 *
 * `setItem` never throws a quota error (zustand's persist would let it escape
 * as an uncaught exception); the first degraded or skipped write of a streak is
 * logged once so a support log still shows it happened.
 */
export function quotaSafePersistStorage<S>(options: {
	lastResort?: (value: { state: S; version?: number }) => {
		state: S;
		version?: number;
	};
	storeName: string;
}) {
	let warned = false;
	const local = (): Storage | null => {
		try {
			return globalThis.localStorage ?? null;
		} catch {
			return null;
		}
	};
	return {
		getItem: (name: string) => {
			const raw = local()?.getItem(name) ?? null;
			if (raw === null) return null;
			try {
				return JSON.parse(raw) as { state: S; version?: number };
			} catch {
				return null;
			}
		},
		setItem: (name: string, value: { state: S; version?: number }) => {
			const storage = local();
			if (!storage) return;
			const outcome = writeWithQuotaFallback(
				storage,
				name,
				value,
				options.lastResort,
			);
			if (outcome === "full") {
				warned = false;
				return;
			}
			if (!warned) {
				warned = true;
				console.warn(
					`[storage] ${options.storeName}: localStorage is full; persisted ${outcome === "skipped" ? "nothing" : `a reduced copy (${outcome})`}. The on-screen state is unchanged.`,
				);
			}
		},
		removeItem: (name: string) => {
			local()?.removeItem(name);
		},
	};
}
