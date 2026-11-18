#!/usr/bin/env node
/**
 * The move dialog's WORKING-SET CONSENT (design move-working-set §11.4, operator
 * request 2026-11-18: a mid-conversation move sends all working files to the
 * destination, so the popup must say so and require the user's approval).
 *
 * What this pins, and why each is a claim a frame cannot show:
 *   - the manifest parser is the boundary: a sparse or malformed answer cannot
 *     throw, and a block without a well-formed `scope_digest` is NOT a manifest
 *     (a checkbox whose tick sends nothing would be a consent theatre);
 *   - the wire: the preflight route, and the transfer body carrying
 *     `confirm_working_set` ONLY when set (the core's model is closed, so an
 *     ungated field is a 422 on an older backend) and no history-secret opt-in
 *     at all (v1 scope decision);
 *   - a consent refusal carries the fresh manifest and reopens the dialog, while
 *     `over_cap`/`unsupported` stay notices;
 *   - the REAL dialog, rendered in jsdom against the real preload seam: without
 *     the capability it issues no preflight and Confirm works as before; with it
 *     Confirm is disabled until the box is ticked and the chosen plan carries the
 *     digest; a seeded `working_set_changed` manifest renders un-ticked.
 *
 * Driven the sibling harnesses' way (`profile-save-row-dom.test.mjs`): the shipped
 * TS is bundled in memory by esbuild and called, no second build.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act, createElement as h } from "react";

const dom = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const key of [
	"window",
	"document",
	"navigator",
	"HTMLElement",
	"HTMLButtonElement",
	"Element",
	"Node",
	"SVGElement",
	"Event",
	"MouseEvent",
	"KeyboardEvent",
	"PointerEvent",
	"FocusEvent",
	"CustomEvent",
	"NodeFilter",
	"HTMLInputElement",
	"DocumentFragment",
	"MutationObserver",
	"localStorage",
])
	Object.defineProperty(globalThis, key, {
		configurable: true,
		value: dom.window[key] ?? dom.window.Event,
	});
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
	observe() {}
	disconnect() {}
	unobserve() {}
};
const { createRoot } = await import("react-dom/client");
// Through `require`, like the bundle's own external: the package ships separate
// ESM and CJS builds, and an `import` here would be a second React Query whose
// context the dialog's hooks cannot see.
const { QueryClient, QueryClientProvider } = createRequire(import.meta.url)(
	"@tanstack/react-query",
);
after(() => dom.window.close());

const bundled = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/features/mesh/mesh-types";
			export { MoveConfirmDialog } from "./src/renderer/src/features/mesh/mesh-actions";
			export { desktopEndpoint, desktopRequestSchema, desktopRequestDeadlineMs } from "./src/shared/desktop-contract";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	write: false,
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});
const module = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(
	createRequire(import.meta.url),
	module,
	module.exports,
);
const api = module.exports;

/* ---------------------------------------------------------------- fixtures */

const DIGEST = `sha256:${"a".repeat(64)}`;
const FRESH_DIGEST = `sha256:${"b".repeat(64)}`;
const PEER = `d_${"b".repeat(32)}`;

/** A §3.4-shaped block: one carried tree, one history-secret withheld tree. */
function block(overrides = {}) {
	return {
		version: 1,
		scope_digest: DIGEST,
		state: "preflight",
		carries_files: true,
		destination: { device_id: PEER, name: "build-box" },
		totals: {
			worktrees: 1,
			unpushed_commits: 3,
			dirty_files: 5,
			bytes: 4_200_000,
		},
		worktrees: [
			{
				path: "~/local-operator/.worktrees/move-working-set",
				repo: "~/local-operator",
				head: "670cf7187",
				branch: "feat/move-working-set",
				unpushed_commits: 3,
				staged: 1,
				unstaged: 2,
				untracked: 2,
				bundle_bytes: 200_000,
				snapshot_bytes: 4_000_000,
				state: "planned",
				clone: { url: "git@github.com:o/r.git", estimated_bytes: 90_000_000 },
			},
			{
				path: "~/proj/.worktrees/secret-branch",
				repo: "~/proj",
				head: "abc",
				state: "left_behind",
				reason: "history_secret",
			},
		],
		excluded: [{ path: "~/proj/.env.local", why: "secret_path" }],
		left_behind: [
			{
				path: "~/local-operator/.worktrees/move-working-set/.venv",
				kind: "dependency_tree",
				recipe: { kind: "uv", run: "uv sync", cwd: "~/local-operator" },
			},
		],
		...overrides,
	};
}

