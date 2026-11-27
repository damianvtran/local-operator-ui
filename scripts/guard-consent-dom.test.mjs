import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, afterEach, beforeEach, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * RADIENT GUARD ON THE DESKTOP (slice U1; Guard RFC v0.9 §5.2.3, §5.9, §14'): the
 * real components, hooks and model against a real `QueryClient`, with the desktop
 * bridge as the only stub (the rig is `mesh-pairing-card.test.mjs`'s).
 *
 * THIS IS THE "ARRIVAL WITHOUT FOCUS CHANGE" PROOF, as a DOM assertion: a prompt
 * that lands while another control holds focus leaves `document.activeElement`
 * where it was and mounts no dialog. It is a jsdom assertion, not a rendered
 * Electron window, and the PR says so; the rendered frames are Storybook's.
 *
 * WHAT IT PINS
 *  - the card's exact sentences for each reason / scope mix (RFC §15.4' C4);
 *  - focus starts on the NON-SHARING choice; Esc is "Decide later" (nothing sent,
 *    card still pending); input inside 500 ms is ignored;
 *  - the ONLY accept is the typed `approvals.approveOperation` with the row's own
 *    digests; the generic approve is `null` for a guard row, and a Mesh read drops
 *    guard rows, so no list control, auto mode or "approve all" can answer;
 *  - Share is drawn only when the host says `signable_here`; an opaque or
 *    unparseable card is not listed;
 *  - the Settings view: every indicator state, Stop sharing's confirm (copy parity,
 *    `backup_days` from the host, never a literal), `revoke_pending` as a calm
 *    success, "stopped from Console", and a non-Team account that sends NOTHING but
 *    the two reads and never a path outside `/v1/desktop/guard`.
 */

// Hoisted: the lint rule (and a regex literal in a hot assertion) want them compiled once.
const FILL_CLASS = /bg-accent|primary/;
const PRICE_OR_CARD_CLAIM = /card required|\$/;
const AGENT_SERVER_GUARD_PATH = /\/v1\/guard\//;

const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
});
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// jsdom accessors that refuse to be read out of context.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
globalThis.localStorage = bootstrapDOM.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CustomEvent = bootstrapDOM.window.CustomEvent;
/*
 * The machine word in the copy follows `navigator.platform` (design round 1, D4:
 * "your Mac" / "your PC" / "your computer"). Node's own `navigator` reports the
 * host OS, so pin it: the same assertions must hold on a Mac and on CI.
 */
const setPlatform = (value) =>
	Object.defineProperty(globalThis.navigator, "platform", {
		value,
		configurable: true,
	});
setPlatform("Linux x86_64");
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

globalThis.__RIG_ENV__ = {
	VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:1",
	VITE_RADIENT_SERVER_BASE_URL: "https://api.example.invalid/v1",
	VITE_RADIENT_CLIENT_ID: "rig",
	VITE_GOOGLE_CLIENT_ID: "rig.apps.googleusercontent.com",
	VITE_MICROSOFT_CLIENT_ID: "00000000-0000-0000-0000-000000000000",
	VITE_MICROSOFT_TENANT_ID: "common",
	VITE_PUBLIC_POSTHOG_KEY: "",
	VITE_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com",
	VITE_LOG_LEVEL: "info",
};

