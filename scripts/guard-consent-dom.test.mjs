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
			export { guardPromptView, guardShareRequest, guardWaitingViews, guardApplyRequest, guardSettingsRoute } from "./src/renderer/src/features/guard/guard-prompt-model";
			export { plainOrgText } from "./src/renderer/src/features/guard/guard-org-mark";
			export { sanitizeOrgName, guardAcceptOutcome, guardApplyOutcome, guardCardExpired } from "./src/shared/guard-consent";
			export { approvalRows, approvalDecisionRequest, canApproveApproval, meshRowsWithoutProfileProposals } from "./src/renderer/src/features/mesh/mesh-approvals";
			export { desktopEndpoint, desktopRequestSchema, desktopRequestDeadlineMs } from "./src/shared/desktop-contract";
			export { guardStatus, guardNonTeamCard } from "./src/shared/guard-status";
			export { meshApprovalKeys } from "./src/renderer/src/features/mesh/mesh-approvals";
			export { setLocale, textDirectionFor } from "./src/renderer/src/shared/i18n";
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
	guardApplyRequest,
	guardSettingsRoute,
	plainOrgText,
	sanitizeOrgName,
	guardAcceptOutcome,
	guardApplyOutcome,
	guardCardExpired,
	desktopRequestDeadlineMs,
	approvalRows,
	approvalDecisionRequest,
	canApproveApproval,
	meshRowsWithoutProfileProposals,
	setLocale,
	textDirectionFor,
	desktopEndpoint,
	desktopRequestSchema,
	guardStatus,
	guardNonTeamCard,
	meshApprovalKeys,
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
/** The host's reply to a typed accept it signed AND sent (`approve_and_apply`). */
const SIGNED_AND_SENT = {
	approval_id: ID,
	operation: "guard_consent",
	signed: { ok: true, key_id: "k" },
	applied: { ok: true, code: "" },
	state: "connected",
};
/** ... signed, but the grant could not be sent (200, `applied.ok` false). */
const SIGNED_NOT_SENT = (over = {}) => ({
	approval_id: ID,
	operation: "guard_consent",
	signed: { ok: true, key_id: "k" },
	applied: {
		ok: false,
		code: "radient_unreachable",
		message: "cli-shaped text",
		retryable: true,
		reason: "Radient could not be reached, so your choice has not been sent.",
		remedy: "Check your connection, then try again.",
		...over,
	},
	state: "failed",
});

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
	// The model carries ORG_MARK where the org goes so the renderer can isolate the
	// name in <bdi>; plainOrgText is the same sentence as text.
	assert.equal(
		plainOrgText(view.title, view.org),
		"Share Guard stats with Acme?",
	);
	assert.equal(
		plainOrgText(view.reasonLine, view.org),
		"Acme turned on Radient Guard.",
	);
	assert.deepEqual(
		view.scopeLines.map((l) => l.scope),
		["decisions", "task_time"],
		"the C4 order, not the queue's",
	);
	assert.equal(
		plainOrgText(view.scopeLines[0].text, view.org),
		"Guardrail results: whether each check allowed, asked or blocked, and the rule type",
	);
	assert.equal(
		plainOrgText(view.scopeLines[1].text, view.org),
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
		const built = guardPromptView(row);
		assert.equal(plainOrgText(built.reasonLine, built.org), sentence, reason);
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
		plainOrgText(view.scopeLines[0].text, view.org),
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
				release = () => resolve(ok(SIGNED_AND_SENT));
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
		"approvals.approveOperation": ok(SIGNED_AND_SENT),
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
		"approvals.approveOperation": ok(SIGNED_AND_SENT),
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

/* ------------------------------------------------- page direction (U1, i18n C1) */

/*
 * `dir="auto"` on translated text resolves from the FIRST strong character, so an
 * Urdu sentence opening with the Latin word "Guard" or an org name laid out
 * left-to-right and reordered its own clauses. Guard's text must inherit the page
 * direction (<html dir>, written by the locale store); only a standalone value that
 * is user data may isolate itself, and that is a <bdi>, never a `dir` attribute on
 * translated copy. The assertion is the resolved direction of every text-bearing
 * element, not a grep for an attribute: it also fails on any future `dir="ltr"`
 * pinned onto Guard copy.
 */
function resolvedDirection(element) {
	return element.closest("[dir]")?.getAttribute("dir") ?? "ltr";
}
function assertInheritsPageDirection(expected, where) {
	assert.equal(document.documentElement.dir, expected, `${where}: page dir`);
	assert.deepEqual(
		[...document.querySelectorAll('[dir="auto"]')].map((el) =>
			el.outerHTML.slice(0, 80),
		),
		[],
		`${where}: no dir=auto on Guard text`,
	);
	const walker = document.createTreeWalker(document.body, 4);
	const wrong = [];
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (!node.textContent.trim()) continue;
		const owner = node.parentElement;
		// A <bdi> is the sanctioned isolation for a standalone user value.
		if (owner.closest("bdi")) continue;
		if (resolvedDirection(owner) !== expected)
			wrong.push(
				`${resolvedDirection(owner)}: ${node.textContent.slice(0, 40)}`,
			);
	}
	assert.deepEqual(wrong, [], `${where}: text resolves to the page direction`);
}

for (const locale of ["ur", "en"]) {
	test(`Guard text inherits the page direction in ${locale}: entry, consent dialog, Settings, revoke confirm, non-Team card`, async () => {
		const direction = textDirectionFor(locale);
		setLocale(locale);
		document.documentElement.dir = direction;
		try {
			script = {
				capabilities: caps(GUARD_PLANE),
				"approvals.list": list(guardRow()),
				"guard.status": ok(status({ mode: "none", orgs: [] })),
			};
			await render(createElement(GuardPromptEntries));
			await until(() => q('[data-testid="guard-entry"]'), "the entry");
			assertInheritsPageDirection(direction, "approvals entry");

			await click(q('[data-testid="guard-review"]'));
			await until(
				() => q('[data-testid="guard-consent-dialog"]'),
				"the dialog",
			);
			assertInheritsPageDirection(direction, "consent dialog");
			await act(async () => root.unmount());
			root = undefined;
			document.body.innerHTML = "";
			container = document.createElement("div");
			document.body.append(container);

			// Two orgs so the standalone org-name line (a <bdi>) is drawn too.
			await render(
				view({
					status: status({
						orgs: [org(), org({ tenant: "t2", org: "Initech" })],
					}),
				}),
			);
			assertInheritsPageDirection(direction, "Settings section");
			await click(q('[data-testid="guard-stop"]'));
			await until(
				() => q('[data-testid="guard-revoke-dialog"]'),
				"revoke confirm",
			);
			assertInheritsPageDirection(direction, "revoke confirm");
			await act(async () => root.unmount());
			root = undefined;
			document.body.innerHTML = "";
			container = document.createElement("div");
			document.body.append(container);

			await render(
				view({
					status: status({ mode: "non_team", orgs: [] }),
					role: "admin",
					nonTeamCard: { trial_days: null, org: "Pat", url: null },
				}),
			);
			assertInheritsPageDirection(direction, "non-Team card");
		} finally {
			// Inside act: the mounted components subscribe to the locale store.
			await act(async () => setLocale("en"));
			document.documentElement.removeAttribute("dir");
		}
	});
}

