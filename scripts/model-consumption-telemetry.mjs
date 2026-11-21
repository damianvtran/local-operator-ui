import { performance } from "node:perf_hooks";

// Driver/gateway correlation is intentionally NOT end-to-end: the released
// renderer observer has no request token. Never infer one from receipt ordering.
const enums = {
	carrier: ["model-get", "canonical-sse"],
	disposition: ["live", "processed", "failed", "cold-or-invalid"],
};
export function receiptMetadata(receipt) {
	const result = {};
	for (const [key, values] of Object.entries(enums))
		result[key] = values.includes(receipt?.[key]) ? receipt[key] : "other";
	for (const [key, pattern] of [
		["sessionId", /^[a-f0-9]{12}$/],
		["epoch", /^[a-f0-9]{32}$/],
	])
		if (typeof receipt?.[key] === "string" && pattern.test(receipt[key]))
			result[key] = receipt[key];
	if (Number.isSafeInteger(receipt?.seq)) result.seq = receipt.seq;
	return result;
}

export function consumptionTelemetry(
	capture,
	expected,
	after,
	now = () => performance.now(),
) {
	const started = now();
	const result = {
		clock: "driver-performance-ms",
		started_ms: started,
		gateway_clock: "python-monotonic-ms",
		clocks_comparable: false,
		correlation_token: /^gateway-[a-f0-9]{32}-\d+$/.test(
			capture?.telemetry?.correlation_token ?? "",
		)
			? capture.telemetry.correlation_token
			: null,
		renderer_request_token: "unavailable",
		capture_id: capture.id,
		request_index: capture.request_index,
		expected: receiptMetadata(expected),
		after,
		polls: 0,
		polls_tail: [],
		final_receipts: [],
		receipt_total: 0,
	};
	return {
		result,
		observe(observed) {
			const receipts = observed.receipts ?? [];
			result.polls++;
			result.observer_armed = observed.armed === true;
			result.observer_fault = observed.fault === true;
			result.receipt_total = receipts.length;
			result.final_receipts = receipts.slice(-128).map(receiptMetadata);
			result.receipts_truncated = receipts.length > 128;
			result.polls_tail.push({ at_ms: now(), receipt_count: receipts.length });
			if (result.polls_tail.length > 128) result.polls_tail.shift();
		},
		finish(receipt, error) {
			result.finished_ms = now();
			result.elapsed_ms = result.finished_ms - started;
			result.matching_receipt = receipt ? receiptMetadata(receipt) : null;
			// Error messages/stacks can contain payloads or credentials. Category only.
			result.outcome = error
				? "poll-error"
				: receipt
					? "consumed"
					: "unconsumed";
			result.error_type = error
				? error.name === "TimeoutError"
					? "TimeoutError"
					: "Error"
				: null;
			return result;
		},
	};
}
