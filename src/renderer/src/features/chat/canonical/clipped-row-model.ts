/**
 * The clipped-row read-back: the model half of "Output truncated — showing X of
 * Y · Open full output".
 *
 * WHY THIS EXISTS. The renderer refuses any single IPC record over 8 MiB, so one
 * 12.58 MB tool result used to make a conversation impossible to open. The core
 * (local-operator PR #4337, `docs/DESKTOP_API.md` "Clipped rows") now serves an
 * oversized row CLIPPED, with a `truncated` marker, and serves the full row by
 * byte range from `GET /v1/desktop/sessions/{id}/history/rows/{ref}`. This module
 * parses that marker and implements the contract's client procedure, verbatim:
 *
 * 1. `ref: null` -> not fetchable on this device; the preview is final and the
 *    route is never called.
 * 2. Page from offset 0; on EVERY answer compare `bytes_total` with the marker's.
 *    A mismatch means the row changed under us: discard and restart from 0 with
 *    the new total (bounded here by `MAX_RESTARTS`, so a row that keeps changing
 *    cannot loop forever).
 * 3. Join the base64-decoded ranges until `eof`, and decode UTF-8 only AFTER the
 *    join: a range boundary can split a multi-byte character.
 * 4. A 404 on a ref (most often a serve restart: the ref secret is per process)
 *    is recovered ONCE: re-read the one row (`around_id=<row>&before=0&after=0`)
 *    for a fresh ref and retry from step 2. A second failure is final.
 *
 * CONSTRAINTS. The byte budgets are the SERVER's (wire bytes, 1.5/4 MiB, 8 MiB
 * IPC): nothing here does arithmetic against them. Memory is bounded by the
 * marker's own `bytes_total`: the reassembly buffer is allocated once at that
 * size and a range that would write past it is a protocol fault, not a reason
 * to grow. `request` is injected so the procedure is testable without React.
 */

import { DESKTOP_HISTORY_ROW_RANGE_BYTES } from "../../../../../shared/desktop-contract";
import type {
	DesktopClippedRow,
	DesktopHistoryPage,
	DesktopHistoryRowRange,
} from "../../../../../shared/desktop-session-contract";

/**
 * How many times a changing `bytes_total` may restart the read. The contract
 * says "restart"; it does not say "forever", and a row rewritten on every read
 * would otherwise keep the viewer spinning and the transport busy.
 */
export const MAX_RESTARTS = 2;

/**
 * The largest row this client will reassemble: 256 MiB.
 *
 * WHY A CEILING AT ALL. The reassembly buffer is allocated up front at the
 * stated `bytes_total`, then decoded into a string (up to twice that again as
 * UTF-16), parsed, and painted in a `<pre>`, all inside the renderer. The
 * server is trusted, but a corrupt or absurd figure (2 GB) would be allocated
 * in full before a single range arrived, and a figure past the typed-array
 * maximum would throw on every Try again (agent review round 1, m2).
 *
 * WHY THIS NUMBER. The row that motivated clipping was a 12.58 MB tool result,
 * and the core serves every range by reading the row it stores, so a row is
 * bounded by what one process wrote to its journal in one line. 256 MiB is ~20x
 * that observed worst case - comfortably above any row the core has produced -
 * while the renderer's worst case (buffer + decoded string + parsed payload,
 * roughly 4x) stays near 1 GiB rather than unbounded. Above it the read ends
 * as `final` before any request: the preview is all this device will show.
 */
export const MAX_CLIPPED_ROW_BYTES = 256 * 1024 * 1024;

/** Read `entry.truncated` off the wire; anything malformed is "not clipped". */
export function parseClippedMarker(value: unknown): DesktopClippedRow | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Record<string, unknown>;
	const total = raw.bytes_total;
	const shown = raw.shown_bytes;
	if (!Number.isSafeInteger(total) || (total as number) < 0) return null;
	if (!Number.isSafeInteger(shown) || (shown as number) < 0) return null;
	if (raw.reason !== "open_frame_cap" && raw.reason !== "history_cap")
		return null;
	const ref =
		typeof raw.ref === "string" && raw.ref.length > 0 ? raw.ref : null;
	return {
		bytes_total: total as number,
		shown_bytes: shown as number,
		ref,
		reason: raw.reason,
		...(raw.omitted === true ? { omitted: true as const } : {}),
	};
}

export function sameClippedMarker(
	a: DesktopClippedRow,
	b: DesktopClippedRow,
): boolean {
	return (
		a.bytes_total === b.bytes_total &&
		a.shown_bytes === b.shown_bytes &&
		a.ref === b.ref &&
		a.reason === b.reason &&
		a.omitted === b.omitted
	);
}

/** The two requests the procedure makes; `desktopResult` in the app. */
export type ClippedRowRequest = {
	range: (args: {
		ref: string;
		offset: number;
		limit: number;
	}) => Promise<DesktopHistoryRowRange>;
	remint: (rowId: string) => Promise<DesktopHistoryPage>;
};

export type ClippedRowProgress = { received: number; total: number };

/**
 * Why a read ended without the row. `final` = the contract's terminal state
 * (two 404s, or a re-read that returned no ref): the preview is all there is
 * and the UI must not offer the action again. `failed` = anything else
 * (transport, timeout, malformed range): retryable. `cancelled` = the caller
 * aborted.
 */
export type ClippedRowOutcome =
	| { kind: "complete"; text: string; bytes: number }
	| { kind: "final" }
	| { kind: "failed" }
	| { kind: "cancelled" };