/* ======================================================================
 * ROUND 2 REMEDIATION (security S-1..S-6, design D1-D7, UX U1-U3, U6)
 * ====================================================================== */

/*
 * NEVER `assert.equal` two DOM nodes: on a mismatch node:assert inspects both, and a
 * jsdom element's object graph is the whole window (a failing focus check ran the
 * machine out of memory). Compare identity and report a tag/testid instead.
 */
function describeNode(node) {
	return node
		? `${node.tagName}#${node.getAttribute?.("data-testid") ?? ""}`
		: String(node);
}
function focusIs(expected, message = "focus") {
	const actual = document.activeElement;
	assert.ok(
		actual === expected,
		`${message}: focus is on ${describeNode(actual)}, expected ${describeNode(expected)}`,
	);
}

/** Open the prompt dialog from its entry and wait out the 500 ms typed-ahead window. */
async function openPrompt() {
	await until(() => q('[data-testid="guard-review"]'), "the entry");
	await click(q('[data-testid="guard-review"]'));
	await until(() => q('[data-testid="guard-yes"]'), "the dialog");
	await wall(600);
}
const accepts = () => sent.filter((r) => r.op === "approvals.approveOperation");
const applies = () => sent.filter((r) => r.op === "approvals.applyOperation");

/* ---- S-1: a signed accept the host could not SEND is not "Sharing" ---- */

test("S-1: a 200 with applied.ok=false is not a grant: the host's reason shows, Try again re-applies the signed card, and the row survives a close", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
		// The card leaves `requested` once signed (state failed), exactly as the host does.
		"approvals.approveOperation": () => {
			script["approvals.list"] = list();
			return ok(SIGNED_NOT_SENT());
		},
		"approvals.applyOperation": ok({
			approval_id: ID,
			operation: "guard_consent",
			state: "connected",
			applied: { ok: true, code: "" },
		}),
	};
	await render(createElement(GuardPromptEntries));
	await openPrompt();
	await click(q('[data-testid="guard-yes"]'));
	await until(
		() => q('[data-testid="guard-not-applied"]'),
		"the not-sent line",
	);
	const body = text();
	assert.ok(!body.includes("Sharing with Acme"), "no false consent receipt");
	assert.equal(q('[data-testid="guard-outcome"]'), null);
	assert.ok(
		body.includes(
			"Radient could not be reached, so your choice has not been sent.",
		),
		"the host's own reason",
	);
	assert.ok(
		body.includes("Check your connection, then try again."),
		"and remedy",
	);
	assert.equal(
		q('[data-testid="guard-not-applied"]').getAttribute("role"),
		"alert",
		"announced",
	);
	assert.ok(q('[data-testid="guard-retry"]'), "Try again is offered");
	assert.equal(accepts().length, 1);

	// Closing does not lose the decision: the list row is gone but a row remains.
	await click(q('[data-testid="guard-done"]'));
	assert.equal(q('[data-testid="guard-consent-dialog"]'), null);
	await until(() => q('[data-testid="guard-entry"]'), "the unsent row");
	assert.ok(text().includes("Radient could not be reached"));
	await click(q('[data-testid="guard-review"]'));
	await until(() => q('[data-testid="guard-retry"]'), "the dialog again");

	await click(q('[data-testid="guard-retry"]'));
	await until(() => q('[data-testid="guard-outcome"]'), "the outcome");
	assert.deepEqual(applies(), [
		{
			op: "approvals.applyOperation",
			approvalId: ID,
			operation: "guard_consent",
			requestDigest: sha("a"),
			disclosureDigest: sha("b"),
		},
	]);
	assert.equal(accepts().length, 1, "the retry never signs again");
	assert.equal(
		q('[data-testid="guard-outcome"]').textContent,
		"Sharing with Acme from this computer.",
	);
	await click(q('[data-testid="guard-done"]'));
	assert.equal(q('[data-testid="guard-entry"]'), null, "settled: row cleared");
});

test("S-1: a non-retryable apply refusal draws no Try again; a retry that fails keeps the host's words", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
		"approvals.approveOperation": () => {
			script["approvals.list"] = list();
			return ok(
				SIGNED_NOT_SENT({
					retryable: false,
					reason: "Acme turned Guard off before this could be sent.",
					remedy: "",
				}),
			);
		},
	};
	await render(createElement(GuardPromptEntries));
	await openPrompt();
	await click(q('[data-testid="guard-yes"]'));
	await until(
		() => q('[data-testid="guard-not-applied"]'),
		"the not-sent line",
	);
	assert.equal(
		q('[data-testid="guard-retry"]'),
		null,
		"no retry that cannot work",
	);
	assert.ok(
		text().includes("Acme turned Guard off before this could be sent."),
	);
});

test("S-1: a retry the host refuses (409 with apply_outcome) stays on the host's sentence, never Sharing", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
		"approvals.approveOperation": () => {
			script["approvals.list"] = list();
			return ok(SIGNED_NOT_SENT());
		},
		"approvals.applyOperation": {
			status: 409,
			body: {
				detail: {
					code: "x",
					text: "refused",
					apply_outcome: {
						code: "revocation_stale",
						retryable: false,
						reason: "Your earlier stop is newer than this choice.",
						remedy: "Choose again when Acme asks.",
					},
				},
			},
		},
	};
	await render(createElement(GuardPromptEntries));
	await openPrompt();
	await click(q('[data-testid="guard-yes"]'));
	await until(() => q('[data-testid="guard-retry"]'), "Try again");
	await click(q('[data-testid="guard-retry"]'));
	await until(
		() => text().includes("Your earlier stop is newer than this choice."),
		"the refusal's sentence",
	);
	assert.equal(
		q('[data-testid="guard-retry"]'),
		null,
		"retryable:false removes it",
	);
	assert.ok(!text().includes("Sharing with Acme"));
});

