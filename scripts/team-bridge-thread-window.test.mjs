import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { dirname } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

// Real queries/decoders with synthetic IPC only: not a browser, runtime or hub.
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
for (const key of [
	"window",
	"document",
	"localStorage",
	"HTMLElement",
	"Element",
	"Node",
	"MutationObserver",
	"navigator",
	"NodeFilter",
	"DocumentFragment",
	"CustomEvent",
	"HTMLInputElement",
	"HTMLButtonElement",
	"HTMLTextAreaElement",
])
	Object.defineProperty(globalThis, key, {
		configurable: true,
		value: dom.window[key],
	});
// No canvas in JSDOM: report unsupported emoji rather than logging its
// not-implemented diagnostic during the real list's capability warmup.
dom.window.HTMLCanvasElement.prototype.getContext = () => null;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const control = process.env.THREAD_WINDOW_OWNER_CONTROL_REF;
const oldOwnerSource = control
	? execFileSync(
			"git",
			[
				"show",
				`${control}:src/renderer/src/features/team-bridge/use-team-bridge-owner-audit.ts`,
			],
			{ encoding: "utf8" },
		)
	: null;
const OWNER_QUERY_MODULE = /\/use-team-bridge-owner-audit\.ts$/;
const AUDIT_VIEW_MODULE = /\/team-bridge-owner-audit\.tsx$/;
const viewControl = process.env.THREAD_WINDOW_VIEW_CONTROL_REF;
const oldViewSource = viewControl
	? execFileSync(
			"git",
			[
				"show",
				`${viewControl}:src/renderer/src/features/team-bridge/team-bridge-owner-audit.tsx`,
			],
			{ encoding: "utf8" },
		)
	: null;
