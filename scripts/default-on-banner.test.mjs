/**
 * Default-on Team Bridge first-run banner (runtime #2790, batch-5 deliverable 4).
 *
 * Real components over fake desktop APIs, like the sibling settings suite. The
 * claims that matter here are ABSENCES: under default-on there must be no Enable
 * button and no dialog on either surface, in every state. A title check alone
 * would pass while an Enable button sat beside it, so every state asserts the
 * absence of /enable/i buttons and of role=dialog/alertdialog explicitly.
 *
 * The local "Enabled on this machine" switch (role=switch) is ALLOWED in state C
 * and F and asserted exactly: it is the machine-local control of an enrolment
 * that already holds, not a way to opt in to Team Bridge, and the existing
 * settings surface owns it. It must NOT appear in B, D or E, and no other
 * switch may appear anywhere.
 *
 * Every "no dialog" claim about the onboarding dialog is made against a MOUNTED
 * AgentMessagesOnboarding with a negative control (a v1 hub does open it), so
 * it cannot pass merely because nothing that could render a dialog is mounted.
 *
 * jsdom has no layout; nothing here claims geometry (the Storybook frames do).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

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
globalThis.Event = dom.window.Event;
// Radix dispatches DOM-realm CustomEvents when the onboarding dialog opens.
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.Element.prototype.scrollIntoView = () => {};
window.Element.prototype.hasPointerCapture = () => false;
window.Element.prototype.setPointerCapture = () => {};
window.Element.prototype.releasePointerCapture = () => {};
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);

const EXTERNAL = /^(react|react-dom|@tanstack\/react-query)(\/.*)?$/;
const bundled = await build({
	stdin: {
		contents: `
			export {AgentMessagesOnboarding} from "./src/renderer/src/features/agent-messages/agent-messages-onboarding";
			export {AgentMessagesSettings} from "./src/renderer/src/features/agent-messages/agent-messages-settings";
			// react-query comes through the bundle so the provider and the component
			// share ONE copy; importing it beside the bundle resolves its ESM build
			// while the bundle's external resolves CJS, and the context is not shared.
			export {QueryClient, QueryClientProvider} from "@tanstack/react-query";
			export {TeamBridgeDefaultOnBanner} from "./src/renderer/src/features/team-bridge/team-bridge-default-on-banner";
			export {useAgentMessagesOnboardingStore} from "./src/renderer/src/shared/store/agent-messages-onboarding-store";
			export {desktopEndpoint} from "./src/shared/desktop-contract";
			export {agentMessagesStatusSchema,agentMessagesSettingsResultSchema,agentMessagesOnboardingContext,agentMessagesDefaultOnBannerPending,agentMessagesDefaultOnInForce,agentMessagesDefaultOnBannerConsentText} from "./src/shared/agent-messages-contract";
		`,
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
			name: "isolated-dependencies",
			setup(builder) {
				// The global status model and the transport belong to the app shell; the
				// banner's own seams (api prop, store) are what is under test.
				builder.onResolve({ filter: /use-agent-messages$/ }, () => ({
					path: "hook",
					namespace: "fixture",
				}));
				builder.onResolve({ filter: /agent-messages-api$/ }, () => ({
					path: "api",
					namespace: "fixture",
				}));
				builder.onResolve({ filter: /use-team-bridge$/ }, () => ({
					path: "keys",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: /^hook$/, namespace: "fixture" }, () => ({
					contents:
						"export const useAgentMessages = () => window.__agentMessagesState; export const checkAgentMessagesSurface = () => {}; export const agentMessagesModel = { invalidateStatus: () => { window.__invalidated = (window.__invalidated ?? 0) + 1; } };",
					loader: "js",
				}));
				builder.onLoad({ filter: /^api$/, namespace: "fixture" }, () => ({
					contents: "export const agentMessagesApi = {};",
					loader: "js",
				}));
				builder.onLoad({ filter: /^keys$/, namespace: "fixture" }, () => ({
					contents:
						'export const teamBridgeKeys = { all: ["team-bridge"], status: ["team-bridge","status"] };',
					loader: "js",
				}));
				builder.onResolve({ filter: EXTERNAL }, (args) => ({
					path: pathToFileURL(require.resolve(args.path)).href,
					external: true,
				}));
			},
		},
	],
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(`${bundled.outputFiles[0].text}\n//# sourceURL=default-on-banner-fixture.mjs`).toString("base64")}`
);
const { QueryClient, QueryClientProvider } = mod;

const statusFixture = JSON.parse(
	readFileSync("scripts/fixtures/agent-messages-status.json", "utf8"),
);
const settingsFixture = JSON.parse(
	readFileSync("scripts/fixtures/agent-messages-settings.json", "utf8"),
);
const allowlistFixture = JSON.parse(
	readFileSync("scripts/fixtures/agent-messages-allowlist.json", "utf8"),
);
// The runtime serves the FULL v2 text; the banner must show it byte-for-byte.
const v2Consent = JSON.parse(
	readFileSync("scripts/fixtures/team-bridge-consent-v2.json", "utf8"),
);
const V2_TEXT = v2Consent.text;
assert.equal(Buffer.byteLength(V2_TEXT), 2035);
assert.equal(
	createHash("sha256").update(V2_TEXT).digest("hex"),
	"dba2eb359f299a07d65676f2a088124903fb280196b54488c7913da4f9517f7d",
);

after(() => {
	dom.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

function statusWith({ surface = "C", defaultOn, enabled = true } = {}) {
	const base = structuredClone(statusFixture);
	base.surface_state = surface;
	base.local.enabled = enabled;
	base.consent = {
		version: "bridge_consent_v2",
		text: V2_TEXT,
		source: "served",
	};
	if (defaultOn !== undefined) base.default_on = defaultOn;
	return base;
}

function settingsWith({
	state = "active",
	defaultOn = true,
	none = false,
} = {}) {
	if (none) {
		return {
			endpoint: null,
			settings: {
				tenant_id: "tnt_bridge_e2e",
				eligible: true,
				consent_version: "bridge_consent_v2",
				consent_required: true,
			},
			...(defaultOn === undefined ? {} : { default_on: false }),
		};
	}
	const base = structuredClone(settingsFixture);
	base.endpoint.state = state;
	base.endpoint.consent.consented_via = defaultOn ? "default_on" : "settings";
	base.endpoint.consent.version = "bridge_consent_v2";
	base.settings.consent_required = state === "disabled";
	if (defaultOn !== undefined) base.default_on = defaultOn;
	return base;
}

const PENDING = { in_force: true, notice_pending: true };
const SEEN = { in_force: true, notice_pending: false };

function makeApi(settings, { failTurnOff = false, failDismiss = false } = {}) {
	const calls = { settings: [], dismiss: 0, local: [], allowlist: 0 };
	const api = {
		settings: async () => structuredClone(settings),
		updateSettings: async (body) => {
			calls.settings.push(body);
			if (failTurnOff) throw new Error("hub refused");
			return {
				...structuredClone(settings),
				endpoint: { ...settings.endpoint, state: body.state },
			};
		},
		allowlist: async () => structuredClone(allowlistFixture),
		updateAllowlist: async () => structuredClone(allowlistFixture),
		localSetting: async (key, value) => {
			calls.local.push({ key, value });
			return {};
		},
		dismissOnboarding: async () => {
			calls.dismiss += 1;
			if (failDismiss) throw new Error("runtime refused");
			return { onboarding: "seen" };
		},
	};
	return { api, calls };
}

const flush = async () => {
	await act(async () => {
		await new Promise((done) => setTimeout(done, 0));
	});
};

const labelOf = (el) =>
	`${el.getAttribute("aria-label") ?? ""} ${el.textContent}`.trim();
const buttons = () => [...document.querySelectorAll("button")];
const button = (label) => buttons().find((el) => labelOf(el) === label);
const enableButtons = () =>
	buttons().filter((el) => /enable/i.test(labelOf(el)));
const dialogs = () =>
	document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
// NEVER pass this to assert.equal/deepEqual: a failing comparison makes node
// inspect the jsdom node's whole object graph, which ran two earlier runs of this
// file past 30 GB. Compare `banner() === null` as a boolean instead.
const banner = () =>
	document.querySelector('[data-agent-messages-banner="default-on"]');
const press = async (el) => {
	assert.ok(el, "expected a control to press");
	await act(async () =>
		el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })),
	);
	await flush();
};

const switchLabels = () =>
	[...document.querySelectorAll('[role="switch"]')].map((el) =>
		(
			document.getElementById(el.getAttribute("aria-labelledby") ?? "")
				?.textContent ?? ""
		).trim(),
	);

/** The absences the product ruling demands, asserted in every state. */
function assertNoOptInAffordance(where) {
	// Only Settings states C and F carry the machine-local switch (see header).
	const state =
		document
			.querySelector("[data-agent-messages-state]")
			?.getAttribute("data-agent-messages-state") ?? null;
	assert.deepEqual(
		switchLabels(),
		state === "C" || state === "F" ? ["Enabled on this machine"] : [],
		`${where}: only the machine-local switch, only in C/F`,
	);
	assert.deepEqual(
		enableButtons().map(labelOf),
		[],
		`${where}: no Enable button`,
	);
	assert.equal(dialogs().length === 0, true, `${where}: no dialog`);
	assert.doesNotMatch(
		document.body.textContent,
		/enable (this )?later|Off by default/i,
		`${where}: no opt-in cue`,
	);
}

