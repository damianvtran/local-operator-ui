import assert from "node:assert/strict";
import { test } from "node:test";
import {
	consumptionTelemetry,
	receiptMetadata,
} from "./model-consumption-telemetry.mjs";

test("receipt telemetry allowlists metadata; payloads, errors and auth never survive", () => {
	const row = {
		carrier: "model-get",
		disposition: "failed",
		sessionId: "a".repeat(12),
		epoch: "b".repeat(32),
		seq: 6,
		body: "secret",
		authorization: "secret",
		error: "secret",
		token: "secret",
	};
	assert.deepEqual(receiptMetadata(row), {
		carrier: "model-get",
		disposition: "failed",
		sessionId: row.sessionId,
		epoch: row.epoch,
		seq: 6,
	});
	assert.deepEqual(
		receiptMetadata({
			carrier: "secret",
			disposition: "secret",
			epoch: "secret",
			sessionId: "secret",
			seq: "secret",
		}),
		{ carrier: "other", disposition: "other" },
	);
});
test("bounded polling keeps final failed/live receipts and synthetic gateway-only identity", () => {
	let clock = 10;
	const capture = {
		id: 7,
		request_index: 98,
		telemetry: { correlation_token: `gateway-${"a".repeat(32)}-98` },
	};
	const receipt = {
		carrier: "model-get",
		disposition: "live",
		sessionId: "a".repeat(12),
		epoch: "b".repeat(32),
		seq: 6,
	};
	const telemetry = consumptionTelemetry(capture, receipt, 3, () => clock++);
	for (let i = 0; i < 200; i++)
		telemetry.observe({
			receipts: Array(200).fill({
				...receipt,
				disposition: "failed",
				body: "secret",
			}),
		});
	const result = telemetry.finish(receipt);
	assert.equal(result.polls, 200);
	assert.equal(result.polls_tail.length, 128);
	assert.equal(result.final_receipts.length, 128);
	assert.equal(result.receipts_truncated, true);
	assert.equal(result.renderer_request_token, "unavailable");
	assert.equal(result.clocks_comparable, false);
	assert.equal(result.outcome, "consumed");
	assert.equal(result.elapsed_ms, 201);
	assert.equal(result.matching_receipt.disposition, "live");
	assert(!JSON.stringify(result).includes("secret"));
	assert(JSON.stringify(result).length < 32_000);
});
test("negative controls retain noncompletion and redact thrown errors and invalid tokens", () => {
	const telemetry = consumptionTelemetry(
		{ id: 9, request_index: 101, telemetry: { correlation_token: "secret" } },
		{},
		0,
	);
	assert.equal(telemetry.finish(null).outcome, "unconsumed");
	const result = telemetry.finish(null, new Error("Bearer secret"));
	assert.equal(result.outcome, "poll-error");
	assert.equal(result.correlation_token, null);
	assert.equal(result.error_type, "Error");
	assert(!JSON.stringify(result).includes("secret"));
});