/** Every request the renderer sent, in order. */
let sent = [];
/** op -> reply or (request) => reply | Promise<reply>; the per-case script. */
let script = {};
const feedListeners = new Set();
globalThis.window.api = {
	desktop: {
		request: async (request) => {
			sent.push(request);
			const reply = script[request.op];
			// Main mints a confirmation for every click a person made (the real gate
			// is `mesh-pairing-attest.test.mjs`'s); a case scripts a refusal itself.
			if (!reply && request.op === "pairings.confirm")
				return {
					status: 200,
					body: { result: { confirmation: "c".repeat(64) } },
				};
			if (!reply) return { status: 404, body: { detail: "no script" } };
			return typeof reply === "function" ? reply(request) : reply;
		},
		feed: {
			subscribe: (listener) => {
				feedListeners.add(listener);
				return () => feedListeners.delete(listener);
			},
			watchState: () => () => {},
		},
	},
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { GuardPromptEntries } from "./src/renderer/src/features/guard/guard-prompt-entries";
			export { GuardSettingsView, GuardNonTeamCardView, guardRevokeBody, guardIndicatorText, guardViewerRole } from "./src/renderer/src/features/guard/guard-settings-view";
			export { useGuardStatus, useGuardNonTeamCard, useGuardRevoke, useGuardWaitingCount } from "./src/renderer/src/features/guard/guard-hooks";
			export { guardPromptView, guardShareRequest, guardWaitingViews } from "./src/renderer/src/features/guard/guard-prompt-model";
			export { approvalRows, approvalDecisionRequest, canApproveApproval, meshRowsWithoutProfileProposals } from "./src/renderer/src/features/mesh/mesh-approvals";
			export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";
			export { guardStatus } from "./src/shared/guard-status";
			export { createElement };
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	external: [
		"react",
		"react-dom",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	packages: "external",
	loader: {
		".css": "empty",
		".png": "empty",
		".svg": "empty",
		".webp": "empty",
	},
	define: { "import.meta.env": "globalThis.__RIG_ENV__" },
	jsx: "automatic",
	write: false,
});
const bundlePath = new URL(
	`./_guard-consent-dom-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	QueryClient,
	QueryClientProvider,
	GuardPromptEntries,
	GuardSettingsView,
	guardRevokeBody,
	guardIndicatorText,
	guardViewerRole,
	useGuardStatus,
	useGuardNonTeamCard,
	useGuardRevoke,
	useGuardWaitingCount,
	guardPromptView,
	guardShareRequest,
	guardWaitingViews,
	approvalRows,
	approvalDecisionRequest,
	canApproveApproval,
	meshRowsWithoutProfileProposals,
	desktopEndpoint,
	desktopRequestSchema,
	guardStatus,
	createElement,
} = await import(bundlePath.href);
await unlink(bundlePath);

const ok = (result) => ({ status: 200, body: { result } });
const caps = (features) =>
	ok({
		desktop_contract: 1,
		desktop_available: true,
		desktop_auth: "bearer",
		features,
	});

const sha = (c) => `sha256:${c.repeat(64)}`;
const ID = "ap_0123456789abcdef";
/** A `guard_consent` approvals row as `GET /v1/desktop/approvals` serves it. */
const guardRow = (over = {}, disclosure = {}, typed = {}) => ({
	approval_id: ID,
	state: "requested",
	kind: "guard_consent",
	machine: { key_id: "k", spki_fp: "f" },
	what: {},
	requested_by: { surface: "guard-host" },
	expires_at: null,
	typed_approval: {
		action: "approve-credential",
		operation: "guard_consent",
		request_digest: sha("a"),
		assurance: "file_only",
		unproven_human: true,
		disclosure: {
			version: 1,
			operation: "guard_consent",
			approval_id: ID,
			tenant: "ten_acme",
			org_display_name: "Acme",
			reason: "new_org",
			collection_rev: 3,
			revocation_gen: 0,
			asked_scopes: ["decisions", "task_time"],
			grant_scopes: ["decisions", "task_time"],
			rendered_terms_digest: sha("c"),
			prompt_digest: sha("d"),
			expires_at: null,
			signing_principal: "k",
			...disclosure,
		},
		disclosure_digest: sha("b"),
		signable_here: true,
		...typed,
	},
	...over,
});
const list = (...rows) => ok({ approvals: rows });

const org = (over = {}) => ({
	tenant: "ten_acme",
	org: "Acme",
	role: "member",
	state: "sharing",
	reason: "",
	since: null,
	answered_via: "",
	scopes_shared: ["decisions", "task_time"],
	prompt: null,
	can_revoke: true,
	can_share_again: false,
	...over,
});
const status = (over = {}) => ({
	mode: "orgs",
	badge: "sharing",
	orgs: [org()],
	insights: [],
	backup_days: 31,
	this_computer: "Studio",
	can_answer: true,
	team_url: "https://console.radienthq.com/dashboard/team",
	...over,
});

let container;
let root;
let client;
beforeEach(() => {
	sent = [];
	script = {};
	feedListeners.clear();
	container = document.createElement("div");
	document.body.append(container);
});
afterEach(async () => {
	await act(async () => root?.unmount());
	root = undefined;
	client?.clear();
	client = undefined;
	container.remove();
	document.body.innerHTML = "";
});

async function settle(rounds = 6) {
	for (let index = 0; index < rounds; index++) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
}
async function until(predicate, label) {
	for (let index = 0; index < 60; index++) {
		if (predicate()) return;
		await settle(1);
	}
	assert.fail(`timed out waiting for ${label}`);
}
async function wall(ms) {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, ms));
	});
}
async function render(element) {
	client?.clear();
	client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
			mutations: { retry: false, gcTime: Number.POSITIVE_INFINITY },
		},
	});
	root = createRoot(container);
	await act(async () => {
		root.render(createElement(QueryClientProvider, { client }, element));
	});
	await settle();
	return client;
}
const ops = () => sent.map((request) => request.op);
const q = (selector) => document.querySelector(selector);
const text = () => document.body.textContent;
async function click(element) {
	await act(async () => {
		element.dispatchEvent(
			new window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
	await settle();
}
async function press(key) {
	await act(async () => {
		(document.activeElement ?? document.body).dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key,
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	await settle();
}
const GUARD_PLANE = { approvals: 1, guard: 1 };

/* ------------------------------------------------------------ the model */

test("the prompt composes the RFC C4 lines in the C4 scope order, per reason", () => {
	const rows = approvalRows({
		approvals: [guardRow({}, { asked_scopes: ["task_time", "decisions"] })],
	});
	const view = guardPromptView(rows[0]);
	assert.equal(view.title, "Share Guard stats with Acme?");
	assert.equal(view.reasonLine, "Acme turned on Radient Guard.");
	assert.deepEqual(
		view.scopeLines.map((l) => l.scope),
		["decisions", "task_time"],
		"the C4 order, not the queue's",
	);
	assert.equal(
		view.scopeLines[0].text,
		"Guardrail results: whether each check allowed, asked or blocked, and the rule type",
	);
	assert.equal(
		view.scopeLines[1].text,
		"Task time, in ranges such as 5–15 min",
	);
	assert.equal(
		view.neverSent,
		"Never sent: file paths, commands, prompts, code, model output or tool arguments.",
	);
	assert.equal(
		view.visibility,
		"Admins see totals only when at least 5 people contributed, never your own numbers.",
	);
	assert.equal(view.noLabel, "Don't share");
	assert.equal(view.laterLabel, "Decide later");
	assert.equal(view.yesLabel, "Share");
});

test("all six reasons render their RFC sentence", () => {
	const expected = {
		new_org: "Acme turned on Radient Guard.",
		widened:
			"Acme wants to collect more: task time. Until you choose, Guard keeps sharing only what you already agreed to.",
		reactivated:
			"Acme turned Radient Guard back on. Nothing is shared until you choose again.",
		plan_gap:
			"Acme's Team plan lapsed and restarted, so Guard needs your answer again. Nothing is shared until you choose.",
		new_device:
			"This is a new computer for your Radient account. You choose per computer, so choose for this one.",
		rejoined:
			"You rejoined Acme. Your earlier answer ended when you left, so choose again.",
	};
	for (const [reason, sentence] of Object.entries(expected)) {
		const [row] = approvalRows({
			approvals: [
				guardRow(
					{},
					{
						reason,
						asked_scopes: reason === "widened" ? ["task_time"] : ["decisions"],
					},
				),
			],
		});
		assert.equal(guardPromptView(row).reasonLine, sentence, reason);
	}
});

test("a widening says Keep current / Share the new items; posture and admin_share pick the visibility sentence", () => {
	const [row] = approvalRows({
		approvals: [
			guardRow(
				{},
				{
					reason: "widened",
					asked_scopes: ["admin_share"],
					grant_scopes: ["decisions", "posture", "admin_share"],
				},
			),
		],
	});
	const view = guardPromptView(row);
	assert.equal(view.widening, true);
	assert.equal(view.noLabel, "Keep current");
	assert.equal(view.yesLabel, "Share the new items");
	assert.equal(
		view.visibility,
		"Admins see totals only when at least 5 people contributed, and setup-check estimates only when at least 20 did. With step-by-step timing shared, they can also see your own timing, but not what the steps contained.",
	);
	assert.equal(
		view.scopeLines[0].text,
		"Let Acme admins see your step-by-step timing",
	);
});

test("the Share request is the typed op with the row's own digests, and only when the host may sign it", () => {
	const [row] = approvalRows({ approvals: [guardRow()] });
	assert.deepEqual(guardShareRequest(row), {
		op: "approvals.approveOperation",
		approvalId: ID,
		operation: "guard_consent",
		requestDigest: sha("a"),
		disclosureDigest: sha("b"),
	});
	const [unsignable] = approvalRows({
		approvals: [guardRow({}, {}, { signable_here: false })],
	});
	assert.equal(guardShareRequest(unsignable), null);
	assert.equal(guardPromptView(unsignable).shareRequest, null);
	// A disclosure for another record is a stale render, not this card.
	const [stale] = approvalRows({
		approvals: [guardRow({}, { approval_id: "ap_other" })],
	});
	assert.equal(guardShareRequest(stale), null);
	// A malformed digest cannot be echoed.
	const [bad] = approvalRows({
		approvals: [guardRow({}, {}, { disclosure_digest: "sha256:xyz" })],
	});
	assert.equal(bad.kind, "guard");
	assert.equal(guardShareRequest(bad), null);
});

test("no generic path answers a Guard consent (RFC §5.9)", () => {
	const [row] = approvalRows({ approvals: [guardRow()] });
	assert.equal(row.kind, "guard");
	assert.equal(
		approvalDecisionRequest(row, "approve", {
			credentialApprovals: true,
			profileApprovals: true,
		}),
		null,
	);
	assert.equal(
		approvalDecisionRequest(row, "apply", {
			credentialApprovals: true,
			profileApprovals: true,
		}),
		null,
	);
	assert.equal(
		canApproveApproval(row, {
			credentialApprovals: true,
			profileApprovals: true,
		}),
		false,
	);
	assert.deepEqual(approvalDecisionRequest(row, "deny"), {
		op: "approvals.deny",
		approvalId: ID,
	});
	// The Mesh surfaces never see a guard row, with or without the profile flag.
	for (const flag of [true, false]) {
		assert.deepEqual(
			meshRowsWithoutProfileProposals(
				approvalRows({ approvals: [guardRow()] }),
				flag,
			),
			[],
		);
	}
});

test("an unparseable or opaque guard card is not listed and cannot be shared", () => {
	const opaque = approvalRows({
		approvals: [
			guardRow({
				typed_approval: {
					operation: "guard_consent",
					signable_here: true,
					surprise: 1,
				},
			}),
		],
	});
	assert.equal(
		opaque[0].kind,
		"guard",
		"the kind is kept so it never falls through to a generic path",
	);
	assert.equal(opaque[0].guard, undefined);
	assert.deepEqual(guardWaitingViews(opaque), []);
	assert.equal(approvalDecisionRequest(opaque[0], "approve"), null);
});

test("a guard card is recognised by its typed operation alone: the host sends no `kind` key", () => {
	for (const typed of [
		{ operation: "guard_consent", signable_here: true, surprise: 1 },
		undefined,
	]) {
		// The fixture's `kind` is dropped: the real host never serves one.
		const { kind: _unserved, ...raw } = guardRow(
			typed ? { typed_approval: typed } : {},
		);
		const [row] = approvalRows({ approvals: [raw] });
		assert.equal(row.kind, "guard");
		assert.deepEqual(meshRowsWithoutProfileProposals([row], false), []);
	}
});

test("every guard op is a /v1/desktop/guard path, and none can carry a grant", () => {
	for (const request of [
		{ op: "guard.status" },
		{ op: "guard.nonTeamCard" },
		{ op: "guard.revoke", tenant: "ten_acme" },
		{ op: "guard.shareAgain", tenant: "ten_acme" },
	]) {
		const endpoint = desktopEndpoint(desktopRequestSchema.parse(request));
		assert.ok(endpoint.path.startsWith("/v1/desktop/guard"), endpoint.path);
		assert.ok(!endpoint.path.startsWith("/v1/guard"));
		assert.equal(endpoint.body, undefined);
	}
	assert.equal(
		desktopRequestSchema.safeParse({ op: "guard.revoke", tenant: "../x" })
			.success,
		false,
	);
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "guard.revoke",
			tenant: "t",
			scopes: ["decisions"],
		}).success,
		false,
	);
	assert.equal(
		desktopRequestSchema.safeParse({ op: "guard.grant", tenant: "t" }).success,
		false,
	);
});

/* ------------------------------------------------- arrival and the dialog */

test("a prompt arriving moves no focus and opens nothing; Review opens it on the non-sharing choice", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
	};
	const composer = document.createElement("textarea");
	document.body.append(composer);
	composer.focus();
	assert.equal(document.activeElement, composer);
	await render(createElement(GuardPromptEntries));
	assert.equal(q('[data-testid="guard-entry"]'), null, "nothing waiting yet");
	// The host files the card; the next poll delivers it.
	script["approvals.list"] = list(guardRow());
	await act(async () => {
		await client.invalidateQueries();
	});
	await until(() => q('[data-testid="guard-entry"]'), "the entry");
	assert.equal(document.activeElement, composer, "arrival changed no focus");
	assert.equal(
		q('[data-testid="guard-consent-dialog"]'),
		null,
		"arrival opened no dialog",
	);
	assert.ok(text().includes("Share Guard stats with Acme?"));
	assert.equal(
		sent.filter(
			(r) =>
				r.op !== "capabilities" &&
				r.op !== "approvals.list" &&
				r.op !== "guard.status",
		).length,
		0,
		"arrival sent no write",
	);

	await click(q('[data-testid="guard-review"]'));
	await until(() => q('[data-testid="guard-consent-dialog"]'), "the dialog");
	assert.equal(document.activeElement, q('[data-testid="guard-no"]'));
	assert.equal(q('[data-testid="guard-no"]').textContent, "Don't share");
	assert.equal(q('[data-testid="guard-yes"]').textContent, "Share");
	// Equal weight: no answer is a filled primary.
	for (const id of ["guard-no", "guard-later", "guard-yes"]) {
		assert.ok(!FILL_CLASS.test(q(`[data-testid="${id}"]`).className), id);
	}
});

test("Esc is Decide later: nothing is sent and the card is still pending", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
	};
	await render(createElement(GuardPromptEntries));
	await until(() => q('[data-testid="guard-review"]'), "the entry");
	await click(q('[data-testid="guard-review"]'));
	await until(() => q('[data-testid="guard-consent-dialog"]'), "the dialog");
	sent = [];
	await press("Escape");
	await until(
		() => q('[data-testid="guard-consent-dialog"]') === null,
		"the dialog to close",
	);
	assert.ok(q('[data-testid="guard-entry"]'), "still pending");
	assert.deepEqual(
		sent.filter(
			(r) => r.op.startsWith("approvals.") && r.op !== "approvals.list",
		),
		[],
		"Esc answered nothing",
	);
});

test("Esc while an answer is in flight keeps the dialog, so its outcome is read", async () => {
	let release;
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
		"approvals.approveOperation": () =>
			new Promise((resolve) => {
				release = () => resolve(ok({ applied: { ok: true } }));
			}),
	};
	await render(createElement(GuardPromptEntries));
	await until(() => q('[data-testid="guard-review"]'), "the entry");
	await click(q('[data-testid="guard-review"]'));
	await until(() => q('[data-testid="guard-yes"]'), "the dialog");
	await wall(600);
	await click(q('[data-testid="guard-yes"]'));
	await until(() => release, "the accept in flight");
	await press("Escape");
	assert.ok(
		q('[data-testid="guard-consent-dialog"]'),
		"Esc did not close the dialog mid-answer",
	);
	script["approvals.list"] = list();
	release();
	await until(() => q('[data-testid="guard-outcome"]'), "the outcome");
});

test("input inside the first 500 ms is ignored; Share then sends the one typed accept", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
		"approvals.approveOperation": ok({ applied: { ok: true } }),
	};
	await render(createElement(GuardPromptEntries));
	await until(() => q('[data-testid="guard-review"]'), "the entry");
	await click(q('[data-testid="guard-review"]'));
	await until(() => q('[data-testid="guard-yes"]'), "the dialog");
	await click(q('[data-testid="guard-yes"]'));
	await click(q('[data-testid="guard-no"]'));
	assert.deepEqual(
		sent.filter(
			(r) => r.op === "approvals.approveOperation" || r.op === "approvals.deny",
		),
		[],
		"a typed-ahead press answered nothing",
	);
	assert.ok(
		q('[data-testid="guard-consent-dialog"]'),
		"and the dialog is still open",
	);
	await wall(600);
	script["approvals.list"] = list();
	await click(q('[data-testid="guard-yes"]'));
	await until(() => q('[data-testid="guard-outcome"]'), "the outcome");
	const accepts = sent.filter((r) => r.op === "approvals.approveOperation");
	assert.equal(accepts.length, 1);
	assert.deepEqual(accepts[0], {
		op: "approvals.approveOperation",
		approvalId: ID,
		operation: "guard_consent",
		requestDigest: sha("a"),
		disclosureDigest: sha("b"),
	});
	assert.equal(
		q('[data-testid="guard-outcome"]').textContent,
		"Sharing with Acme from this computer.",
	);
	assert.ok(
		!sent.some((r) => r.op === "approvals.approve"),
		"the generic approve was never sent",
	);
});

test("Don't share is the generic deny and nothing else", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
		"approvals.deny": ok({ state: "denied" }),
	};
	await render(createElement(GuardPromptEntries));
	await until(() => q('[data-testid="guard-review"]'), "the entry");
	await click(q('[data-testid="guard-review"]'));
	await until(() => q('[data-testid="guard-no"]'), "the dialog");
	await wall(600);
	await click(q('[data-testid="guard-no"]'));
	await until(() => q('[data-testid="guard-outcome"]'), "the outcome");
	assert.deepEqual(
		sent.filter(
			(r) => r.op.startsWith("approvals.") && r.op !== "approvals.list",
		),
		[{ op: "approvals.deny", approvalId: ID }],
	);
	assert.equal(
		q('[data-testid="guard-outcome"]').textContent,
		"Not sharing with Acme.",
	);
});

test("a failed accept says nothing changed and keeps the card answerable", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
		"approvals.approveOperation": {
			status: 409,
			body: { detail: { code: "x", text: "no" } },
		},
	};
	await render(createElement(GuardPromptEntries));
	await until(() => q('[data-testid="guard-review"]'), "the entry");
	await click(q('[data-testid="guard-review"]'));
	await until(() => q('[data-testid="guard-yes"]'), "the dialog");
	await wall(600);
	await click(q('[data-testid="guard-yes"]'));
	await until(() => q('[data-testid="guard-failed"]'), "the failure line");
	assert.ok(
		text().includes("Your choice wasn't saved, so nothing changed. Try again."),
	);
	assert.ok(q('[data-testid="guard-yes"]'), "still answerable");
});

test("a card the host will not sign draws no Share control", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow({}, {}, { signable_here: false })),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
	};
	await render(createElement(GuardPromptEntries));
	await until(() => q('[data-testid="guard-review"]'), "the entry");
	await click(q('[data-testid="guard-review"]'));
	await until(() => q('[data-testid="guard-no"]'), "the dialog");
	assert.equal(q('[data-testid="guard-yes"]'), null);
	assert.ok(q('[data-testid="guard-later"]'));
});

test("a card another surface answered closes with Answered on <surface>", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(status({ orgs: [org({ answered_via: "tui" })] })),
	};
	await render(createElement(GuardPromptEntries));
	await until(() => q('[data-testid="guard-review"]'), "the entry");
	await click(q('[data-testid="guard-review"]'));
	await until(() => q('[data-testid="guard-consent-dialog"]'), "the dialog");
	script["approvals.list"] = list();
	await act(async () => {
		await client.invalidateQueries();
	});
	await until(() => q('[data-testid="guard-outcome"]'), "the elsewhere line");
	assert.equal(
		q('[data-testid="guard-outcome"]').textContent,
		"Answered on this terminal",
	);
});

test("a newer prompt for the same org replaces the open one with a notice", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
	};
	await render(createElement(GuardPromptEntries));
	await until(() => q('[data-testid="guard-review"]'), "the entry");
	await click(q('[data-testid="guard-review"]'));
	await until(() => q('[data-testid="guard-consent-dialog"]'), "the dialog");
	script["approvals.list"] = list(
		guardRow(
			{ approval_id: "ap_newer" },
			{ approval_id: "ap_newer", collection_rev: 4 },
		),
	);
	await act(async () => {
		await client.invalidateQueries();
	});
	await until(() => q('[data-testid="guard-notice"]'), "the notice");
	assert.equal(
		q('[data-testid="guard-notice"]').textContent,
		"Acme changed this request. Check the new one below.",
	);
});

test("a prompt swapped in under an open dialog re-arms the 500 ms window", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
		"approvals.approveOperation": ok({ applied: { ok: true } }),
	};
	await render(createElement(GuardPromptEntries));
	await until(() => q('[data-testid="guard-review"]'), "the entry");
	await click(q('[data-testid="guard-review"]'));
	await until(() => q('[data-testid="guard-yes"]'), "the dialog");
	// Past the first window: a press now WOULD be accepted for the first card.
	await wall(600);
	script["approvals.list"] = list(
		guardRow(
			{ approval_id: "ap_newer" },
			{ approval_id: "ap_newer", collection_rev: 4 },
		),
	);
	await act(async () => {
		await client.invalidateQueries();
	});
	await until(() => q('[data-testid="guard-notice"]'), "the notice");
	// A click aimed at the OLD text lands on the NEW card inside its window.
	await click(q('[data-testid="guard-yes"]'));
	assert.deepEqual(
		sent.filter((r) => r.op === "approvals.approveOperation"),
		[],
		"the replaced card's first 500 ms ignored the press",
	);
	await wall(600);
	await click(q('[data-testid="guard-yes"]'));
	await until(
		() => sent.some((r) => r.op === "approvals.approveOperation"),
		"the accept after the window",
	);
	assert.equal(
		sent.find((r) => r.op === "approvals.approveOperation").approvalId,
		"ap_newer",
	);
});

test("the gear's count is the number of reviewable prompts", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(
			guardRow(),
			guardRow({ state: "approved" }),
			guardRow({ typed_approval: { operation: "guard_consent" } }),
		),
	};
	let count = -1;
	const Probe = () => {
		count = useGuardWaitingCount();
		return null;
	};
	await render(createElement(Probe));
	await until(() => count === 1, "one reviewable prompt");
});

/* ---------------------------------------------------- the settings view */

const noop = () => {};
const view = (props) =>
	createElement(GuardSettingsView, {
		load: "ready",
		status: status(),
		role: "owner",
		nonTeamCard: null,
		nonTeamLoading: false,
		busyTenant: null,
		failedTenant: null,
		revoked: null,
		onRevoke: noop,
		onShareAgain: noop,
		...props,
	});

test("every indicator state reads the RFC sentence; sharing_pending is never paused", () => {
	const cases = [
		[{ state: "sharing" }, "Guard: sharing with Acme"],
		[
			{ state: "sharing_pending" },
			"Guard: sharing with Acme · new items waiting for your choice",
		],
		[{ state: "waiting" }, "Guard: Acme is waiting for your choice"],
		[{ state: "not_sharing" }, "Guard: not sharing with Acme"],
		[{ state: "will_ask" }, "Guard: Acme will ask you again soon"],
		[
			{ state: "paused", reason: "entitlement_lapsed" },
			"Guard: paused, Team plan inactive",
		],
		[
			{ state: "paused", reason: "org_off" },
			"Guard: paused, turned off by Acme",
		],
		[
			{ state: "paused", reason: "membership_ended" },
			"Guard: paused, you're no longer in Acme",
		],
		[
			{ state: "paused", reason: "scope_revoked" },
			"Guard: paused, you stopped sharing",
		],
		[
			{ state: "paused", reason: "revoke_pending" },
			"Guard: paused, will stop once Radient confirms",
		],
		[{ state: "paused", reason: "something_new" }, "Guard: paused"],
	];
	for (const [over, sentence] of cases) {
		assert.equal(guardIndicatorText(org(over)), sentence, JSON.stringify(over));
	}
	assert.ok(
		!guardIndicatorText(org({ state: "sharing_pending" })).includes("paused"),
	);
});

test("stopped from Console reads a calm dated state with Share again", async () => {
	const since = Date.UTC(2026, 10, 20, 12) / 1000;
	await render(
		view({
			status: status({
				badge: "",
				orgs: [
					org({
						state: "paused",
						reason: "console_revoked",
						since,
						scopes_shared: [],
						can_revoke: false,
						can_share_again: true,
					}),
				],
			}),
		}),
	);
	assert.ok(text().includes("you stopped sharing from Console on"), text());
	assert.ok(q('[data-testid="guard-share-again"]'));
	assert.equal(q('[data-testid="guard-stop"]'), null);
	assert.equal(
		q('[data-testid="guard-write-failed"]'),
		null,
		"never an error toast",
	);
});

test("Share again is not offered when this backend cannot answer", async () => {
	await render(
		view({
			status: status({
				can_answer: false,
				orgs: [
					org({
						state: "not_sharing",
						scopes_shared: [],
						can_revoke: false,
						can_share_again: true,
					}),
				],
			}),
		}),
	);
	assert.equal(q('[data-testid="guard-share-again"]'), null);
});

test("what is shared lists the live scopes with the never-sent line", async () => {
	await render(view({}));
	assert.deepEqual(
		[...document.querySelectorAll('[data-testid="guard-shared"] li')].map(
			(li) => li.dataset.scope,
		),
		["decisions", "task_time"],
	);
	assert.ok(
		text().includes(
			"Never sent: file paths, commands, prompts, code, model output or tool arguments.",
		),
	);
});

test("Stop sharing confirms first, focuses Keep sharing, then sends the one revoke", async () => {
	const calls = [];
	await render(view({ onRevoke: (tenant) => calls.push(tenant) }));
	await click(q('[data-testid="guard-stop"]'));
	await until(() => q('[data-testid="guard-revoke-dialog"]'), "the confirm");
	assert.deepEqual(calls, [], "no write before the confirm");
	assert.equal(document.activeElement, q('[data-testid="guard-keep"]'));
	const body = text();
	assert.ok(body.includes("Stop sharing with Acme?"));
	assert.ok(body.includes("Guard stops sending from all your computers now."));
	assert.ok(
		body.includes(
			"Other records you already sent stay until they expire: stats after 90 days, reports after 180 days.",
		),
	);
	assert.ok(
		body.includes(
			"Past totals that included you stay published. They never show you on your own.",
		),
	);
	assert.ok(!body.includes("backups"), "no timing sentence without that scope");
	await click(q('[data-testid="guard-keep"]'));
	assert.deepEqual(calls, []);
	await click(q('[data-testid="guard-stop"]'));
	await until(
		() => q('[data-testid="guard-confirm-stop"]'),
		"the confirm again",
	);
	await click(q('[data-testid="guard-confirm-stop"]'));
	assert.deepEqual(calls, ["ten_acme"]);
});

test("the timing sentence and its backup window come from the host, only with that scope", () => {
	const withTiming = org({ scopes_shared: ["decisions", "trace_detail"] });
	assert.ok(
		guardRevokeBody(withTiming, 31)[0].includes(
			"deletes your step-by-step timing. Copies in backups are gone within 31 days.",
		),
	);
	assert.ok(
		guardRevokeBody(withTiming, 45)[0].includes("within 45 days"),
		"never a literal",
	);
	assert.equal(
		guardRevokeBody(withTiming, null)[0],
		"Guard stops sending from all your computers now.",
	);
	assert.equal(
		guardRevokeBody(org(), 31)[0],
		"Guard stops sending from all your computers now.",
	);
});

test("revoke_pending is a calm line, not an error; a failed write says nothing changed", async () => {
	await render(
		view({
			status: status({
				orgs: [
					org({
						state: "paused",
						reason: "revoke_pending",
						can_revoke: false,
						scopes_shared: [],
					}),
				],
			}),
			revoked: { tenant: "ten_acme", status: "revoke_pending" },
		}),
	);
	// Said once, by the indicator: a second copy would be a second claim.
	assert.equal(text().split("will stop once Radient confirms").length - 1, 1);
	assert.ok(text().includes("Guard: paused, will stop once Radient confirms"));
	assert.equal(q('[data-testid="guard-write-failed"]'), null);
	await act(async () => root.unmount());
	root = createRoot(container);
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client },
				view({ failedTenant: "ten_acme" }),
			),
		);
	});
	assert.ok(q('[data-testid="guard-write-failed"]'));
	assert.ok(
		text().includes("Your choice wasn't saved, so nothing changed. Try again."),
	);
	await act(async () => root.unmount());
	root = createRoot(container);
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client },
				view({ revoked: { tenant: "ten_acme", status: "revoked" } }),
			),
		);
	});
	assert.ok(text().includes("Stopped sharing with Acme."));
});

test("an unreadable or absent Guard store is the calm unavailable line", async () => {
	await render(view({ load: "unavailable", status: null }));
	assert.equal(
		q('[data-testid="guard-unavailable"]').textContent,
		"Guard can't read its settings on this computer. Nothing was shared or sent from this screen.",
	);
	await act(async () => root.unmount());
	root = createRoot(container);
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client },
				view({ status: status({ mode: "unavailable", orgs: [] }) }),
			),
		);
	});
	assert.ok(q('[data-testid="guard-unavailable"]'));
});

test("no org has asked: the none line", async () => {
	await render(view({ status: status({ mode: "none", orgs: [] }) }));
	assert.equal(
		q('[data-testid="guard-none"]').textContent,
		"No organization has asked you to share Guard stats.",
	);
});

/* ------------------------------------------------------- the non-Team card */

test("non-Team card: the owner sees the trial CTA, the admin asks the owner, a member sees nothing", async () => {
	const card = {
		trial_days: 14,
		org: "Pat",
		url: "https://console.radienthq.com/dashboard/team",
	};
	await render(
		view({
			status: status({ mode: "non_team", orgs: [] }),
			role: "owner",
			nonTeamCard: card,
		}),
	);
	assert.equal(
		q('[data-testid="guard-card-cta"]').textContent,
		"Start 14-day free trial",
	);
	assert.ok(text().includes("Radient Guard is part of Radient Team"));
	assert.ok(text().includes("Guard collects nothing for Pat."));
	for (const [role, expectation] of [
		["admin", "Ask your owner to upgrade"],
		["member", null],
	]) {
		await act(async () => root.unmount());
		root = createRoot(container);
		await act(async () => {
			root.render(
				createElement(
					QueryClientProvider,
					{ client },
					view({
						status: status({ mode: "non_team", orgs: [] }),
						role,
						nonTeamCard: card,
					}),
				),
			);
		});
		if (expectation) {
			assert.equal(
				q('[data-testid="guard-ask-owner"]').textContent,
				expectation,
			);
			assert.equal(
				q('[data-testid="guard-card-cta"]'),
				null,
				"an admin cannot start the trial",
			);
		} else {
			assert.equal(q('[data-testid="guard-non-team-card"]'), null);
		}
	}
	// Ineligible (no trial_days) reads "See Radient Team", and no price or "no card" claim.
	await act(async () => root.unmount());
	root = createRoot(container);
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client },
				view({
					status: status({ mode: "non_team", orgs: [] }),
					nonTeamCard: { trial_days: null, org: null, url: "" },
				}),
			),
		);
	});
	assert.equal(
		q('[data-testid="guard-card-cta"]').textContent,
		"See Radient Team",
	);
	assert.ok(!PRICE_OR_CARD_CLAIM.test(text()));
	assert.deepEqual(
		["owner", "admin", "member", undefined].map(guardViewerRole),
		["owner", "admin", "member", "owner"],
	);
});

test("a non-Team account sends only the two reads: never a write, never a /v1/guard path", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(),
		"guard.status": ok(status({ mode: "non_team", orgs: [], badge: "" })),
		"guard.nonTeamCard": ok({
			trial_days: 14,
			org: null,
			url: "https://console.radienthq.com/dashboard/team",
		}),
	};
	let seenCard = null;
	const Probe = () => {
		const s = useGuardStatus();
		const c = useGuardNonTeamCard(s.data?.mode === "non_team");
		useGuardRevoke(); // mounted, never fired: building the hook sends nothing
		seenCard = c.data ?? null;
		return createElement(GuardSettingsView, {
			load: s.data ? "ready" : "loading",
			status: s.data ?? null,
			role: "owner",
			nonTeamCard: c.data ?? null,
			nonTeamLoading: c.isPending,
			busyTenant: null,
			failedTenant: null,
			revoked: null,
			onRevoke: noop,
			onShareAgain: noop,
		});
	};
	await render(createElement(Probe));
	await until(() => seenCard?.trial_days === 14, "the card read");
	await wall(50);
	assert.deepEqual([...new Set(ops())].sort(), [
		"capabilities",
		"guard.nonTeamCard",
		"guard.status",
	]);
	assert.ok(
		ops().every(
			(op) =>
				![
					"guard.revoke",
					"guard.shareAgain",
					"approvals.approveOperation",
					"approvals.approve",
					"approvals.deny",
				].includes(op),
		),
	);
	for (const request of sent) {
		if (request.op === "capabilities") continue;
		const path = desktopEndpoint(desktopRequestSchema.parse(request)).path;
		assert.ok(path.startsWith("/v1/desktop/"), path);
		assert.ok(!AGENT_SERVER_GUARD_PATH.test(path));
	}
	assert.equal(
		q('[data-testid="guard-card-cta"]').textContent,
		"Start 14-day free trial",
	);
});

test("a host that predates features.guard sends no guard op at all", async () => {
	script = { capabilities: caps({ approvals: 1 }), "approvals.list": list() };
	const Probe = () => {
		useGuardStatus();
		return null;
	};
	await render(createElement(Probe));
	await wall(50);
	assert.ok(
		ops().every((op) => !op.startsWith("guard.")),
		ops().join(),
	);
});

test("status parsing: an unknown state fails the whole read into the unavailable line", () => {
	assert.equal(
		guardStatus({ mode: "orgs", orgs: [{ ...org(), state: "mystery" }] }),
		null,
	);
	assert.equal(guardStatus({ mode: "weird" }), null);
	assert.equal(guardStatus(status()).orgs[0].scopes_shared.length, 2);
});