// Reuse the audit render suite's dependency boundary: the rail needs one
// sidebar token, not the chat application. The panel and list stay real.
const sidebarSource = readFileSync(
	"src/renderer/src/features/chat/components/chat-sidebar.tsx",
	"utf8",
);
const rowCurrentLiteral = sidebarSource.match(
	/export const rowCurrent =\s*("[^"]+")/,
)?.[1];
assert.ok(rowCurrentLiteral);
const CHAT_SIDEBAR_MODULE = /chat\/components\/chat-sidebar$/;
const ANY_STUB_MODULE = /.*/;
const viewPlugin = {
	name: "audit-view-test-boundary",
	setup(b) {
		b.onResolve({ filter: CHAT_SIDEBAR_MODULE }, () => ({
			path: "sidebar",
			namespace: "thread-test-stub",
		}));
		b.onLoad(
			{ filter: ANY_STUB_MODULE, namespace: "thread-test-stub" },
			() => ({
				contents: `export const rowCurrent = ${rowCurrentLiteral};`,
				loader: "js",
			}),
		);
		b.onLoad({ filter: AUDIT_VIEW_MODULE }, (args) => ({
			// Test-only visibility into the real private inline component; no
			// production export or alternate implementation of the reader.
			contents: `${oldViewSource ?? readFileSync(args.path, "utf8")}\nexport {ReplyDisclosure};`,
			loader: "tsx",
			resolveDir: dirname(args.path),
		}));
	},
};
const bundle = await build({
	stdin: {
		contents: `
		export {OwnerAuditPanelView, ReplyDisclosure} from './src/renderer/src/features/team-bridge/team-bridge-owner-audit';
		export * from './src/renderer/src/features/team-bridge/use-thread-reply-window';
		export {useOwnerAuditReplies} from './src/renderer/src/features/team-bridge/use-team-bridge-owner-audit';
		export {loadThreadPage} from './src/renderer/src/features/team-bridge/team-bridge-thread-read';
        export {createOwnerAuditQueryFixture} from './src/renderer/src/features/team-bridge/team-bridge-owner-audit-query.fixture';
		export {TeamBridgeOwnerAuditApi} from './src/renderer/src/shared/api/local-operator/team-bridge-owner-audit-api';
		export {DesktopControlError} from './src/renderer/src/shared/api/local-operator/desktop-api';
		export {desktopRequestSchema,desktopEndpoint} from './src/shared/desktop-contract';
		export {QueryClient,QueryClientProvider} from '@tanstack/react-query';
		export {radientUserKeys} from './src/renderer/src/shared/hooks/radient-account-authority';
		export {teamBridgeKeys} from './src/renderer/src/features/team-bridge/team-bridge-keys';
	`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	write: false,
	format: "cjs",
	platform: "node",
	external: ["react", "react-dom"],
	tsconfig: "tsconfig.app.json",
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	jsx: "automatic",
	loader: { ".css": "empty" },
	plugins: [
		viewPlugin,
		...(oldOwnerSource
			? [
					{
						name: "baseline-owner-query",
						setup(b) {
							b.onLoad({ filter: OWNER_QUERY_MODULE }, (args) => ({
								contents: oldOwnerSource,
								loader: "ts",
								resolveDir: dirname(args.path),
							}));
						},
					},
				]
			: []),
	],
});
const mod = new Module(`${process.cwd()}/.thread-window-test.cjs`);
mod.filename = `${process.cwd()}/.thread-window-test.cjs`;
mod.paths = Module._nodeModulePaths(process.cwd());
mod._compile(bundle.outputFiles[0].text, mod.filename);
const m = mod.exports;
after(() => dom.window.close());
const OWNER = "acct_fixture";
const TENANT = "org_fixture";
const CID = "bcv_test0001";
const ROOT = "bcmsg_root0001";
const rootMessage = {
	id: ROOT,
	conversation_id: CID,
	seq: 1,
	sender: { account_id: OWNER, kind: "human", display_label: "Fixture" },
	body: "Synthetic root",
	origin: "human",
	created_at: "2026-11-01T00:00:00Z",
};
const row = (seq) => ({
	...rootMessage,
	id: `bcmsg_reply${String(seq).padStart(8, "0")}`,
	seq,
	thread_root_id: ROOT,
});
function page(start, count = 50, extra = {}) {
	return {
		root: rootMessage,
		replies: Array.from({ length: count }, (_, i) => row(start + i)),
		has_more: start > 2,
		next_before_seq: start > 2 ? start : undefined,
		order: "desc",
		...extra,
	};
}
function transport(handler) {
	const calls = [];
	window.api = {
		desktop: {
			request: async (input) => {
				calls.push(input);
				const result = await handler(input);
				return { status: 200, kind: "json", body: { status: 200, result } };
			},
		},
	};
	return calls;
}
async function mount(useHook) {
	const client = new m.QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
		},
	});
	client.setQueryData(m.radientUserKeys.user(), {
		account: { id: OWNER, email: "fixture@example.invalid" },
	});
	client.setQueryData(m.teamBridgeKeys.statusFor(OWNER), {
		account_id: OWNER,
		state: "ready",
		read_only: false,
		local: { enabled: true },
	});
	let current;
	function Probe() {
		current = useHook(client);
		return null;
	}
	const host = document.createElement("div");
	document.body.append(host);
	const reactRoot = createRoot(host);
	await act(async () =>
		reactRoot.render(
			React.createElement(
				m.QueryClientProvider,
				{ client },
				React.createElement(Probe),
			),
		),
	);
	let unmounted = false;
	const unmount = async () => {
		if (unmounted) return;
		await act(async () => reactRoot.unmount());
		unmounted = true;
		host.remove();
	};
	return {
		client,
		unmount,
		async rerender() {
			await act(async () =>
				reactRoot.render(
					React.createElement(
						m.QueryClientProvider,
						{ client },
						React.createElement(Probe),
					),
				),
			);
		},
		get query() {
			return current;
		},
		async close() {
			await unmount();
			client.clear();
		},
	};
}
async function until(check) {
	for (let i = 0; i < 80; i++) {
		if (check()) return;
		await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
	}
	assert.ok(check(), "query did not settle within the bounded wait");
}
const identity = { conversationId: CID, rootId: ROOT };
const key = ["team-bridge", "replies", OWNER, TENANT, CID, ROOT];
function generic(read, options = {}) {
	return () =>
		m.useThreadReplyWindow({ queryKey: key, identity, read, ...options });
}