test("S-1: a 200 this build cannot read as signed-and-sent is never 'Sharing' (negative controls)", async () => {
	for (const reply of [
		{ applied: { ok: true } }, // no `signed`
		{ signed: { ok: true } }, // no `applied`
		{ signed: { ok: false }, applied: { ok: true } },
		{},
		null,
	]) {
		sent = [];
		script = {
			capabilities: caps(GUARD_PLANE),
			"approvals.list": list(guardRow()),
			"guard.status": ok(status({ mode: "none", orgs: [] })),
			"approvals.approveOperation": ok(reply),
		};
		await render(createElement(GuardPromptEntries));
		await openPrompt();
		await click(q('[data-testid="guard-yes"]'));
		await settle(10);
		assert.ok(
			!text().includes("Sharing with Acme"),
			`${JSON.stringify(reply)} is not a grant`,
		);
		await act(async () => root.unmount());
		root = undefined;
		document.body.innerHTML = "";
		container = document.createElement("div");
		document.body.append(container);
	}
	// And the parser itself, both phases.
	assert.equal(guardAcceptOutcome(SIGNED_AND_SENT).kind, "done");
	assert.equal(guardAcceptOutcome(SIGNED_NOT_SENT()).kind, "not_applied");
	assert.equal(guardApplyOutcome({ applied: { ok: true } }).kind, "done");
	assert.equal(guardApplyOutcome({}).kind, "unreadable");
});

/* ---- S-2: the org name is sanitised and isolated ---- */

test("S-2: invisible bidi/format characters are stripped from the org name; ZWNJ and real text survive", () => {
	assert.equal(sanitizeOrgName("\u202eEvil\u202c\n\u200bAcme"), "Evil Acme");
	assert.equal(sanitizeOrgName("A\u2066b\u2069c"), "Abc");
	assert.equal(sanitizeOrgName("  Acme \t Robotics  "), "Acme Robotics");
	assert.equal(
		sanitizeOrgName("x\uE000y"),
		"xy",
		"the renderer's own marker cannot be forged",
	);
	assert.equal(
		sanitizeOrgName("می\u200cخواهم"),
		"می\u200cخواهم",
		"ZWNJ is spelling in Persian/Urdu names",
	);
	const [row] = approvalRows({
		approvals: [
			guardRow({}, { org_display_name: "\u202eEvil\u202c\n\u200bAcme" }),
		],
	});
	assert.equal(row.guard.disclosure.org_display_name, "Evil Acme");
	// A name that is ONLY invisible characters leaves the card opaque: no Share.
	assert.deepEqual(
		guardWaitingViews(
			approvalRows({
				approvals: [guardRow({}, { org_display_name: "\u202e\u200b" })],
			}),
		),
		[],
	);
	assert.equal(
		guardStatus({ ...status(), orgs: [org({ org: "\u202eAcme\u202c" })] })
			.orgs[0].org,
		"Acme",
		"the Settings read inherits the same sanitising",
	);
});

test("S-2: the org name is in <bdi> in the entry and the dialog (title, reason, scope lines, outcome)", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(
			guardRow(
				{},
				{
					org_display_name: "\u202eEvil\u202c Acme",
					asked_scopes: ["decisions", "reports"],
				},
			),
		),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
		"approvals.approveOperation": ok(SIGNED_AND_SENT),
	};
	await render(createElement(GuardPromptEntries));
	await until(() => q('[data-testid="guard-entry"]'), "the entry");
	const entryBdi = [
		...q('[data-testid="guard-entry"]').querySelectorAll("bdi"),
	];
	assert.equal(entryBdi.length, 2, "title and reason line");
	assert.ok(entryBdi.every((b) => b.textContent === "Evil Acme"));
	assert.ok(!q('[data-testid="guard-entry"]').textContent.includes("\u202e"));
	await click(q('[data-testid="guard-review"]'));
	await until(() => q('[data-testid="guard-yes"]'), "the dialog");
	const dialog = q('[data-testid="guard-consent-dialog"]');
	// title + reason + the reports scope line (which names the org)
	assert.ok(dialog.querySelectorAll("bdi").length >= 3);
	assert.ok(dialog.querySelector("h2 bdi"), "the title isolates the name");
	assert.ok(!dialog.textContent.includes("\u202e"));
	assert.ok(
		!dialog.textContent.includes("\uE000"),
		"no marker leaks into the DOM",
	);
	await wall(600);
	await click(q('[data-testid="guard-yes"]'));
	await until(() => q('[data-testid="guard-outcome"]'), "the outcome");
	assert.ok(q('[data-testid="guard-outcome"] bdi'));
});

/* ---- S-4: the accept gets the gesture budget; a failure is not worded as "nothing changed" when unknown ---- */

test("S-4: the guard_consent accept has the presence-gesture budget; its retry and other typed ops keep the control budget", () => {
	const base = {
		approvalId: ID,
		requestDigest: sha("a"),
		disclosureDigest: sha("b"),
	};
	const accept = desktopRequestDeadlineMs({
		op: "approvals.approveOperation",
		operation: "guard_consent",
		...base,
	});
	assert.equal(accept, 195_000, "180 s gesture + 15 s");
	assert.ok(accept > 20_000);
	assert.equal(
		desktopRequestDeadlineMs({
			op: "approvals.applyOperation",
			operation: "guard_consent",
			...base,
		}),
		20_000,
		"the retry never signs",
	);
	assert.equal(
		desktopRequestDeadlineMs({
			op: "approvals.approveOperation",
			operation: "profile_save",
			...base,
		}),
		20_000,
		"profile_save keeps the budget it always had",
	);
});

