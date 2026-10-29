import assert from "node:assert/strict";
import { createServer } from "node:http";
import Module from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
const dom = new JSDOM("<html><body></body></html>", {
	url: "http://localhost",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const bundle = await build({
	stdin: {
		contents: `
export * from './src/renderer/src/shared/hooks/use-account-avatar';
export * from './src/renderer/src/shared/hooks/radient-account-authority';
export {TeamBridgeApi} from './src/renderer/src/shared/api/local-operator/team-bridge-api';
export {requestDesktopMediaOutcome} from './src/main/desktop-media';
export {QueryClient, QueryClientProvider} from '@tanstack/react-query';`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	external: ["react", "react-dom"],
	tsconfig: "tsconfig.app.json",
	write: false,
});
const compiled = new Module(`${process.cwd()}/scripts/avatar-runtime.cjs`);
compiled.filename = `${process.cwd()}/scripts/avatar-runtime.cjs`;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const m = compiled.exports;
let seq = 0;
const urls = new Set();
URL.createObjectURL = () => {
	const url = `blob:test/${++seq}`;
	urls.add(url);
	return url;
};
URL.revokeObjectURL = (url) => urls.delete(url);
const member = {
	account_id: "acc_target",
	avatar_url: "/v1/accounts/acc_target/avatar?v=0123456789abcdef",
};
const image = { data: new Uint8Array([1, 2, 3]), mimeType: "image/png" };
function fixture() {
	const client = new m.QueryClient();
	client.setQueryData(m.radientUserKeys.user(), { account: { id: "A" } });
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	function Avatar({ value = member }) {
		const url = m.useTeamBridgeAvatar(value, 64);
		return React.createElement("img", { src: url, "data-url": url });
	}
	const render = async (values) =>
		act(async () =>
			root.render(
				React.createElement(
					m.QueryClientProvider,
					{ client },
					values.map((value, i) =>
						React.createElement(Avatar, { key: i, value }),
					),
				),
			),
		);
	return {
		client,
		host,
		render,
		async close() {
			await act(async () => {
				m.beginRadientAuthorityTransition(client);
				root.unmount();
			});
			host.remove();
			client.clear();
		},
	};
}
test("same-epoch replacement survives stale completion and remains owned for revocation", async () => {
	for (const [staleOutcome, remount] of [
		["resolve", false],
		["reject", false],
		["resolve", true],
		["reject", true],
	]) {
		const f = fixture();
		const pending = [];
		m.TeamBridgeApi.avatarBytes = () =>
			new Promise((resolve, reject) => pending.push({ resolve, reject }));
		try {
			await f.render([member]);
			assert.equal(pending.length, 1);
			const epoch = m.observedRadientAuthority(f.client).epoch;
			await act(async () => f.client.clear());
			await act(async () =>
				f.client.setQueryData(m.radientUserKeys.user(), {
					account: { id: "A" },
				}),
			);
			assert.equal(m.observedRadientAuthority(f.client).epoch, epoch);
			assert.equal(pending.length, 2);
			await act(async () => pending[1].resolve(image));
			const replacementUrl = f.host.querySelector("img").dataset.url;
			assert.ok(urls.has(replacementUrl));
			await act(async () => {
				if (staleOutcome === "resolve") pending[0].resolve(image);
				else pending[0].reject(new Error("stale failure"));
			});
			if (remount) {
				await f.render([]);
				await f.render([member]);
				assert.equal(
					pending.length,
					2,
					"stale finalizers cannot evict the replacement",
				);
			}
			assert.equal(urls.size, 1);
			assert.equal(f.host.querySelector("img").dataset.url, replacementUrl);
			await act(async () => {
				m.beginRadientAuthorityTransition(f.client);
				assert.equal(urls.size, 0);
			});
		} finally {
			await f.close();
		}
	}
});

test("avatar identity accepts canonical UUID and legacy IDs, never escaped path aliases", () => {
	const hash = "0123456789abcdef";
	for (const accountId of [
		"2fc3a222-9e22-4c85-8b94-0b11c81972f7",
		"acc_legacy-A_1",
	]) {
		assert.deepEqual(
			m.teamBridgeAvatarVersion({
				account_id: accountId,
				avatar_url: `/v1/accounts/${accountId}/avatar?v=${hash}`,
			}),
			{ accountId, hash },
		);
	}
	for (const encoded of [
		"not_an_account",
		"acc_",
		`acc_${"x".repeat(65)}`,
		"acc%5Flegacy",
		"acc+legacy",
		"acc%2Flegacy",
		"%2e%2e",
		"acc%252Flegacy",
		"acc%3Flegacy",
		"acc%23legacy",
	]) {
		assert.equal(
			m.teamBridgeAvatarVersion({
				account_id: decodeURIComponent(encoded.replaceAll("+", " ")),
				avatar_url: `/v1/accounts/${encoded}/avatar?v=${hash}`,
			}),
			null,
		);
	}
});

test("avatar binary relay uses only the closed local route and bounds returned bytes", async () => {
	let calls = 0;
	let status = 200;
	let mime = "image/png";
	let data = Buffer.from("png");
	let path;
	let auth;
	const server = createServer((req, res) => {
		calls++;
		path = req.url;
		auth = req.headers.authorization;
		res.writeHead(status, { "Content-Type": mime });
		res.end(data);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	try {
		// Positive harness control: the live listener really receives ordinary HTTP.
		await fetch(origin);
		assert.equal(calls, 1);
		calls = 0;
		const request = {
			op: "team_bridge.avatar",
			accountId: "target",
			hash: "0123456789abcdef",
			size: 64,
			expectedAccountId: "A",
		};
		const out = await m.requestDesktopMediaOutcome(
			request,
			null,
			origin,
			"local-secret",
		);
		assert.equal(out.response.kind, "bytes");
		assert.equal(out.answered, true);
		assert.equal(
			path,
			"/v1/desktop/team-bridge/accounts/target/avatar?v=0123456789abcdef&size=64&expected_account_id=A",
		);
		assert.equal(auth, "Bearer local-secret");
		const send = () =>
			m.requestDesktopMediaOutcome(request, null, origin, "local-secret");
		for (const refusal of [401, 403, 404, 409]) {
			status = refusal;
			assert.equal((await send()).response.status, refusal);
		}
		status = 200;
		for (const invalidMime of [
			"text/html",
			"application/json",
			"image/svg+xml",
		]) {
			mime = invalidMime;
			assert.equal((await send()).response.status, 502);
		}
		mime = "image/jpeg";
		assert.equal((await send()).response.kind, "bytes");
		data = Buffer.alloc(1024 * 1024 + 1);
		assert.equal((await send()).response.status, 502);
		data = Buffer.alloc(0);
		assert.equal((await send()).response.status, 502);
		calls = 0;
		for (const invalid of [
			{ ...request, accountId: "https://evil.test" },
			{ ...request, size: 512 },
			{ ...request, hash: "wrong" },
			{ ...request, expectedAccountId: undefined },
			{ ...request, url: "https://evil.test" },
		]) {
			assert.equal(
				(
					await m.requestDesktopMediaOutcome(
						invalid,
						null,
						origin,
						"local-secret",
					)
				).response.status,
				422,
			);
		}
		assert.equal(calls, 0);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});
test("deduplicates, retains scrolling remount, synchronously revokes on auth transition", async () => {
	const f = fixture();
	let calls = 0;
	m.TeamBridgeApi.avatarBytes = async () => {
		calls++;
		return image;
	};
	try {
		await f.render([member, member]);
		assert.equal(calls, 1);
		const url = f.host.querySelector("img").dataset.url;
		assert.ok(urls.has(url));
		await f.render([]);
		assert.ok(urls.has(url));
		await f.render([member]);
		assert.equal(calls, 1);
		await act(async () => {
			m.beginRadientAuthorityTransition(f.client);
			assert.ok(!urls.has(url));
		});
	} finally {
		await f.close();
	}
});
test("unmounted inflight completion is retained only in its original authority; A-B-A cannot resurrect", async () => {
	const f = fixture();
	let complete;
	let calls = 0;
	m.TeamBridgeApi.avatarBytes = () => {
		calls++;
		return new Promise((resolve) => {
			complete = resolve;
		});
	};
	try {
		await f.render([member]);
		await f.render([]);
		await act(async () => {
			m.beginRadientAuthorityTransition(f.client);
			f.client.setQueryData(m.radientUserKeys.user(), { account: { id: "B" } });
			m.settleRadientAuthority(f.client, 1, "B");
			m.beginRadientAuthorityTransition(f.client);
			f.client.setQueryData(m.radientUserKeys.user(), { account: { id: "A" } });
			m.settleRadientAuthority(f.client, 2, "A");
			complete(image);
		});
		assert.equal(urls.size, 0);
		await f.render([member]);
		assert.equal(calls, 2);
		await act(async () => complete(image));
		assert.equal(urls.size, 1);
	} finally {
		await f.close();
	}
});
test("inflight completion after unmount remains reusable while signed in", async () => {
	const f = fixture();
	let complete;
	let calls = 0;
	m.TeamBridgeApi.avatarBytes = (input) => {
		assert.equal(input.expectedAccountId, "A");
		calls++;
		return new Promise((resolve) => {
			complete = resolve;
		});
	};
	try {
		await f.render([member]);
		await f.render([]);
		await act(async () => complete(image));
		assert.equal(urls.size, 1);
		await f.render([member]);
		assert.equal(calls, 1);
		assert.ok(f.host.querySelector("img").dataset.url);
		await f.render([]);
		await act(async () => {
			m.beginRadientAuthorityTransition(f.client);
			assert.equal(urls.size, 0);
		});
	} finally {
		await f.close();
	}
});
test("bounds idle retained avatars and rejects non-image or oversized bytes", async () => {
	const f = fixture();
	m.TeamBridgeApi.avatarBytes = async () => image;
	try {
		for (let i = 0; i < 70; i++) {
			const id = `acc_target${i}`;
			await f.render([
				{
					account_id: id,
					avatar_url: `/v1/accounts/${id}/avatar?v=0123456789abcdef`,
				},
			]);
		}
		await f.render([]);
		assert.ok(urls.size <= 64);
		await act(async () => m.beginRadientAuthorityTransition(f.client));
		assert.equal(urls.size, 0);
	} finally {
		await f.close();
	}
	for (const bad of [
		{ ...image, mimeType: "text/html" },
		{ ...image, data: new Uint8Array(1024 * 1024 + 1) },
	]) {
		const x = fixture();
		m.TeamBridgeApi.avatarBytes = async () => bad;
		try {
			await x.render([member]);
			assert.equal(urls.size, 0);
		} finally {
			await x.close();
		}
	}
});

test("composite relay carries only the coded renderer_busy refusal, never the bare status", async () => {
	// Core #3101 answers transient overload as 503 {detail:{code:"renderer_busy"}}
	// and a bad image as 502 malformed_page. The desktop must branch on the
	// DECLARED code (core review M1): a bare 503 also describes this machine's
	// own transport failure, so treating it as overload would be a guess.
	let status = 503;
	let mime = "application/json";
	let body = JSON.stringify({ detail: { code: "renderer_busy" } });
	const server = createServer((_req, res) => {
		res.writeHead(status, { "Content-Type": mime });
		res.end(body);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	try {
		const request = {
			op: "team_bridge.notification_avatar",
			expectedAccountId: "A",
			tenantId: "tnt_1",
			accountId: "target",
			kind: "person",
			theme: "light",
			size: 64,
			initials: "BT",
			avatar: { account_id: "target", hash: "0123456789abcdef" },
		};
		const send = () =>
			m.requestDesktopMediaOutcome(request, null, origin, "local-secret");

		// Positive harness control: the live listener really answers.
		await fetch(origin);
		let out = await send();
		assert.equal(out.response.kind, "error");
		assert.equal(out.response.status, 503);
		assert.equal(out.response.code, "renderer_busy");
		assert.equal(out.answered, true);

		// A different code at the same status is NOT busy.
		body = JSON.stringify({ detail: { code: "malformed_page" } });
		out = await send();
		assert.equal(out.response.code, undefined, "only renderer_busy is carried");

		// The same JSON at a non-503 status is not busy either.
		status = 502;
		body = JSON.stringify({ detail: { code: "renderer_busy" } });
		out = await send();
		assert.equal(out.response.code, undefined, "the code alone is not enough");

		// Non-JSON refusals stay generic and cheap.
		status = 503;
		mime = "text/html";
		body = "<html>busy</html>";
		out = await send();
		assert.equal(out.response.code, undefined);

		// An unbounded error body is not buffered into memory.
		mime = "application/json";
		status = 503;
		body = JSON.stringify({
			detail: { code: "renderer_busy" },
			pad: "x".repeat(64 * 1024),
		});
		out = await send();
		assert.equal(
			out.response.code,
			undefined,
			"oversized refusal stays generic",
		);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});