test("both reply endpoints serialize DESC/before without default after, preserving legacy wire", () => {
	for (const op of [
		"team_bridge.messages.replies",
		"team_bridge.owner_audit.replies",
	]) {
		const base = {
			op,
			conversation_id: CID,
			message_id: ROOT,
			expected_account_id: OWNER,
			tenant_id: TENANT,
		};
		for (const options of [
			{ order: "desc", limit: 50 },
			{ order: "desc", before_seq: 9951, limit: 50 },
		]) {
			const endpoint = m.desktopEndpoint(
				m.desktopRequestSchema.parse({ ...base, ...options }),
			);
			const query = new URL(endpoint.path, "http://fixture.invalid")
				.searchParams;
			assert.equal(query.get("order"), "desc");
			assert.equal(query.has("after_seq"), false);
			assert.equal(
				query.get("before_seq"),
				options.before_seq === undefined ? null : "9951",
			);
		}
		const legacy = new URL(
			m.desktopEndpoint(m.desktopRequestSchema.parse(base)).path,
			"http://fixture.invalid",
		).searchParams;
		assert.equal(legacy.has("before_seq"), false);
		assert.equal(legacy.has("order"), false);
		assert.equal(legacy.has("after_seq"), false);
	}
});

test("actual owner reply hook opens bounded newest, not the legacy oldest window", async () => {
	const calls = transport((input) =>
		input.order === "desc"
			? page(9951)
			: page(2, 50, { order: undefined, has_more: true, next_after_seq: 52 }),
	);
	const h = await mount(() =>
		m.useOwnerAuditReplies({ accountId: OWNER, tenantId: TENANT }, CID, ROOT),
	);
	try {
		await until(() => h.query.isSuccess || h.query.isError);
		assert.equal(h.query.isSuccess, true, String(h.query.error));
		assert.equal(h.query.data.pages[0].replies[0].seq, 9951);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].order, "desc");
		assert.equal(calls[0].after_seq, undefined);
		assert.equal(h.query.data.pages[0].replies.length, 50);
	} finally {
		await h.close();
	}
});

test("actual member decoder and query reverse PAGE order only, with exclusive older cursor", async () => {
	const calls = transport((input) =>
		input.before_seq === undefined ? page(9951) : page(9901),
	);
	const h = await mount(
		generic((mode, cursor) =>
			m.loadThreadPage(
				{ tenantId: TENANT, ...identity },
				OWNER,
				mode === "desc" ? undefined : (cursor ?? 0),
				mode === "desc" ? { order: "desc", beforeSeq: cursor } : undefined,
			),
		),
	);
	try {
		await until(() => h.query.isSuccess);
		await act(async () => {
			await h.query.fetchNextPage();
		});
		await until(() => h.query.data.pages.length === 2);
		assert.deepEqual(
			h.query.replies.map((r) => r.seq),
			Array.from({ length: 100 }, (_, i) => 9901 + i),
		);
		assert.equal(calls[1].before_seq, 9951);
		assert.equal(calls[1].after_seq, undefined);
	} finally {
		await h.close();
	}
});

test("old hub missing echo is discarded, then legacy ASC uses a separate cache key", async () => {
	const calls = transport(() =>
		page(2, 50, {
			order: undefined,
			has_more: false,
			next_before_seq: undefined,
		}),
	);
	const h = await mount(() =>
		m.useOwnerAuditReplies({ accountId: OWNER, tenantId: TENANT }, CID, ROOT),
	);
	try {
		await until(() => h.query.isSuccess);
		assert.equal(h.query.mode, "legacy");
		assert.equal(h.query.latestPageAvailable, false);
		assert.equal(calls.length, 2);
		assert.equal(calls[0].order, "desc");
		assert.equal(calls[1].order, undefined);
		assert.equal(calls[1].after_seq, 0);
		assert.ok(
			h.client
				.getQueryCache()
				.findAll()
				.filter((q) => q.queryKey.at(-1) === "desc")
				.every((q) => q.state.data === undefined),
		);
	} finally {
		await h.close();
	}
});