test("S-4: a failed accept whose re-read ALSO fails says it could not confirm, never 'nothing changed'", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
		"approvals.approveOperation": () => {
			script["approvals.list"] = { status: 500, body: { detail: "down" } };
			return { status: 504, body: { detail: "timed out" } };
		},
	};
	await render(createElement(GuardPromptEntries));
	await openPrompt();
	await click(q('[data-testid="guard-yes"]'));
	await until(
		() => q('[data-testid="guard-unconfirmed"]'),
		"the unconfirmed line",
	);
	assert.ok(
		!text().includes("nothing changed"),
		"an unknown outcome is not 'nothing changed'",
	);
	assert.ok(!text().includes("Sharing with Acme"));
	assert.equal(
		q('[data-testid="guard-unconfirmed"]').getAttribute("role"),
		"alert",
	);
	// S-7 (security r2): the unknown outcome must not assert a negative either.
	// "Nothing was shared or sent" is false when the accept landed and only the
	// answer was lost, so the dialog says only that the choice is unconfirmed.
	assert.equal(
		q('[data-testid="guard-unconfirmed"]').textContent,
		"We couldn't confirm your choice. Check Guard in Settings before trying again.",
	);
	assert.ok(!text().includes("Nothing was shared"));
	assert.ok(!text().includes("can't read its settings"));
});

test("S-4: after a failed accept the record is re-read first: still waiting says nothing changed; gone is worded by the reconcile (not 'nothing changed')", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(
			status({
				mode: "orgs",
				orgs: [org({ answered_via: "desktop", state: "sharing" })],
			}),
		),
		// The host signed and sent, then the response was lost: the card is gone.
		"approvals.approveOperation": () => {
			script["approvals.list"] = list();
			return { status: 504, body: { detail: "timed out" } };
		},
	};
	await render(createElement(GuardPromptEntries));
	await openPrompt();
	const before = sent.filter((r) => r.op === "approvals.list").length;
	await click(q('[data-testid="guard-yes"]'));
	await until(
		() => q('[data-testid="guard-outcome"]'),
		"the reconciled outcome",
	);
	assert.ok(
		sent.filter((r) => r.op === "approvals.list").length > before,
		"the list was re-read before the failure was worded",
	);
	assert.ok(!text().includes("nothing changed"));
	assert.equal(
		q('[data-testid="guard-outcome"]').textContent,
		"Answered on the desktop app",
	);
});

/* ---- S-5: one answer at a time ---- */

test("S-5: two Share clicks in one tick send exactly one accept", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
		"approvals.approveOperation": ok(SIGNED_AND_SENT),
	};
	await render(createElement(GuardPromptEntries));
	await openPrompt();
	const yes = q('[data-testid="guard-yes"]');
	await act(async () => {
		for (let n = 0; n < 2; n++)
			yes.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
	});
	await until(() => q('[data-testid="guard-outcome"]'), "the outcome");
	assert.equal(accepts().length, 1);
	assert.equal(
		q('[data-testid="guard-outcome"]').textContent,
		"Sharing with Acme from this computer.",
		"the outcome is the one answer's",
	);
});

/* ---- S-6: an ended card sends nothing ---- */

test("S-6: a card whose window ended sends nothing and says the request changed; a live window still sends", async () => {
	const past = Math.floor(Date.now() / 1000) - 60;
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow({}, { expires_at: past })),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
		"approvals.approveOperation": ok(SIGNED_AND_SENT),
	};
	await render(createElement(GuardPromptEntries));
	await openPrompt();
	await click(q('[data-testid="guard-yes"]'));
	await until(() => q('[data-testid="guard-outcome"]'), "the changed line");
	assert.equal(accepts().length, 0, "nothing was sent for an ended card");
	assert.equal(
		q('[data-testid="guard-outcome"]').textContent,
		"Acme changed this request. Check the new one below.",
	);
	assert.equal(guardCardExpired([null, undefined, 0], Date.now()), false);
	assert.equal(
		guardCardExpired([null, past], Date.now()),
		true,
		"the record's own window counts",
	);
	await act(async () => root.unmount());
	root = undefined;
	document.body.innerHTML = "";
	container = document.createElement("div");
	document.body.append(container);
	sent = [];
	script["approvals.list"] = list(
		guardRow({}, { expires_at: Math.floor(Date.now() / 1000) + 3600 }),
	);
	await render(createElement(GuardPromptEntries));
	await openPrompt();
	await click(q('[data-testid="guard-yes"]'));
	await until(() => q('[data-testid="guard-outcome"]'), "the outcome");
	assert.equal(accepts().length, 1, "control: a live card sends");
});

/* ---- D1/D2/D3/D5/D7: layout and states ---- */

test("D1/D7: the dialog caps to the viewport with a pinned header and footer and a scrolling, focusable body; the entry row wraps", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
	};
	await render(createElement(GuardPromptEntries));
	await until(() => q('[data-testid="guard-entry"]'), "the entry");
	assert.ok(
		q('[data-testid="guard-entry"]').className.includes("flex-wrap"),
		"D7",
	);
	await click(q('[data-testid="guard-review"]'));
	await until(() => q('[data-testid="guard-yes"]'), "the dialog");
	const dialog = q('[data-testid="guard-consent-dialog"]');
	assert.ok(
		dialog.className.includes("max-h-[calc(100dvh-2rem)]"),
		"capped to the viewport",
	);
	assert.ok(
		dialog.className.includes("max-w-[min(32rem,calc(100vw-2rem))]"),
		"keeps a gutter at 320 px",
	);
	const body = q('[data-testid="guard-body"]');
	assert.ok(
		body.className.includes("overflow-y-auto") &&
			body.className.includes("min-h-0"),
	);
	assert.equal(body.getAttribute("tabindex"), "0", "keyboard-scrollable");
	assert.ok(
		body.contains(q('[data-testid="guard-notice"]') ?? q("[data-scope]")),
	);
	const header = dialog.querySelector("h2").parentElement;
	assert.ok(header.className.includes("shrink-0"), "header pinned");
	const footer = q('[data-testid="guard-no"]').parentElement;
	assert.ok(footer.className.includes("shrink-0"), "answers pinned");
	assert.ok(
		!body.contains(q('[data-testid="guard-yes"]')),
		"the answers are outside the scroller",
	);
});