async function mountSettings(
	t,
	{ status, settings, api, accountId = "account-a" },
) {
	window.__agentMessagesState = { accountId, snapshot: { status } };
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	t.after(async () => {
		await act(async () => root.unmount());
		container.remove();
	});
	const built = api ? { api, calls: null } : makeApi(settings);
	let refreshes = 0;
	const render = (nextStatus = status) =>
		act(async () =>
			root.render(
				React.createElement(mod.AgentMessagesSettings, {
					availability: "visible",
					status: nextStatus,
					accountId,
					refusal: null,
					api: built.api,
					onRefreshStatus: () => {
						refreshes += 1;
						return Promise.resolve();
					},
					sessions: [],
				}),
			),
		);
	await render();
	await flush();
	await flush();
	return { ...built, render, refreshes: () => refreshes, root, container };
}

async function mountPage(t, { status, settings, api }) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	t.after(async () => {
		await act(async () => root.unmount());
		container.remove();
		client.clear();
	});
	const built = api ? { api, calls: null } : makeApi(settings);
	const render = (nextStatus = status) =>
		act(async () =>
			root.render(
				React.createElement(
					QueryClientProvider,
					{ client },
					React.createElement(mod.TeamBridgeDefaultOnBanner, {
						status: nextStatus,
						api: built.api,
					}),
				),
			),
		);
	await render();
	await flush();
	await flush();
	return { ...built, render, root, container, client };
}

