import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { copyScanAgentMessages } from "./agent-messages-copy-scan.mjs";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/agent-messages/agent-messages-model"; export * from "./src/shared/agent-messages-contract"; export {desktopEndpoint,desktopRequestSchema} from "./src/shared/desktop-contract";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
});
const {
	AgentMessagesModel,
	agentMessagesStatusSchema,
	agentMessagesOnboardingContext,
	agentMessagesServedConsent,
	desktopEndpoint,
	desktopRequestSchema,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const PASSIVE_TIMER = /\bset(?:Timeout|Interval)\s*\(/;
const fixture = JSON.parse(
	readFileSync("scripts/fixtures/agent-messages-status.json", "utf8"),
);
const status = (patch = {}) => structuredClone({ ...fixture, ...patch });
const response = (account = "account-a", tenant = "tenant-home") => ({
	endpoint: {
		id: "bep-example",
		state: "active",
		account_id: account,
		tenant_id: tenant,
	},
});
const deferred = () => {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
};
function rig(overrides = {}) {
	const calls = { status: [], enable: [], local: [], seen: [] };
	let now = 0;
	const model = new AgentMessagesModel({
		status: async (boundary) => {
			calls.status.push(boundary);
			return status();
		},
		enable: async (body) => {
			calls.enable.push(body);
			return response();
		},
		localSetting: async (key, value) => {
			calls.local.push([key, value]);
		},
		markSeen: (account, tenant) => calls.seen.push([account, tenant]),
		describe: (error) => ({
			code: error.code ?? "failed",
			message: "Stable refusal sentence.",
			details: error.details,
		}),
		now: () => now,
		...overrides,
	});
	return {
		model,
		calls,
		advance: (ms) => {
			now += ms;
		},
	};
}

test("signed out fires no read; natural boundaries coalesce with a five-minute floor and no timer", async () => {
	const { model, calls, advance } = rig();
	await model.check("app_start");
	assert.equal(calls.status.length, 0);
	model.setAccount("account-a");
	await Promise.all([
		model.check("app_start"),
		model.check("sign_in"),
		model.check("surface_open"),
	]);
	assert.deepEqual(calls.status, ["app_start"]);
	advance(299999);
	await model.check("window_focus");
	assert.equal(calls.status.length, 1);
	advance(1);
	await model.check("window_focus");
	assert.deepEqual(calls.status, ["app_start", "window_focus"]);
	for (const path of ["agent-messages-model.ts", "use-agent-messages.ts"]) {
		assert.doesNotMatch(
			readFileSync(`src/renderer/src/features/agent-messages/${path}`, "utf8"),
			PASSIVE_TIMER,
		);
	}
});

test("only ready B mounts; unknown, no plan, dark, mismatched identity and unknown shapes are absent", () => {
	assert.ok(agentMessagesOnboardingContext(status(), "account-a"));
	for (const surface of ["A", "C", "D", "E", "F", "G", null])
		assert.equal(
			agentMessagesOnboardingContext(
				status({ surface_state: surface }),
				"account-a",
			),
			null,
		);
	for (const state of ["signed_out", "unavailable", "update_required"])
		assert.equal(
			agentMessagesOnboardingContext(status({ state }), "account-a"),
			null,
		);
	assert.equal(agentMessagesOnboardingContext(status(), "account-b"), null);
	assert.equal(
		agentMessagesOnboardingContext(status({ capability: 0 }), "account-a"),
		null,
	);
	assert.equal(agentMessagesOnboardingContext(null, "account-a"), null);
	assert.equal(
		agentMessagesStatusSchema.safeParse({ state: "perhaps" }).success,
		false,
	);
	assert.equal(
		agentMessagesStatusSchema.safeParse(status({ future: "additive" })).success,
		true,
	);
});

test("multi-org selection is consumed from backend, not any-org inference or UI sorting", () => {
	const other = {
		tenant_id: "tenant-lowest",
		tenant_name: "Other organization",
		eligible: true,
		endpoint: null,
	};
	const multi = status({
		status: { tenants: [other, fixture.status.tenants[0]] },
	});
	assert.equal(
		agentMessagesOnboardingContext(multi, "account-a").tenantId,
		"tenant-home",
	);
	assert.equal(
		agentMessagesOnboardingContext({ ...multi, tenant_id: null }, "account-a"),
		null,
	);
	const mixed = structuredClone(multi);
	mixed.status.tenants[1].eligible = false;
	assert.equal(agentMessagesOnboardingContext(mixed, "account-a"), null);
	mixed.status.tenants[1].eligible = true;
	mixed.status.tenants[1].endpoint = { id: "bep-old", state: "disabled" };
	assert.equal(agentMessagesOnboardingContext(mixed, "account-a"), null);
});

test("frozen H1 without account guard, absent consent and embedded fallback never enable", async () => {
	for (const patch of [
		{ consent_account_guard: undefined },
		{ consent_account_guard: false },
		{ consent: null },
		{ consent: { ...fixture.consent, source: "embedded" } },
	]) {
		const { model, calls } = rig({ status: async () => status(patch) });
		model.setAccount("account-a");
		await model.check("app_start");
		assert.equal(model.canEnable(model.consentIdentity()), false);
		await model.enable(
			{
				accountId: "account-a",
				tenantId: "tenant-home",
				consentVersion: fixture.consent.version,
			},
			null,
		);
		assert.equal(calls.enable.length, 0);
	}
	assert.equal(
		agentMessagesServedConsent(
			status({ consent: { ...fixture.consent, source: "cached" } }),
		).text,
		fixture.consent.text,
	);
	assert.equal(
		agentMessagesStatusSchema.safeParse(
			status({ consent: { ...fixture.consent, text: "é".repeat(1025) } }),
		).success,
		false,
	);
});

test("enable is exactly one explicit click with account/tenant/rendered version; pending is not enabled", async () => {
	const write = deferred();
	const { model, calls } = rig({
		enable: async (body) => {
			calls.enable.push(body);
			return write.promise;
		},
	});
	model.setAccount("account-a");
	await model.check("app_start");
	assert.equal(calls.enable.length, 0);
	const identity = model.consentIdentity();
	const pending = model.enable(identity, "abcdef123456");
	assert.equal(model.getSnapshot().pending, true);
	assert.equal(model.getSnapshot().confirmed, false);
	assert.deepEqual(calls.local, []);
	await model.enable(identity, "abcdef123456");
	model.dismiss("account-a", "tenant-home");
	assert.deepEqual(calls.seen, []);
	assert.deepEqual(calls.enable, [
		{
			expected_account_id: "account-a",
			tenant_id: "tenant-home",
			state: "active",
			consent_version: fixture.consent.version,
			consented_via: "dialog",
		},
	]);
	write.resolve(response());
	await pending;
	assert.deepEqual(calls.local, [
		["team_bridge.session", "abcdef123456"],
		["team_bridge.enabled", true],
	]);
	assert.deepEqual(calls.seen, [["account-a", "tenant-home"]]);
});

test("off-chat or draft completion explicitly clears designation before machine enable", async () => {
	for (const session of [null, "draft:abcdef123456", "not-a-session"]) {
		const { model, calls } = rig();
		model.setAccount("account-a");
		await model.check("app_start");
		await model.enable(model.consentIdentity(), session);
		assert.deepEqual(calls.local, [
			["team_bridge.session", ""],
			["team_bridge.enabled", true],
		]);
	}
});

test("409 refreshes/re-renders but NEVER silently retries; only a new click can send the new version", async () => {
	let fetched = 0;
	let attempts = 0;
	const { model, calls } = rig({
		status: async () =>
			status({
				consent: {
					...fixture.consent,
					version: ++fetched === 1 ? "bridge_consent_v1" : "bridge_consent_v2",
					text:
						fetched === 1
							? fixture.consent.text
							: `${fixture.consent.text} Updated disclosure.`,
				},
			}),
		enable: async (body) => {
			calls.enable.push(body);
			if (++attempts === 1) throw { code: "consent_version_unknown" };
			return response();
		},
	});
	model.setAccount("account-a");
	await model.check("app_start");
	const old = model.consentIdentity();
	await model.enable(old, null);
	assert.equal(fetched, 2);
	assert.equal(attempts, 1);
	assert.deepEqual(calls.local, []);
	assert.equal(model.getSnapshot().status.consent.version, "bridge_consent_v2");
	assert.equal(model.getSnapshot().refusal.code, "consent_version_unknown");
	await model.enable(old, null);
	assert.equal(attempts, 1);
	await model.enable(model.consentIdentity(), null);
	assert.equal(attempts, 2);
	assert.equal(calls.enable[1].consent_version, "bridge_consent_v2");
});

test("failed consent, wrong response identity, and failed local designation never optimistically enable", async () => {
	for (const write of [
		async () => {
			throw { code: "messaging_unavailable" };
		},
		async () => response("account-b"),
		async () => response("account-a", "other"),
	]) {
		const { model, calls } = rig({ enable: write });
		model.setAccount("account-a");
		await model.check("app_start");
		await model.enable(model.consentIdentity(), null);
		assert.equal(model.getSnapshot().confirmed, false);
		assert.deepEqual(calls.local, []);
		assert.deepEqual(calls.seen, []);
	}
	const { model, calls } = rig({
		localSetting: async (key, value) => {
			calls.local.push([key, value]);
			throw new Error("registry failure");
		},
	});
	model.setAccount("account-a");
	await model.check("app_start");
	await model.enable(model.consentIdentity(), null);
	assert.equal(model.getSnapshot().confirmed, true);
	assert.deepEqual(calls.local, [["team_bridge.session", ""]]);
	assert.equal(model.canEnable(model.consentIdentity()), false);
});

test("auth switch discards pending read/write responses and does not write next account's local flags", async () => {
	const read = deferred();
	const r = rig({ status: async () => read.promise });
	r.model.setAccount("account-a");
	const pendingRead = r.model.check("app_start");
	r.model.setAccount("account-b");
	read.resolve(status());
	await pendingRead;
	assert.equal(r.model.getSnapshot().status, null);
	const write = deferred();
	const { model, calls } = rig({ enable: async () => write.promise });
	model.setAccount("account-a");
	await model.check("app_start");
	const pendingWrite = model.enable(model.consentIdentity(), "abcdef123456");
	model.setAccount("account-b");
	write.resolve(response());
	await pendingWrite;
	assert.deepEqual(calls.local, []);
	assert.deepEqual(calls.seen, []);
	assert.equal(model.getSnapshot().confirmed, false);
	model.dismiss("account-a", "tenant-home");
	assert.deepEqual(calls.seen, []);
});

test("a boundary organization or consent-version change discards in-flight local activation and confirmation", async () => {
	const orgChanged = status({
		tenant_id: "tenant-next",
		status: {
			tenants: [{ tenant_id: "tenant-next", eligible: true, endpoint: null }],
		},
	});
	const versionChanged = status({
		consent: { ...fixture.consent, version: "bridge_consent_v2" },
	});
	for (const changed of [orgChanged, versionChanged]) {
		const write = deferred();
		let reads = 0;
		const { model, calls, advance } = rig({
			status: async () => (reads++ === 0 ? status() : changed),
			enable: async () => write.promise,
		});
		model.setAccount("account-a");
		await model.check("app_start");
		const pending = model.enable(model.consentIdentity(), "abcdef123456");
		advance(300000);
		await model.check("window_focus");
		write.resolve(response());
		await pending;
		assert.deepEqual(calls.local, []);
		assert.deepEqual(calls.seen, []);
		assert.equal(model.getSnapshot().confirmed, false);
		assert.equal(model.getSnapshot().pending, false);
		assert.equal(model.canEnable(model.consentIdentity()), true);
	}
});

test("local transport carries exact guarded body, schema rejects missing account guard and malformed upstream fields", () => {
	const op = {
		op: "agent_messages.enable",
		expected_account_id: "account-a",
		tenant_id: "tenant-home",
		state: "active",
		consent_version: fixture.consent.version,
		consented_via: "dialog",
	};
	assert.equal(desktopRequestSchema.safeParse(op).success, true);
	const { op: _op, ...body } = op;
	assert.deepEqual(desktopEndpoint(op), {
		path: "/v1/desktop/team-bridge/settings",
		method: "PUT",
		body,
	});
	const { expected_account_id: _guard, ...unguarded } = op;
	assert.equal(desktopRequestSchema.safeParse(unguarded).success, false);
	assert.equal(
		desktopRequestSchema.safeParse({ ...op, enabled: true }).success,
		false,
	);
	assert.deepEqual(
		desktopEndpoint({ op: "agent_messages.status", boundary: "window_focus" }),
		{
			path: "/v1/desktop/team-bridge/status?boundary=window_focus",
			method: "GET",
		},
	);
});

test("copy_scan bans bare human team/teammate; exception is ONLY byte-exact canonical served consent", () => {
	const copy = JSON.parse(
		readFileSync("src/i18n/catalogues/en/ui.agentMessages.json", "utf8"),
	);
	for (const [key, text] of Object.entries(copy))
		assert.deepEqual(copyScanAgentMessages(text), [], key);
	assert.equal(
		copy["ui.agentMessages.dialog.title"],
		"Agent messages on Radient",
	);
	assert.equal(
		copy["ui.agentMessages.dialog.lead"],
		"Your agent can exchange messages with other members' agents in your organization.",
	);
	assert.equal(
		copy["ui.agentMessages.dialog.reach"],
		"By default only agents of members in your organization can reach you; change this in Settings → Agent messages.",
	);
	assert.equal(
		copy["ui.agentMessages.dialog.later"],
		"You can enable this later in Settings → Agent messages.",
	);
	assert.deepEqual(
		copyScanAgentMessages(fixture.consent.text, { canonicalConsent: true }),
		[],
	);
	assert.ok(
		copyScanAgentMessages(`${fixture.consent.text} `, {
			canonicalConsent: true,
		}).length,
	);
	assert.ok(copyScanAgentMessages(fixture.consent.text).length);
	assert.equal(copyScanAgentMessages("your team and your teammate").length, 2);
	assert.equal(
		copyScanAgentMessages("agent teams and your organization").length,
		0,
	);
});