test("D2: a non-Team member with nothing waiting draws nothing at all, not even the heading", async () => {
	await render(
		view({ status: status({ mode: "non_team", orgs: [] }), role: "member" }),
	);
	assert.equal(q('[data-testid="guard-section"]'), null);
	assert.equal(container.textContent, "");
	// Control: the owner still sees the section and its card.
	await act(async () => root.unmount());
	root = undefined;
	document.body.innerHTML = "";
	container = document.createElement("div");
	document.body.append(container);
	await render(
		view({ status: status({ mode: "non_team", orgs: [] }), role: "owner" }),
	);
	assert.ok(q('[data-testid="guard-non-team-card"]'));
	assert.ok(q('[data-guard-heading="true"]'));
});

test("D3/D5: the heading matches 'Paired phones'; a plain read says Checking…, not Working…", async () => {
	await render(view({ load: "loading", status: null }));
	const heading = q('[data-guard-heading="true"]');
	assert.ok(
		heading.className.includes("font-medium") &&
			heading.className.includes("text-body "),
	);
	assert.equal(q('[data-testid="guard-loading"]').textContent, "Checking…");
	assert.ok(!text().includes("Working…"));
});

/* ---- U1: the gear leads to the section that holds the prompt ---- */

test("U1: with a prompt waiting the gear opens Radient account; otherwise the plain gear", () => {
	assert.equal(guardSettingsRoute(0), "/settings");
	assert.equal(guardSettingsRoute(1), "/settings?section=radient");
	assert.equal(guardSettingsRoute(3), "/settings?section=radient");
});

/* ---- U2/U3: focus returns, outcomes are announced ---- */

test("U2/U3: Esc returns focus to Review; Share moves focus to Close; closing puts focus on the Guard heading when the card is gone", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
		"approvals.approveOperation": () => {
			script["approvals.list"] = list();
			return ok(SIGNED_AND_SENT);
		},
	};
	await render(
		createElement(
			"div",
			null,
			createElement(
				"h3",
				{ "data-guard-heading": "true", tabIndex: -1 },
				"Radient Guard",
			),
			createElement(GuardPromptEntries),
		),
	);
	await until(() => q('[data-testid="guard-review"]'), "the entry");
	const review = q('[data-testid="guard-review"]');
	review.focus();
	await click(review);
	await until(() => q('[data-testid="guard-yes"]'), "the dialog");
	await press("Escape");
	assert.equal(q('[data-testid="guard-consent-dialog"]'), null);
	await settle(4);
	focusIs(review, "Esc: back on Review");

	review.focus();
	await click(review);
	await until(() => q('[data-testid="guard-yes"]'), "the dialog again");
	await wall(600);
	await click(q('[data-testid="guard-yes"]'));
	await until(() => q('[data-testid="guard-outcome"]'), "the outcome");
	focusIs(q('[data-testid="guard-done"]'), "focus on Close");
	assert.equal(
		q('[data-testid="guard-outcome"]').tagName,
		"OUTPUT",
		"a status region",
	);
	await click(q('[data-testid="guard-done"]'));
	await settle(4);
	focusIs(
		q('[data-guard-heading="true"]'),
		"the card is gone: focus lands on the Guard heading, not <body>",
	);
});

test("U3: a failed accept is announced (role=alert) and focus returns to the NON-sharing answer", async () => {
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
	await openPrompt();
	await click(q('[data-testid="guard-yes"]'));
	await until(() => q('[data-testid="guard-failed"]'), "the failure");
	assert.equal(q('[data-testid="guard-failed"]').getAttribute("role"), "alert");
	focusIs(q('[data-testid="guard-no"]'), "never on Share");
});

test("U2: confirming Stop sharing and pressing Share again leave focus on the Guard heading, not <body>", async () => {
	await render(
		view({
			status: status({
				orgs: [
					org({
						can_share_again: true,
						state: "not_sharing",
						can_revoke: false,
					}),
				],
			}),
		}),
	);
	q('[data-testid="guard-share-again"]').focus();
	await click(q('[data-testid="guard-share-again"]'));
	focusIs(q('[data-guard-heading="true"]'));
	await act(async () => root.unmount());
	root = undefined;
	document.body.innerHTML = "";
	container = document.createElement("div");
	document.body.append(container);

	await render(view());
	q('[data-testid="guard-stop"]').focus();
	await click(q('[data-testid="guard-stop"]'));
	await until(() => q('[data-testid="guard-confirm-stop"]'), "the confirm");
	await click(q('[data-testid="guard-confirm-stop"]'));
	await settle(4);
	focusIs(q('[data-guard-heading="true"]'));
});

test("U2: Keep sharing returns focus to the Stop button that opened the confirm", async () => {
	await render(view());
	const stop = q('[data-testid="guard-stop"]');
	stop.focus();
	await click(stop);
	await until(() => q('[data-testid="guard-keep"]'), "the confirm");
	await click(q('[data-testid="guard-keep"]'));
	await settle(4);
	focusIs(stop);
});

/* ---- U3: Settings failures and outcomes are announced ---- */

test("U3: Settings' write failure is role=alert and the stopped line is a status region", async () => {
	await render(view({ failedTenant: "ten_acme" }));
	assert.equal(
		q('[data-testid="guard-write-failed"]').getAttribute("role"),
		"alert",
	);
	await act(async () => root.unmount());
	root = undefined;
	document.body.innerHTML = "";
	container = document.createElement("div");
	document.body.append(container);
	await render(
		view({
			status: status({
				orgs: [org({ state: "not_sharing", can_revoke: false })],
			}),
			revoked: { tenant: "ten_acme", status: "revoked" },
		}),
	);
	assert.equal(q('[data-testid="guard-revoked"]').tagName, "OUTPUT");
});

/* ---- U6: who sees the data, from existing strings ---- */

test("U6: while sharing, Settings says who sees the data (the prompt's own visibility sentence, by what is shared)", async () => {
	await render(view());
	assert.equal(
		q('[data-testid="guard-visibility"]').textContent,
		"Admins see totals only when at least 5 people contributed, never your own numbers.",
	);
	await act(async () => root.unmount());
	root = undefined;
	document.body.innerHTML = "";
	container = document.createElement("div");
	document.body.append(container);
	await render(
		view({
			status: status({
				orgs: [org({ scopes_shared: ["decisions", "posture", "admin_share"] })],
			}),
		}),
	);
	assert.ok(
		q('[data-testid="guard-visibility"]').textContent.includes(
			"With step-by-step timing shared, they can also see your own timing",
		),
	);
});