test.beforeEach(() => {
	window.localStorage.clear();
	mod.useAgentMessagesOnboardingStore.setState({
		seen: {},
		defaultOnDismissed: {},
	});
	window.__invalidated = 0;
});

// ---------------------------------------------------------------------------
// Settings -> Agent messages
// ---------------------------------------------------------------------------

test("Settings: the pending banner shows exactly Turn off, Read what this means and a dismiss control, and no Enable or dialog", async (t) => {
	await mountSettings(t, {
		status: statusWith({ defaultOn: PENDING }),
		settings: settingsWith(),
	});
	assert.ok(banner(), "banner is present");
	assert.match(banner().textContent, /Team Bridge is on for you/);
	assert.deepEqual([...banner().querySelectorAll("button")].map(labelOf), [
		"Dismiss",
		"Turn off",
		"Read what this means",
	]);
	assertNoOptInAffordance("pending banner");
});

test("Settings: Read what this means shows the served v2 text verbatim", async (t) => {
	await mountSettings(t, {
		status: statusWith({ defaultOn: PENDING }),
		settings: settingsWith(),
	});
	assert.equal(
		document.querySelector("[data-agent-messages-banner-consent]") === null,
		true,
		"collapsed until asked",
	);
	await press(button("Read what this means"));
	const text = banner().querySelector("[data-agent-messages-banner-consent] p");
	assert.ok(text, "the consent block opened");
	assert.equal(text.textContent, V2_TEXT, "byte-equal to consent.text");
	assertNoOptInAffordance("expanded banner");
});

