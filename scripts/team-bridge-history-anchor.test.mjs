import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import Module from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/* Real shared hooks and API decoder, synthetic DOM geometry and owned HTTP
 * daemon. Geometry is NOT browser-frame evidence and the daemon is NOT the hub.
 * The fixture counts actual requests and never uses live credentials/config. */
const bundle = await build({
	stdin: {
		contents: `
 export {useStickToBottom} from "./src/renderer/src/features/team-bridge/use-stick-to-bottom";
 export {ownerAuditChronology} from "./src/renderer/src/features/team-bridge/team-bridge-owner-audit-model";
 export {useOwnerAuditMessages} from "./src/renderer/src/features/team-bridge/use-team-bridge-owner-audit";
 export {QueryClient,QueryClientProvider} from "@tanstack/react-query";
 export {radientUserKeys} from "./src/renderer/src/shared/hooks/radient-account-authority";
 export {teamBridgeKeys} from "./src/renderer/src/features/team-bridge/team-bridge-keys";
 export {desktopEndpoint} from "./src/shared/desktop-contract";
 export {createOwnerAuditQueryFixture, queryHistoryViewport} from "./src/renderer/src/features/team-bridge/team-bridge-owner-audit-query.fixture";
 export {TeamBridgeOwnerAuditApi} from "./src/renderer/src/shared/api/local-operator/team-bridge-owner-audit-api";
 `,
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	external: ["react", "react-dom"],
	loader: { ".css": "empty" },
	tsconfig: "tsconfig.app.json",
	write: false,
});
const compiled = new Module(
	`${process.cwd()}/scripts/history-anchor-runtime.cjs`,
);
compiled.filename = `${process.cwd()}/scripts/history-anchor-runtime.cjs`;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const m = compiled.exports;
const dom = new JSDOM("<!doctype html><body></body>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const name of ["window", "document", "HTMLElement", "HTMLImageElement"])
	globalThis[name] =
		name === "window"
			? dom.window
			: name === "document"
				? dom.window.document
				: dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const h = React.createElement;
const settle = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 8));
	});