const plan = {
	sessionId: "0123456789ab",
	to: PEER,
	keep: false,
	verb: "Move to build-box",
	waitS: 0,
	lost: null,
};

/* ---------------------------------------------------------------- parser */

test("the parser reads the §3.4 block and keeps only consent metadata", () => {
	const set = api.workingSet(block());
	assert.equal(set.scopeDigest, DIGEST);
	assert.equal(set.destination.name, "build-box");
	assert.equal(set.totals.bytes, 4_200_000);
	const [tree, withheld] = set.worktrees;
	assert.equal(tree.branch, "feat/move-working-set");
	assert.deepEqual(
		[tree.unpushedCommits, tree.staged, tree.unstaged, tree.untracked],
		[3, 1, 2, 2],
	);
	assert.equal(tree.bytes, 4_200_000);
	assert.deepEqual(tree.clone, {
		url: "git@github.com:o/r.git",
		bytes: 90_000_000,
	});
	assert.equal(withheld.state, "left_behind");
	assert.equal(withheld.reason, "history_secret");
	assert.equal(withheld.branch, null, "detached/absent branch is null");
	assert.deepEqual(set.excluded, [
		{ path: "~/proj/.env.local", why: "secret_path" },
	]);
	assert.equal(set.leftBehind[0].recipe.run, "uv sync");
	assert.equal(api.workingSetHasFiles(set), true);
});

test("the parser accepts the result/working_set wrappers and the clone_bytes spelling", () => {
	const wrapped = api.workingSet({
		result: { working_set: block(), destination_name: "build-box" },
	});
	assert.equal(wrapped.scopeDigest, DIGEST);
	const flat = api.workingSet(
		block({
			worktrees: [
				{
					path: "~/a",
					repo: "~/a",
					head: "1",
					state: "planned",
					remote_url: "https://x/y.git",
					clone_bytes: 10,
				},
			],
		}),
	);
	assert.deepEqual(flat.worktrees[0].clone, {
		url: "https://x/y.git",
		bytes: 10,
	});
});

test("a block without a well-formed digest is not a manifest, and sparse rows never throw", () => {
	assert.equal(api.workingSet(block({ scope_digest: "sha256:nothex" })), null);
	assert.equal(api.workingSet(null), null);
	assert.equal(api.workingSet("nope"), null);
	const sparse = api.workingSet({
		scope_digest: DIGEST,
		worktrees: [null, 3, { path: "" }, { path: "~/ok", staged: -4 }],
		excluded: [{}, { path: "~/k", why: "secret_content" }],
		left_behind: "x",
	});
	assert.equal(sparse.worktrees.length, 1);
	assert.equal(
		sparse.worktrees[0].staged,
		0,
		"a negative count is not a count",
	);
	assert.equal(sparse.excluded.length, 1);
	assert.deepEqual(sparse.leftBehind, []);
	assert.equal(
		api.workingSetHasFiles(
			api.workingSet({ scope_digest: DIGEST, worktrees: [] }),
		),
		false,
		"an empty manifest keeps today's dialog",
	);
});

test("the route's confirmation_required wins, and carries_files is never assumed", () => {
	const notRequired = api.workingSet({
		session_id: "0123456789ab",
		confirmation_required: false,
		working_set: block(),
	});
	assert.equal(api.workingSetHasFiles(notRequired), false);
	const required = api.workingSet({
		confirmation_required: true,
		working_set: block({ worktrees: [], excluded: [], left_behind: [] }),
	});
	assert.equal(api.workingSetHasFiles(required), true);
	const { carries_files: _absent, ...older } = block();
	assert.equal(
		api.workingSet(older).carriesFiles,
		false,
		"absent reads as NOT sent: never promise files that stay behind",
	);
	assert.equal(api.workingSet(block()).carriesFiles, true);
	const row = api.workingSet(
		block({
			worktrees: [
				{
					path: "~/a",
					repo: "~/a",
					head: "1",
					state: "planned",
					remote_url: "https://x/y.git",
					clone_check: "pending_destination",
					primary: true,
				},
			],
		}),
	).worktrees[0];
	assert.deepEqual(
		[row.cloneCheck, row.remoteUrl, row.primary, row.clone],
		["pending_destination", "https://x/y.git", true, null],
	);
});