test("Settings: Turn off sends one PUT with state disabled and nothing else, and no settings.edit", async (t) => {
	const { calls, refreshes } = await mountSettings(t, {
		status: statusWith({ defaultOn: PENDING }),
		settings: settingsWith(),
	});
	await press(
		banner().querySelector('[data-agent-messages-banner-action="turn_off"]'),
	);
	assert.deepEqual(calls.settings, [
		{
			expected_account_id: "account-a",
			tenant_id: "tnt_bridge_e2e",
			state: "disabled",
		},
	]);
	// The runtime writes the sticky local opt-out; a client write would be a second source of truth.
	assert.deepEqual(calls.local, []);
	assert.equal(calls.dismiss, 0);
	assert.ok(refreshes() >= 1, "status is refreshed after the write");
	assert.equal(
		banner() === null,
		true,
		"banner is gone once the endpoint is off",
	);
	// After Turn off: the plain off state, and still no Enable and no dialog.
	assert.match(document.body.textContent, /Turned off/);
	assertNoOptInAffordance("after Turn off");
	assert.ok(
		button("Turn on again"),
		"the way back is the explicit settings control",
	);
});

test("Settings: a failed Turn off keeps the banner, says nothing changed and sends no second write", async (t) => {
	const api = makeApi(settingsWith(), { failTurnOff: true });
	await mountSettings(t, {
		status: statusWith({ defaultOn: PENDING }),
		api: api.api,
	});
	await press(
		banner().querySelector('[data-agent-messages-banner-action="turn_off"]'),
	);
	assert.match(
		banner().textContent,
		/could not be turned off\. Nothing was changed/,
	);
	assert.equal(api.calls.settings.length, 1);
	assertNoOptInAffordance("turn-off failure");
});

test("Settings: dismiss calls the route once, hides the banner and it never returns on re-render or remount", async (t) => {
	const status = statusWith({ defaultOn: PENDING });
	const first = await mountSettings(t, { status, settings: settingsWith() });
	await press(
		banner().querySelector('[data-agent-messages-banner-action="dismiss"]'),
	);
	assert.equal(first.calls.dismiss, 1);
	assert.equal(banner() === null, true, "banner is gone");
	assertNoOptInAffordance("dismissed");
	// The shared status model may replay a cached notice_pending:true for minutes.
	await first.render(status);
	await flush();
	assert.equal(
		banner() === null,
		true,
		"re-render with the stale pending status",
	);
	await act(async () => first.root.unmount());
	first.container.remove();
	const second = await mountSettings(t, { status, settings: settingsWith() });
	assert.equal(
		banner() === null,
		true,
		"remount with the stale pending status",
	);
	assert.equal(second.calls.dismiss, 0, "no second dismissal request");
	// Authoritative: the runtime's own notice_pending:false also hides it.
	await second.render(statusWith({ defaultOn: SEEN }));
	assert.equal(banner() === null, true, "banner is gone");
	assertNoOptInAffordance("seen");
});