test("only unsupported initial query can downgrade; auth/permanent errors never do", async () => {
	for (const status of [401, 403, 404, 409, 500]) {
		const modes = [];
		const h = await mount(
			generic(async (mode) => {
				modes.push(mode);
				throw new m.DesktopControlError(
					status,
					"Synthetic refusal",
					undefined,
					"invalid_request",
				);
			}),
		);
		try {
			await until(() => h.query.isError);
			assert.deepEqual(modes, ["desc"]);
		} finally {
			await h.close();
		}
	}
	const modes = [];
	const h = await mount(
		generic(async (mode) => {
			modes.push(mode);
			if (mode === "desc")
				throw new m.DesktopControlError(
					422,
					"Synthetic old runtime",
					undefined,
					"invalid_request",
				);
			return page(2, 0, { order: undefined, has_more: false });
		}),
	);
	try {
		await until(() => h.query.isSuccess);
		assert.deepEqual(modes, ["desc", "legacy"]);
		assert.equal(h.query.mode, "legacy");
	} finally {
		await h.close();
	}
});

test("explicit empty terminal echo works; malformed order/root/boundaries cannot masquerade", async () => {
	for (const mutate of [
		(p) => ({ ...p, order: "asc" }),
		(p) => ({ ...p, root: { ...p.root, id: "bcmsg_other" } }),
		(p) => ({ ...p, next_before_seq: 123 }),
		(p) => ({ ...p, replies: [...p.replies].reverse() }),
	]) {
		let calls = 0;
		const h = await mount(
			generic(async () => {
				calls++;
				return mutate(page(9951));
			}),
		);
		try {
			await until(() => h.query.isError);
			assert.equal(calls, 1);
			assert.equal(h.query.mode, "desc");
		} finally {
			await h.close();
		}
	}
	const h = await mount(generic(async () => page(2, 0, { has_more: false })));
	try {
		await until(() => h.query.isSuccess);
		assert.equal(h.query.replies.length, 0);
		assert.equal(h.query.hasNextPage, false);
		assert.equal(h.query.mode, "desc");
	} finally {
		await h.close();
	}
});

test("six-page bound refuses visible eviction, slides only offscreen and resets newest explicitly", async () => {
	let evict = false;
	let calls = 0;
	const h = await mount(
		generic(
			async (_mode, cursor) => {
				calls++;
				return page(cursor === undefined ? 9951 : cursor - 50);
			},
			{ canEvict: () => evict },
		),
	);
	try {
		await until(() => h.query.isSuccess);
		for (let i = 0; i < 5; i++)
			await act(async () => {
				await h.query.fetchNextPage();
			});
		await until(() => h.query.data.pages.length === 6);
		assert.equal(h.query.replies.length, 300);
		await act(async () => {
			await h.query.fetchNextPage();
		});
		assert.equal(h.query.data.pages[0].replies[0].seq, 9951);
		assert.equal(h.query.replies.length, 300);
		evict = true;
		await act(async () => {
			await h.query.fetchNextPage();
		});
		await until(() => h.query.data.pages[0].replies[0].seq === 9901);
		assert.equal(h.query.latestPageAvailable, false);
		await act(async () => {
			await h.query.resetLatest();
		});
		await until(() => h.query.data?.pages.length === 1);
		assert.equal(h.query.latestPageAvailable, true);
		assert.equal(h.query.replies.length, 50);
		assert.equal(calls, 9);
	} finally {
		await h.close();
	}
});

