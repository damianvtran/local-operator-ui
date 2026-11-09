/** Payload-free, first-snapshot-only timing carried OUTSIDE the SSE JSON.
 * Local spans use monotonic clocks; epoch differences across processes are only
 * approximate bridges (not network or backend latency). No global correlation
 * registry: the receipt lives and dies with its one stream event.
 */
export type SnapshotReceipt = {
	streamId: string;
	sessionId: string;
	chars: number;
	mainRecordEpochMs: number;
	mainFoldMs: number;
	mainObserverMs: number;
	mainEmitMs: number;
	mainSendEpochMs?: number;
	preloadReceiptEpochMs?: number;
	preloadReadyMs?: number;
	rendererEntryEpochMs?: number;
	bufferedAt?: number;
	deliveryAt?: number;
	delivery?: "direct" | "live" | "replay";
};

const SESSION_ID = /^[a-f0-9]{12}$/;
const STREAM_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export const receiptEpochMs = () => performance.timeOrigin + performance.now();

/** Called at the existing IPC sender boundary, never by parsing a raw frame. */
export function stampSnapshotSend(receipt?: SnapshotReceipt): void {
	if (receipt) receipt.mainSendEpochMs = receiptEpochMs();
}

/** First renderer entry, before a prewarm can either buffer or deliver it. */
export function enterSnapshotRenderer(receipt?: SnapshotReceipt): void {
	if (receipt) receipt.rendererEntryEpochMs = receiptEpochMs();
}

export function deliverSnapshot(
	receipt: SnapshotReceipt | undefined,
	delivery: "direct" | "live" | "replay",
): void {
	if (!receipt) return;
	receipt.delivery = delivery;
	receipt.deliveryAt = performance.now();
}

/** A single compact line; accepts metadata only, never conversation content.
 * The open token is the captured subscription token, not whichever click is now
 * current. Prewarmed snapshots can precede that click; negative epoch bridges
 * are meaningful and must not be clamped or charged to the daemon.
 */
export function formatSnapshotReceipt(
	r: SnapshotReceipt,
	openToken: number | null,
	parseStart: number,
	parseEnd: number,
): string {
	const ms = (value: number | undefined) =>
		value === undefined ? "-" : value.toFixed(3);
	const diff = (end: number | undefined, start: number | undefined) =>
		end === undefined || start === undefined ? undefined : end - start;
	return [
		"[snapshot-receipt]", // i18n: ignore -- Technical payload-free timing diagnostic
		`openToken=${openToken ?? "-"}`,
		`session=${SESSION_ID.test(r.sessionId) ? r.sessionId : "?"}`,
		`streamId=${STREAM_ID.test(r.streamId) ? r.streamId : "?"}`,
		"kind=snapshot", // i18n: ignore -- Technical record kind
		`chars=${r.chars}`,
		`mainRecordEpochMs=${ms(r.mainRecordEpochMs)}`,
		`mainFoldMs=${ms(r.mainFoldMs)}`,
		`mainObserverMs=${ms(r.mainObserverMs)}`,
		`mainEmitMs=${ms(r.mainEmitMs)}`,
		`mainSendEpochMs=${ms(r.mainSendEpochMs)}`,
		`ipcApproxMs=${ms(diff(r.preloadReceiptEpochMs, r.mainSendEpochMs))}`,
		`preloadReceiptEpochMs=${ms(r.preloadReceiptEpochMs)}`,
		`preloadReadyMs=${ms(r.preloadReadyMs)}`,
		`bridgeApproxMs=${ms(diff(r.rendererEntryEpochMs, r.preloadReceiptEpochMs === undefined || r.preloadReadyMs === undefined ? undefined : r.preloadReceiptEpochMs + r.preloadReadyMs))}`,
		`rendererEntryEpochMs=${ms(r.rendererEntryEpochMs)}`,
		`delivery=${r.delivery ?? "-"}`,
		`bufferMs=${ms(diff(r.deliveryAt, r.bufferedAt))}`,
		`deliveryToParseMs=${ms(diff(parseStart, r.deliveryAt))}`,
		`parseMs=${ms(parseEnd - parseStart)}`,
	].join(" ");
}