test("Settings: a failed dismissal leaves the banner up with an honest error", async (t) => {
	const api = makeApi(settingsWith(), { failDismiss: true });
	await mountSettings(t, {
		status: statusWith({ defaultOn: PENDING }),
		api: api.api,
	});
	await press(
		banner().querySelector('[data-agent-messages-banner-action="dismiss"]'),
	);
	assert.ok(banner(), "not hidden for a promise the runtime never recorded");
	assert.match(banner().textContent, /could not be dismissed/);
	assert.equal(
		mod.useAgentMessagesOnboardingStore.getState().defaultOnDismissed[
			'["account-a","tnt_bridge_e2e"]'
		],
		undefined,
	);
});

test("Settings: default-on with no endpoint yet renders no Enable, no consent form and no opt-in line", async (t) => {
	await mountSettings(t, {
		status: statusWith({
			surface: "B",
			defaultOn: { in_force: true, notice_pending: false },
		}),
		settings: settingsWith({ none: true }),
	});
	assert.equal(banner() === null, true, "banner is gone");
	assert.match(document.body.textContent, /Team Bridge is not set up yet/);
	assertNoOptInAffordance("B under default-on");
});

test("Settings: the banner rule needs surface C, settings default_on and notice_pending together", async (t) => {
	const cases = [
		[
			"surface B",
			statusWith({ surface: "B", defaultOn: PENDING }),
			settingsWith(),
		],
		[
			"settings default_on false",
			statusWith({ defaultOn: PENDING }),
			settingsWith({ defaultOn: false }),
		],
		[
			"settings default_on absent",
			statusWith({ defaultOn: PENDING }),
			(() => {
				const { default_on: _omitted, ...s } = settingsWith();
				return s;
			})(),
		],
		["notice not pending", statusWith({ defaultOn: SEEN }), settingsWith()],
		["status default_on absent", statusWith(), settingsWith()],
	];
	for (const [name, status, settings] of cases) {
		const view = await mountSettings(t, { status, settings });
		assert.equal(banner() === null, true, name);
		await act(async () => view.root.unmount());
		view.container.remove();
	}
});

test("Settings: a v1 hub (no default_on anywhere) renders today's opt-in UI unchanged", async (t) => {
	const v1Status = structuredClone(statusFixture); // surface B, v1 text, no default_on
	await mountSettings(t, {
		status: v1Status,
		settings: settingsWith({ none: true, defaultOn: undefined }),
	});
	assert.equal(banner() === null, true, "banner is gone");
	assert.ok(button("Enable"), "the opt-in Enable is still offered");
	assert.match(document.body.textContent, /Off by default\./);
	assert.match(document.body.textContent, /Agent messages are off/);
});

// ---------------------------------------------------------------------------
// Team Bridge page
// ---------------------------------------------------------------------------

test("Team Bridge page: the pending banner offers Turn off, Read what this means and dismiss, and no Enable or dialog", async (t) => {
	await mountPage(t, {
		status: statusWith({ defaultOn: PENDING }),
		settings: settingsWith(),
	});
	assert.ok(banner());
	assert.deepEqual([...banner().querySelectorAll("button")].map(labelOf), [
		"Dismiss",
		"Turn off",
		"Read what this means",
	]);
	await press(button("Read what this means"));
	assert.equal(
		banner().querySelector("[data-agent-messages-banner-consent] p")
			.textContent,
		V2_TEXT,
	);
	assertNoOptInAffordance("page, pending");
});