test("unmount cancels held result and leaves no private reply cache", async () => {
	let release;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	const h = await mount(generic(async () => held));
	let privateSuccesses = 0;
	const unsubscribe = h.client.getQueryCache().subscribe((event) => {
		if (
			event.query.queryKey.includes("replies") &&
			event.query.state.data !== undefined
		)
			privateSuccesses++;
	});
	await h.unmount();
	release(page(9951));
	await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
	try {
		await until(
			() => h.client.getQueryCache().findAll({ queryKey: key }).length === 0,
		);
		assert.ok(
			h.client.getQueryData(m.radientUserKeys.user()),
			"metadata remains: client.clear cannot masquerade as private gcTime:0",
		);
		assert.equal(
			privateSuccesses,
			0,
			"late private result never enters even a short-lived cache",
		);
	} finally {
		unsubscribe();
		await h.close();
	}
});

test("actual owner org switch cancels the old response without downgrading or caching its oldest window", async () => {
	let tenant = TENANT;
	let release;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	const calls = transport((input) =>
		input.tenant_id === TENANT ? held : page(9951),
	);
	const h = await mount(() =>
		m.useOwnerAuditReplies({ accountId: OWNER, tenantId: tenant }, CID, ROOT),
	);
	try {
		await until(() => calls.length === 1);
		tenant = "org_other";
		await h.rerender();
		await until(() => h.query.isSuccess);
		release(page(2, 50, { order: undefined, has_more: false }));
		await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
		assert.equal(h.query.mode, "desc");
		assert.equal(h.query.replies[0].seq, 9951);
		assert.equal(calls.length, 2);
		assert.ok(
			h.client
				.getQueryCache()
				.findAll()
				.filter(
					(q) => q.queryKey.includes(TENANT) && q.queryKey.includes("replies"),
				)
				.every((q) => q.state.data === undefined),
		);
	} finally {
		release(page(2, 0, { has_more: false }));
		await h.close();
	}
});

test("actual owner sign-out during a held read rejects the body instead of retrying or falling back", async () => {
	let release;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	const calls = transport(() => held);
	const h = await mount(() =>
		m.useOwnerAuditReplies({ accountId: OWNER, tenantId: TENANT }, CID, ROOT),
	);
	try {
		await until(() => calls.length === 1);
		await act(async () =>
			h.client.setQueryData(m.radientUserKeys.user(), null),
		);
		release(page(9951));
		// Main's subscribed authority generation parks the new query on sign-out;
		// cancellation is not an error/retry and must never admit the held body.
		await until(() => h.query.auditAuthRequired && !h.query.isFetching);
		assert.equal(h.query.data, undefined);
		assert.equal(calls.length, 1);
		assert.equal(h.query.mode, "desc");
	} finally {
		release(page(2, 0, { has_more: false }));
		await h.close();
	}
});

test("owner window retains main's one-retry 5xx recovery without automatic focus/reconnect retries", async () => {
	let attempts = 0;
	const calls = transport(() => {
		if (++attempts === 1)
			throw new m.DesktopControlError(503, "Synthetic unavailable");
		return page(9951);
	});
	const h = await mount(() =>
		m.useOwnerAuditReplies({ accountId: OWNER, tenantId: TENANT }, CID, ROOT),
	);
	try {
		await until(() => h.query.isSuccess);
		assert.equal(calls.length, 2);
		const query = h.client
			.getQueryCache()
			.findAll()
			.find((q) => q.queryKey.includes("replies"));
		assert.equal(query.options.enabled, true);
		assert.equal(query.options.retryDelay, 250);
		assert.equal(
			query.options.retry(
				0,
				new m.DesktopControlError(503, "Synthetic unavailable"),
			),
			true,
		);
		assert.equal(
			query.options.retry(
				1,
				new m.DesktopControlError(503, "Synthetic unavailable"),
			),
			false,
		);
		assert.equal(
			query.options.retry(
				0,
				new m.DesktopControlError(403, "Synthetic refusal"),
			),
			false,
		);
		assert.equal(query.options.refetchOnWindowFocus, false);
		assert.equal(query.options.refetchOnReconnect, false);
		assert.equal(query.options.retryOnMount, false);
	} finally {
		await h.close();
	}
});