test("shared anchor: native audit and existing Radix hosts open newest; preserve ID+offset on prepend/reflow; follow only live edge", async () => {
	for (const mode of ["root", "radix"]) {
		let ids = Array.from({ length: 50 }, (_, i) => `m${951 + i}`);
		const heights = new Map();
		const height = (id) => heights.get(id) ?? 40;
		let top = 0;
		let live = true;
		let resetKey = "org-a:conversation-a:ready";
		let api;
		const observers = [];
		const previousObserver = globalThis.ResizeObserver;
		globalThis.ResizeObserver = class {
			constructor(callback) {
				this.callback = callback;
				this.active = true;
				observers.push(this);
			}
			observe() {}
			disconnect() {
				this.active = false;
			}
		};
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const total = () => ids.reduce((sum, id) => sum + height(id), 0);
		const rect = (y, size) => ({
			top: y,
			bottom: y + size,
			height: size,
			left: 0,
			right: 600,
			width: 600,
		});
		const instrument = (node) => {
			if (!node) return;
			Object.defineProperties(node, {
				scrollHeight: { configurable: true, get: total },
				clientHeight: { configurable: true, get: () => 200 },
				scrollTop: {
					configurable: true,
					get: () => top,
					set: (value) => {
						top = Math.max(0, Math.min(total() - 200, value));
					},
				},
			});
			node.getBoundingClientRect = () => rect(0, 200);
		};
		function Probe() {
			api = m.useStickToBottom({
				resetKey,
				contentKey: ids.join(":"),
				scrollElement: mode,
				preserveAnchor: mode === "root",
				rowIds: ids,
				liveEdgeAvailable: live,
			});
			const children = h(
				"div",
				null,
				ids.map((id) =>
					h(
						"div",
						{
							key: id,
							"data-message-id": id,
							ref: (node) => {
								if (node)
									node.getBoundingClientRect = () =>
										rect(
											ids
												.slice(0, ids.indexOf(id))
												.reduce((sum, x) => sum + height(x), 0) - top,
											height(id),
										);
							},
						},
						id,
					),
				),
			);
			if (mode === "root")
				return h(
					"div",
					{
						ref: (node) => {
							api.rootRef.current = node;
							instrument(node);
						},
						"data-host": true,
					},
					children,
				);
			return h(
				"div",
				{ ref: api.rootRef },
				h(
					"div",
					{
						ref: instrument,
						"data-host": true,
						"data-radix-scroll-area-viewport": "",
					},
					children,
				),
			);
		}
		const render = () => act(async () => root.render(h(Probe)));
		const scroll = (value) =>
			act(async () => {
				const node = host.querySelector("[data-host]");
				node.scrollTop = value;
				node.dispatchEvent(new window.Event("scroll"));
			});
		try {
			await render();
			assert.equal(top, 1800, `${mode}: initial end anchor`);
			await scroll(207);
			if (mode === "root") {
				const row = host.querySelector('[data-message-id="m956"]');
				const offset = row.getBoundingClientRect().top;
				ids = [...Array.from({ length: 50 }, (_, i) => `m${901 + i}`), ...ids];
				await render();
				assert.equal(
					row.getBoundingClientRect().top,
					offset,
					"prepend retains exact visible ID/pixel",
				);
				heights.set("m920", 120);
				await act(async () => {
					for (const observer of observers)
						if (observer.active) observer.callback();
				});
				assert.equal(
					row.getBoundingClientRect().top,
					offset,
					"above-anchor dynamic height retains offset",
				);
				ids = [...ids, "m1001"];
				await render();
				assert.equal(api.newMessages, 1);
				assert.equal(row.getBoundingClientRect().top, offset);
				await act(async () => api.pin());
				assert.equal(top, total() - 200);
				assert.equal(api.newMessages, 0);
				ids = [...ids, "m1002"];
				await render();
				assert.equal(top, total() - 200, "incoming at live edge follows");
				await scroll(207);
				const retained = host.querySelector('[data-message-id="m906"]');
				const before = retained.getBoundingClientRect().top;
				ids = [
					...Array.from({ length: 50 }, (_, i) => `m${851 + i}`),
					...ids.slice(0, -50),
				];
				live = false;
				await render();
				assert.equal(
					retained.getBoundingClientRect().top,
					before,
					"eviction of newest cannot shift retained visible row",
				);
				const held = top;
				await act(async () => api.pin());
				assert.equal(
					top,
					held,
					"old window cannot pretend pin means the live edge",
				);
			} else {
				const held = top;
				ids = [...ids, "m1001"];
				await render();
				assert.equal(
					top,
					held,
					"default member policy never yanks a history reader",
				);
				await act(async () => api.pin());
				assert.equal(top, total() - 200);
			}
			resetKey = "org-b:conversation-b:ready";
			ids = ["new1", "new2"];
			live = true;
			await render();
			assert.equal(
				top,
				0,
				"short switched conversation stays in its own bounds",
			);
			ids = [];
			await render();
			assert.equal(top, 0, "empty stream is stable");
		} finally {
			await act(async () => root.unmount());
			host.remove();
			assert.equal(
				observers.filter((observer) => observer.active).length,
				0,
				"observers are released",
			);
			globalThis.ResizeObserver = previousObserver;
		}
	}
});

test("owner audit merge orders seq,id and deduplicates overlapping pages without erasing available bodies", () => {
	const rows = m.ownerAuditChronology([
		[
			{ id: "z", seq: 2, body: "kept" },
			{ id: "b", seq: 1, body: "B" },
		],
		[
			{ id: "a", seq: 1, body: "A" },
			{ id: "z", seq: 2, body: null },
		],
	]);
	assert.deepEqual(
		rows.map((row) => row.id),
		["a", "b", "z"],
	);
	assert.equal(rows[2].body, "kept");
});