class CancelledError extends Error {}
class NotFoundError extends Error {}
class ProtocolError extends Error {}
/** A `bytes_total` above `MAX_CLIPPED_ROW_BYTES`: final, never retried. */
class TooLargeError extends Error {}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { status?: unknown }).status === 404
	);
}

function decodeBase64(data: string): Uint8Array {
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/**
 * Read one ref to completion, or throw. Progress restarts at 0 with the new
 * total on a restart, so it never claims a fraction of the wrong size.
 */
async function readRanges(
	ref: string,
	expectedTotal: number,
	request: ClippedRowRequest,
	signal: AbortSignal,
	onProgress: (progress: ClippedRowProgress) => void,
): Promise<{ text: string; bytes: number }> {
	let total = expectedTotal;
	let restarts = 0;
	restart: for (;;) {
		// Checked before every allocation, including a restart's new total.
		if (total > MAX_CLIPPED_ROW_BYTES) throw new TooLargeError();
		// Allocated once per attempt at the stated size: the memory bound.
		const buffer = new Uint8Array(total);
		let offset = 0;
		onProgress({ received: 0, total });
		for (;;) {
			if (signal.aborted) throw new CancelledError();
			let range: DesktopHistoryRowRange;
			try {
				range = await request.range({
					ref,
					offset,
					limit: DESKTOP_HISTORY_ROW_RANGE_BYTES,
				});
			} catch (error) {
				if (isNotFound(error)) throw new NotFoundError();
				throw error;
			}
			if (signal.aborted) throw new CancelledError();
			if (!Number.isSafeInteger(range.bytes_total) || range.bytes_total < 0)
				throw new ProtocolError();
			if (range.bytes_total !== total) {
				// The row changed under us (contract step 2).
				restarts += 1;
				if (restarts > MAX_RESTARTS) throw new ProtocolError();
				total = range.bytes_total;
				continue restart;
			}
			const chunk = decodeBase64(range.data ?? "");
			if (chunk.length !== range.length) throw new ProtocolError();
			if (offset + chunk.length > total) throw new ProtocolError();
			buffer.set(chunk, offset);
			offset += chunk.length;
			onProgress({ received: offset, total });
			if (range.eof || offset === total) {
				if (offset !== total) throw new ProtocolError();
				// Decode-after-join (contract step 3). `fatal` so a corrupt join is a
				// visible failure rather than silent replacement characters.
				const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
				return { text, bytes: total };
			}
			// A non-eof empty range would never advance: refuse rather than spin.
			if (chunk.length === 0) throw new ProtocolError();
		}
	}
}

/**
 * The whole client procedure (steps 1-4). Never throws: every ending is an
 * outcome the viewer paints.
 */
export async function fetchClippedRow(args: {
	rowId: string;
	marker: DesktopClippedRow;
	request: ClippedRowRequest;
	signal: AbortSignal;
	onProgress: (progress: ClippedRowProgress) => void;
}): Promise<ClippedRowOutcome> {
	const { rowId, marker, request, signal, onProgress } = args;
	if (marker.ref === null) return { kind: "final" };
	const attempt = async (ref: string, total: number) =>
		readRanges(ref, total, request, signal, onProgress);
	try {
		return {
			kind: "complete",
			...(await attempt(marker.ref, marker.bytes_total)),
		};
	} catch (error) {
		if (error instanceof CancelledError) return { kind: "cancelled" };
		if (error instanceof TooLargeError) return { kind: "final" };
		if (!(error instanceof NotFoundError)) return { kind: "failed" };
	}
	/*
	 * Step 4: ONE re-mint, ONE retry. Only the contract's two terminal cases
	 * are `final` - the re-read has no ref (or the row is gone: a 404 on the
	 * re-read), or the retry 404s again. A transport error or timeout on either
	 * request is `failed`, so Try again stays offered: a network blip right after
	 * a serve restart must not kill the action for the mount (review round 1, m3).
	 * Try again starts a NEW attempt from the marker's ref, so each attempt still
	 * makes at most one re-mint.
	 */
	let fresh: DesktopClippedRow | null = null;
	try {
		const page = await request.remint(rowId);
		if (signal.aborted) return { kind: "cancelled" };
		const row = page.entries?.find((entry) => entry.id === rowId);
		fresh = row ? parseClippedMarker(row.truncated) : null;
	} catch (error) {
		if (signal.aborted) return { kind: "cancelled" };
		return isNotFound(error) ? { kind: "final" } : { kind: "failed" };
	}
	if (!fresh || fresh.ref === null) return { kind: "final" };
	try {
		return {
			kind: "complete",
			...(await attempt(fresh.ref, fresh.bytes_total)),
		};
	} catch (error) {
		if (error instanceof CancelledError) return { kind: "cancelled" };
		if (error instanceof NotFoundError || error instanceof TooLargeError)
			return { kind: "final" };
		return { kind: "failed" };
	}
}

/**
 * What the viewer shows from the full row: the message's text when it has
 * one, else the row's payload as indented JSON (a withheld checkpoint, a tool
 * result whose content is structured). The full row is the core's wire
 * envelope `{id, ts, type, payload, ts_source}`.
 */
export function clippedRowDisplayText(
	fullRow: string,
	messageText: (payload: Record<string, unknown>) => string,
): string {
	try {
		const row = JSON.parse(fullRow) as { payload?: unknown };
		const payload =
			row && typeof row.payload === "object" && row.payload !== null
				? (row.payload as Record<string, unknown>)
				: null;
		if (payload) {
			const text = messageText(payload);
			if (text) return text;
			return JSON.stringify(payload, null, 2);
		}
	} catch {
		// Not JSON: show the bytes as the route served them.
	}
	return fullRow;
}