test("reused story transport admits both real decoders and models old-server/runtime negotiation honestly", async () => {
	const fixture = m.createOwnerAuditQueryFixture({
		accountId: OWNER,
		tenantIds: [TENANT],
		conversations: [],
		members: [],
		message: rootMessage,
		unavailableMessage: { ...rootMessage, body: null },
	});
	const prior = window.api;
	window.api = { desktop: { request: fixture.request } };
	const scope = { accountId: OWNER, tenantId: TENANT };
	try {
		const member = await m.loadThreadPage(
			{ tenantId: TENANT, ...identity },
			OWNER,
			undefined,
			{ order: "desc" },
		);
		const owner = await m.TeamBridgeOwnerAuditApi.replies(
			scope,
			CID,
			ROOT,
			undefined,
			{ order: "desc" },
		);
		assert.equal(member.order, "desc");
		assert.equal(owner.order, "desc");
		assert.equal(member.replies.length, 50);
		assert.equal(owner.replies.at(-1).seq, 20000);
		fixture.setThreadMode("old-server");
		const ignored = await m.TeamBridgeOwnerAuditApi.replies(
			scope,
			CID,
			ROOT,
			undefined,
			{ order: "desc" },
		);
		assert.equal(ignored.order, undefined);
		assert.throws(() => m.admitReplyWindow(ignored));
		const legacy = await m.TeamBridgeOwnerAuditApi.replies(scope, CID, ROOT, 0);
		assert.equal(legacy.replies[0].seq, 10000);
		assert.equal(legacy.next_after_seq, 10050);
		fixture.setThreadMode("old-runtime");
		await assert.rejects(
			m.TeamBridgeOwnerAuditApi.replies(scope, CID, ROOT, undefined, {
				order: "desc",
			}),
			(e) => e.status === 422 && e.code === "invalid_request",
		);
	} finally {
		fixture.dispose();
		window.api = prior;
	}
});

test("only transient older-page errors retain the admitted window; auth/epoch refusals do not", async () => {
	for (const [error, retain] of [
		[new m.DesktopControlError(503, "Synthetic unavailable"), true],
		[new m.DesktopControlError(null, "Synthetic transport"), true],
		[new m.DesktopControlError(403, "Synthetic denied"), false],
		[new Error("Synthetic authority changed"), false],
	]) {
		const h = await mount(
			generic(async (_mode, cursor) => {
				if (cursor !== undefined) throw error;
				return page(9951);
			}),
		);
		try {
			await until(() => h.query.isSuccess);
			await act(async () => {
				await h.query.fetchNextPage();
			});
			await until(() => h.query.isError);
			assert.equal(h.query.keepWindowOnError, retain);
			assert.equal(h.query.mode, "desc");
		} finally {
			await h.close();
		}
	}
});

test("a reused message ID with a different sequence cannot corrupt the bounded global chronology", async () => {
	let calls = 0;
	const h = await mount(
		generic(async (_mode, cursor) => {
			calls++;
			if (cursor === undefined) return page(9951);
			const older = page(9901);
			older.replies[0] = { ...older.replies[0], id: row(9951).id };
			return older;
		}),
	);
	try {
		await until(() => h.query.isSuccess);
		await act(async () => {
			await h.query.fetchNextPage();
		});
		await until(() => h.query.isError);
		assert.equal(h.query.data.pages.length, 1);
		assert.equal(calls, 2);
		assert.equal(h.query.mode, "desc");
	} finally {
		await h.close();
	}
});