test("actual HTTP pagination: one bounded newest page, older only on demand, seventh-page cache bound and explicit latest reset", async () => {
	const requests = [];
	let repeatedCursor = false;
	let holdNext = false;
	let releasePending;
	let deny = false;
	const server = createServer(async (req, res) => {
		const url = new URL(req.url, "http://fixture.invalid");
		requests.push(url);
		const limit = Number(url.searchParams.get("limit"));
		const before = Number(url.searchParams.get("before_seq") || 10001);
		assert.equal(limit, 50);
		assert.ok(
			["org_fixture", "org_other"].includes(url.searchParams.get("tenant_id")),
		);
		assert.equal(url.searchParams.get("expected_account_id"), "acct_fixture");
		if (holdNext) {
			holdNext = false;
			await new Promise((resolve) => {
				releasePending = resolve;
			});
		}
		if (deny) {
			res.statusCode = 403;
			res.setHeader("Content-Type", "application/json");
			res.end(JSON.stringify({ detail: { code: "owner_audit_denied" } }));
			return;
		}
		const messages = Array.from({ length: limit }, (_, i) => ({
			id: `m${before - 1 - i}`,
			seq: before - 1 - i,
			conversation_id: "bcv_fixture",
			sender: { account_id: "acct_agent", kind: "agent" },
			body: `synthetic bounded page ${url.searchParams.get("tenant_id")}`,
			created_at: "2026-10-31T12:00:00Z",
		}));
		res.setHeader("Content-Type", "application/json");
		res.end(
			JSON.stringify({
				status: 200,
				result: {
					messages,
					has_more: true,
					next_before_seq: repeatedCursor ? before : messages.at(-1).seq,
				},
			}),
		);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	window.api = {
		desktop: {
			request: async (request) => {
				const endpoint = m.desktopEndpoint(request);
				const response = await fetch(origin + endpoint.path);
				return {
					status: response.status,
					kind: "json",
					body: await response.json(),
				};
			},
		},
	};
	const client = new m.QueryClient({
		defaultOptions: {
			queries: { gcTime: Number.POSITIVE_INFINITY, retry: false },
		},
	});
	client.setQueryData(m.radientUserKeys.user(), {
		account: { id: "acct_fixture" },
	});
	client.setQueryData(m.teamBridgeKeys.statusFor("acct_fixture"), {
		account_id: "acct_fixture",
		state: "ready",
		local: { enabled: true },
	});
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	let query;
	let tenantId = "org_fixture";
	let allowEviction = true;
	function Probe() {
		query = m.useOwnerAuditMessages(
			{ accountId: "acct_fixture", tenantId },
			"bcv_fixture",
			() => allowEviction,
		);
		return null;
	}
	const until = async (predicate) => {
		for (let i = 0; i < 100; i += 1) {
			if (predicate()) return;
			await settle();
		}
		assert.fail("fixture query did not settle");
	};
	try {
		await act(async () =>
			root.render(h(m.QueryClientProvider, { client }, h(Probe))),
		);
		await until(() => query.isSuccess);
		assert.equal(requests.length, 1);
		assert.equal(requests[0].searchParams.has("before_seq"), false);
		assert.equal(query.data.pages[0].messages[0].seq, 10000);
		assert.equal(query.data.pages[0].messages.at(-1).seq, 9951);
		for (let i = 0; i < 5; i += 1) {
			await act(async () => {
				await query.fetchNextPage();
			});
			await settle();
		}
		// Return to a would-be-evicted page while the seventh request is slow.
		holdNext = true;
		releasePending = undefined;
		let pendingOlder;
		await act(async () => {
			pendingOlder = query.fetchNextPage();
		});
		await until(() => Boolean(releasePending));
		allowEviction = false;
		await act(async () => {
			releasePending();
			await pendingOlder;
		});
		await settle();
		assert.equal(requests.length, 7);
		assert.equal(query.data.pages.length, 6);
		assert.equal(
			query.data.pages[0].messages[0].seq,
			10000,
			"visible recent page cannot be evicted by a late older result",
		);
		assert.equal(
			query.isError,
			false,
			"pagination cancellation preserves already readable pages",
		);
		allowEviction = true;
		await act(async () => {
			await query.fetchNextPage();
		});
		await settle();
		assert.equal(requests.length, 8);
		assert.equal(query.data.pages.length, 6);
		assert.equal(query.data.pages.flatMap((page) => page.messages).length, 300);
		assert.deepEqual(
			requests
				.slice(1)
				.map((url) => Number(url.searchParams.get("before_seq"))),
			[9951, 9901, 9851, 9801, 9751, 9701, 9701],
		);
		const chronology = m.ownerAuditChronology(
			query.data.pages.map((page) => page.messages),
		);
		assert.equal(new Set(chronology.map((row) => row.id)).size, 300);
		assert.equal(
			chronology.at(-1).seq - chronology[0].seq,
			299,
			"no fixture gaps across seven requests",
		);
		assert.notEqual(
			query.data.pageParams[0],
			undefined,
			"newest evicted window is explicitly detectable",
		);
		await act(async () => {
			await query.refetchLatest();
		});
		await until(() => query.isSuccess && query.data.pages.length === 1);
		assert.equal(requests.length, 9);
		assert.equal(requests[8].searchParams.has("before_seq"), false);
		assert.equal(query.data.pages.length, 1);
		assert.equal(query.data.pages[0].messages[0].seq, 10000);
		repeatedCursor = true;
		await act(async () => {
			await query.fetchNextPage();
		});
		await settle();
		assert.equal(query.hasNextPage, false, "non-decreasing cursor cannot loop");

		// An older tenant's delayed result cannot become the new tenant's data.
		repeatedCursor = false;
		holdNext = true;
		releasePending = undefined;
		let pending;
		await act(async () => {
			pending = query.refetchLatest();
		});
		await until(() => Boolean(releasePending));
		tenantId = "org_other";
		await act(async () =>
			root.render(h(m.QueryClientProvider, { client }, h(Probe))),
		);
		await until(
			() =>
				query.isSuccess &&
				query.data.pages[0].messages[0].body.endsWith("org_other"),
		);
		await act(async () => {
			releasePending();
			await pending;
		});
		await settle();
		assert.equal(
			query.data.pages[0].messages[0].body.endsWith("org_other"),
			true,
		);
		await until(
			() =>
				client.getQueryData([
					"team-bridge",
					"owner-audit",
					"acct_fixture",
					"org_fixture",
					"bcv_fixture",
					"messages",
				]) === undefined,
		);
		deny = true;
		const beforeDenial = requests.length;
		await act(async () => {
			await query.refetchLatest();
		});
		await until(() => query.isError);
		await settle();
		assert.equal(
			requests.length,
			beforeDenial + 1,
			"permanent denial is not automatically retried",
		);
		assert.equal(query.error.status, 403);
	} finally {
		await act(async () => root.unmount());
		client.clear();
		host.remove();
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
});

test("query-backed story fixture uses current desktop protocol/real decoder, held responses and synthetic-only authority", async () => {
	const fixture = m.createOwnerAuditQueryFixture({
		accountId: "acct_fixture",
		tenantIds: ["org_fixture"],
		conversations: [],
		members: [],
		message: {
			id: "m",
			seq: 1,
			conversation_id: "bcv_fixture",
			sender: { account_id: "acct_agent", kind: "agent" },
			body: "Synthetic fixture",
			created_at: "2026-10-31T12:00:00Z",
		},
		unavailableMessage: {
			id: "m",
			seq: 1,
			conversation_id: "bcv_fixture",
			sender: { account_id: "acct_agent", kind: "agent" },
			body: null,
			created_at: "2026-10-31T12:00:00Z",
		},
	});
	const previous = window.api;
	window.api = { desktop: { request: fixture.request } };
	const scope = { accountId: "acct_fixture", tenantId: "org_fixture" };
	try {
		const first = await m.TeamBridgeOwnerAuditApi.messages(
			scope,
			"bcv_fixture",
		);
		assert.equal(first.messages.length, 50);
		assert.equal(first.messages[0].seq, 10000);
		assert.equal(first.next_before_seq, 9951);
		assert.equal(fixture.inspect().records[0].before, undefined);
		window.api = { desktop: { legacyRequest: fixture.request } };
		await assert.rejects(
			m.TeamBridgeOwnerAuditApi.messages(scope, "bcv_fixture"),
		);
		assert.equal(
			fixture.inspect().records.length,
			1,
			"a stale preload method cannot silently count as a successful query",
		);
		window.api = { desktop: { request: fixture.request } };
		await assert.rejects(
			m.TeamBridgeOwnerAuditApi.messages(
				{ ...scope, accountId: "acct_other" },
				"bcv_fixture",
			),
			(error) => error.status === 403,
		);
		await assert.rejects(
			m.TeamBridgeOwnerAuditApi.messages(
				{ ...scope, tenantId: "org_unknown" },
				"bcv_fixture",
			),
			(error) => error.status === 403,
		);
		for (const tenant of [undefined, null, 0, ""]) {
			const response = await fixture.request({
				op: "team_bridge.owner_audit.messages",
				expected_account_id: "acct_fixture",
				tenant_id: tenant,
				conversation_id: "bcv_fixture",
				limit: 50,
			});
			assert.equal(
				response.status,
				403,
				"malformed tenant values stay on the refusal path without coercion",
			);
		}
		fixture.holdNextOlder();
		const older = m.TeamBridgeOwnerAuditApi.messages(
			scope,
			"bcv_fixture",
			9951,
		);
		assert.equal(fixture.inspect().held, 1);
		fixture.release();
		assert.equal((await older).messages[0].seq, 9950);
		fixture.setMode("denied");
		await assert.rejects(
			m.TeamBridgeOwnerAuditApi.messages(scope, "bcv_fixture"),
			(error) => error.status === 403,
		);
		fixture.setMode("unavailable");
		assert.equal(
			(
				await m.TeamBridgeOwnerAuditApi.messages(scope, "bcv_fixture")
			).messages.every((row) => row.body === null),
			true,
		);
		assert.equal(
			(
				await fixture.request({
					op: "fixture.unknown",
					tenant_id: "org_fixture",
					expected_account_id: "acct_fixture",
				})
			).status,
			503,
			"unknown operations never fall through to the real desktop",
		);
		fixture.dispose();
		assert.equal(
			(
				await fixture.request({
					op: "team_bridge.directory",
					tenant_id: "org_fixture",
				})
			).status,
			503,
		);
		fixture.activate();
		assert.equal(
			fixture.client.getQueryData(m.radientUserKeys.user()).account.id,
			"acct_fixture",
			"Strict Effects setup re-establishes synthetic authority after teardown",
		);
	} finally {
		fixture.dispose();
		window.api = previous;
	}
});

const fixtureRootClassesPattern = /<div className="([^"]+)"/;
const fixturePanelClassesPattern =
	/data-query-history-panel\s+className="([^"]+)"/;
