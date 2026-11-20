import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { drainModelBarrier } from "./model-uncertainty-native.mjs";

const sessionId = "aaaaaaaaaaaa";
const path = `/v1/desktop/sessions/${sessionId}/events`;
const frame = (type, model, seq = 1, epoch = "generation") => ({
	type,
	session_id: sessionId,
	epoch,
	seq,
	payload: model
		? { frontend: { snapshot: { selected_model: { model_id: model } } } }
		: {
				subscription_id: "owned-subscription",
				gap: false,
				watch_ttl_seconds: 30,
				attaching: false,
			},
});
const wire = (value) => `data: ${JSON.stringify(value)}\n\n`;
const baseline = frame("snapshot", "mock-model-a");
const context = {
	sessionId,
	baselineBody: wire(baseline),
	baseline: { model: "mock-model-a", sessionId, epoch: "generation", seq: 1 },
	commit: { epoch: "generation" },
};
const capture = (value, before = true) => ({
	path,
	before_b_request: before,
	body: wire(value),
});

test("real TCP serial SSE barriers reach genuine B without promoting GET/open/unknown", async () => {
	const captures = [];
	const held = new Map();
	const received = [];
	const server = http.createServer(async (_req, res) => {
		res.writeHead(200, { "content-type": "text/event-stream" });
		for (const [value, before] of [
			[baseline, true],
			[frame("open", null, 2), false],
			[frame("snapshot", "mock-model-b", 2), false],
		]) {
			const c = { ...capture(value, before), id: captures.length };
			captures.push(c);
			await new Promise((resolve) => held.set(c.id, resolve));
			res.write(c.body);
		}
		res.end();
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const request = http.get(`http://127.0.0.1:${server.address().port}`, (res) =>
		res.on("data", (data) => received.push(data.toString())),
	);
	request.on("error", () => {}); // Teardown of a deliberately stalled counterfactual resets TCP.
	try {
		// A bounded turn budget is a test watchdog, not a changed native wait.
		for (let turn = 0; turn < 40; turn++) {
			for (const c of captures)
				if (drainModelBarrier(c, context)) held.get(c.id)?.();
			if (captures.some((c) => c.body.includes("mock-model-b"))) break;
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		const b = captures.find((c) => c.body.includes("mock-model-b"));
		assert(b, "known A/open head-of-line barriers prevented genuine B capture");
		assert.equal(drainModelBarrier(b, context), false);
		held.get(b.id)();
		await new Promise((resolve) => request.on("close", resolve));
		assert.equal(received.join(""), captures.map((c) => c.body).join(""));
		assert.equal(JSON.parse(b.body.slice(6)).session_id, sessionId);
		assert.equal(JSON.parse(b.body.slice(6)).epoch, context.commit.epoch);
		assert(JSON.parse(b.body.slice(6)).seq > context.baseline.seq);
		console.log(
			JSON.stringify({
				tcp: "genuine-B-consumed",
				captures: captures.length,
				received: received.length,
			}),
		);
	} finally {
		request.destroy();
		for (const release of held.values()) release();
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
});

test("barrier policy fails closed on authority, partial, mixed and unknown bytes", () => {
	const negatives = [
		{
			...capture(frame("snapshot", "mock-model-b", 2), false),
			path: path.slice(0, -7),
		},
		capture(frame("snapshot", "mock-model-b", 2)),
		capture(frame("snapshot", "mock-model-a", 1, "other-generation")),
		capture(frame("snapshot", "mock-model-a", 0)),
		capture({ type: "unknown", session_id: sessionId }),
		capture({ ...frame("open"), payload: { unexpected: true } }, false),
		{
			...capture(baseline),
			body: wire(baseline) + wire(frame("snapshot", "mock-model-b", 2)),
		},
		capture({
			...baseline,
			payload: { ...baseline.payload, unexpected: true },
		}),
		{ ...capture(baseline), body: wire(baseline).trimEnd() },
		{ ...capture(baseline), body: wire(baseline) + wire({ type: "unknown" }) },
		{ ...capture(baseline), body: "data: malformed\n\n" },
	];
	for (const c of negatives)
		assert.equal(drainModelBarrier(c, context), false, c.body);
	assert.equal(
		drainModelBarrier(capture(baseline), { sessionId }),
		false,
		"initial wanted A must stay held",
	);
	console.log(
		JSON.stringify({
			negativeBarriersHeld: negatives.length,
			initialA: "held",
		}),
	);
});