// Independent review6554794746 reproduced both failures on b418. Keep the
// non-evicting operations separate: post-send invalidation and polling must
// refresh the same six-page cache even while its newest page is visible.
for (const operation of ["refetch", "post-send invalidation", "poll"]) {
	test(`six-page ${operation} admits arrivals without evicting the visible newest page`, async (t) => {
		if (operation === "poll") t.mock.timers.enable({ apis: ["setInterval"] });
		let latest = 10000;
		let mayEvict = true;
		let reads = 0;
		const h = await mount(
			generic(
				async (_mode, cursor) => {
					reads++;
					return page((cursor ?? latest + 1) - 50);
				},
				{
					canEvict: () => mayEvict,
					poll: operation === "poll",
				},
			),
		);
		try {
			await until(() => h.query.isSuccess);
			for (let i = 0; i < 5; i++) {
				await act(async () => {
					await h.query.fetchNextPage();
				});
				// A resolved fetch can precede the observer's committed page count.
				// Wait before the next fetch so it cannot reuse a stale cursor.
				await until(
					() => h.query.data.pages.length === i + 2 && !h.query.isFetching,
				);
			}
			await until(() => h.query.data.pages.length === 6);
			assert.equal(reads, 6, "all six pages were read, not cancelled");
			assert.equal(h.query.data.pages.length, 6);
			assert.equal(h.query.replies.at(-1).seq, 10000);
			mayEvict = false;
			latest = 10001;
			await act(async () => {
				if (operation === "poll") t.mock.timers.tick(8000);
				else if (operation === "post-send invalidation")
					await h.client.invalidateQueries({ queryKey: key });
				else await h.query.refetch();
			});
			await until(
				() => h.query.replies.at(-1)?.seq === 10001 && !h.query.isFetching,
			);
			assert.equal(reads, 12, "refresh read all six cached pages");
			assert.equal(h.query.data.pages.length, 6);
			assert.equal(h.query.replies.length, 300);
			assert.equal(h.query.isError, false);
			// Same-code positive control: allowing eviction cannot be necessary
			// for an ordinary refresh to admit the next arrival either.
			mayEvict = true;
			latest = 10002;
			await act(async () => {
				await h.query.refetch();
			});
			await until(() => h.query.replies.at(-1)?.seq === 10002);
		} finally {
			await h.close();
			if (operation === "poll") t.mock.timers.reset();
		}
	});
}

test("conflicting IDs inside the initial page are refused before private cache admission", async () => {
	const invalid = page(9951);
	invalid.replies[1] = { ...invalid.replies[1], id: invalid.replies[0].id };
	let response = invalid;
	const h = await mount(generic(async () => response));
	try {
		await until(() => h.query.isSuccess || h.query.isError);
		assert.equal(h.query.isError, true);
		assert.equal(h.query.data, undefined);
		assert.equal(h.query.replies.length, 0);
		assert.equal(h.client.getQueryData([...key, "desc"]), undefined);
		response = page(9951);
		await act(async () => {
			await h.query.refetch();
		});
		await until(() => h.query.isSuccess);
		assert.equal(h.query.replies.length, 50);
		assert.equal(h.query.data.pages[0].replies.length, 50);
	} finally {
		await h.close();
	}
});