test("Team Bridge page: Turn off sends the PUT alone; dismiss posts once and never returns", async (t) => {
	const off = await mountPage(t, {
		status: statusWith({ defaultOn: PENDING }),
		settings: settingsWith(),
	});
	await press(button("Turn off"));
	assert.deepEqual(off.calls.settings, [
		{
			expected_account_id: "account-a",
			// The settings read's own tenant, as Settings sends it.
			tenant_id: "tnt_bridge_e2e",
			state: "disabled",
		},
	]);
	assert.deepEqual(off.calls.local, []);
	assert.equal(off.calls.dismiss, 0);
	assert.equal(banner() === null, true, "plain off state: the banner is gone");
	assertNoOptInAffordance("page, after Turn off");
	assert.ok(
		(window.__invalidated ?? 0) >= 1,
		"the shared status cache is dropped",
	);
	await act(async () => off.root.unmount());
	off.container.remove();

	const seen = await mountPage(t, {
		status: statusWith({ defaultOn: PENDING }),
		settings: settingsWith(),
	});
	await press(button("Dismiss"));
	assert.equal(seen.calls.dismiss, 1);
	assert.equal(banner() === null, true, "banner is gone");
	await seen.render();
	assert.equal(banner() === null, true, "re-render");
	await act(async () => seen.root.unmount());
	seen.container.remove();
	const remounted = await mountPage(t, {
		status: statusWith({ defaultOn: PENDING }),
		settings: settingsWith(),
	});
	assert.equal(banner() === null, true, "remount");
	assertNoOptInAffordance("page, dismissed");
	assert.equal(remounted.calls.dismiss, 0);
});

test("Team Bridge page: nothing pending means no settings read and no banner", async (t) => {
	let reads = 0;
	const { api } = makeApi(settingsWith());
	const counting = {
		...api,
		settings: async () => {
			reads += 1;
			return settingsWith();
		},
	};
	await mountPage(t, {
		status: statusWith({ defaultOn: SEEN }),
		api: counting,
	});
	assert.equal(banner() === null, true, "banner is gone");
	assert.equal(
		reads,
		0,
		"a member with nothing to be told issues no extra request",
	);
	await mountPage(t, { status: statusWith(), api: counting });
	assert.equal(banner() === null, true, "banner is gone");
	assert.equal(reads, 0);
});

test("Team Bridge page: the view mounts the banner in its notice slot", () => {
	const source = readFileSync(
		"src/renderer/src/features/team-bridge/team-bridge-page.tsx",
		"utf8",
	);
	assert.match(
		source,
		/notice=\{<TeamBridgeDefaultOnBanner status=\{status\.data\} \/>\}/,
	);
	assert.match(source, /\{notice\}/);
});

// ---------------------------------------------------------------------------
// Contract, routes and the onboarding dialog
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// R1 remediation: mounted-dialog guard, races, tenant/account switch, versions
// ---------------------------------------------------------------------------

async function mountOnboarding(t, status) {
	window.__agentMessagesState = {
		accountId: "account-a",
		snapshot: { status, presentable: true, pending: false, confirmed: false },
		model: {
			setBlocked: () => {},
			consentIdentity: () => null,
			canEnable: () => false,
			dismiss: () => {},
		},
	};
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	let mounted = true;
	const unmount = async () => {
		if (!mounted) return;
		mounted = false;
		await act(async () => root.unmount());
		container.remove();
	};
	t.after(unmount);
	await act(async () =>
		root.render(
			React.createElement(mod.AgentMessagesOnboarding, {
				blocked: false,
				sessionId: null,
			}),
		),
	);
	return { container, unmount };
}

test("Onboarding dialog: MOUNTED, it renders nothing under default-on and DOES open for a v1 hub (negative control)", async (t) => {
	const control = await mountOnboarding(t, structuredClone(statusFixture));
	assert.equal(
		dialogs().length > 0,
		true,
		"control: a v1 hub opens the dialog",
	);
	// Unmount the control first: its dialog portals into <body>.
	await control.unmount();
	for (const defaultOn of [PENDING, SEEN]) {
		const view = await mountOnboarding(
			t,
			statusWith({ surface: "B", defaultOn }),
		);
		assert.equal(dialogs().length === 0, true, "no dialog under default-on");
		assert.equal(
			view.container.childNodes.length === 0,
			true,
			"renders nothing",
		);
		await view.unmount();
	}
});