/* ---- round 3: security r2 S-7..S-9, NIT-1/NIT-3; review r3 M-2/N-1; design r2 D8 ---- */

const HELD = () => {
	let release = () => {};
	const promise = new Promise((resolve) => {
		release = resolve;
	});
	return { promise, release };
};
const reopen = async () => {
	await act(async () => root.unmount());
	root = undefined;
	document.body.innerHTML = "";
	container = document.createElement("div");
	document.body.append(container);
};

test("S-7: a not-sent card with no host reason says the choice is unconfirmed, never 'nothing was shared'", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
		"approvals.approveOperation": () => {
			script["approvals.list"] = list();
			return ok(SIGNED_NOT_SENT({ reason: "", remedy: "" }));
		},
	};
	await render(createElement(GuardPromptEntries));
	await openPrompt();
	await click(q('[data-testid="guard-yes"]'));
	await until(
		() => q('[data-testid="guard-not-applied"]'),
		"the not-sent line",
	);
	assert.equal(
		q('[data-testid="guard-not-applied"]').textContent,
		"We couldn't confirm your choice. Check Guard in Settings before trying again.",
	);
	assert.ok(!text().includes("Nothing was shared"));
	// The row left behind after Close says the same, not the unavailable sentence.
	await click(q('[data-testid="guard-done"]'));
	await until(() => q('[data-testid="guard-entry"]'), "the unsent row");
	assert.ok(text().includes("We couldn't confirm your choice."));
	assert.ok(!text().includes("Nothing was shared"));
});

test("S-7: every locale carries the new key, translated and placeholder-free", async () => {
	const { readFile } = await import("node:fs/promises");
	const en = JSON.parse(
		await readFile("src/i18n/catalogues/en/ui.guard.json", "utf8"),
	)["ui.guard.screen_unconfirmed"];
	assert.equal(
		en,
		"We couldn't confirm your choice. Check Guard in Settings before trying again.",
	);
	for (const locale of ["es", "fr", "hi", "ru", "ur", "vi", "zh-CN"]) {
		const value = JSON.parse(
			await readFile(`src/i18n/catalogues/${locale}/ui.guard.json`, "utf8"),
		)["ui.guard.screen_unconfirmed"];
		assert.ok(value && value !== en, `${locale} is translated`);
		assert.ok(!value.includes("{"), `${locale} has no placeholder`);
		assert.ok(value.includes("Guard"), `${locale} keeps the product name`);
	}
});

test("S-8: Esc is ignored while Try again is in flight, and a late result never reopens a dialog the person closed", async () => {
	const held = HELD();
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
		"approvals.approveOperation": () => {
			script["approvals.list"] = list();
			return ok(SIGNED_NOT_SENT());
		},
		"approvals.applyOperation": () => held.promise,
	};
	// T-1: release the held retry even when an assertion fails, so a failing run
	// reads as the assertion and not as a hang plus a late unhandled rejection.
	try {
		await render(createElement(GuardPromptEntries));
		await openPrompt();
		await click(q('[data-testid="guard-yes"]'));
		await until(() => q('[data-testid="guard-retry"]'), "Try again");
		await click(q('[data-testid="guard-retry"]'));
		await until(() => applies().length === 1, "the retry in flight");
		await press("Escape");
		assert.ok(
			q('[data-testid="guard-consent-dialog"]'),
			"Esc does not close a dialog whose retry is running",
		);
		// Close (the button) can still be pressed; the late result must not undo it.
		await click(q('[data-testid="guard-done"]'));
		assert.equal(q('[data-testid="guard-consent-dialog"]'), null);
		held.release(
			ok({
				approval_id: ID,
				operation: "guard_consent",
				state: "connected",
				applied: { ok: true, code: "" },
			}),
		);
		await settle(8);
		assert.equal(
			q('[data-testid="guard-consent-dialog"]'),
			null,
			"the dialog the person closed stays closed",
		);
	} finally {
		held.release(ok({}));
	}
});

test("M-2: a Try again whose answer cannot be read, or that fails outright, says it could not confirm and stays retryable", async () => {
	for (const retryReply of [
		ok({}), // a 200 this build cannot read
		{ status: 500, body: { detail: "down" } }, // not an apply refusal
	]) {
		sent = [];
		script = {
			capabilities: caps(GUARD_PLANE),
			"approvals.list": list(guardRow()),
			"guard.status": ok(status({ mode: "none", orgs: [] })),
			"approvals.approveOperation": () => {
				script["approvals.list"] = list();
				return ok(SIGNED_NOT_SENT());
			},
			"approvals.applyOperation": retryReply,
		};
		await render(createElement(GuardPromptEntries));
		await openPrompt();
		await click(q('[data-testid="guard-yes"]'));
		await until(() => q('[data-testid="guard-retry"]'), "Try again");
		await click(q('[data-testid="guard-retry"]'));
		await until(
			() =>
				q('[data-testid="guard-not-applied"]')?.textContent.includes(
					"We couldn't confirm your choice.",
				),
			"the unconfirmed line",
		);
		const alert = q('[data-testid="guard-not-applied"]');
		assert.ok(
			!alert.textContent.includes("Radient could not be reached"),
			"the host's earlier sentence may no longer be true",
		);
		assert.ok(!text().includes("Sharing with Acme"));
		assert.ok(
			q('[data-testid="guard-retry"]') &&
				!q('[data-testid="guard-retry"]').disabled,
			"Try again is offered again",
		);
		assert.equal(accepts().length, 1, "never signs again");
		await reopen();
	}
});

test("N-1: an unconfirmed dialog recovers when the list does: gone is worded by the reconcile, still waiting reads 'nothing changed'", async () => {
	for (const cardGone of [true, false]) {
		sent = [];
		script = {
			capabilities: caps(GUARD_PLANE),
			"approvals.list": list(guardRow()),
			"guard.status": ok(
				status({
					mode: "orgs",
					orgs: [org({ answered_via: "desktop", state: "sharing" })],
				}),
			),
			"approvals.approveOperation": () => {
				script["approvals.list"] = { status: 500, body: { detail: "down" } };
				return { status: 504, body: { detail: "timed out" } };
			},
		};
		const qc = await render(createElement(GuardPromptEntries));
		await openPrompt();
		await click(q('[data-testid="guard-yes"]'));
		await until(() => q('[data-testid="guard-unconfirmed"]'), "unconfirmed");
		// The host is reachable again.
		script["approvals.list"] = cardGone ? list() : list(guardRow());
		await act(async () => {
			await qc.refetchQueries({ queryKey: meshApprovalKeys.approvals });
		});
		if (cardGone) {
			await until(() => q('[data-testid="guard-outcome"]'), "the outcome");
			assert.equal(
				q('[data-testid="guard-outcome"]').textContent,
				"Answered on the desktop app",
			);
		} else {
			await until(() => q('[data-testid="guard-failed"]'), "failed");
			assert.equal(q('[data-testid="guard-unconfirmed"]'), null);
		}
		await reopen();
	}
});