/* ---------------------------------------------------------------- refusals */

function refusalError(code, detailExtra = {}) {
	return {
		status: 409,
		code,
		message: "route sentence",
		detail: { code, message: "route sentence", ...detailExtra },
	};
}

test("a consent refusal carries the fresh manifest and reopens; over_cap does not", () => {
	const changed = api.meshRefusal(
		refusalError("working_set_changed", {
			working_set: block({ scope_digest: FRESH_DIGEST }),
		}),
	);
	assert.equal(changed.workingSet.scopeDigest, FRESH_DIGEST);
	assert.deepEqual(
		{
			digest: api.workingSetReopen(changed).workingSet.scopeDigest,
			changed: api.workingSetReopen(changed).changed,
		},
		{ digest: FRESH_DIGEST, changed: true },
	);
	const unconfirmed = api.meshRefusal(
		refusalError("working_set_unconfirmed", { working_set: block() }),
	);
	assert.equal(api.workingSetReopen(unconfirmed).changed, false);
	const overCap = api.meshRefusal(
		refusalError("working_set_over_cap", { working_set: block() }),
	);
	assert.ok(overCap.workingSet, "over_cap still carries its manifest");
	assert.equal(api.workingSetReopen(overCap), null);
	const busy = api.meshRefusal(refusalError("busy", { working_set: block() }));
	assert.equal(busy.workingSet, undefined, "only working-set codes read it");
	const unknown = api.workingSetReopen(
		api.meshRefusal(refusalError("working_set_unknown")),
	);
	assert.deepEqual(unknown, {
		workingSet: null,
		changed: false,
		withoutOnly: true,
	});
	const unsupported = api.workingSetReopen(
		api.meshRefusal(
			refusalError("working_set_unsupported", {
				working_set: block({ state: "unsupported" }),
			}),
		),
	);
	assert.equal(unsupported.withoutOnly, true);
	assert.equal(unsupported.workingSet.state, "unsupported");
});

/* ---------------------------------------------------------------- contract */

test("the preflight route and the consent body fields ride the wire only when set", () => {
	assert.deepEqual(
		api.desktopEndpoint({
			op: "sessions.transfer.preflight",
			sessionId: "0123456789ab",
			to: PEER,
		}),
		{
			path: "/v1/desktop/sessions/0123456789ab/transfer/preflight",
			method: "POST",
			body: { to: PEER },
		},
	);
	const bare = api.desktopEndpoint({
		op: "sessions.transfer",
		sessionId: "0123456789ab",
		to: PEER,
	}).body;
	assert.deepEqual(Object.keys(bare).sort(), ["keep", "to", "wait_s"]);
	const confirmed = api.desktopEndpoint({
		op: "sessions.transfer",
		sessionId: "0123456789ab",
		to: PEER,
		confirmWorkingSet: DIGEST,
	}).body;
	assert.equal(confirmed.confirm_working_set, DIGEST);
	assert.equal("without_working_set" in confirmed, false);
	const without = api.desktopEndpoint({
		op: "sessions.transfer",
		sessionId: "0123456789ab",
		to: PEER,
		withoutWorkingSet: true,
	}).body;
	assert.equal(without.without_working_set, true);
	assert.equal("confirm_working_set" in without, false);
	assert.equal("include_history_secrets" in confirmed, false);
	const parse = (extra) =>
		api.desktopRequestSchema.safeParse({
			op: "sessions.transfer",
			sessionId: "0123456789ab",
			to: PEER,
			...extra,
		}).success;
	assert.equal(parse({ confirmWorkingSet: DIGEST }), true);
	assert.equal(
		parse({ confirmWorkingSet: "yes" }),
		false,
		"a digest, not a bool",
	);
	assert.equal(
		parse({ includeHistorySecrets: true }),
		false,
		"v1 has no history-secret opt-in",
	);
	assert.ok(
		api.desktopRequestDeadlineMs("sessions.transfer.preflight") > 20_000,
		"the preflight dials the destination: mesh-read budget, not control",
	);
});

