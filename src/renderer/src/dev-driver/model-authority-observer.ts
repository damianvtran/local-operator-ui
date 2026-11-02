/**
 * Default-off, metadata-only witness for the existing armed renderer driver.
 * A wire release is not a consumer receipt. Callers record ONLY after their
 * actual interpretation/flush; this observer never changes a value, promise,
 * selection, ref or control flow and never retains payload/authentication data.
 */
export type ModelAuthorityReceipt = {
	carrier: "canonical-sse" | "model-get" | "default-save";
	sessionId: string;
	epoch: string | null;
	seq: number | null;
	disposition: "processed" | "live" | "cold-or-invalid" | "failed" | "invoked";
};
let armed = false;
let fault = false;
const receipts: ModelAuthorityReceipt[] = [];

export function armModelAuthorityObserver(): void {
	if (typeof window === "undefined" || !window.__loDevDriver?.armed) return;
	armed = true;
	fault = false;
	receipts.length = 0;
}

export function modelAuthorityObserverArmed(): boolean {
	return armed;
}

export function observeModelAuthority(receipt: ModelAuthorityReceipt): void {
	if (!armed) return;
	// Observer failures must fail the evidence door, not the product handler.
	try {
		if (receipts.length >= 256) {
			fault = true;
			return;
		}
		receipts.push({
			carrier: receipt.carrier,
			sessionId: receipt.sessionId,
			epoch: typeof receipt.epoch === "string" ? receipt.epoch : null,
			seq: typeof receipt.seq === "number" ? receipt.seq : null,
			disposition: receipt.disposition,
		});
	} catch {
		fault = true;
	}
}

export function readModelAuthorityObserver() {
	return {
		armed,
		fault,
		receipts: receipts.map((receipt) => ({ ...receipt })),
	};
}
