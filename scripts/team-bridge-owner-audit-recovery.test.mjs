/** Bounded recovery against the shipped hook/transport, not a parallel retry
 * simulation. IPC and account/status answers are synthetic; no live hub or
 * credential is used. Render assertions are markup, not visual evidence. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

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
	"DocumentFragment",
	"CustomEvent",
])
	globalThis[key] = key === "window" ? dom.window : dom.window[key];
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const { renderToStaticMarkup } = await import("react-dom/server");
const row = readFileSync(
	"src/renderer/src/features/chat/components/chat-sidebar.tsx",
	"utf8",
).match(/export const rowCurrent =\s*("[^"]+")/)[1];
const SIDEBAR_MODULE = /chat\/components\/chat-sidebar$/;
const ANY_MODULE = /.*/;
const SIGN_IN_ROUTE = /#\/settings\?section=radient/;
const STALE_MARKER = /private-stale-marker/;
const TRY_AGAIN = /Try again/;
const bundle = await build({
	stdin: {
		contents: `
 export * from "./src/renderer/src/features/team-bridge/use-team-bridge-owner-audit";
 export { AuditFailure, OwnerAuditRailView, readState } from "./src/renderer/src/features/team-bridge/team-bridge-owner-audit";
 export { DesktopControlError, desktopRequestTimeoutMs } from "./src/renderer/src/shared/api/local-operator/desktop-api";
 export * from "./src/renderer/src/shared/hooks/radient-account-authority";
 export { teamBridgeKeys } from "./src/renderer/src/features/team-bridge/team-bridge-keys";
 export { QueryClient, QueryClientProvider, CancelledError } from "@tanstack/react-query";
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
	plugins: [
		{
			name: "sidebar-boundary",
			setup(b) {
				b.onResolve({ filter: SIDEBAR_MODULE }, () => ({
					path: "sidebar",
					namespace: "stub",
				}));
				b.onLoad({ filter: ANY_MODULE, namespace: "stub" }, () => ({
					contents: `export const rowCurrent = ${row};`,
				}));
			},
		},
	],
});
const compiled = new Module(
	`${process.cwd()}/scripts/audit-recovery-runtime.cjs`,
);
compiled.filename = `${process.cwd()}/scripts/audit-recovery-runtime.cjs`;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const m = compiled.exports;
const error = (status, code) =>
	new m.DesktopControlError(status, "synthetic refusal", undefined, code);
const h = React.createElement;
const scope = { accountId: "audit_owner", tenantId: "audit_tenant" };
function seed() {
	const client = new m.QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
		},
	});
	client.setQueryData(m.radientUserKeys.user(), {
		account: { id: scope.accountId },
	});
	client.setQueryData(m.teamBridgeKeys.statusFor(scope.accountId), {
		account_id: scope.accountId,
		state: "ready",
		read_only: false,
		local: { enabled: true },
	});
	return client;
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, ms = 2500) {
	const end = Date.now() + ms;
	while (!predicate() && Date.now() < end) await act(async () => pause(15));
	assert.ok(predicate(), "condition settled within bounded test deadline");
}
async function mount(response, hook = m.useOwnerAuditConversations) {
	const client = seed();
	const requests = [];
	window.api = {
		desktop: {
			request: async (request) => {
				requests.push(request);
				return response(request, requests.length);
			},
		},
	};
	let query;
	function Probe() {
		query = hook(scope, "conversation", "root");
		return h(m.OwnerAuditRailView, {
			conversations:
				query.data?.pages.flatMap((page) => page.conversations ?? []) ?? [],
			state: m.readState(query),
			onSelect() {},
			retry: () => query.refetch(),
		});
	}
	const root = createRoot(document.getElementById("root"));
	const show = async (visible, keys = ["probe"]) =>
		act(async () =>
			root.render(
				h(
					m.QueryClientProvider,
					{ client },
					visible ? keys.map((key) => h(Probe, { key })) : null,
				),
			),
		);
	await show(true);
	return {
		client,
		requests,
		query: () => query,
		show,
		text: () => document.getElementById("root").textContent,
		close: async () => {
			await act(async () => root.unmount());
			client.clear();
		},
	};
}
const ok = {
	status: 200,
	body: { result: { conversations: [], has_more: false, next_cursor: null } },
};

test("shared classifier preserves known authority categories and unknown codes", () => {
	for (const [e, category] of [
		[new TypeError("Failed to fetch"), "other"],
		[error(null), "desktop"],
		[error(503), "desktop"],
		[new Error("Owner audit authority changed"), "audit-owner"],
		[new Error("Team Bridge read authority changed"), "bridge-authority"],
		[new Error("Account authority changed"), "credential-authority"],
		[new m.CancelledError(), "cancelled"],
	])
		assert.equal(m.auditFailureMetadata(e).category, category);
	assert.equal(
		m.auditFailureMetadata(error(500, "unrecognized_private_code")).code,
		"other",
	);
});

test("retry policy never retries unknown/network/null, 401, 403, 404 or authority cancellation", () => {
	for (const e of [
		new TypeError("Failed to fetch"),
		error(null),
		error(401),
		error(403),
		error(404),
		error(422, "unknown"),
		new Error("Account authority changed"),
		new m.CancelledError(),
	])
		assert.equal(m.retryOwnerAuditRead(0, e), false);
	for (const status of [500, 503, 599]) {
		assert.equal(m.retryOwnerAuditRead(0, error(status, "unknown")), true);
		assert.equal(m.retryOwnerAuditRead(1, error(status, "unknown")), false);
	}
	assert.equal(m.retryOwnerAuditRead(0, error(503)), true);
	assert.equal(m.retryOwnerAuditRead(1, error(503)), false);
});

test("uncoded and unrecognised 503 responses recover on exactly one retry", async () => {
	for (const body of [
		{},
		{ detail: { code: "unrecognised_service_failure" } },
	]) {
		const rig = await mount((_request, attempt) =>
			attempt === 1 ? { status: 503, body } : ok,
		);
		try {
			await until(() => rig.query().isSuccess || rig.query().isError);
			assert.equal(
				rig.requests.length,
				2,
				"HTTP 503 earns one retry regardless of body shape",
			);
			assert.equal(rig.query().isSuccess, true);
			assert.equal(m.readState(rig.query()), "ready");
		} finally {
			await rig.close();
		}
	}
});

test("an unrecognised 4xx refusal never requests the succeeding response", async () => {
	const rig = await mount((_request, attempt) =>
		attempt === 1
			? { status: 422, body: { detail: { code: "unrecognised_refusal" } } }
			: ok,
	);
	try {
		await until(() => rig.query().isError);
		assert.equal(rig.requests.length, 1);
		assert.equal(rig.query().error.status, 422);
	} finally {
		await rig.close();
	}
});

test("four actionable states map from typed errors; permission/not-found have no retry", () => {
	for (const [e, state] of [
		[error(401), "auth"],
		[error(403), "permission"],
		[error(404), "not-found"],
		[error(503), "unavailable"],
		[error(null), "error"],
	]) {
		assert.equal(m.auditFailureState(e), state);
		assert.equal(
			m.readState({ isPending: false, isError: true, error: e }),
			state,
		);
		const markup = renderToStaticMarkup(
			h(m.AuditFailure, { state, retry() {} }),
		);
		assert.equal(
			markup.includes("Try again"),
			state === "error" || state === "unavailable",
		);
		if (state === "auth") assert.match(markup, SIGN_IN_ROUTE);
		if (state === "permission" || state === "not-found" || state === "auth") {
			assert.equal(
				m.readState({
					isPending: false,
					isError: true,
					data: { pages: [] },
					error: e,
				}),
				state,
			);
		}
		const rail = renderToStaticMarkup(
			h(m.OwnerAuditRailView, {
				conversations: [],
				state,
				onSelect() {},
				retry() {},
			}),
		);
		assert.equal(
			rail.includes("Try again"),
			state === "error" || state === "unavailable",
		);
	}
	assert.equal(
		m.readState({ isPending: true, isError: false, auditAuthRequired: true }),
		"auth",
	);
});

for (const hook of [
	m.useOwnerAuditConversations,
	m.useOwnerAuditMessages,
	m.useOwnerAuditReplies,
]) {
	test(`${hook.name}: 503 is attempted exactly twice, 403 exactly once`, async () => {
		for (const [status, count] of [
			[503, 2],
			[403, 1],
			[404, 1],
		]) {
			const rig = await mount(
				() => ({
					status,
					body: {
						detail: {
							code: status === 503 ? "owner_audit_unavailable" : undefined,
						},
					},
				}),
				hook,
			);
			try {
				await until(() => rig.query().isError);
				assert.equal(
					rig.requests.length,
					count,
					JSON.stringify(m.auditFailureMetadata(rig.query().error)),
				);
				assert.ok(
					rig.requests.every(
						(r) =>
							r.expected_account_id === scope.accountId &&
							r.tenant_id === scope.tenantId,
					),
				);
			} finally {
				await rig.close();
			}
		}
	});
}

test("401 without completed refresh waits at most one window and surfaces auth without retry", async () => {
	const start = Date.now();
	const rig = await mount(() => ({ status: 401, body: {} }));
	try {
		await until(() => rig.query().isError);
		assert.equal(rig.requests.length, 1);
		assert.equal(m.auditFailureState(rig.query().error), "auth");
		assert.ok(Date.now() - start >= m.AUDIT_AUTH_SETTLEMENT_MS);
	} finally {
		await rig.close();
	}
});

test("401 after real epoch settlement issues one fresh read; repeated 401 does not loop", async () => {
	const rig = await mount(() => ({ status: 401, body: {} }));
	try {
		await until(() => rig.requests.length === 1);
		await act(async () => {
			m.beginRadientAuthorityTransition(rig.client);
			m.settleRadientAuthority(
				rig.client,
				m.radientAuthorityEpoch(rig.client),
				scope.accountId,
			);
		});
		await until(() => rig.query().isError);
		assert.equal(rig.requests.length, 2);
		assert.equal(m.auditFailureState(rig.query().error), "auth");
		await act(async () => pause(m.AUDIT_RETRY_DELAY_MS * 2));
		assert.equal(rig.requests.length, 2);
	} finally {
		await rig.close();
	}
});

test("late old-epoch audit bodies never warm cache; new authority commissions a fresh request", async () => {
	let release;
	const rig = await mount((_request, n) =>
		n === 1
			? new Promise((resolve) => {
					release = resolve;
				})
			: ok,
	);
	try {
		await until(() => Boolean(release));
		await act(async () => {
			m.beginRadientAuthorityTransition(rig.client);
			m.settleRadientAuthority(
				rig.client,
				m.radientAuthorityEpoch(rig.client),
				scope.accountId,
			);
		});
		await until(() => rig.query().isSuccess || rig.query().isError);
		assert.equal(rig.query().isSuccess, true, String(rig.query().error));
		assert.equal(rig.requests.length, 2);
		await act(async () =>
			release({
				status: 200,
				body: {
					result: { ...ok.body.result, next_cursor: "private-stale-marker" },
				},
			}),
		);
		await act(async () => pause(30));
		assert.doesNotMatch(
			JSON.stringify(
				rig.client
					.getQueryCache()
					.getAll()
					.map((q) => q.state.data),
			),
			STALE_MARKER,
		);
		assert.equal(rig.query().data.pages[0].next_cursor, null);
		await act(async () => m.beginRadientAuthoritySignOut(rig.client));
		assert.equal(rig.query().auditAuthRequired, true);
		assert.equal(rig.query().data, undefined);
	} finally {
		await rig.close();
	}
});

test("a never-settling IPC read reaches the existing deadline and an actionable error", async () => {
	const rig = await mount((_request, attempt) =>
		attempt === 1 ? new Promise(() => {}) : ok,
	);
	try {
		const timeout = m.desktopRequestTimeoutMs(rig.requests[0]);
		console.log(
			`hanging: initial=${m.readState(rig.query())}, existing deadline=${timeout}ms`,
		);
		await until(() => rig.query().isError, timeout + 1500);
		console.log(
			`hanging: final=${m.readState(rig.query())}, code=${rig.query().error.code}, requests=${rig.requests.length}, text=${rig.text()}`,
		);
		assert.equal(rig.query().error.code, "deadline_exceeded");
		assert.equal(m.readState(rig.query()), "error");
		assert.match(rig.text(), TRY_AGAIN);
		assert.equal(rig.requests.length, 1);
		await act(async () => document.querySelector("button").click());
		await until(() => rig.query().isSuccess);
		assert.equal(rig.requests.length, 2);
		assert.equal(m.readState(rig.query()), "ready");
	} finally {
		await rig.close();
	}
});

const auditRoot = {
	id: "root",
	conversation_id: "conversation",
	seq: 1,
	sender: { account_id: "audit_agent", kind: "agent" },
	body: "fresh audit history",
	created_at: "2026-11-01T00:00:00Z",
};
const navigationOk = {
	status: 200,
	body: {
		result: {
			...ok.body.result,
			conversations: [
				{
					id: "conversation",
					tenant_id: scope.tenantId,
					kind: "dm",
					name: "Fresh audited conversation",
					agent: { account_id: "audit_agent", state: "active", joined_seq: 1 },
				},
			],
			messages: [auditRoot],
			next_before_seq: null,
			root: auditRoot,
			replies: [],
			next_after_seq: null,
		},
	},
};

for (const hook of [
	m.useOwnerAuditConversations,
	m.useOwnerAuditMessages,
	m.useOwnerAuditReplies,
]) {
	for (const settlement of ["late-success", "late-cancellation"]) {
		test(`${hook.name}: navigation remount does not inherit ${settlement} from the departed read`, async () => {
			let release;
			let reject;
			const rig = await mount(
				(_request, n) =>
					n === 1
						? new Promise((resolve, fail) => {
								release = resolve;
								reject = fail;
							})
						: navigationOk,
				hook,
			);
			try {
				await until(() => Boolean(release));
				console.log(
					`${hook.name} ${settlement}: initial=${m.readState(rig.query())}, requests=${rig.requests.length}`,
				);
				await rig.show(false);
				await rig.show(true);
				await act(async () => pause(30));
				console.log(
					`${settlement}: remount=${m.readState(rig.query())}, requests=${rig.requests.length}`,
				);
				await act(async () =>
					settlement === "late-success"
						? release({
								...navigationOk,
								body: {
									result: {
										...navigationOk.body.result,
										next_cursor: "private-stale-marker",
									},
								},
							})
						: reject(new m.CancelledError({ revert: true })),
				);
				await act(async () => pause(50));
				console.log(
					`${settlement}: settled-old=${m.readState(rig.query())}, fetch=${rig.query().fetchStatus}, requests=${rig.requests.length}, text=${rig.text()}`,
				);
				assert.equal(m.readState(rig.query()), "ready");
				assert.equal(
					rig.requests.length,
					2,
					"the new mount owns a fresh request",
				);
				assert.equal(
					rig.query().data.pages[0].messages[0].body,
					"fresh audit history",
				);
				assert.doesNotMatch(JSON.stringify(rig.query().data), STALE_MARKER);
				assert.equal(rig.text(), "Fresh audited conversation");
			} finally {
				await rig.close();
			}
		});
	}
	test(`${hook.name}: explicit cancellation followed by remount starts a fresh read`, async () => {
		let release;
		const rig = await mount(
			(_request, n) =>
				n === 1
					? new Promise((resolve) => {
							release = resolve;
						})
					: navigationOk,
			hook,
		);
		try {
			await until(() => Boolean(release));
			await act(async () =>
				rig.client.cancelQueries({ queryKey: ["team-bridge", "owner-audit"] }),
			);
			await until(() => rig.query().fetchStatus === "idle");
			console.log(
				`${hook.name}: cancelled=${m.readState(rig.query())}/${rig.query().fetchStatus}`,
			);
			await rig.show(false);
			await rig.show(true);
			await until(() => rig.query().isSuccess);
			assert.equal(rig.requests.length, 2);
			await act(async () => release(navigationOk));
			assert.equal(m.readState(rig.query()), "ready");
		} finally {
			await rig.close();
		}
	});

	test(`${hook.name}: a shared read outlives its first observer, not its last`, async () => {
		let release;
		const rig = await mount(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
			hook,
		);
		try {
			await until(() => Boolean(release));
			await rig.show(true, ["probe", "other"]);
			await rig.show(true, ["other"]);
			await act(async () => release(navigationOk));
			await until(() => rig.query().isSuccess);
			assert.equal(rig.requests.length, 1);
			assert.equal(m.readState(rig.query()), "ready");
		} finally {
			await rig.close();
		}
	});
}
