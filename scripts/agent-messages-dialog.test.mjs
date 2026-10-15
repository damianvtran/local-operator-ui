import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const HOOK_MODULE = /use-agent-messages$/;
const ALL_MODULES = /.*/;
const REACT_MODULE = /^(react|react-dom)(\/.*)?$/;
const ACCOUNT_GUARD_SENTENCE =
	/cannot safely enable agent messages for your account/;
const DIALOG_TITLE = /Agent messages on Radient/;

// DOM/event plumbing only. jsdom has NO layout; rendered geometry belongs to
// the real-browser QA lease, never to this test's passing assertions.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		/* jsdom context-bound accessors */
	}
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// Node has its own Event/CustomEvent; Radix must construct the DOM realm's
// events when it dispatches against jsdom document.
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const bundled = await build({
	stdin: {
		contents:
			'export {AgentMessagesDialog} from "./src/renderer/src/features/agent-messages/agent-messages-dialog"; export {AgentMessagesOnboarding} from "./src/renderer/src/features/agent-messages/agent-messages-onboarding"; export {AgentMessagesModel} from "./src/renderer/src/features/agent-messages/agent-messages-model"; export {useAgentMessagesOnboardingStore,agentMessagesOnboardingKey} from "./src/renderer/src/shared/store/agent-messages-onboarding-store";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	jsx: "automatic",
	mainFields: ["module", "main"],
	alias: { "@shared": resolve("src/renderer/src/shared") },
	plugins: [
		{
			name: "isolated-dialog-dependencies",
			setup(builder) {
				builder.onResolve({ filter: HOOK_MODULE }, () => ({
					path: "hook",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: ALL_MODULES, namespace: "fixture" }, () => ({
					contents:
						"export const useAgentMessages = () => window.__agentMessagesState;",
					loader: "js",
				}));
				builder.onResolve({ filter: REACT_MODULE }, (args) => {
					if (args.path.startsWith("@shared")) return undefined;
					return {
						path: pathToFileURL(require.resolve(args.path)).href,
						external: true,
					};
				});
			},
		},
	],
});
const api = await import(
	`data:text/javascript;base64,${Buffer.from(`${bundled.outputFiles[0].text}\n//# sourceURL=agent-messages-dialog-fixture.mjs`).toString("base64")}`
);
const fixture = JSON.parse(
	readFileSync("scripts/fixtures/agent-messages-status.json", "utf8"),
);
after(() => {
	dom.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

async function mount(
	t,
	{
		status = fixture,
		accountId = "account-a",
		blocked = false,
		blockedAtCheck = false,
		pending = false,
		consent = undefined,
		skipInitialCheck = false,
		statusImpl = null,
	} = {},
) {
	api.useAgentMessagesOnboardingStore.setState({ seen: {} });
	const writes = [];
	const model = new api.AgentMessagesModel({
		status: statusImpl ?? (async () => structuredClone(status)),
		enable: async (body) => {
			writes.push(body);
			return {
				endpoint: {
					id: "bep-example",
					state: "active",
					account_id: body.expected_account_id,
					tenant_id: body.tenant_id,
				},
			};
		},
		localSetting: async () => {},
		markSeen: (account, tenant) =>
			api.useAgentMessagesOnboardingStore.getState().markSeen(account, tenant),
		describe: () => ({ code: "refused", message: "Stable refusal sentence." }),
	});
	model.setAccount(accountId);
	// R2/Q2: the busy fact is snapshotted AT the boundary check; a check that
	// hit busy must not present when the app merely goes quiet afterwards.
	model.setBlocked(blockedAtCheck);
	if (!skipInitialCheck) await model.check("app_start");
	window.__agentMessagesState = {
		accountId,
		model,
		snapshot: { ...model.getSnapshot(), pending },
	};
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	t.after(async () => {
		await act(async () => root.unmount());
		container.remove();
	});
	await act(async () =>
		root.render(
			React.createElement(
				consent !== undefined
					? api.AgentMessagesDialog
					: api.AgentMessagesOnboarding,
				consent !== undefined
					? {
							consent,
							accountGuard: true,
							canEnable: true,
							pending: false,
							confirmed: false,
							refusal: null,
							onDismiss: () => model.dismiss(accountId, "tenant-home"),
							onEnable: () => {},
						}
					: { blocked, sessionId: null },
			),
		),
	);
	return { root, container, model, writes };
}
const press = async (target, type = "click", options = {}) => {
	await act(async () =>
		target.dispatchEvent(
			type.startsWith("key")
				? new window.KeyboardEvent(type, { bubbles: true, ...options })
				: new window.MouseEvent(type, { bubbles: true, ...options }),
		),
	);
};

for (const path of ["X", "Not now", "Escape", "outside"])
	test(`one shared ${path} dismissal persists privately across rehydration and does not enroll`, async (t) => {
		const mounted = await mount(t);
		assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
		if (path === "X")
			await press(document.querySelector('button[aria-label="Close"]'));
		if (path === "Not now")
			await press(
				[...document.querySelectorAll("button")].find(
					(button) => button.textContent === "Not now",
				),
			);
		if (path === "Escape")
			await press(document.activeElement, "keydown", {
				key: "Escape",
				code: "Escape",
			});
		if (path === "outside") {
			await act(async () => {
				await new Promise((done) => setTimeout(done, 30));
			});
			const overlay = document.querySelector(".bg-scrim");
			// Radix defers primary-pointer outside dismissal until the matching
			// click (react-dismissable-layer usePointerDownOutside).
			await press(overlay, "pointerdown", { button: 0 });
			await press(overlay, "click", { button: 0 });
		}
		assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
		const key = api.agentMessagesOnboardingKey("account-a", "tenant-home");
		assert.equal(
			api.useAgentMessagesOnboardingStore.getState().seen[key],
			true,
		);
		assert.deepEqual(mounted.writes, []);
		const persisted = localStorage.getItem("agent-messages-onboarding");
		await act(async () =>
			api.useAgentMessagesOnboardingStore.setState({ seen: {} }),
		);
		localStorage.setItem("agent-messages-onboarding", persisted);
		await act(async () =>
			api.useAgentMessagesOnboardingStore.persist.rehydrate(),
		);
		assert.equal(
			api.useAgentMessagesOnboardingStore.getState().seen[key],
			true,
		);
		assert.equal(
			api.useAgentMessagesOnboardingStore.getState().seen[
				api.agentMessagesOnboardingKey("account-b", "tenant-home")
			],
			undefined,
		);
		assert.equal(
			api.useAgentMessagesOnboardingStore.getState().seen[
				api.agentMessagesOnboardingKey("account-a", "other")
			],
			undefined,
		);
	});

test("unknown/no-plan/dark/signed-out and modal-blocked states mount no strings or placeholders", async (t) => {
	for (const options of [
		{ status: null },
		{ status: { ...fixture, surface_state: "A" } },
		{ status: { ...fixture, surface_state: "G" } },
		{ accountId: null },
		{ blocked: true },
	]) {
		const mounted = await mount(t, options);
		assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
		assert.equal(mounted.container.textContent, "");
		await act(async () => mounted.root.unmount());
	}
});

test("canonical consent is exact immediately above buttons; helper is under buttons and no links/markdown exist", async (t) => {
	await mount(t);
	const consent = document.querySelector(
		"[data-agent-messages-consent-version]",
	);
	assert.equal(consent.textContent, fixture.consent.text);
	assert.equal(
		consent.nextElementSibling.querySelector("button").textContent,
		"Enable",
	);
	assert.equal(
		consent.nextElementSibling.nextElementSibling.textContent,
		"You can enable this later in Settings → Agent messages.",
	);
	assert.equal(document.querySelectorAll("a,iframe,img,script").length, 0);
	assert.equal(document.activeElement.textContent, "Not now");
	assert.ok(
		document
			.querySelector('[role="dialog"]')
			.getAttribute("aria-describedby")
			.includes(consent.id),
	);
});

test("URL/markup-looking served consent is inert text, not a fetched image or link", async (t) => {
	const text = "[click](https://example.invalid) <img src=x> **consent**";
	await mount(t, { consent: { version: "bridge_consent_v1", text } });
	assert.equal(
		document.querySelector("[data-agent-messages-consent-version]").textContent,
		text,
	);
	assert.equal(document.querySelectorAll("a,img,iframe").length, 0);
});

test("missing guarded backend receipt renders consent but disables Enable", async (t) => {
	await mount(t, { status: { ...fixture, consent_account_guard: false } });
	const enable = [...document.querySelectorAll("button")].find(
		(button) => button.textContent === "Enable",
	);
	assert.equal(enable.disabled, true);
	assert.match(document.body.textContent, ACCOUNT_GUARD_SENTENCE);
});

test("a check that hit busy stays hidden once the app goes quiet - no new boundary, no dialog", async (t) => {
	await mount(t, { blocked: false, blockedAtCheck: true });
	assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
	assert.doesNotMatch(document.body.textContent, DIALOG_TITLE);
});

test("busy DURING an in-flight check stays hidden after quiet - only the next boundary presents", async (t) => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const mounted = await mount(t, {
		skipInitialCheck: true,
		statusImpl: async () => {
			await gate;
			return structuredClone(fixture);
		},
	});
	const base = window.__agentMessagesState;
	const refresh = async () => {
		window.__agentMessagesState = {
			...base,
			snapshot: mounted.model.getSnapshot(),
		};
		await act(async () =>
			mounted.root.render(
				React.createElement(api.AgentMessagesOnboarding, {
					blocked: false,
					sessionId: null,
				}),
			),
		);
	};
	await refresh();
	assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
	// The boundary starts safe; the user becomes busy in flight and is quiet
	// again BEFORE the eligible response lands. The completion must not arm
	// from the stale entry snapshot.
	const inFlight = mounted.model.check("window_focus");
	mounted.model.setBlocked(true);
	mounted.model.setBlocked(false);
	release();
	await inFlight;
	await refresh();
	assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
	// The NEXT safe boundary (served from the cache) presents.
	await mounted.model.check("window_focus");
	await refresh();
	assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
});

test("explicit Enable click sends the captured account/org/served version; mounting alone sends nothing", async (t) => {
	const mounted = await mount(t);
	assert.deepEqual(mounted.writes, []);
	const enable = [...document.querySelectorAll("button")].find(
		(button) => button.textContent === "Enable",
	);
	await press(enable);
	assert.deepEqual(mounted.writes, [
		{
			expected_account_id: "account-a",
			tenant_id: "tenant-home",
			state: "active",
			consent_version: fixture.consent.version,
			consented_via: "dialog",
		},
	]);
	assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
});

test("pending consent disables Enable and every dismissal path without recording a shown flag", async (t) => {
	const mounted = await mount(t, { pending: true });
	for (const button of document.querySelectorAll("button"))
		assert.equal(button.disabled, true);
	await press(document.activeElement, "keydown", {
		key: "Escape",
		code: "Escape",
	});
	await act(async () => {
		await new Promise((done) => setTimeout(done, 30));
	});
	const overlay = document.querySelector(".bg-scrim");
	await press(overlay, "pointerdown", { button: 0 });
	await press(overlay, "click", { button: 0 });
	assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
	assert.deepEqual(api.useAgentMessagesOnboardingStore.getState().seen, {});
	assert.deepEqual(mounted.writes, []);
});
