/**
 * S6b: the approvals card's model, sanitized before it crosses into the card's
 * document.
 *
 * WHY A PURE MODULE. The card runs a sandboxed, context-isolated document with
 * its own preload; main is the only side that knows the queue's trusted fields.
 * A compromised card must be unable to widen what it can paint, so every value
 * that crosses is rebuilt from an allow-list here — fixed enums, bounded
 * strings, a bounded array, a bounded total — rather than forwarded. The same
 * builder is what the trust tests feed hostile input to.
 *
 * WHAT IS NOT HERE: decision meaning. The model carries entry ids and display
 * text only; `decide` re-resolves the id against the live queue in main and
 * routes through `host.respondToConsent`. A card that lies about its model can
 * at worst paint wrong glyphs.
 */

import {
	APPROVALS_CARD_MODEL_LIMITS,
	type ApprovalsCardModel,
	type ApprovalsCardRequest,
} from "../../shared/browser-approvals-overlay";

/** A display string, capped. Never HTML: the document writes `textContent`. */
function text(value: unknown, max: number): string {
	if (typeof value !== "string") return "";
	// Control characters are stripped so a queue field cannot smuggle line
	// breaks or bidi overrides into a one-line label.
	const cleaned = value
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
		.trim();
	return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

function httpOrigin(value: unknown): string | null {
	const origin = text(value, APPROVALS_CARD_MODEL_LIMITS.origin);
	try {
		const url = new URL(origin);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		return url.origin;
	} catch {
		return null;
	}
}

/** One queue entry → one card request, or `null` when it cannot be displayed. */
export function approvalsCardRequestFrom(
	entry: {
		entryId?: unknown;
		origin?: unknown;
		displayAuthority?: unknown;
		expiresAt?: unknown;
	},
): ApprovalsCardRequest | null {
	const entryId = text(entry.entryId, APPROVALS_CARD_MODEL_LIMITS.entryId);
	const origin = httpOrigin(entry.origin);
	if (!entryId || !origin) return null;
	const expiresAt =
		typeof entry.expiresAt === "number" && Number.isFinite(entry.expiresAt)
			? entry.expiresAt
			: 0;
	return {
		entryId,
		origin,
		requester:
			text(
				entry.displayAuthority,
				APPROVALS_CARD_MODEL_LIMITS.requester,
			) || "",
		expiresAt,
	};
}

export interface ApprovalsCardModelInput {
	seq: number;
	entries: ReadonlyArray<Parameters<typeof approvalsCardRequestFrom>[0]>;
	locale: unknown;
	dir: unknown;
	theme: unknown;
	view?: unknown;
	focus?: boolean;
	busy?: boolean;
	error?: unknown;
	/** Entry ids the operator dismissed; presentation-only, never persisted. */
	dismissed?: ReadonlySet<string>;
}

function modelDirection(value: unknown): "ltr" | "rtl" {
	return value === "rtl" ? "rtl" : "ltr";
}

/**
 * Build the model the controller pushes. `request` is the oldest live entry the
 * operator has not dismissed; the rest of the queue rides in `pending` so the
 * card's "Review all" is a local view change.
 */
export function approvalsCardModelFrom(
	input: ApprovalsCardModelInput,
): ApprovalsCardModel {
	const pending: ApprovalsCardRequest[] = [];
	for (const entry of input.entries) {
		if (pending.length >= APPROVALS_CARD_MODEL_LIMITS.pending) break;
		const request = approvalsCardRequestFrom(entry);
		if (request) pending.push(request);
	}
	const request =
		pending.find((entry) => !input.dismissed?.has(entry.entryId)) ?? null;
	const model: ApprovalsCardModel = {
		v: 1,
		seq:
			Number.isInteger(input.seq) && input.seq >= 0
				? input.seq
				: 0,
		locale: text(input.locale, 35) || "en",
		dir: modelDirection(input.dir),
		theme: input.theme === "light" ? "light" : "dark",
		view: input.view === "list" ? "list" : "request",
		focus: input.focus === true,
		count: pending.length,
		busy: input.busy === true,
		request,
		pending,
		error:
			input.error === "stale" || input.error === "unavailable"
				? input.error
				: null,
	};
	return sanitizeApprovalsCardModel(model) ?? emptyModel(model);
}

function emptyModel(fallback: ApprovalsCardModel): ApprovalsCardModel {
	return {
		...fallback,
		request: null,
		pending: [],
		count: 0,
		busy: false,
		error: "unavailable",
	};
}

/**
 * Re-validate a model shaped anywhere (the controller's own builder, a test, or
 * a future second producer) before it is serialized into the document. Returns
 * `null` when even a bounded model cannot fit; the caller then sends nothing.
 */
export function sanitizeApprovalsCardModel(
	raw: unknown,
): ApprovalsCardModel | null {
	if (!raw || typeof raw !== "object") return null;
	const input = raw as Record<string, unknown>;
	const seq = input.seq;
	if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) return null;
	const pendingRaw = Array.isArray(input.pending) ? input.pending : [];
	const pending: ApprovalsCardRequest[] = [];
	for (const entry of pendingRaw) {
		if (pending.length >= APPROVALS_CARD_MODEL_LIMITS.pending) break;
		const request = approvalsCardRequestFrom(
			(entry ?? {}) as Parameters<typeof approvalsCardRequestFrom>[0],
		);
		if (request) pending.push(request);
	}
	const requestRaw =
		input.request && typeof input.request === "object"
			? approvalsCardRequestFrom(
					input.request as Parameters<typeof approvalsCardRequestFrom>[0],
				)
			: null;
	const request = requestRaw ?? null;
	const model: ApprovalsCardModel = {
		v: 1,
		seq,
		locale: text(input.locale, 35) || "en",
		dir: modelDirection(input.dir),
		theme: input.theme === "light" ? "light" : "dark",
		view: input.view === "list" ? "list" : "request",
		focus: input.focus === true,
		count: pending.length,
		busy: input.busy === true,
		request,
		pending,
		error:
			input.error === "stale" || input.error === "unavailable"
				? input.error
				: null,
	};
	while (
		model.pending.length > 0 &&
		Buffer.byteLength(JSON.stringify(model), "utf8") >
			APPROVALS_CARD_MODEL_LIMITS.totalBytes
	) {
		model.pending.pop();
		model.count = model.pending.length;
	}
	if (
		Buffer.byteLength(JSON.stringify(model), "utf8") >
		APPROVALS_CARD_MODEL_LIMITS.totalBytes
	) {
		return null;
	}
	return model;
}