/* ---------------------------------------------------------------- the dialog */

function installBridge({ features, preflight }) {
	const calls = [];
	window.api = {
		desktop: {
			request: async (request) => {
				calls.push(request.op);
				if (request.op === "capabilities")
					return {
						status: 200,
						body: {
							result: {
								desktop_contract: 1,
								desktop_available: true,
								desktop_auth: "bearer",
								features,
							},
						},
					};
				if (request.op === "sessions.transfer.preflight")
					return { status: 200, body: { result: preflight } };
				throw new Error(`unexpected op ${request.op}`);
			},
		},
	};
	return calls;
}

async function settle() {
	for (let i = 0; i < 10; i += 1)
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
}

/*
 * Unmounted after EVERY test, pass or fail: a failed assertion that skipped the
 * unmount left Radix's focus trap and React Query's timers alive, and the file
 * then hung instead of reporting the failure.
 */
let mounted = null;
afterEach(async () => {
	const unmount = mounted;
	mounted = null;
	if (unmount) await unmount();
});

async function mount(props) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const chosen = [];
	await act(async () => {
		root.render(
			h(
				QueryClientProvider,
				{ client },
				h(api.MoveConfirmDialog, {
					open: true,
					plan,
					alternatives: [],
					risky: false,
					busy: false,
					onCancel: () => {},
					onChoose: (next) => chosen.push(next),
					...props,
				}),
			),
		);
	});
	await settle();
	const confirm = () =>
		[...document.querySelectorAll('[role="dialog"] button')].find(
			(button) => button.textContent === plan.verb,
		);
	const unmount = async () => {
		await act(async () => root.unmount());
		host.remove();
		client.clear();
		document.body.innerHTML = "";
	};
	mounted = unmount;
	return { chosen, confirm };
}

test("without the capability the dialog asks nothing and confirms as before", async () => {
	const calls = installBridge({
		features: { peers: 1, session_transfer: 1 },
		preflight: block(),
	});
	const view = await mount({});
	assert.equal(calls.includes("sessions.transfer.preflight"), false);
	assert.equal(document.querySelector('[data-testid="working-set"]'), null);
	assert.equal(view.confirm().disabled, false);
	await act(async () => view.confirm().click());
	assert.equal(view.chosen.length, 1);
	assert.equal("confirmWorkingSet" in view.chosen[0], false);
});

test("with working files, Confirm waits for the tick and then sends the digest", async () => {
	const calls = installBridge({
		features: {
			peers: 1,
			session_transfer: 1,
			session_transfer_working_set: 1,
		},
		preflight: { working_set: block() },
	});
	const view = await mount({});
	assert.ok(calls.includes("sessions.transfer.preflight"));
	const review = document.querySelector('[data-testid="working-set"]');
	assert.ok(review, "the populated review renders");
	assert.match(review.textContent, /build-box/);
	assert.match(review.textContent, /feat\/move-working-set/);
	assert.match(review.textContent, /~\/proj\/\.worktrees\/secret-branch/);
	assert.match(review.textContent, /~\/proj\/\.env\.local/);
	assert.match(review.textContent, /uv sync/);
	assert.equal(
		review.querySelectorAll('[role="checkbox"]').length,
		1,
		"exactly one checkbox: the confidence one, no history-secret opt-in",
	);
	assert.equal(view.confirm().disabled, true, "disabled until ticked");
	await act(async () => view.confirm().click());
	assert.equal(view.chosen.length, 0);
	await act(async () => review.querySelector('[role="checkbox"]').click());
	assert.equal(view.confirm().disabled, false);
	await act(async () => view.confirm().click());
	assert.equal(view.chosen.length, 1);
	assert.equal(view.chosen[0].confirmWorkingSet, DIGEST);
});