test("S-9: tag characters, U+180E, invisible operators and Hangul fillers are stripped; a name blank after cleaning is missing", async () => {
	assert.equal(sanitizeOrgName("Ac\u180Eme"), "Acme");
	assert.equal(sanitizeOrgName("Ac\u2061\u2062\u2063\u2064me"), "Acme");
	assert.equal(sanitizeOrgName("Ac\u{E0041}\u{E007F}\u{E0001}me"), "Acme");
	assert.equal(sanitizeOrgName("Ac\u115F\u1160\u3164\uFFA0me"), "Acme");
	assert.equal(sanitizeOrgName("Ac\u00ADme\uFFF9"), "Acme");
	// Kept: ZWNJ/ZWJ (spelling) and the emoji variation selector (a mark, not formatting).
	assert.equal(sanitizeOrgName("A\u200Cb\u200Dc"), "A\u200Cb\u200Dc");
	assert.equal(sanitizeOrgName("Acme \u2764\uFE0F"), "Acme \u2764\uFE0F");
	// Consent card: blank after cleaning leaves it opaque (no Share, not listed).
	for (const blank of [
		"\u3164",
		"\u180E\u2061",
		"\u{E0041}",
		"\uFFA0 \u1160",
	]) {
		assert.deepEqual(
			guardWaitingViews(
				approvalRows({
					approvals: [guardRow({}, { org_display_name: blank })],
				}),
			),
			[],
			`${JSON.stringify(blank)} is opaque`,
		);
	}
	// Settings: never an empty name in a sentence; the tenant id names it.
	const parsed = guardStatus({
		...status(),
		orgs: [org({ org: "\u3164", tenant: "ten_blank" })],
	});
	assert.equal(parsed.orgs[0].org, "ten_blank");
	// The non-Team card: a blank org is absent, so no footer is drawn.
	assert.equal(guardNonTeamCard({ org: "\u3164", url: "" }).org, null);
	assert.equal(guardNonTeamCard({ org: "Acme", url: "" }).org, "Acme");
});

test("NIT-1: Settings isolates the org name in <bdi> in the indicator, shared line, scope lines, revoke title and stopped line", async () => {
	const name = "\u202eEvil\u202c Acme";
	await render(
		view({
			status: guardStatus(
				status({
					orgs: [org({ org: name, scopes_shared: ["decisions", "reports"] })],
				}),
			),
		}),
	);
	const bdiText = (selector) =>
		[...q(selector).querySelectorAll("bdi")].map((b) => b.textContent);
	assert.deepEqual(bdiText('[data-testid="guard-indicator"]'), ["Evil Acme"]);
	assert.ok(
		bdiText('[data-testid="guard-shared"]').includes("Evil Acme"),
		"the reports scope line names the org inside <bdi>",
	);
	assert.ok(
		q('[data-testid="guard-org"]').textContent.includes(
			"Sharing with Evil Acme from this computer.",
		),
	);
	assert.ok(
		[...q('[data-testid="guard-org"]').querySelectorAll("bdi")].length >= 3,
		"indicator, shared sentence and the reports line",
	);
	assert.ok(!document.body.textContent.includes("\uE000"), "no marker leaks");
	await click(q('[data-testid="guard-stop"]'));
	await until(() => q('[data-testid="guard-revoke-dialog"]'), "the confirm");
	assert.deepEqual(
		[
			...q('[data-testid="guard-revoke-dialog"] h2').querySelectorAll("bdi"),
		].map((b) => b.textContent),
		["Evil Acme"],
	);
	assert.ok(
		q('[data-testid="guard-revoke-dialog"] h2').textContent.includes(
			"Stop sharing with Evil Acme?",
		),
	);
	await reopen();
	await render(
		view({
			status: guardStatus(
				status({
					orgs: [org({ org: name, state: "not_sharing", can_revoke: false })],
				}),
			),
			revoked: { tenant: "ten_acme", status: "revoked" },
		}),
	);
	assert.deepEqual(bdiText('[data-testid="guard-revoked"]'), ["Evil Acme"]);
});

test("NIT-3: a second Share after the card's dialog was remounted mid-answer sends nothing, and the latch releases when the answer settles", async () => {
	const held = HELD();
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
		"approvals.approveOperation": () => held.promise,
	};
	await render(createElement(GuardPromptEntries));
	await openPrompt();
	await click(q('[data-testid="guard-yes"]'));
	await until(() => accepts().length === 1, "the first accept in flight");
	// Leave and come back while the host is still answering.
	await reopen();
	await render(createElement(GuardPromptEntries));
	await openPrompt();
	await click(q('[data-testid="guard-yes"]'));
	await settle(4);
	assert.equal(
		accepts().length,
		1,
		"the returning instance sent no second accept",
	);
	held.release(ok(SIGNED_AND_SENT));
	await settle(8);
	// The latch is released from the request's own promise, not from a callback the
	// unmounted instance would have dropped: the card can be answered again.
	await reopen();
	await render(createElement(GuardPromptEntries));
	await openPrompt();
	script["approvals.approveOperation"] = ok(SIGNED_AND_SENT);
	await click(q('[data-testid="guard-yes"]'));
	await until(
		() => accepts().length === 2,
		"a fresh accept after the first settled",
	);
});

