/** Narrow tests for the hosted fixture adapter; no Electron, core, or provider launch. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import {
	ASK_SCENE_ID,
	ASK_SCENE_KEY,
	ASK_SCENE_SESSION,
	askAcceptPython,
	askSeedPython,
	createAskFaultProxy,
} from "./notifications-ask-remediation-scene.mjs";

const ORIGINAL = "synthetic-ci-original-not-a-credential";
const CORRECTED = "synthetic-ci-corrected-not-a-credential";

test(
	"hosted fault adapter is loopback-only, preserves ordinary routes/auth, and records no plaintext",
	{ timeout: 10000 },
	async () => {
		const requests = [];
		const upstream = createServer(async (req, res) => {
			let body = "";
			for await (const chunk of req) body += chunk;
			requests.push({
				method: req.method,
				url: req.url,
				auth: req.headers.authorization,
				body,
			});
			res.writeHead(207, { "content-type": "application/json" });
			res.end(JSON.stringify({ actual: true }));
		});
		await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
		let accepted = 0;
		const fixture = await createAskFaultProxy({
			base: `http://127.0.0.1:${upstream.address().port}`,
			token: "synthetic-test-bearer",
			accept: async () => {
				accepted++;
				return { verdict: { ok: true } };
			},
		});
		const headers = {
			authorization: "Bearer synthetic-test-bearer",
			"content-type": "application/json",
		};
		const url = `${fixture.apiUrl}/v1/desktop/sessions/${ASK_SCENE_SESSION}/answers`;
		const post = (value, overrides = {}) =>
			fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify({
					ask_id: ASK_SCENE_ID,
					answers: { [ASK_SCENE_KEY]: [value] },
					...overrides,
				}),
			});
		try {
			assert.equal(new URL(fixture.apiUrl).hostname, "127.0.0.1");
			const ordinary = await fetch(
				`${fixture.apiUrl}/v1/settings/language?q=1`,
				{ method: "PATCH", headers, body: '{"value":"fr"}' },
			);
			assert.equal(ordinary.status, 207);
			await ordinary.text();
			assert.deepEqual(requests[0], {
				method: "PATCH",
				url: "/v1/settings/language?q=1",
				auth: headers.authorization,
				body: '{"value":"fr"}',
			});
			const denied = await fetch(url, {
				method: "POST",
				body: JSON.stringify({ ask_id: ASK_SCENE_ID }),
			});
			assert.equal(denied.status, 401);
			await denied.text();
			assert.equal(fixture.attempts.length, 0);
			const wrong = await post(ORIGINAL, { ask_id: "not-a-fixture" });
			assert.equal(wrong.status, 207);
			await wrong.text();
			assert.equal(fixture.attempts.length, 0, "unknown ask is never accepted");
			for (const [value, status] of [
				[ORIGINAL, 503],
				[ORIGINAL, 503],
				[CORRECTED, 200],
			]) {
				const result = await post(value);
				assert.equal(result.status, status);
				const text = await result.text();
				assert.ok(!text.includes(ORIGINAL) && !text.includes(CORRECTED));
			}
			assert.equal(accepted, 1);
			assert.deepEqual(fixture.attempts, [
				{ original: true, corrected: false },
				{ original: true, corrected: false },
				{ original: false, corrected: true },
			]);
			assert.ok(!JSON.stringify(fixture.attempts).includes(ORIGINAL));
			assert.equal(
				requests.length,
				2,
				"only non-fixture route reached upstream",
			);
		} finally {
			await fixture.close();
			upstream.closeAllConnections();
			await new Promise((resolve) => upstream.close(resolve));
		}
	},
);

test("hosted seed and acceptance use real pinned queue APIs, never mark delivery or persist credentials", () => {
	const seed = askSeedPython("/isolated/config");
	const accept = askAcceptPython("/isolated/config");
	assert.ok(
		seed.includes("store.append_event") && seed.includes("store.write_entry"),
	);
	assert.ok(seed.includes('"persist": False'));
	assert.ok(
		accept.includes("queue.respond") && accept.includes("queue.records()"),
	);
	assert.ok(accept.includes('assert not record.get("delivered")'));
	assert.ok(!accept.includes(ORIGINAL) && !accept.includes(CORRECTED));
	const parent = readFileSync(
		new URL("./notifications-app-scene.mjs", import.meta.url),
		"utf8",
	);
	assert.ok(
		parent.indexOf("await runAskRemediationScene") <
			parent.indexOf("const offScreen = await aimOffScreen"),
	);
	assert.ok(parent.includes("await askFixture?.close()"));
	assert.ok(
		parent.includes('LOCAL_OPERATOR_UI_NATIVE_SCENE !== "notifications"'),
	);
	assert.ok(parent.includes('RUNNER_ENVIRONMENT !== "github-hosted"'));
});

// A held-open upstream proves streaming, rather than passing by buffering a short body.
test(
	"non-fixture SSE reaches the app before EOF, ordered and byte-identical",
	{ timeout: 10000 },
	async () => {
		const frames = [
			Buffer.from('id: 1\nevent: state\ndata: {"n":1}\n\n'),
			Buffer.from('id: 2\nevent: state\ndata: {"n":2}\n\n'),
		];
		let response;
		let upstreamEnded = false;
		const upstream = createServer((req, res) => {
			assert.equal(req.headers.authorization, "Bearer synthetic-stream-auth");
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				"x-fixture-pass": "unaltered",
			});
			res.flushHeaders();
			response = res;
			res.write(frames[0]);
		});
		await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
		const fixture = await createAskFaultProxy({
			base: `http://127.0.0.1:${upstream.address().port}`,
			token: "unused",
			accept: () => {
				throw new Error("must not intercept SSE");
			},
		});
		const abort = new AbortController();
		try {
			const reply = await fetch(
				`${fixture.apiUrl}/v1/desktop/sessions/other/events`,
				{
					headers: { authorization: "Bearer synthetic-stream-auth" },
					signal: abort.signal,
				},
			);
			assert.equal(reply.status, 200);
			assert.equal(reply.headers.get("content-type"), "text/event-stream");
			assert.equal(reply.headers.get("cache-control"), "no-cache");
			assert.equal(reply.headers.get("x-fixture-pass"), "unaltered");
			const reader = reply.body.getReader();
			const readChunk = async () => {
				let timer;
				try {
					return await Promise.race([
						reader.read(),
						new Promise((_, reject) => {
							timer = setTimeout(
								() => reject(new Error("SSE buffered until EOF")),
								1000,
							);
						}),
					]);
				} finally {
					clearTimeout(timer);
				}
			};
			const first = await readChunk();
			assert.equal(first.done, false);
			assert.deepEqual(Buffer.from(first.value), frames[0]);
			assert.equal(upstreamEnded, false);
			response.write(frames[1]);
			const second = await readChunk();
			assert.deepEqual(Buffer.from(second.value), frames[1]);
			assert.equal(
				upstreamEnded,
				false,
				"both frames arrived while upstream remained open",
			);
			upstreamEnded = true;
			response.end();
			assert.equal((await readChunk()).done, true);
			assert.deepEqual(fixture.intercepted, []);
		} finally {
			abort.abort();
			await fixture.close();
			upstream.closeAllConnections();
			await new Promise((resolve) => upstream.close(resolve));
		}
	},
);

test(
	"non-fixture status, headers, auth and binary request/response bodies pass unchanged",
	{ timeout: 10000 },
	async () => {
		const body = Buffer.from([0, 255, 195, 40, 13, 10, 128, 42]);
		const replyBytes = Buffer.from([255, 0, 254, 13, 10, 42]);
		let seen;
		const upstream = createServer(async (req, res) => {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			seen = {
				headers: req.headers,
				body: Buffer.concat(chunks),
				url: req.url,
			};
			res.writeHead(418, "Fixture status unchanged", {
				"content-type": "application/octet-stream",
				"content-length": String(replyBytes.length),
				"x-fixture-response": "unaltered",
				"cache-control": "no-store",
			});
			res.end(replyBytes);
		});
		await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
		const fixture = await createAskFaultProxy({
			base: `http://127.0.0.1:${upstream.address().port}`,
			token: "unused",
			accept: () => {
				throw new Error("not a fixture ask");
			},
		});
		try {
			const reply = await fetch(
				`${fixture.apiUrl}/v1/desktop/notifications/read?revision=2`,
				{
					method: "POST",
					headers: {
						authorization: "Bearer synthetic-byte-auth",
						"content-type": "application/octet-stream",
						"x-fixture-request": "unaltered",
					},
					body,
				},
			);
			assert.equal(reply.status, 418);
			assert.equal(reply.statusText, "Fixture status unchanged");
			assert.equal(reply.headers.get("x-fixture-response"), "unaltered");
			assert.equal(reply.headers.get("cache-control"), "no-store");
			assert.equal(
				reply.headers.get("content-type"),
				"application/octet-stream",
			);
			assert.equal(
				reply.headers.get("content-length"),
				String(replyBytes.length),
			);
			assert.deepEqual(Buffer.from(await reply.arrayBuffer()), replyBytes);
			assert.deepEqual(seen.body, body);
			assert.equal(seen.url, "/v1/desktop/notifications/read?revision=2");
			assert.equal(seen.headers.authorization, "Bearer synthetic-byte-auth");
			assert.equal(seen.headers["x-fixture-request"], "unaltered");
			assert.equal(seen.headers["content-type"], "application/octet-stream");
			assert.equal(
				seen.headers.host,
				new URL(fixture.apiUrl).host,
				"Host is forwarded, not rewritten",
			);
			assert.deepEqual(fixture.intercepted, []);
		} finally {
			await fixture.close();
			upstream.closeAllConnections();
			await new Promise((resolve) => upstream.close(resolve));
		}
	},
);