// JSDOM has no layout engine: model only the outer transcript's block geometry
// and native scroll clamping, then drive the REAL panel/disclosure/query hooks.
// This is a deterministic scroll-policy regression, not browser pixel evidence.
test("combined parent and reply arrival holds the OUTER inline viewport top", async () => {
	let response = page(9951);
	transport(() => response);
	const client = new m.QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
		},
	});
	client.setQueryData(m.radientUserKeys.user(), {
		account: { id: OWNER, email: "fixture@example.invalid" },
	});
	client.setQueryData(m.teamBridgeKeys.statusFor(OWNER), {
		account_id: OWNER,
		state: "ready",
		read_only: false,
		local: { enabled: true },
	});
	const conversation = {
		id: CID,
		tenant_id: TENANT,
		kind: "channel",
		name: "Fixture",
		members: [],
		agent: {
			account_id: "acct_agent_fixture",
			display_label: "Agent",
			state: "active",
			joined_seq: 1,
		},
	};
	const scope = { accountId: OWNER, tenantId: TENANT };
	let parents = [{ ...rootMessage, reply_count: 10000 }];
	const host = document.createElement("div");
	document.body.append(host);
	const reactRoot = createRoot(host);
	const draw = () =>
		React.createElement(
			m.QueryClientProvider,
			{ client },
			React.createElement(m.OwnerAuditPanelView, {
				conversation,
				messages: parents,
				state: "ready",
				retry() {},
				readerAccountId: OWNER,
				renderReplies: (root) =>
					React.createElement(m.ReplyDisclosure, {
						scope,
						conversation,
						root,
						people: [],
					}),
			}),
		);
	try {
		await act(async () => reactRoot.render(draw()));
		const disclosure = host.querySelector("details");
		const outer = disclosure.closest(".overflow-auto");
		assert.ok(outer);
		let scrollTop = 600;
		const outerWrites = [];
		const height = () => 1200 + (parents.length - 1) * 52;
		Object.defineProperties(outer, {
			clientHeight: { configurable: true, get: () => 600 },
			scrollHeight: { configurable: true, get: height },
			scrollTop: {
				configurable: true,
				get: () => scrollTop,
				set: (value) => {
					outerWrites.push(value);
					scrollTop = Math.max(0, Math.min(value, height() - 600));
				},
			},
		});
		const box = (top, h) => ({
			top,
			bottom: top + h,
			height: h,
			left: 0,
			right: 600,
			width: 600,
		});
		outer.getBoundingClientRect = () => box(100, 600);
		const parentRow = disclosure.closest("[data-message-id]");
		assert.ok(parentRow);
		parentRow.getBoundingClientRect = () => box(760 - scrollTop, 400);
		await act(async () => outer.dispatchEvent(new window.Event("scroll")));
		await act(async () => {
			disclosure.open = true;
			disclosure.dispatchEvent(new window.Event("toggle"));
		});
		await until(
			() =>
				host.querySelectorAll("[data-audit-reply-window] [data-message-id]")
					.length === 50,
		);
		const inline = host.querySelector("[data-audit-reply-window]");
		inline.getBoundingClientRect = () => box(860 - scrollTop, 320);
		const before = inline.getBoundingClientRect().top;
		// Both arrivals are committed together. The parent append used to call
		// toBottom(), shifting this entire box upward by the parent's 52px.
		outerWrites.length = 0;
		response = page(9952);
		parents = [
			...parents,
			{ ...rootMessage, id: "bcmsg_parent_arrival", seq: 10002 },
		];
		await act(async () => {
			await client.invalidateQueries({
				queryKey: ["team-bridge", "owner-audit"],
			});
			reactRoot.render(draw());
		});
		await until(() =>
			inline.querySelector('[data-message-id="bcmsg_reply00010001"]'),
		);
		assert.equal(
			inline.getBoundingClientRect().top,
			before,
			"parent live-edge following must not move the inline surface on combined arrival",
		);
		assert.equal(scrollTop, 600, "the parent's held offset is unchanged");
		assert.ok(
			outerWrites.every((value) => value === 600),
			"no intermediate jump-then-scroll correction in the outer transcript",
		);
		assert.equal(
			inline.querySelectorAll("[data-message-id]").length,
			50,
			"combined arrival preserves the bounded newest window",
		);
		assert.ok(
			inline.classList.contains("h-80"),
			"reserve height even for short or empty reply results",
		);
		assert.ok(
			inline.classList.contains("overflow-x-hidden"),
			"ordinary replies must not reserve a horizontal scrollbar",
		);
		assert.ok(host.textContent.includes("Load older replies"));
		response = page(2, 0, { has_more: false, next_before_seq: undefined });
		await act(async () => {
			await client.invalidateQueries({
				queryKey: ["team-bridge", "owner-audit"],
			});
		});
		await until(() =>
			inline.textContent.includes("No replies in this audit window."),
		);
		assert.equal(inline.querySelectorAll("[data-message-id]").length, 0);
	} finally {
		await act(async () => reactRoot.unmount());
		client.clear();
		host.remove();
	}
});