test("Settings: a double click on Turn off sends one PUT", async (t) => {
	const { calls } = await mountSettings(t, {
		status: statusWith({ defaultOn: PENDING }),
		settings: settingsWith(),
	});
	const turnOff = banner().querySelector(
		'[data-agent-messages-banner-action="turn_off"]',
	);
	// Both clicks land before React re-renders the button disabled.
	await act(async () => {
		for (let i = 0; i < 2; i += 1) {
			turnOff.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		}
	});
	await flush();
	assert.equal(calls.settings.length, 1);
});

test("Settings: Dismiss while Turn off is in flight is dropped", async (t) => {
	const base = makeApi(settingsWith());
	let release;
	const gate = new Promise((done) => {
		release = done;
	});
	const api = {
		...base.api,
		updateSettings: async (body) => {
			await gate;
			return base.api.updateSettings(body);
		},
	};
	await mountSettings(t, {
		status: statusWith({ defaultOn: PENDING }),
		api,
	});
	const bannerButton = (name) =>
		banner().querySelector(`[data-agent-messages-banner-action="${name}"]`);
	const turnOff = bannerButton("turn_off");
	const dismiss = bannerButton("dismiss");
	// One act: the dismiss click arrives before the pending state has rendered.
	await act(async () => {
		turnOff.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		dismiss.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	assert.equal(base.calls.dismiss, 0, "dismiss dropped while Turn off pending");
	release();
	await flush();
	assert.equal(base.calls.dismiss, 0);
	assert.equal(base.calls.settings.length, 1);
});

test("Settings: state D (paused) under default-on has no banner, no Enable, no dialog", async (t) => {
	await mountSettings(t, {
		status: statusWith({ defaultOn: SEEN }),
		settings: settingsWith({ state: "paused" }),
	});
	assert.equal(
		document.querySelector('[data-agent-messages-state="D"]') === null,
		false,
		"state D rendered",
	);
	assert.equal(banner() === null, true, "no banner while paused");
	assertNoOptInAffordance("D under default-on");
});

test("Banner consent text is shown only when its version is the one enrolled; otherwise the unavailable copy", async (t) => {
	const moved = settingsWith();
	moved.endpoint.consent.version = "bridge_consent_v1";
	assert.equal(
		mod.agentMessagesDefaultOnBannerConsentText(
			statusWith({ defaultOn: PENDING }),
			settingsWith(),
		),
		V2_TEXT,
	);
	assert.equal(
		mod.agentMessagesDefaultOnBannerConsentText(
			statusWith({ defaultOn: PENDING }),
			moved,
		),
		null,
	);
	await mountSettings(t, {
		status: statusWith({ defaultOn: PENDING }),
		settings: moved,
	});
	await press(button("Read what this means"));
	const body = banner().querySelector("[data-agent-messages-banner-consent]");
	assert.equal(body.textContent.includes(V2_TEXT), false, "newer text hidden");
	assert.match(body.textContent, /full text is not available/);
});

test("Team Bridge page: a version mismatch shows the unavailable copy, not another version's text", async (t) => {
	const moved = settingsWith();
	moved.endpoint.consent.version = "bridge_consent_v1";
	await mountPage(t, {
		status: statusWith({ defaultOn: PENDING }),
		settings: moved,
	});
	await press(button("Read what this means"));
	const body = banner().querySelector("[data-agent-messages-banner-consent]");
	assert.equal(body.textContent.includes(V2_TEXT), false);
	assert.match(body.textContent, /full text is not available/);
});

test("Team Bridge page: a dismissal is per tenant; another tenant's banner still shows", async (t) => {
	const view = await mountPage(t, {
		status: statusWith({ defaultOn: PENDING }),
		settings: settingsWith(),
	});
	await press(button("Dismiss"));
	assert.equal(banner() === null, true, "dismissed for tenant-home");
	const other = statusWith({ defaultOn: PENDING });
	other.tenant_id = "tenant-other";
	await view.render(other);
	await flush();
	assert.equal(banner() === null, false, "tenant-other is not dismissed");
});

test("Team Bridge page: a sign-in switch within one tenant re-reads settings instead of replaying the other account's", async (t) => {
	let reads = 0;
	const { api } = makeApi(settingsWith());
	const counting = {
		...api,
		settings: async () => {
			reads += 1;
			return settingsWith();
		},
	};
	const view = await mountPage(t, {
		status: statusWith({ defaultOn: PENDING }),
		api: counting,
	});
	assert.equal(reads, 1);
	const switched = statusWith({ defaultOn: PENDING });
	switched.account_id = "account-b";
	await view.render(switched);
	await flush();
	await flush();
	assert.equal(reads, 2, "account is part of the settings query key");
});

test("Settings: an unknown consented_via from a newer runtime still renders, shown as sent", async (t) => {
	const future = settingsWith();
	future.endpoint.consent.consented_via = "carrier_pigeon";
	assert.equal(
		mod.agentMessagesSettingsResultSchema.safeParse(future).success,
		true,
	);
	await mountSettings(t, {
		status: statusWith({ defaultOn: SEEN }),
		settings: future,
	});
	assert.match(document.body.textContent, /carrier_pigeon/);
	assertNoOptInAffordance("unknown consented_via");
});

test("contract: a malformed notice_pending alone keeps in_force true (dialog stays closed) and hides the banner", () => {
	const parsed = mod.agentMessagesStatusSchema.parse({
		...statusFixture,
		surface_state: "B",
		default_on: { in_force: true, notice_pending: "soon" },
	});
	assert.equal(mod.agentMessagesDefaultOnInForce(parsed), true);
	assert.equal(parsed.default_on.notice_pending, false);
	assert.equal(mod.agentMessagesOnboardingContext(parsed, "account-a"), null);
});

test("contract: absent default_on fields parse and behave as today; default_on consented_via parses in responses", () => {
	const v1 = mod.agentMessagesStatusSchema.parse(statusFixture);
	assert.equal(v1.default_on, undefined);
	assert.equal(mod.agentMessagesDefaultOnInForce(v1), false);
	const malformed = mod.agentMessagesStatusSchema.parse({
		...statusFixture,
		default_on: "yes",
	});
	assert.equal(
		malformed.default_on,
		undefined,
		"a malformed block degrades, never fails the status read",
	);
	const settings = mod.agentMessagesSettingsResultSchema.parse(settingsWith());
	assert.equal(settings.endpoint.consent.consented_via, "default_on");
	assert.equal(settings.default_on, true);
	const legacy = mod.agentMessagesSettingsResultSchema.parse(settingsFixture);
	assert.equal(legacy.default_on, undefined);
});

test("contract: the onboarding dialog has no context while default-on is in force, and still has one for a v1 hub", () => {
	const b = statusWith({
		surface: "B",
		defaultOn: { in_force: true, notice_pending: false },
	});
	assert.equal(mod.agentMessagesOnboardingContext(b, "account-a"), null);
	assert.deepEqual(
		mod.agentMessagesOnboardingContext(
			structuredClone(statusFixture),
			"account-a",
		),
		{
			accountId: "account-a",
			tenantId: "tenant-home",
		},
	);
	const notInForce = statusWith({
		surface: "B",
		defaultOn: { in_force: false, notice_pending: false },
	});
	assert.ok(mod.agentMessagesOnboardingContext(notInForce, "account-a"));
});

test("routes: dismiss is a bare POST; settings.put refuses default_on as a consent claim", () => {
	assert.deepEqual(
		mod.desktopEndpoint({ op: "agent_messages.onboarding.dismiss" }),
		{
			path: "/v1/desktop/team-bridge/onboarding/dismiss",
			method: "POST",
		},
	);
	const source = readFileSync("src/shared/desktop-contract.ts", "utf8");
	assert.match(
		source,
		/consented_via: z\.enum\(\["dialog", "settings"\]\)\.optional\(\)/,
	);
	assert.doesNotMatch(source, /consented_via: z\.enum\(\[[^\]]*default_on/);
});
