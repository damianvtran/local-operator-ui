/**
 * Settings -> Agent messages: the renderer behaviours RFC §5.6 requires.
 *
 * Real component over a fake desktop API (the wire itself is exercised by the
 * native QA lane). jsdom has no layout, so nothing here claims geometry; the
 * assertions are state, copy and the EXACT request bodies the section sends.
 */
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
const API_MODULE = /agent-messages-api$/;
const ALL_MODULES = /.*/;
const REACT_MODULE = /^(react|react-dom)(\/.*)?$/;

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
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout engine; Radix's typeahead/scroll paths only need the
// methods to exist. Nothing here asserts geometry.
window.Element.prototype.scrollIntoView = () => {};
window.Element.prototype.hasPointerCapture = () => false;
window.Element.prototype.setPointerCapture = () => {};
window.Element.prototype.releasePointerCapture = () => {};
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const bundled = await build({
	stdin: {
		contents:
			'export {AgentMessagesSettings} from "./src/renderer/src/features/agent-messages/agent-messages-settings"; export {desktopEndpoint} from "./src/shared/desktop-contract"; export {agentMessagesSettingsAvailability,agentMessagesSettingsState,agentMessagesSectionMounted,allowlistReplaceSet,allowlistSaveGate,allowlistDraft,allowlistIdentifierError,settingsRefusalSentence,agentMessagesChiefOfStaffHold} from "./src/renderer/src/features/agent-messages/agent-messages-settings-model"; export {agentMessagesSettingsResultSchema,agentMessagesAllowlistResultSchema,agentMessagesStatusSchema} from "./src/shared/agent-messages-contract"; export {DesktopControlError} from "./src/renderer/src/shared/api/local-operator/desktop-api"; export {agentMessagesRefusal} from "./src/renderer/src/features/agent-messages/agent-messages-refusal";',
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
			name: "isolated-settings-dependencies",
			setup(builder) {
				// The transport and the global status model are the app shell's;
				// this test drives the section's props and its API calls directly.
				builder.onResolve({ filter: HOOK_MODULE }, () => ({
					path: "hook",
					namespace: "fixture",
				}));
				builder.onResolve({ filter: API_MODULE }, () => ({
					path: "api",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: ALL_MODULES, namespace: "fixture" }, () => ({
					contents:
						"export const agentMessagesApi = {}; export const useAgentMessages = () => window.__agentMessagesState; export const checkAgentMessagesSurface = () => {};",
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
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(`${bundled.outputFiles[0].text}\n//# sourceURL=agent-messages-settings-fixture.mjs`).toString("base64")}`
);

const statusFixture = JSON.parse(
	readFileSync("scripts/fixtures/agent-messages-status.json", "utf8"),
);
const settingsFixture = JSON.parse(
	readFileSync("scripts/fixtures/agent-messages-settings.json", "utf8"),
);
const allowlistFixture = JSON.parse(
	readFileSync("scripts/fixtures/agent-messages-allowlist.json", "utf8"),
);
const CONSENT_TEXT = statusFixture.consent.text;

after(() => {
	dom.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

function statusWith(patch = {}) {
	const { local, ...rest } = patch;
	return {
		...structuredClone(statusFixture),
		...rest,
		local: { ...statusFixture.local, ...(local ?? {}) },
	};
}

function settingsWith(state) {
	const base = structuredClone(settingsFixture);
	if (state === null) {
		return {
			endpoint: null,
			settings: {
				tenant_id: "tnt_bridge_e2e",
				eligible: true,
				consent_version: "bridge_consent_v1",
				consent_required: true,
			},
		};
	}
	base.endpoint.state = state;
	base.settings.consent_required = state === "disabled";
	return base;
}

function makeApi({ settings, allowlist = allowlistFixture, overrides = {} }) {
	const writes = { settings: [], allowlist: [], local: [], refresh: 0 };
	const api = {
		settings: async () => structuredClone(settings),
		updateSettings: async (body) => {
			writes.settings.push(body);
			if (!settings.endpoint) return structuredClone(settingsFixture);
			return {
				...structuredClone(settings),
				endpoint: { ...settings.endpoint, state: body.state },
			};
		},
		allowlist: async () => (allowlist ? structuredClone(allowlist) : null),
		updateAllowlist: async (body) => {
			writes.allowlist.push(body);
			return structuredClone(allowlist);
		},
		localSetting: async (key, value) => {
			writes.local.push({ key, value });
			return {};
		},
		...overrides,
	};
	return { api, writes };
}

const flush = async () => {
	await act(async () => {
		await new Promise((done) => setTimeout(done, 0));
	});
};

async function mount(t, options = {}) {
	const {
		availability = "visible",
		status = statusWith({ surface_state: "C", local: { enabled: true } }),
		accountId = "account-a",
		settings = settingsWith("active"),
		allowlist = allowlistFixture,
		overrides = {},
		api: suppliedApi = null,
		sessions = [
			{ session_id: "aaaaaaaaaaaa", title: "Research" },
			{ session_id: "bbbbbbbbbbbb", title: "Triage" },
		],
		onOpenSession,
	} = options;
	window.__agentMessagesState = { accountId, snapshot: { status } };
	const built = suppliedApi
		? {
				api: suppliedApi,
				writes: { settings: [], allowlist: [], local: [], refresh: 0 },
			}
		: makeApi({ settings, allowlist, overrides });
	const { api, writes } = built;
	const refresh = () => {
		writes.refresh += 1;
		return Promise.resolve();
	};
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	t.after(async () => {
		await act(async () => root.unmount());
		container.remove();
	});
	const props = (next = {}) => ({
		availability: next.availability ?? availability,
		status: next.status ?? status,
		accountId: next.accountId ?? accountId,
		refusal: null,
		api: next.api ?? api,
		onRefreshStatus: refresh,
		sessions,
		onOpenSession,
	});
	await act(async () =>
		root.render(React.createElement(mod.AgentMessagesSettings, props())),
	);
	await flush();
	await flush();
	const rerender = async (next = {}) => {
		await act(async () =>
			root.render(React.createElement(mod.AgentMessagesSettings, props(next))),
		);
		await flush();
		await flush();
	};
	return { api, writes, container, root, rerender };
}

const button = (label, scope = document) =>
	[...scope.querySelectorAll("button")].find(
		(entry) => entry.textContent.trim() === label,
	);

const press = async (target, type = "click", options = {}) => {
	assert.ok(target, `expected a ${type} target`);
	await act(async () =>
		target.dispatchEvent(
			type.startsWith("key")
				? new window.KeyboardEvent(type, { bubbles: true, ...options })
				: new window.MouseEvent(type, { bubbles: true, ...options }),
		),
	);
};

const setInput = async (input, value) => {
	assert.ok(input, "expected an input");
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	).set;
	await act(async () => {
		setter.call(input, value);
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
};

const directionGroup = (legend) =>
	[...document.querySelectorAll("fieldset")].find(
		(group) => group.querySelector(":scope > legend")?.textContent === legend,
	);

// ---------------------------------------------------------------------------
// Visibility (the matrix, RFC §5.6)
// ---------------------------------------------------------------------------

test("visibility is absent for A, signed out, update-required, stale capability and never-observed", () => {
	const A = statusWith({
		surface_state: "A",
		visibility: {
			settings: false,
			inbox: false,
			account_door: false,
			onboarding: false,
		},
	});
	assert.equal(
		mod.agentMessagesSettingsAvailability({
			status: A,
			refused: false,
			everVisible: false,
		}),
		"absent",
	);
	assert.equal(
		mod.agentMessagesSettingsAvailability({
			status: statusWith({ state: "signed_out", surface_state: null }),
			refused: false,
			everVisible: true,
		}),
		"absent",
	);
	assert.equal(
		mod.agentMessagesSettingsAvailability({
			status: statusWith({ update_required: true }),
			refused: false,
			everVisible: true,
		}),
		"absent",
	);
	assert.equal(
		mod.agentMessagesSettingsAvailability({
			status: statusWith({ capability: 0 }),
			refused: false,
			everVisible: true,
		}),
		"absent",
	);
	assert.equal(
		mod.agentMessagesSettingsAvailability({
			status: null,
			refused: false,
			everVisible: false,
		}),
		"absent",
	);
});

test("visibility is visible for B and C, dark for the launch state, error only after a failed read of a visible section", () => {
	assert.equal(
		mod.agentMessagesSettingsAvailability({
			status: statusWith({ surface_state: "B" }),
			refused: false,
			everVisible: false,
		}),
		"visible",
	);
	assert.equal(
		mod.agentMessagesSettingsAvailability({
			status: statusWith({ surface_state: "C" }),
			refused: false,
			everVisible: false,
		}),
		"visible",
	);
	assert.equal(
		mod.agentMessagesSettingsAvailability({
			status: statusWith({
				state: "unavailable",
				surface_state: null,
				error: { code: "messaging_unavailable", message: "dark" },
			}),
			refused: false,
			everVisible: false,
		}),
		"dark",
	);
	// `unavailable` is ALSO the transport/destination failure shape. Only the
	// launch code may render the dark panel; an outage is an error once the
	// section was observable, and absent before that.
	for (const code of [
		"bridge_unreachable",
		"bridge_destination_refused",
		"bridge_signin_required",
	]) {
		const outage = statusWith({
			state: "unavailable",
			surface_state: null,
			error: { code, message: "outage" },
		});
		assert.equal(
			mod.agentMessagesSettingsAvailability({
				status: outage,
				refused: false,
				everVisible: false,
			}),
			"absent",
			`${code} before the section was ever visible`,
		);
		assert.equal(
			mod.agentMessagesSettingsAvailability({
				status: outage,
				refused: false,
				everVisible: true,
			}),
			"error",
			`${code} after the section was visible`,
		);
	}
	assert.equal(
		mod.agentMessagesSettingsAvailability({
			status: statusWith({
				surface_state: "G",
				error: { code: "messaging_unavailable", message: "dark" },
			}),
			refused: false,
			everVisible: false,
		}),
		"dark",
	);
	assert.equal(
		mod.agentMessagesSettingsAvailability({
			status: null,
			refused: true,
			everVisible: true,
		}),
		"error",
	);
	assert.equal(
		mod.agentMessagesSettingsAvailability({
			status: null,
			refused: true,
			everVisible: false,
		}),
		"absent",
	);
	assert.equal(
		mod.agentMessagesSettingsAvailability({
			status: null,
			refused: false,
			everVisible: true,
			checking: true,
		}),
		"visible",
	);
});

test("a transport outage never renders as the dark-launch panel", async (t) => {
	const outage = statusWith({
		state: "unavailable",
		surface_state: null,
		error: {
			code: "bridge_unreachable",
			message: "The hub could not be reached.",
		},
	});
	const availability = mod.agentMessagesSettingsAvailability({
		status: outage,
		refused: false,
		everVisible: true,
	});
	assert.equal(availability, "error");
	await mount(t, { availability, status: outage });
	assert.doesNotMatch(document.body.textContent, /Not available yet/);
	assert.doesNotMatch(
		document.body.textContent,
		/Nothing is enabled on this machine/,
	);
	assert.match(document.body.textContent, /Could not load agent messages/);
});

test("the dark launch renders a neutral panel with no control that pretends to work", async (t) => {
	await mount(t, {
		availability: "dark",
		status: statusWith({ surface_state: "G" }),
	});
	assert.match(document.body.textContent, /Not available yet/);
	assert.match(
		document.body.textContent,
		/Agent messages are not available yet\./,
	);
	assert.match(
		document.body.textContent,
		/Nothing is enabled on this machine\./,
	);
	assert.equal(document.querySelectorAll("button").length, 0);
	assert.equal(document.querySelectorAll('[role="switch"]').length, 0);
	assert.equal(document.querySelectorAll("select").length, 0);
	assert.equal(document.querySelectorAll('[role="alert"]').length, 0);
});

// ---------------------------------------------------------------------------
// Enable / resume / pause / turn off
// ---------------------------------------------------------------------------

test("B shows the served consent text byte-equal, and Enable sends the exact version, surface and account", async (t) => {
	const { writes } = await mount(t, {
		status: statusWith({ surface_state: "B", local: { enabled: false } }),
		settings: settingsWith(null),
	});
	const consentBlock = [...document.querySelectorAll("p")].find(
		(entry) => entry.textContent === CONSENT_TEXT,
	);
	assert.ok(consentBlock, "the served consent text is rendered exactly");
	assert.match(document.body.textContent, /Off by default\./);

	await press(button("Enable"));
	await flush();
	assert.deepEqual(writes.settings, [
		{
			expected_account_id: "account-a",
			tenant_id: "tnt_bridge_e2e",
			state: "active",
			consent_version: "bridge_consent_v1",
			consented_via: "settings",
		},
	]);
	assert.deepEqual(writes.local, [{ key: "team_bridge.enabled", value: true }]);
	assert.ok(writes.refresh >= 1, "the status is refreshed after local enable");
	// B -> C creates the endpoint, so the reach editor must now load its policy
	// without a remount (the first read legitimately had no allowlist).
	await flush();
	assert.equal(
		document
			.querySelector("[data-agent-messages-state]")
			?.getAttribute("data-agent-messages-state"),
		"C",
	);
	assert.ok(
		document.querySelector("[data-agent-messages-allowlist]"),
		"the reach editor mounted after the endpoint was created",
	);
});

test("B disables Enable when consent is unavailable", async (t) => {
	await mount(t, {
		status: statusWith({ surface_state: "B", consent: null }),
		settings: settingsWith(null),
	});
	assert.equal(button("Enable").disabled, true);
	assert.match(
		document.body.textContent,
		/Consent is unavailable\. Agent messages have not been enabled\./,
	);
});

test("E requires the consent echo; D resumes without one", async (t) => {
	const optedOut = await mount(t, {
		status: statusWith({ surface_state: "E", local: { enabled: false } }),
		settings: settingsWith("disabled"),
	});
	await press(button("Enable again"));
	await flush();
	assert.equal(optedOut.writes.settings[0].state, "active");
	assert.equal(
		optedOut.writes.settings[0].consent_version,
		"bridge_consent_v1",
	);
	assert.equal(optedOut.writes.settings[0].consented_via, "settings");

	const paused = await mount(t, {
		status: statusWith({ surface_state: "D", local: { enabled: true } }),
		settings: settingsWith("paused"),
	});
	await press(button("Resume"));
	await flush();
	assert.deepEqual(paused.writes.settings[0], {
		expected_account_id: "account-a",
		tenant_id: "tnt_bridge_e2e",
		state: "active",
	});
});

test("C pauses and turns off as state-only writes", async (t) => {
	const { writes } = await mount(t);
	await press(button("Pause"));
	await flush();
	assert.deepEqual(writes.settings[0], {
		expected_account_id: "account-a",
		tenant_id: "tnt_bridge_e2e",
		state: "paused",
	});
	// Pause is "not now": the machine-local preference is untouched.
	assert.deepEqual(writes.local, []);
	await press(button("Turn off"));
	await flush();
	assert.deepEqual(writes.settings[1], {
		expected_account_id: "account-a",
		tenant_id: "tnt_bridge_e2e",
		state: "disabled",
	});
	// Opting out IS off: the machine-local enable follows the endpoint.
	assert.deepEqual(writes.local, [
		{ key: "team_bridge.enabled", value: false },
	]);
});

test("C shows the consent record and the local switch stays a local preference", async (t) => {
	const { writes } = await mount(t, {
		status: statusWith({
			surface_state: "C",
			local: { enabled: true, session: "aaaaaaaaaaaa" },
		}),
	});
	assert.match(document.body.textContent, /bridge_consent_v1/);
	assert.match(document.body.textContent, /Settings/);
	assert.match(document.body.textContent, /2026-10-18/);
	assert.match(document.body.textContent, /Read the consent text/);
	const consentText = [...document.querySelectorAll("p")].find(
		(entry) => entry.textContent === CONSENT_TEXT,
	);
	assert.ok(consentText, "the expander carries the exact served text");

	const toggle = document.querySelector('[role="switch"]');
	assert.ok(toggle);
	await press(toggle);
	await flush();
	assert.deepEqual(writes.local[0], {
		key: "team_bridge.enabled",
		value: false,
	});
	assert.match(
		document.body.textContent,
		/Your enrollment stays active for this account and your other machines\./,
	);
});

test("F is a neutral organization line with no server resume action", async (t) => {
	const { writes } = await mount(t, {
		status: statusWith({
			surface_state: "F",
			state_note: "Your organization turned agent messages off.",
			local: { enabled: true },
		}),
	});
	assert.match(
		document.body.textContent,
		/Your organization turned agent messages off\./,
	);
	assert.match(document.body.textContent, /Turned off by your organization/);
	assert.equal(button("Resume"), undefined);
	assert.equal(button("Enable again"), undefined);
	assert.equal(button("Pause"), undefined);
	assert.ok(document.querySelector('[role="switch"]'));
	assert.deepEqual(writes.settings, []);
});

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

test("choosing listed-only blocks Save until an entry exists, then saves the complete replace-set", async (t) => {
	const { writes } = await mount(t);
	const receive = directionGroup("Who can message you");
	assert.ok(receive, "the receive direction renders");
	const only = [...receive.querySelectorAll("button")].find(
		(entry) => entry.textContent === "Only agents I choose",
	);
	await press(only);
	await flush();
	const save = button("Save reach settings");
	assert.equal(save.disabled, true);
	assert.match(
		document.body.textContent,
		/Add at least one agent or person, or choose Anyone in my organization\./,
	);

	const addForm = [...receive.querySelectorAll("label")].find(
		(label) => label.textContent === "Allow an agent or person",
	);
	assert.ok(addForm);
	const input = document.getElementById(addForm.htmlFor);
	await setInput(input, "bep_receive_allow");
	const addButton = [...addForm.parentElement.querySelectorAll("button")].find(
		(entry) => entry.textContent === "Add",
	);
	await press(addButton);
	await flush();
	assert.equal(button("Save reach settings").disabled, false);

	await press(button("Save reach settings"));
	await flush();
	assert.equal(writes.allowlist.length, 1);
	assert.deepEqual(writes.allowlist[0], {
		expected_account_id: "account-a",
		tenant_id: "tnt_bridge_e2e",
		entries: [
			{
				direction: "receive",
				effect: "allow",
				target: { endpoint_id: "bep_receive_allow" },
			},
			{
				direction: "receive",
				effect: "deny",
				target: { account_id: "account-blocked" },
			},
			{
				direction: "send",
				effect: "allow",
				target: { endpoint_id: "bep_peer_send" },
			},
		],
	});
});

test("a class-default direction keeps only its deny rows when the policy is saved", () => {
	assert.deepEqual(
		mod.allowlistReplaceSet(
			[
				{
					key: "1",
					direction: "receive",
					effect: "allow",
					kind: "endpoint",
					id: "bep_r",
				},
				{
					key: "2",
					direction: "receive",
					effect: "deny",
					kind: "account",
					id: "account-b",
				},
			],
			{ send: "class_default", receive: "class_default" },
		),
		[
			{
				direction: "receive",
				effect: "deny",
				target: { account_id: "account-b" },
			},
		],
	);
});

test("a listed-only direction with no allow entry refuses Save even when another direction has entries", () => {
	const entries = mod.allowlistDraft(allowlistFixture.allowlist.entries);
	assert.deepEqual(
		mod.allowlistSaveGate({
			entries,
			modes: { send: "listed_only", receive: "listed_only" },
			savedSignature: allowlistSignature(entries, {
				send: "listed_only",
				receive: "listed_only",
			}),
			saving: false,
		}),
		{ disabled: true, reason: "needs_entry" },
	);
});

function allowlistSignature(entries, modes) {
	return JSON.stringify(mod.allowlistReplaceSet(entries, modes));
}

test("identifier validation refuses empty, overlong, whitespace and control values", () => {
	for (const value of ["", " ", "a b", "a\nb", "x".repeat(129), "tab\there"]) {
		assert.ok(
			mod.allowlistIdentifierError(value),
			`${JSON.stringify(value)} must be refused`,
		);
	}
	for (const value of ["bep_example", "account-a", "x".repeat(128)]) {
		assert.equal(mod.allowlistIdentifierError(value), null);
	}
});

test("the CoS designation is saved immediately from the real session list", async (t) => {
	const { writes } = await mount(t, {
		status: statusWith({
			surface_state: "C",
			local: { enabled: true, session: "aaaaaaaaaaaa" },
		}),
	});
	const combo = document.querySelector('button[role="combobox"]');
	assert.ok(combo, "expected the session designation select");
	combo.focus();
	await press(combo, "keydown", { key: "ArrowDown" });
	await flush();
	const option = [...document.querySelectorAll('[role="option"]')].find(
		(entry) => entry.textContent.trim() === "Triage",
	);
	assert.ok(option, "the canonical store's title must be a selectable option");
	await act(async () => option.click());
	await flush();
	assert.deepEqual(writes.local, [
		{ key: "team_bridge.session", value: "bbbbbbbbbbbb" },
	]);
});

test("the four desktop ops build the settings and allowlist routes", () => {
	assert.deepEqual(
		mod.desktopEndpoint({
			op: "agent_messages.settings",
			tenant_id: "tnt_bridge_e2e",
		}),
		{
			path: "/v1/desktop/team-bridge/settings?tenant_id=tnt_bridge_e2e",
			method: "GET",
		},
	);
	assert.deepEqual(
		mod.desktopEndpoint({
			op: "agent_messages.settings.put",
			expected_account_id: "account-a",
			state: "paused",
		}),
		{
			path: "/v1/desktop/team-bridge/settings",
			method: "PUT",
			body: { expected_account_id: "account-a", state: "paused" },
		},
	);
	assert.deepEqual(
		mod.desktopEndpoint({
			op: "agent_messages.allowlist.get",
		}),
		{ path: "/v1/desktop/team-bridge/allowlist", method: "GET" },
	);
	assert.deepEqual(
		mod.desktopEndpoint({
			op: "agent_messages.allowlist.put",
			expected_account_id: "account-a",
			entries: [
				{
					direction: "send",
					effect: "allow",
					target: { endpoint_id: "bep_peer" },
				},
			],
		}),
		{
			path: "/v1/desktop/team-bridge/allowlist",
			method: "PUT",
			body: {
				expected_account_id: "account-a",
				entries: [
					{
						direction: "send",
						effect: "allow",
						target: { endpoint_id: "bep_peer" },
					},
				],
			},
		},
	);
});

// ---------------------------------------------------------------------------
// Load failures
// ---------------------------------------------------------------------------

test("the settings fixture is the served shape, with no endpoint account id", () => {
	// The upstream BridgeEndpointResponse has no account_id; requiring one made
	// every enrolled account read as unreadable (round-1 R1).
	assert.equal("account_id" in settingsFixture.endpoint, false);
	const parsed =
		mod.agentMessagesSettingsResultSchema.safeParse(settingsFixture);
	assert.equal(
		parsed.success,
		true,
		JSON.stringify(parsed.error?.issues ?? []),
	);
	assert.equal(parsed.data.endpoint?.tenant_id, "tnt_bridge_e2e");
});

test("an allowlist target whose kind disagrees with its id is refused", () => {
	const good = structuredClone(allowlistFixture);
	assert.equal(
		mod.agentMessagesAllowlistResultSchema.safeParse(good).success,
		true,
	);
	const bad = structuredClone(allowlistFixture);
	bad.allowlist.entries[0].target = {
		kind: "account",
		endpoint_id: "bep_x",
	};
	bad.view.entries = structuredClone(bad.allowlist.entries);
	assert.equal(
		mod.agentMessagesAllowlistResultSchema.safeParse(bad).success,
		false,
	);
});

test("A, signed-out and update-required mount no section at all", () => {
	const cases = [
		statusWith({
			surface_state: "A",
			visibility: {
				settings: false,
				inbox: false,
				account_door: false,
				onboarding: false,
			},
		}),
		statusWith({ state: "signed_out" }),
		statusWith({ update_required: true }),
	];
	for (const status of cases) {
		const availability = mod.agentMessagesSettingsAvailability({
			status,
			refused: false,
			everVisible: true,
		});
		assert.equal(availability, "absent", JSON.stringify(status.state));
		assert.equal(
			mod.agentMessagesSectionMounted(availability, status),
			false,
			JSON.stringify(status.state),
		);
	}
	const b = statusWith({ surface_state: "B" });
	const c = statusWith({ surface_state: "C" });
	for (const status of [b, c]) {
		const availability = mod.agentMessagesSettingsAvailability({
			status,
			refused: false,
			everVisible: false,
		});
		assert.equal(mod.agentMessagesSectionMounted(availability, status), true);
	}
	// Retry/account-switch in flight: visible, no held status. The shell (and a
	// retry Alert when one is outstanding) must stay mounted (R2-2).
	assert.equal(mod.agentMessagesSectionMounted("visible", null), true);
	assert.equal(mod.agentMessagesSectionMounted("error", null), true);
	assert.equal(mod.agentMessagesSectionMounted("absent", null), false);
});

test("an account switch reloads settings instead of keeping the previous account's state", async (t) => {
	const active = settingsWith("active");
	const paused = settingsWith("paused");
	let calls = 0;
	const stable = makeApi({ settings: active });
	/*
	 * ONE stable api, so the only thing that can re-run the load is the account
	 * change. The pre-fix deps `[visible, tenantId, reloadKey, api]` would see
	 * the same api and tenant and never call this stub a second time.
	 */
	const api = {
		...stable.api,
		settings: async () => {
			calls += 1;
			return structuredClone(calls === 1 ? active : paused);
		},
	};
	const mounted = await mount(t, { api });
	assert.equal(calls, 1);
	assert.equal(
		document
			.querySelector("[data-agent-messages-state]")
			?.getAttribute("data-agent-messages-state"),
		"C",
	);

	await mounted.rerender({
		status: statusWith({
			account_id: "account-b",
			surface_state: "C",
			local: { enabled: true },
		}),
		accountId: "account-b",
	});
	assert.equal(calls, 2, "the account change must re-read settings");
	assert.equal(
		document
			.querySelector("[data-agent-messages-state]")
			?.getAttribute("data-agent-messages-state"),
		"D",
		"the previous account's C must not survive the switch",
	);
});

test("a status from another account refuses writes", async (t) => {
	// The loaded status says account-a while the live account is account-b.
	const { writes } = await mount(t, { accountId: "account-b" });
	const pause = button("Pause");
	assert.ok(pause);
	assert.equal(pause.disabled, true);
	await press(pause);
	await flush();
	assert.deepEqual(writes.settings, []);
	assert.deepEqual(writes.local, []);
});

test("D disables Resume when consent is required but unavailable", async (t) => {
	const paused = settingsWith("paused");
	paused.settings.consent_required = true;
	await mount(t, {
		status: statusWith({
			surface_state: "D",
			consent: null,
			local: { enabled: true },
		}),
		settings: paused,
	});
	assert.equal(button("Resume").disabled, true);
	assert.match(
		document.body.textContent,
		/Consent is unavailable\. Agent messages have not been enabled\./,
	);
});

test("F with read_only gates the reach editor and says why", async (t) => {
	await mount(t, {
		status: statusWith({
			surface_state: "F",
			read_only: true,
			local: { enabled: true },
		}),
	});
	assert.match(
		document.body.textContent,
		/Reach settings are read-only while agent messages are turned off\./,
	);
	assert.equal(button("Save reach settings").disabled, true);
	const receive = directionGroup("Who can message you");
	assert.ok(receive);
	for (const level of receive.querySelectorAll("button[aria-pressed]"))
		assert.equal(level.disabled, true);
});

test("each Remove control names its target", async (t) => {
	await mount(t);
	const remove = document.querySelector(
		'button[aria-label="Remove bep_peer_send"]',
	);
	assert.ok(remove, "the allow row's Remove names its endpoint");
});

test("a failed settings read renders the mapped refusal sentence, not the exception", async (t) => {
	await mount(t, {
		overrides: {
			settings: async () => {
				throw new Error("offline");
			},
		},
	});
	assert.match(document.body.textContent, /Could not load agent messages/);
	assert.match(
		document.body.textContent,
		/No settings were changed\. Try again to check the current status\./,
	);
	assert.doesNotMatch(document.body.textContent, /offline/);
	assert.ok(button("Retry"));
	// The mapper itself, without a component: a non-transport failure is the
	// whitelisted sentence this app authored, never the exception's text.
	const mapped = mod.agentMessagesRefusal(new Error("secret detail"));
	assert.equal(mapped.code, "client_unavailable");
	assert.doesNotMatch(mapped.message, /secret detail/);
});

test("an unreadable settings response keeps its own sentence beside the reassurance", async (t) => {
	// R3-1: a parse failure is NOT the transport fallback. The invalid_response
	// sentence stays; only the client-unavailable/dialog copy is suppressed.
	await mount(t, { overrides: { settings: async () => null } });
	assert.match(
		document.body.textContent,
		/This machine returned a settings response the app could not read\./,
	);
	assert.match(
		document.body.textContent,
		/No settings were changed\. Try again to check the current status\./,
	);
	assert.doesNotMatch(document.body.textContent, /could not be enabled/);
	assert.ok(button("Retry"));
});

test("a failed write renders the refusal sentence, never the raw exception", async (t) => {
	await mount(t, {
		overrides: {
			updateSettings: async () => {
				// The real transport class: the mapper reads its `code`, which a
				// plain Error carrying a property would not reach.
				throw new mod.DesktopControlError(
					403,
					"raw upstream detail",
					undefined,
					"bridge_disabled",
				);
			},
		},
	});
	await press(button("Pause"));
	await flush();
	assert.match(
		document.body.textContent,
		/Your organization has turned off agent messages\./,
	);
	assert.doesNotMatch(document.body.textContent, /raw upstream detail/);
	assert.doesNotMatch(document.body.textContent, /DesktopControlError/);
	assert.equal(
		mod.settingsRefusalSentence({
			code: "bridge_signin_required",
			message: "x",
		}),
		"Sign in to Radient to manage agent messages.",
	);
});

// ---------------------------------------------------------------------------
// The chief-of-staff delivery hold (runtime #2777, F8)
// ---------------------------------------------------------------------------

const HOLD_SESSION = "aaaaaaaaaaaa";
const holdNotice = () =>
	document.querySelector('[data-agent-messages-hold="open_chief_of_staff"]');
const holdStatus = (delivery_hold) =>
	statusWith({
		surface_state: "C",
		local: { enabled: true, session: HOLD_SESSION },
		delivery_hold,
	});

test("the status schema accepts delivery_hold present, null or absent, and degrades a malformed one", () => {
	const absent = mod.agentMessagesStatusSchema.parse(statusFixture);
	assert.equal(absent.delivery_hold, undefined, "an older runtime omits it");
	assert.equal(
		mod.agentMessagesStatusSchema.parse({
			...statusFixture,
			delivery_hold: null,
		}).delivery_hold,
		null,
	);
	const present = mod.agentMessagesStatusSchema.parse({
		...statusFixture,
		delivery_hold: {
			code: "open_chief_of_staff",
			count: 2,
			session: HOLD_SESSION,
		},
	});
	assert.deepEqual(present.delivery_hold, {
		code: "open_chief_of_staff",
		count: 2,
		session: HOLD_SESSION,
	});
	/* A bad hint must not fail the status read that gates the whole surface. */
	const malformed = mod.agentMessagesStatusSchema.parse({
		...statusFixture,
		delivery_hold: { code: "open_chief_of_staff", count: "two" },
	});
	assert.equal(malformed.delivery_hold, null);
	assert.equal(malformed.account_id, statusFixture.account_id);
});

test("the hold model answers only for open_chief_of_staff with a positive count", () => {
	const hold = (delivery_hold, session = HOLD_SESSION) =>
		mod.agentMessagesChiefOfStaffHold(
			statusWith({ local: { session }, delivery_hold }),
		);
	assert.equal(mod.agentMessagesChiefOfStaffHold(null), null);
	assert.equal(hold(undefined), null);
	assert.equal(hold(null), null);
	assert.equal(hold({ code: "open_chief_of_staff", count: 0 }), null);
	assert.equal(hold({ code: "some_future_hold", count: 3 }), null);
	assert.deepEqual(
		hold({ code: "open_chief_of_staff", count: 3, session: "runtime-cos" }),
		{ count: 3, sessionId: "runtime-cos" },
		"the runtime's designation wins",
	);
	assert.deepEqual(hold({ code: "open_chief_of_staff", count: 1 }), {
		count: 1,
		sessionId: HOLD_SESSION,
	});
	assert.deepEqual(hold({ code: "open_chief_of_staff", count: 1 }, ""), {
		count: 1,
		sessionId: null,
	});
});

test("the hold notice renders singular copy at count 1 and opens the chief of staff", async (t) => {
	const opened = [];
	await mount(t, {
		status: holdStatus({
			code: "open_chief_of_staff",
			count: 1,
			session: HOLD_SESSION,
		}),
		onOpenSession: (id) => opened.push(id),
	});
	const notice = holdNotice();
	assert.ok(notice, "the notice renders");
	assert.match(
		notice.textContent,
		/^1 message is waiting for your chief of staff\. Send one message in that conversation to receive it\./,
	);
	await press(button("Message chief of staff", notice));
	assert.deepEqual(opened, [HOLD_SESSION]);
});

test("the hold notice renders plural copy at count N", async (t) => {
	await mount(t, {
		status: holdStatus({
			code: "open_chief_of_staff",
			count: 4,
			session: HOLD_SESSION,
		}),
		onOpenSession: () => {},
	});
	assert.match(
		holdNotice()?.textContent ?? "",
		/^4 messages are waiting for your chief of staff\. Send one message in that conversation to receive them\./,
	);
});

test("the hold notice is absent at count 0, for null and for an older runtime", async (t) => {
	for (const delivery_hold of [
		{ code: "open_chief_of_staff", count: 0, session: HOLD_SESSION },
		null,
		undefined,
	]) {
		const { root } = await mount(t, {
			status: holdStatus(delivery_hold),
			onOpenSession: () => {},
		});
		assert.ok(
			document.querySelector("[data-agent-messages-section]"),
			"the section itself still renders",
		);
		assert.equal(holdNotice(), null, JSON.stringify(delivery_hold));
		await act(async () => root.unmount());
	}
});

test("the hold notice offers no button when there is nothing to open", async (t) => {
	await mount(t, {
		status: statusWith({
			surface_state: "C",
			local: { enabled: true, session: "" },
			delivery_hold: { code: "open_chief_of_staff", count: 2, session: null },
		}),
		onOpenSession: () => {},
	});
	assert.ok(holdNotice());
	assert.equal(button("Message chief of staff", holdNotice()), undefined);
	/* Design D2: no button, so the sentence says where to go instead. */
	assert.match(
		holdNotice().textContent,
		/^2 messages are waiting for your chief of staff\. Find that conversation in the sidebar and send one message to receive them\./,
	);
});

test("a malformed hold session degrades only the target, never the count (R1-2)", () => {
	const parsed = mod.agentMessagesStatusSchema.parse({
		...statusFixture,
		delivery_hold: { code: "open_chief_of_staff", count: 2, session: "" },
	});
	assert.deepEqual(parsed.delivery_hold, {
		code: "open_chief_of_staff",
		count: 2,
		session: null,
	});
	const wrongType = mod.agentMessagesStatusSchema.parse({
		...statusFixture,
		delivery_hold: { code: "open_chief_of_staff", count: 2, session: 42 },
	});
	assert.equal(wrongType.delivery_hold?.count, 2);
	assert.equal(wrongType.delivery_hold?.session, null);
});

test("the hold button reads at full ink while staying a ghost button (design D3)", async (t) => {
	await mount(t, {
		status: holdStatus({
			code: "open_chief_of_staff",
			count: 1,
			session: HOLD_SESSION,
		}),
		onOpenSession: () => {},
	});
	const control = button("Message chief of staff", holdNotice());
	assert.ok(control);
	assert.match(control.className, /(^|\s)text-ink(\s|$)/);
	assert.doesNotMatch(control.className, /(^|\s)text-ink-muted(\s|$)/);
});

/*
 * R1-3: the section only knows `onOpenSession`; what makes the button real is
 * the page passing it, through the shared switch rule. A dropped prop is a
 * SUPPORTED state (no button, sidebar copy), so it would fail silently - pin
 * the wiring at its source, the same way session-switch.test.mjs pins the
 * entrances. The cache drop (QA follow-up) has to come before the switch, so
 * Settings' mount boundary on the way back reads the hold fresh.
 */
test("settings-page wires onOpenSession to openConversation after dropping the status cache", () => {
	const page = readFileSync(
		"src/renderer/src/features/settings/components/settings-page.tsx",
		"utf8",
	);
	assert.match(
		page,
		/import \{ openConversation \} from "@features\/chat\/open-conversation";/,
	);
	const wiring = page.match(
		/onOpenSession=\{\(sessionId\) => \{([\s\S]*?)\}\}/,
	);
	assert.ok(wiring, "AgentMessagesSettings receives onOpenSession");
	const body = wiring[1];
	const invalidate = body.indexOf("agentMessagesModel.invalidateStatus();");
	const open = body.indexOf("openConversation(navigate, sessionId)");
	assert.ok(invalidate >= 0, "the status cache is dropped");
	assert.ok(open > invalidate, "then the shared switch rule opens the session");
	assert.doesNotMatch(body, /\/chat\//, "no hand-built chat URL");
});