const fixtureClassTokensPattern = /\s+/;
const fixtureTagCoupledViewportPattern =
	/main (?:\.overflow-auto|\[data-message-id\])/;
const fixtureViewportCallsPattern = /queryHistoryViewport\(root.current\)/g;

test("query-backed fixture has a bounded flex panel and resolves its real timeline without a main tag", () => {
	const story = readFileSync(
		"src/renderer/src/features/team-bridge/team-bridge-owner-audit.stories.tsx",
		"utf8",
	);
	const surface = story.slice(
		story.indexOf("function QueryHistorySurface("),
		story.indexOf("function QueryBackedHistoryExercise("),
	);
	const rootClasses =
		surface
			.match(fixtureRootClassesPattern)?.[1]
			.split(fixtureClassTokensPattern) ?? [];
	const panelClasses =
		surface
			.match(fixturePanelClassesPattern)?.[1]
			.split(fixtureClassTokensPattern) ?? [];
	for (const token of ["flex", "h-screen", "min-h-0", "overflow-hidden"])
		assert.ok(rootClasses.includes(token), `fixture root lacks ${token}`);
	for (const token of [
		"flex",
		"min-h-0",
		"min-w-0",
		"flex-1",
		"flex-col",
		"overflow-hidden",
	])
		assert.ok(
			panelClasses.includes(token),
			`fixture panel parent lacks ${token}`,
		);
	const exercise = story.slice(
		story.indexOf("function QueryBackedHistoryExercise("),
	);
	assert.doesNotMatch(exercise, fixtureTagCoupledViewportPattern);
	assert.equal(
		exercise.match(fixtureViewportCallsPattern)?.length,
		3,
		"metrics, scroll controls and image probe must use the same scoped viewport lookup",
	);
	assert.ok(
		exercise.includes("viewportBoundsOk:"),
		"browser admission must report actual bounded geometry rather than only host existence",
	);
	const fixtureDom = document.createElement("div");
	// Deliberately no main tag, plus decoy sidebar and nested code scrollers.
	// This is a DOM/layout-contract test, NOT a CSS/native-height measurement.
	fixtureDom.innerHTML = `<aside class="overflow-auto"></aside><div data-query-history-panel><article><header></header><div id="actual-timeline" class="min-h-0 flex-1 overflow-auto"><ul><li data-message-id="actual-row"><pre class="overflow-auto"></pre></li></ul></div></article></div>`;
	const host = m.queryHistoryViewport(fixtureDom);
	assert.equal(host?.id, "actual-timeline");
	assert.equal(
		host.querySelector("[data-message-id]")?.dataset.messageId,
		"actual-row",
	);
	assert.equal(
		m.queryHistoryViewport(document.createElement("div")),
		null,
		"missing panel must not fall back to another scroller",
	);
});