test("an empty manifest keeps today's dialog: no review, no digest", async () => {
	installBridge({
		features: {
			peers: 1,
			session_transfer: 1,
			session_transfer_working_set: 1,
		},
		preflight: {
			working_set: block({ worktrees: [], excluded: [], left_behind: [] }),
		},
	});
	const view = await mount({
		plan: { ...plan, confirmWorkingSet: DIGEST },
	});
	assert.equal(document.querySelector('[data-testid="working-set"]'), null);
	await act(async () => view.confirm().click());
	assert.equal(
		"confirmWorkingSet" in view.chosen[0],
		false,
		"a stale digest on a reopened plan is dropped",
	);
});

test("a changed-refusal seed renders the fresh list un-ticked, without a new preflight", async () => {
	const calls = installBridge({
		features: {
			peers: 1,
			session_transfer: 1,
			session_transfer_working_set: 1,
		},
		preflight: { working_set: block() },
	});
	const seed = api.workingSetReopen(
		api.meshRefusal(
			refusalError("working_set_changed", {
				working_set: block({ scope_digest: FRESH_DIGEST }),
			}),
		),
	);
	const view = await mount({ workingSetSeed: seed });
	assert.equal(calls.includes("sessions.transfer.preflight"), false);
	const box = document.querySelector(
		'[data-testid="working-set"] [role="checkbox"]',
	);
	assert.equal(box.getAttribute("aria-checked"), "false");
	assert.equal(view.confirm().disabled, true);
	await act(async () => box.click());
	await act(async () => view.confirm().click());
	assert.equal(view.chosen[0].confirmWorkingSet, FRESH_DIGEST);
});

test("files that stay behind are said to stay, and the tick still sends the digest", async () => {
	installBridge({
		features: {
			peers: 1,
			session_transfer: 1,
			session_transfer_working_set: 1,
		},
		preflight: {
			confirmation_required: true,
			working_set: block({
				carries_files: false,
				worktrees: [
					...block().worktrees,
					{
						path: "~/big/.worktrees/huge",
						repo: "~/big",
						head: "d",
						state: "left_behind",
						reason: "history_unscanned",
					},
				],
			}),
		},
	});
	const view = await mount({});
	const review = document.querySelector('[data-testid="working-set"]');
	assert.equal(
		review.querySelector("[data-mode]").getAttribute("data-mode"),
		"leave",
	);
	assert.match(review.textContent, /won't have/);
	assert.doesNotMatch(
		review.textContent,
		/will be sent/,
		"no send claim when carries_files is false",
	);
	assert.match(review.textContent, /too large to check for secrets/);
	assert.equal(view.confirm().disabled, true);
	await act(async () => review.querySelector('[role="checkbox"]').click());
	await act(async () => view.confirm().click());
	assert.equal(view.chosen[0].confirmWorkingSet, DIGEST);
	assert.equal("withoutWorkingSet" in view.chosen[0], false);
});

test("an unknown working set offers only the explicit move-without consent", async () => {
	const calls = installBridge({
		features: {
			peers: 1,
			session_transfer: 1,
			session_transfer_working_set: 1,
		},
		preflight: { working_set: block() },
	});
	const seed = api.workingSetReopen(
		api.meshRefusal(refusalError("working_set_unknown")),
	);
	const view = await mount({
		workingSetSeed: seed,
		destinationName: "build-box",
		plan: { ...plan, confirmWorkingSet: DIGEST },
	});
	assert.equal(calls.includes("sessions.transfer.preflight"), false);
	const review = document.querySelector('[data-testid="working-set"]');
	assert.equal(
		review.querySelector("[data-mode]").getAttribute("data-mode"),
		"without",
	);
	assert.match(review.textContent, /couldn't be checked/);
	assert.match(review.textContent, /build-box/);
	assert.equal(view.confirm().disabled, true);
	await act(async () => review.querySelector('[role="checkbox"]').click());
	await act(async () => view.confirm().click());
	assert.equal(view.chosen[0].withoutWorkingSet, true);
	assert.equal(
		"confirmWorkingSet" in view.chosen[0],
		false,
		"the stale digest is dropped; only the without-consent travels",
	);
});