test("D8: the host's English reason and remedy are isolated in <bdi> so an RTL page keeps their punctuation", async () => {
	script = {
		capabilities: caps(GUARD_PLANE),
		"approvals.list": list(guardRow()),
		"guard.status": ok(status({ mode: "none", orgs: [] })),
		"approvals.approveOperation": () => {
			script["approvals.list"] = list();
			return ok(SIGNED_NOT_SENT());
		},
	};
	await render(createElement(GuardPromptEntries));
	await openPrompt();
	await click(q('[data-testid="guard-yes"]'));
	await until(
		() => q('[data-testid="guard-not-applied"]'),
		"the not-sent line",
	);
	assert.deepEqual(
		[...q('[data-testid="guard-not-applied"]').querySelectorAll("bdi")].map(
			(b) => b.textContent,
		),
		[
			"Radient could not be reached, so your choice has not been sent.",
			"Check your connection, then try again.",
		],
	);
});

/* ---- round 4: U8 / U9 / N-2 / S-11 / S-12 ---- */

const RETRY_REFUSED = {
	status: 409,
	body: {
		detail: {
			code: "x",
			text: "refused",
			apply_outcome: {
				code: "radient_unreachable",
				retryable: true,
				reason:
					"Radient could not be reached, so your choice has not been sent.",
				remedy: "Check your connection, then try again.",
			},
		},
	},
};
const notSent = (retryReply) => ({
	capabilities: caps(GUARD_PLANE),
	"approvals.list": list(guardRow()),
	"guard.status": ok(status({ mode: "none", orgs: [] })),
	"approvals.approveOperation": () => {
		script["approvals.list"] = list();
		return ok(SIGNED_NOT_SENT());
	},
	"approvals.applyOperation": retryReply,
});

test("U8: reopening a not-sent card puts focus on Close inside the dialog, not on the Review button behind it", async () => {
	script = notSent(RETRY_REFUSED);
	await render(createElement(GuardPromptEntries));
	await openPrompt();
	await click(q('[data-testid="guard-yes"]'));
	await until(
		() => q('[data-testid="guard-not-applied"]'),
		"the not-sent line",
	);
	await click(q('[data-testid="guard-done"]'));
	await until(() => q('[data-testid="guard-entry"]'), "the unsent row");
	const review = q('[data-testid="guard-review"]');
	review.focus();
	await click(review);
	await until(
		() => q('[data-testid="guard-not-applied"]'),
		"the reopened dialog",
	);
	await settle(4);
	focusIs(
		q('[data-testid="guard-done"]'),
		"reopened not-sent card: focus is on Close, inside the dialog",
	);
	assert.ok(
		q('[data-testid="guard-consent-dialog"]').contains(document.activeElement),
		"focus is inside the modal, not in the aria-hidden area behind it",
	);
});

test("U9: a second Try again that fails with the same sentence is announced again (the alert is a new live region)", async () => {
	script = notSent(RETRY_REFUSED);
	await render(createElement(GuardPromptEntries));
	await openPrompt();
	await click(q('[data-testid="guard-yes"]'));
	await until(() => q('[data-testid="guard-retry"]'), "Try again");
	await click(q('[data-testid="guard-retry"]'));
	await until(() => applies().length === 1, "the first retry");
	await settle(4);
	const first = q('[data-testid="guard-not-applied"]');
	assert.equal(first.getAttribute("role"), "alert");
	const sentence = first.textContent;
	await click(q('[data-testid="guard-retry"]'));
	await until(() => applies().length === 2, "the second retry");
	await settle(4);
	const second = q('[data-testid="guard-not-applied"]');
	assert.equal(second.textContent, sentence, "the same message both times");
	assert.notEqual(
		second,
		first,
		"a new alert node: identical text in the same node would not be spoken again",
	);
});

test("N-2: reopening the row while a retry is in flight shows Try again held, then free once it lands", async () => {
	const held = HELD();
	script = notSent(() => held.promise);
	try {
		await render(createElement(GuardPromptEntries));
		await openPrompt();
		await click(q('[data-testid="guard-yes"]'));
		await until(() => q('[data-testid="guard-retry"]'), "Try again");
		await click(q('[data-testid="guard-retry"]'));
		await until(() => applies().length === 1, "the retry in flight");
		await click(q('[data-testid="guard-done"]'));
		await until(() => q('[data-testid="guard-entry"]'), "the unsent row");
		await click(q('[data-testid="guard-review"]'));
		await until(() => q('[data-testid="guard-retry"]'), "the reopened dialog");
		assert.equal(
			q('[data-testid="guard-retry"]').disabled,
			true,
			"Try again is held while the earlier retry runs",
		);
		assert.ok(text().includes("Working"), "and a status line says why");
		held.release(RETRY_REFUSED);
		await until(
			() => q('[data-testid="guard-retry"]')?.disabled === false,
			"Try again free after the late result",
		);
	} finally {
		held.release(RETRY_REFUSED);
	}
});

test("S-11: characters that stay invisible outside \\p{Cf} are stripped, and a name of only such characters is blank", () => {
	for (const ch of [
		"\u2800",
		"\u17B4",
		"\u17B5",
		"\u180B",
		"\u180C",
		"\u180D",
		"\uFFFC",
	]) {
		assert.equal(
			sanitizeOrgName(`Ac${ch}me`),
			"Acme",
			`U+${ch.codePointAt(0).toString(16)} stripped`,
		);
		assert.equal(
			sanitizeOrgName(ch),
			"",
			`a name of only U+${ch.codePointAt(0).toString(16)} is blank`,
		);
	}
	assert.equal(
		sanitizeOrgName("\u2800\u2800 \u034F"),
		"",
		"marks with no base are blank",
	);
	assert.equal(
		sanitizeOrgName("e\u0301"),
		"e\u0301",
		"a mark with a base survives",
	);
	assert.deepEqual(
		guardWaitingViews(
			approvalRows({
				approvals: [guardRow({}, { org_display_name: "\u2800\u2800" })],
			}),
		),
		[],
		"a braille-blank name leaves the card opaque: no Share",
	);
});

test("S-12: a blank org name falls back to the SANITISED tenant id, and to a neutral dash when that is blank too", () => {
	const read = (row) => guardStatus({ ...status(), orgs: [row] }).orgs[0].org;
	assert.equal(read(org({ org: "\u2800", tenant: "ten_acme" })), "ten_acme");
	assert.equal(
		read(org({ org: "\u2800", tenant: "\u202eten\uE000_acme\u202c" })),
		"ten_acme",
		"bidi controls and the renderer's marker never reach the sentence slot",
	);
	assert.equal(read(org({ org: "", tenant: "\u2800\u200b" })), "\u2014");
});
