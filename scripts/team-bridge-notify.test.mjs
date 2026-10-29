import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * Team Bridge notification tests: the pure policy, the IPC payload limits, the
 * main-process notifier and its persisted cursor.
 *
 * Executed through esbuild against the SHIPPED TypeScript, the house pattern
 * for this repository (there is no separate unit runner). The main module is
 * bundled with a fake Electron `Notification`; production wiring is the same
 * module with the real class.
 */
const neutral = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/team-bridge/team-bridge-notify-model";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
});
const model = await import(
	`data:text/javascript;base64,${Buffer.from(neutral.outputFiles[0].text).toString("base64")}`
);

const shared = await build({
	stdin: {
		contents: 'export * from "./src/shared/team-bridge-notify";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
});
const limits = await import(
	`data:text/javascript;base64,${Buffer.from(shared.outputFiles[0].text).toString("base64")}`
);

/* Top-level so the fixture's own build hook does not allocate a regex per call. */
const ELECTRON_MODULE = /^electron$/;
const ANY_FILE = /.*/;
const PREVIEW_IN_STORE = /Ada|Minerva|sent a message|title|body/;
const NOTIFICATION_REFUSAL = /cannot use Team Bridge notifications/;
/* Top-level so the assertions above do not allocate a regex per call. */
const BEN_NAME = /Ben Tran/;
const AIDA_NAME = /Aida/;
const DOCUMENT_REFUSAL = /cannot use/;

const electronFixture = {
	name: "electron-fixture",
	setup(builder) {
		builder.onResolve({ filter: ELECTRON_MODULE }, () => ({
			path: "electron",
			namespace: "fixture",
		}));
		builder.onLoad({ filter: ANY_FILE, namespace: "fixture" }, () => ({
			contents: `
	export const ipcMain = { handle: (name, handler) => globalThis.__teamBridgeHandlers.set(name, handler) };
	export const shell = { openExternal: async () => {} };
	export class Notification {
		static isSupported() { return globalThis.__notifySupported !== false; }
		constructor(options) { this.options = options; }
		on(event, handler) { (this.handlers ??= {})[event] = handler; }
		once(event, handler) {
			const wrapper = (...args) => { this.off(event, wrapper); handler(...args); };
			this.on(event, wrapper);
		}
		off(event, handler) {
			if (this.handlers?.[event] === handler) delete this.handlers[event];
		}
		show() {}
		close() {}
	}
	`,
		}));
	},
};

const mainBundle = await build({
	stdin: {
		contents:
			'export * from "./src/main/team-bridge-notifier"; export * from "./src/main/team-bridge-notification-images"; export { registerDesktopIPC } from "./src/main/desktop-ipc";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [electronFixture],
});
const notifierModule = await import(
	`data:text/javascript;base64,${Buffer.from(mainBundle.outputFiles[0].text).toString("base64")}`
);

const storeBundle = await build({
	stdin: {
		contents: 'export * from "./src/main/team-bridge-notify-store";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const storeModule = await import(
	`data:text/javascript;base64,${Buffer.from(storeBundle.outputFiles[0].text).toString("base64")}`
);

const member = (label, kind, state, accountId = `acct_${label}`) => ({
	account_id: accountId,
	kind,
	display_label: label,
	role: "member",
	state,
});

const conversation = (patch = {}) => ({
	id: "bcv_1",
	tenant_id: "tnt_1",
	kind: "dm",
	name: "",
	visibility: "private",
	agent_capable: false,
	status: "open",
	created_by: "acct_a",
	last_message_at: "2026-10-18T10:00:00Z",
	latest_seq: 2,
	members: [
		member("Ada", "human", "active", "acct_a"),
		member("Bea", "human", "active", "acct_b"),
	],
	last_read_seq: 0,
	unread_count: 2,
	muted: false,
	...patch,
});

const notifyRow = (patch = {}) => ({
	conversation_id: "bcv_1",
	tenant_id: "tnt_1",
	unread_count: 2,
	last_read_seq: 0,
	latest_seq: 2,
	...patch,
});

/* The exact QA (round 3) payloads: account discovery carries orgs, not rows. */
const QA_ACCOUNT_UNREAD = {
	total: 1,
	organizations: [
		{
			tenant_id: "tnt_qa_org",
			tenant_name: "QA Org",
			unread: 1,
			eligible: true,
		},
	],
};
const QA_TENANT_UNREAD = {
	total: 1,
	conversations: [
		{
			conversation_id: "bcv_qa1",
			unread_count: 1,
			last_read_seq: 0,
			latest_seq: 1,
			muted: false,
		},
	],
};
const QA_CONVERSATION = conversation({
	id: "bcv_qa1",
	tenant_id: "tnt_qa_org",
	kind: "group",
	name: "QA Notify Group",
	members: [
		member("Alice QA", "human", "active", "acct_alice"),
		member("Bob QA", "human", "active", "acct_bob"),
	],
	member: true,
	notify: "all",
	muted: false,
	latest_seq: 1,
	last_read_seq: 0,
	// The QA observation: the list row reports zero while unread reports one.
	unread_count: 0,
});

const organization = (tenantId, name) => ({
	tenantId,
	name,
	role: "member",
	unread: 0,
});

function plan(overrides = {}) {
	return model.planTeamBridgeNotifications({
		conversations: [conversation()],
		rows: [notifyRow()],
		organizations: [organization("tnt_1", "Minerva")],
		selfAccountId: "acct_a",
		cursors: new Map(),
		seeded: true,
		quiet: false,
		...overrides,
	});
}

// ---------------------------------------------------------------------------
// IPC payload limits
// ---------------------------------------------------------------------------

test("a valid notification payload parses exactly", async () => {
	const request = {
		owner: { accountId: "acct_a", epoch: 1 },
		conversationId: "bcv_abc123",
		tenantId: "tnt_1",
		title: "Ada (Minerva)",
		body: "Ada sent a message",
		seq: 7,
	};
	assert.deepEqual(limits.parseTeamBridgeNotifyRequest(request), request);
});

test("bad payloads are refused, not repaired", async () => {
	const valid = {
		owner: { accountId: "acct_a", epoch: 1 },
		conversationId: "bcv_abc123",
		tenantId: "tnt_1",
		title: "Ada (Minerva)",
		body: "Ada sent a message",
		seq: 7,
	};
	const cases = [
		["null", null],
		["array", []],
		["missing owner", { ...valid, owner: undefined }],
		["missing epoch", { ...valid, owner: { accountId: "acct_a" } }],
		["missing conversation", { ...valid, conversationId: undefined }],
		["empty id", { ...valid, conversationId: "" }],
		["id with a space", { ...valid, conversationId: "bcv 1" }],
		["empty title", { ...valid, title: "   " }],
		[
			"oversized title",
			{ ...valid, title: "x".repeat(limits.TEAM_BRIDGE_NOTIFY_MAX_TITLE + 1) },
		],
		[
			"oversized body",
			{ ...valid, body: "x".repeat(limits.TEAM_BRIDGE_NOTIFY_MAX_BODY + 1) },
		],
		["html in the title", { ...valid, title: "<b>Ada</b>" }],
		["html in the body", { ...valid, body: "<script>x</script>" }],
		["newline in the body", { ...valid, body: "one\ntwo" }],
		["fractional seq", { ...valid, seq: 1.5 }],
		["negative seq", { ...valid, seq: -1 }],
		["string seq", { ...valid, seq: "7" }],
	];
	for (const [name, value] of cases) {
		assert.equal(
			limits.parseTeamBridgeNotifyRequest(value),
			null,
			`${name} must be refused`,
		);
	}
});

test("the click path names the organization and the conversation", async () => {
	assert.equal(
		limits.teamBridgeOpenPath({
			conversationId: "bcv_a&b",
			tenantId: "tnt_1",
		}),
		"/team-bridge?tenant=tnt_1&conversation=bcv_a%26b",
	);
});

// ---------------------------------------------------------------------------
// Renderer policy
// ---------------------------------------------------------------------------

test("the first complete answer seeds every cursor and raises nothing", async () => {
	const result = plan({ seeded: false });
	assert.equal(result.candidates.length, 0);
	assert.equal(result.cursors.get("bcv_1"), 2);
	assert.equal(result.seeded, true);
});

test("a newer seq for a member on notify=all is a candidate", async () => {
	const result = plan({ cursors: new Map([["bcv_1", 1]]) });
	assert.equal(result.candidates.length, 1);
	assert.deepEqual(result.candidates[0], {
		conversationId: "bcv_1",
		tenantId: "tnt_1",
		seq: 2,
		conversationName: "Bea",
		organizationName: "Minerva",
		senderLabel: null,
		// The banner formatter's facts (tb-os-notifications): place and count.
		kind: "dm",
		name: null,
		unreadCount: 2,
	});
});

test("the same seq is never notified twice", async () => {
	const first = plan({ cursors: new Map([["bcv_1", 1]]) });
	const second = plan({ cursors: first.cursors });
	assert.equal(first.candidates.length, 1);
	assert.equal(second.candidates.length, 0);
});

test("member=false is never notified, even with unread", async () => {
	const result = plan({
		conversations: [conversation({ member: false, discoverable: true })],
		cursors: new Map([["bcv_1", 1]]),
	});
	assert.equal(result.candidates.length, 0);
	assert.equal(result.cursors.get("bcv_1"), 2);
});

test("notify=mention and notify=mute are silent in v1", async () => {
	for (const notify of ["mention", "mute"]) {
		const result = plan({
			conversations: [conversation({ notify })],
			cursors: new Map([["bcv_1", 1]]),
		});
		assert.equal(result.candidates.length, 0, notify);
		assert.equal(result.cursors.get("bcv_1"), 2, notify);
	}
});

test("the legacy muted flag is silent when notify is absent", async () => {
	const result = plan({
		conversations: [conversation({ muted: true })],
		cursors: new Map([["bcv_1", 1]]),
	});
	assert.equal(result.candidates.length, 0);
});

test("membership is derived from an active human member when the flag is absent", async () => {
	const result = plan({ cursors: new Map([["bcv_1", 1]]) });
	assert.equal(result.candidates.length, 1);

	const agentOnly = plan({
		conversations: [
			conversation({
				members: [
					member("Ada", "agent", "active", "acct_a"),
					member("Bea", "human", "active", "acct_b"),
				],
			}),
		],
		cursors: new Map([["bcv_1", 1]]),
	});
	assert.equal(agentOnly.candidates.length, 0);
});

test("a focused window suppresses the banner but consumes the seq", async () => {
	const result = plan({ cursors: new Map([["bcv_1", 1]]), quiet: true });
	assert.equal(result.candidates.length, 0);
	assert.equal(result.cursors.get("bcv_1"), 2);
});

test("an unread row without conversation metadata waits for the next poll", async () => {
	const result = plan({
		conversations: [],
		cursors: new Map([["bcv_1", 1]]),
	});
	assert.equal(result.candidates.length, 0);
	assert.equal(result.cursors.get("bcv_1"), 1);
});

test("a conversation that first appears after the seed is a candidate", async () => {
	const result = plan({ cursors: new Map() });
	assert.equal(result.candidates.length, 1);
	assert.equal(result.candidates[0].seq, 2);
});

test("a read row advances its cursor instead of notifying", async () => {
	const result = plan({
		rows: [notifyRow({ unread_count: 0, last_read_seq: 2 })],
		cursors: new Map([["bcv_1", 1]]),
	});
	assert.equal(result.candidates.length, 0);
	assert.equal(result.cursors.get("bcv_1"), 2);
});

test("the QA account + tenant payloads produce one candidate and one banner", async () => {
	const organizations = model.teamBridgeNotifyOrganizations(QA_ACCOUNT_UNREAD);
	assert.deepEqual(
		organizations.map((organization) => organization.tenant_id),
		["tnt_qa_org"],
	);

	const rows = QA_TENANT_UNREAD.conversations.map((row) => ({
		...row,
		tenant_id: organizations[0].tenant_id,
	}));
	const result = model.planTeamBridgeNotifications({
		conversations: [QA_CONVERSATION],
		rows,
		organizations: [organization("tnt_qa_org", "QA Org")],
		selfAccountId: "acct_alice",
		cursors: new Map(),
		// The pre-existing unread was seeded on an earlier poll; this is the
		// first message after that seed.
		seeded: true,
		quiet: false,
	});
	assert.equal(result.candidates.length, 1);
	const candidate = result.candidates[0];
	assert.deepEqual(
		{
			conversationId: candidate.conversationId,
			tenantId: candidate.tenantId,
			seq: candidate.seq,
			conversationName: candidate.conversationName,
			organizationName: candidate.organizationName,
			senderLabel: candidate.senderLabel,
		},
		{
			conversationId: "bcv_qa1",
			tenantId: "tnt_qa_org",
			seq: 1,
			conversationName: "QA Notify Group",
			organizationName: "QA Org",
			senderLabel: null,
		},
	);

	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		const request = {
			owner: { accountId: "acct_a", epoch: 1 },
			conversationId: candidate.conversationId,
			tenantId: candidate.tenantId,
			title: `${candidate.conversationName} (${candidate.organizationName})`,
			body: "New message",
			seq: candidate.seq,
		};
		assert.deepEqual(await h.notifier.notify(request), { shown: true });
		assert.equal(h.banners.length, 1);
		assert.equal(h.banners[0].options.title, "QA Notify Group (QA Org)");
		assert.equal(h.banners[0].options.body, "New message");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an organization with a zero total contributes no read and no rows", async () => {
	const account = {
		total: 1,
		organizations: [
			...QA_ACCOUNT_UNREAD.organizations,
			{
				tenant_id: "tnt_quiet",
				tenant_name: "Quiet Org",
				unread: 0,
				eligible: true,
			},
		],
	};
	assert.deepEqual(
		model
			.teamBridgeNotifyOrganizations(account)
			.map((organization) => organization.tenant_id),
		["tnt_qa_org"],
	);
});

test("the sender label is the list row's, trimmed, and absent means fallback", async () => {
	const labelled = plan({
		conversations: [conversation({ last_sender_label: "  Bea  " })],
		cursors: new Map([["bcv_1", 1]]),
	});
	assert.equal(labelled.candidates[0].senderLabel, "Bea");

	const absent = plan({ cursors: new Map([["bcv_1", 1]]) });
	assert.equal(absent.candidates[0].senderLabel, null);

	const blank = plan({
		conversations: [conversation({ last_sender_label: "   " })],
		cursors: new Map([["bcv_1", 1]]),
	});
	assert.equal(blank.candidates[0].senderLabel, null);

	// The legacy placeholder is not a name: the banner title falls back to the
	// conversation instead of announcing "Member".
	const placeholder = plan({
		conversations: [conversation({ last_sender_label: "Member" })],
		cursors: new Map([["bcv_1", 1]]),
	});
	assert.equal(placeholder.candidates[0].senderLabel, null);
});

test("an organization the caller cannot name is omitted from the subject", async () => {
	const result = plan({
		organizations: [],
		cursors: new Map([["bcv_1", 1]]),
	});
	assert.equal(result.candidates[0].organizationName, null);
});

// ---------------------------------------------------------------------------
// Main-process notifier
// ---------------------------------------------------------------------------

function fakeBanner(options) {
	const banner = {
		options,
		handlers: {},
		closed: false,
		once(event, handler) {
			const wrapper = (...args) => {
				delete banner.handlers[event];
				handler(...args);
			};
			banner.handlers[event] ??= [];
			banner.handlers[event].push(wrapper);
		},
		emit(event) {
			for (const handler of [...(banner.handlers[event] ?? [])]) handler();
		},
		show() {
			banner.shown = true;
		},
		close() {
			banner.closed = true;
		},
	};
	return banner;
}

function fakeWindow({
	focused = false,
	visible = true,
	minimized = false,
} = {}) {
	return {
		destroyed: false,
		isDestroyed() {
			return this.destroyed;
		},
		isFocused: () => focused,
		isVisible: () => visible,
		isMinimized: () => minimized,
	};
}

function harness({
	file,
	window = fakeWindow(),
	show = "focus",
	supported = true,
	timers,
	images,
} = {}) {
	const banners = [];
	const signals = [];
	const reopens = [];
	const presented = [];
	const store = new storeModule.TeamBridgeNotifyStore(file);
	const notifier = new notifierModule.TeamBridgeNotifier({
		window: () => window,
		show,
		store,
		images,
		icon: "app-icon",
		host: {
			signalOpen: () => signals.push(true),
			reopen: () => reopens.push(true),
		},
		canNotify: () => supported,
		createBanner: (options) => {
			const banner = fakeBanner(options);
			banners.push(banner);
			return banner;
		},
		present: (targetWindow) => presented.push(targetWindow),
		...(timers
			? {
					setSettleTimer: timers.setSettleTimer,
					clearSettleTimer: timers.clearSettleTimer,
					...(timers.setWaitTimer ? { setWaitTimer: timers.setWaitTimer } : {}),
					...(timers.clearWaitTimer
						? { clearWaitTimer: timers.clearWaitTimer }
						: {}),
				}
			: {}),
	});
	notifier.setAuthority?.({ accountId: "acct_a", epoch: 1 });
	return { notifier, banners, signals, reopens, presented, store, window };
}

/** A fake timer for the bounded composite wait: capture the deadline callback so
 * a test can fire it exactly when it chooses, instead of sleeping 250 ms. */
function waitClock() {
	const pending = new Map();
	let next = 0;
	return {
		pending,
		setWaitTimer(callback, delay) {
			const id = ++next;
			pending.set(id, { callback, delay });
			return id;
		},
		clearWaitTimer(id) {
			pending.delete(id);
		},
		/** Fire every armed deadline; the race then resolves undefined. */
		fireAll() {
			const entries = [...pending.values()];
			pending.clear();
			for (const entry of entries) entry.callback();
		},
	};
}

function tempFile() {
	const dir = mkdtempSync(join(tmpdir(), "team-bridge-notify-"));
	return { dir, file: join(dir, "cursors.json") };
}

const request = (patch = {}) => ({
	owner: { accountId: "acct_a", epoch: 1 },
	conversationId: "bcv_abc123",
	tenantId: "tnt_1",
	title: "Ada (Minerva)",
	body: "Ada sent a message",
	seq: 4,
	...patch,
});

test("account transition revokes old banners and cannot route their clicks", async () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		h.notifier.setAuthority?.({ accountId: "acct_a", epoch: 1 });
		await h.notifier.notify(
			request({ owner: { accountId: "acct_a", epoch: 1 } }),
		);
		h.notifier.setAuthority?.({ accountId: "acct_b", epoch: 2 });
		assert.equal(h.banners[0].closed, true);
		h.banners[0].emit("click");
		assert.deepEqual(h.notifier.takePendingOpen(), { unavailable: true });
		assert.equal(h.signals.length, 1);
		assert.equal(h.presented.length, 1);
		assert.deepEqual(
			await h.notifier.notify(
				request({ owner: { accountId: "acct_b", epoch: 2 } }),
			),
			{ shown: true },
		);
		assert.notEqual(h.banners[0].options.id, h.banners[1].options.id);
		h.banners[1].emit("click");
		assert.equal(h.notifier.takePendingOpen()?.owner.accountId, "acct_b");
		assert.doesNotMatch(readFileSync(file, "utf8"), PREVIEW_IN_STORE);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("main raises one banner with the exact renderer strings", async () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		assert.deepEqual(await h.notifier.notify(request()), { shown: true });
		assert.equal(h.banners.length, 1);
		assert.equal(h.banners[0].options.title, "Ada (Minerva)");
		assert.equal(h.banners[0].options.body, "Ada sent a message");
		assert.equal(h.banners[0].options.silent, false);
		assert.equal(h.banners[0].shown, true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("main refuses a malformed payload", async () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		await assert.rejects(() =>
			h.notifier.notify(request({ title: "<b>x</b>" })),
		);
		assert.equal(h.banners.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a duplicate seq is collapsed and a newer seq replaces the banner", async () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		await h.notifier.notify(request());
		assert.deepEqual(await h.notifier.notify(request()), { shown: false });
		assert.equal(h.banners.length, 1);

		assert.deepEqual(await h.notifier.notify(request({ seq: 5 })), {
			shown: true,
		});
		assert.equal(h.banners.length, 2);
		assert.equal(h.banners[0].closed, true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the persisted cursor survives a restart", async () => {
	const { dir, file } = tempFile();
	try {
		const first = harness({ file });
		await first.notifier.notify(request());
		const raw = readFileSync(file, "utf8");
		assert.equal(
			JSON.parse(raw).cursors[JSON.stringify(["acct_a", "bcv_abc123"])],
			4,
		);
		assert.equal(raw.includes("Ada sent"), false);

		const second = harness({ file });
		assert.deepEqual(await second.notifier.notify(request()), { shown: false });
		assert.equal(second.banners.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a focused window is quiet", async () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file, window: fakeWindow({ focused: true }) });
		assert.deepEqual(await h.notifier.notify(request()), { shown: false });
		assert.equal(h.banners.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("headless and unsupported runs raise nothing", async () => {
	const { dir, file } = tempFile();
	try {
		const headless = harness({ file, show: "never" });
		assert.deepEqual(await headless.notifier.notify(request()), {
			shown: false,
		});
		assert.equal(headless.banners.length, 0);

		const unsupported = harness({ file, supported: false });
		assert.deepEqual(await unsupported.notifier.notify(request()), {
			shown: false,
		});
		assert.equal(unsupported.banners.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a click signals and parks the target until the renderer pulls it", async () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		await h.notifier.notify(request());
		h.banners[0].emit("click");
		assert.equal(h.signals.length, 1);
		assert.equal(h.presented.length, 1);
		assert.equal(h.reopens.length, 0);
		/*
		 * THE POINT OF THE PARKED TARGET: the signal may reach a renderer that is
		 * still loading and be dropped. The target is still here, and the mount
		 * pull is what delivers it - exactly once.
		 */
		assert.deepEqual(h.notifier.takePendingOpen(), {
			owner: { accountId: "acct_a", epoch: 1 },
			conversationId: "bcv_abc123",
			tenantId: "tnt_1",
		});
		assert.equal(h.notifier.takePendingOpen(), null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a click with no window asks for one and parks the target", async () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file, window: null });
		await h.notifier.notify(request());
		assert.equal(h.banners.length, 1);
		h.banners[0].emit("click");
		assert.equal(h.reopens.length, 1);
		assert.equal(h.signals.length, 0);
		assert.deepEqual(h.notifier.takePendingOpen(), {
			owner: { accountId: "acct_a", epoch: 1 },
			conversationId: "bcv_abc123",
			tenantId: "tnt_1",
		});
		assert.equal(h.notifier.takePendingOpen(), null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a corrupt cursor file fails toward a possible duplicate, never a crash", async () => {
	const { dir, file } = tempFile();
	try {
		const store = new storeModule.TeamBridgeNotifyStore(file);
		store.record("acct_a", "bcv_abc123", 3);
		// Simulate corruption between runs.
		rmSync(file);
		const fresh = new storeModule.TeamBridgeNotifyStore(file);
		assert.equal(fresh.notifiedSeq("acct_a", "bcv_abc123"), undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("load enforces the cursor bound, not only record", async () => {
	const { dir, file } = tempFile();
	try {
		const bound = storeModule.TEAM_BRIDGE_NOTIFY_CURSOR_BOUND;
		const cursors = {};
		for (let index = 0; index < bound + 3; index += 1) {
			cursors[JSON.stringify(["acct_a", `bcv_${index}`])] = index + 1;
		}
		writeFileSync(file, JSON.stringify({ version: 2, cursors }));

		const store = new storeModule.TeamBridgeNotifyStore(file);
		assert.equal(store.notifiedSeq("acct_a", "bcv_0"), undefined);
		assert.equal(store.notifiedSeq("acct_a", `bcv_${bound + 2}`), bound + 3);

		store.record("acct_a", "bcv_new", 1);
		const persisted = JSON.parse(readFileSync(file, "utf8")).cursors;
		assert.equal(Object.keys(persisted).length, bound);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("reply summary seq/root survive planning, native click and old-root navigation", async () => {
	const stale = plan({
		conversations: [
			conversation({ latest_seq: 1, last_thread_root_id: "bcmsg_stale" }),
		],
	});
	assert.equal(stale.candidates.length, 0);
	assert.equal(
		stale.cursors.has("bcv_1"),
		false,
		"a mismatched summary must not consume the unread seq",
	);
	const ready = plan({
		conversations: [conversation({ last_thread_root_id: "bcmsg_oldroot" })],
	});
	const [candidate] = ready.candidates;
	assert.equal(candidate.threadId, "bcmsg_oldroot");
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		await h.notifier.notify(
			request({
				conversationId: candidate.conversationId,
				tenantId: candidate.tenantId,
				seq: candidate.seq,
				threadId: candidate.threadId,
			}),
		);
		h.banners[0].emit("click");
		const target = h.notifier.takePendingOpen();
		assert.deepEqual(target, {
			owner: { accountId: "acct_a", epoch: 1 },
			conversationId: "bcv_1",
			tenantId: "tnt_1",
			threadId: "bcmsg_oldroot",
		});
		// THE HOLD DROPS THE THREAD ROOT FROM THE ROUTE. Main still parks the
		// ids it was given (the click target is a fact), but this build does not
		// route a thread - see `TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD` in
		// `team-bridge-notify.ts`.
		assert.equal(
			limits.teamBridgeOpenPath(target),
			"/team-bridge?tenant=tnt_1&conversation=bcv_1",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("same conversation cursor is isolated by account across restart", async () => {
	const { dir, file } = tempFile();
	try {
		const a = harness({ file });
		assert.deepEqual(await a.notifier.notify(request()), { shown: true });
		const b = harness({ file });
		b.notifier.setAuthority?.({ accountId: "acct_b", epoch: 2 });
		assert.deepEqual(
			await b.notifier.notify(
				request({ owner: { accountId: "acct_b", epoch: 2 } }),
			),
			{ shown: true },
		);
		assert.deepEqual(
			await b.notifier.notify(
				request({ owner: { accountId: "acct_b", epoch: 2 } }),
			),
			{ shown: false },
		);
		assert.equal(
			Object.keys(JSON.parse(readFileSync(file, "utf8")).cursors).length,
			2,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("logout revokes preview retention and parked targets; late authority cannot rearm them", async () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		await h.notifier.notify(request());
		h.banners[0].emit("click");
		await h.notifier.notify(request({ seq: 5 }));
		h.notifier.setAuthority({ epoch: 2 });
		assert.equal(h.banners[1].closed, true);
		assert.deepEqual(h.notifier.takePendingOpen(), { unavailable: true });
		assert.equal(
			h.notifier.lifetime.size,
			0,
			"even an adapter without close events releases previews",
		);
		h.notifier.setAuthority({ accountId: "acct_a", epoch: 1 });
		assert.deepEqual(await h.notifier.notify(request({ seq: 6 })), {
			shown: false,
		});
		h.notifier.setAuthority({ accountId: "acct_b", epoch: 2 });
		h.notifier.setAuthority({ accountId: "acct_a", epoch: 2 });
		assert.deepEqual(
			await h.notifier.notify(
				request({ owner: { accountId: "acct_a", epoch: 2 }, seq: 6 }),
			),
			{ shown: false },
		);
		h.banners[1].emit("click");
		assert.deepEqual(h.notifier.takePendingOpen(), { unavailable: true });
		assert.equal(
			h.presented.length,
			2,
			"both original and stale click visibly answer",
		);
		await assert.rejects(() =>
			h.notifier.notify(request({ owner: undefined })),
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("A to B to A cannot revive an earlier credential epoch click or notify", async () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		await h.notifier.notify(request());
		h.notifier.setAuthority({ accountId: "acct_b", epoch: 2 });
		h.notifier.setAuthority({ accountId: "acct_a", epoch: 3 });
		h.banners[0].emit("click");
		assert.deepEqual(h.notifier.takePendingOpen(), { unavailable: true });
		assert.deepEqual(await h.notifier.notify(request({ seq: 5 })), {
			shown: false,
		});
		assert.deepEqual(
			await h.notifier.notify(
				request({ owner: { accountId: "acct_a", epoch: 3 }, seq: 5 }),
			),
			{ shown: true },
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("legacy accountless cursor is never assigned to the next account", async () => {
	const { dir, file } = tempFile();
	try {
		writeFileSync(
			file,
			JSON.stringify({ version: 1, cursors: { bcv_abc123: 999 } }),
		);
		const h = harness({ file });
		assert.deepEqual(await h.notifier.notify(request()), { shown: true });
		const persisted = JSON.parse(readFileSync(file, "utf8"));
		assert.equal(persisted.version, 2);
		assert.equal(persisted.cursors.bcv_abc123, undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("authorized IPC fences late epochs, auxiliary frames and document replacement", async () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		const contents = new EventEmitter();
		contents.mainFrame = { url: "file:///app/index.html" };
		h.window.webContents = contents;
		const auxiliary = {
			isDestroyed: () => false,
			webContents: { mainFrame: { url: "file:///app/mini.html" } },
		};
		globalThis.__teamBridgeHandlers = new Map();
		notifierModule.registerDesktopIPC(
			() => h.window,
			"file:///app/index.html",
			async () => ({}),
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			() => [{ window: auxiliary, url: "file:///app/mini.html" }],
			undefined,
			h.notifier,
		);
		const invoke = (
			name,
			input,
			event = { sender: contents, senderFrame: contents.mainFrame },
		) =>
			globalThis.__teamBridgeHandlers.get(`team-bridge:${name}`)(event, input);
		invoke("authority", { accountId: "acct_a", epoch: 5 });
		assert.deepEqual(
			await invoke(
				"notify",
				request({ owner: { accountId: "acct_a", epoch: 5 } }),
			),
			{ shown: true },
		);
		invoke("authority", { epoch: 6 });
		assert.equal(h.banners[0].closed, true);
		invoke("authority", { accountId: "acct_a", epoch: 5 });
		assert.deepEqual(
			await invoke(
				"notify",
				request({ owner: { accountId: "acct_a", epoch: 5 }, seq: 5 }),
			),
			{ shown: false },
		);
		assert.throws(
			() =>
				invoke(
					"authority",
					{ accountId: "acct_a", epoch: 999 },
					{
						sender: auxiliary.webContents,
						senderFrame: auxiliary.webContents.mainFrame,
					},
				),
			NOTIFICATION_REFUSAL,
		);
		invoke("authority", { accountId: "acct_b", epoch: 6 });
		await invoke(
			"notify",
			request({ owner: { accountId: "acct_b", epoch: 6 } }),
		);
		contents.emit(
			"did-start-navigation",
			{},
			"file:///app/index.html",
			false,
			true,
		);
		assert.equal(
			h.banners[1].closed,
			false,
			"attempted navigation does not revoke",
		);
		invoke("authority", { accountId: "acct_b", epoch: 6 });
		const oldFrame = contents.mainFrame;
		contents.mainFrame = { url: "file:///app/index.html" };
		contents.emit(
			"did-frame-navigate",
			{},
			"file:///app/index.html",
			200,
			"OK",
			true,
		);
		assert.throws(
			() =>
				invoke(
					"authority",
					{ accountId: "acct_b", epoch: 6 },
					{ sender: contents, senderFrame: oldFrame },
				),
			DOCUMENT_REFUSAL,
		);
		invoke("authority", { accountId: "acct_b", epoch: 0 });
		assert.deepEqual(
			await invoke(
				"notify",
				request({ owner: { accountId: "acct_b", epoch: 0 }, seq: 5 }),
			),
			{ shown: true },
		);
		contents.emit("destroyed");
		assert.equal(
			h.banners[2].closed,
			false,
			"window destruction retains banners",
		);
		h.banners[2].emit("click");
		assert.equal(
			invoke("pending-open"),
			null,
			"replacement account must settle before consumption",
		);
		invoke("authority", { accountId: "acct_b", epoch: 0 });
		assert.equal(invoke("pending-open")?.conversationId, "bcv_abc123");
	} finally {
		globalThis.__teamBridgeHandlers = undefined;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("native identifiers cannot collide across colon-bearing owner/conversation pairs", async () => {
	assert.notEqual(
		notifierModule.teamBridgeBannerId("acct:a", "bcv"),
		notifierModule.teamBridgeBannerId("acct", "a:bcv"),
	);
});

test("R2 unknown revocation preserves the established epoch owner", async () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		h.notifier.setAuthority({ accountId: "acct_a", epoch: 5 });
		h.notifier.setAuthority({ epoch: 5 });
		assert.deepEqual(
			await h.notifier.notify(
				request({ owner: { accountId: "acct_a", epoch: 5 } }),
			),
			{ shown: false },
		);
		h.notifier.setAuthority({ accountId: "acct_b", epoch: 5 });
		assert.deepEqual(
			await h.notifier.notify(
				request({ owner: { accountId: "acct_b", epoch: 5 } }),
			),
			{ shown: false },
		);
		h.notifier.setAuthority({ accountId: "acct_a", epoch: 5 });
		assert.deepEqual(
			await h.notifier.notify(
				request({ owner: { accountId: "acct_a", epoch: 5 } }),
			),
			{ shown: true },
			"the established owner can resolve a temporary unknown",
		);
		h.notifier.setAuthority({ epoch: 6 });
		h.notifier.setAuthority({ accountId: "acct_b", epoch: 5 });
		assert.deepEqual(
			await h.notifier.notify(
				request({ owner: { accountId: "acct_b", epoch: 5 }, seq: 7 }),
			),
			{ shown: false },
		);
		h.notifier.setAuthority({ accountId: "acct_b", epoch: 6 });
		assert.deepEqual(
			await h.notifier.notify(
				request({ owner: { accountId: "acct_b", epoch: 6 } }),
			),
			{ shown: true },
			"higher epoch can establish a new owner",
		);
		h.notifier.resetAuthority();
		h.notifier.setAuthority({ accountId: "acct_c", epoch: 0 });
		assert.deepEqual(
			await h.notifier.notify(
				request({ owner: { accountId: "acct_c", epoch: 0 }, seq: 8 }),
			),
			{ shown: true },
			"trusted document reset clears epoch binding",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

async function lifecycleHarness(file) {
	const h = harness({ file });
	const contents = new EventEmitter();
	contents.mainFrame = { url: "file:///app/index.html" };
	h.window.webContents = contents;
	globalThis.__teamBridgeHandlers = new Map();
	notifierModule.registerDesktopIPC(
		() => h.window,
		"file:///app/index.html",
		async () => ({}),
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		h.notifier,
	);
	const invoke = (name, input) =>
		globalThis.__teamBridgeHandlers.get(`team-bridge:${name}`)(
			{ sender: contents, senderFrame: contents.mainFrame },
			input,
		);
	invoke("authority", { accountId: "acct_a", epoch: 5 });
	await invoke("notify", request({ owner: { accountId: "acct_a", epoch: 5 } }));
	return { ...h, contents, invoke };
}

for (const event of ["destroyed", "reload", "render-process-gone"]) {
	test(`Q1 D1 ${event} keeps banner and parks click until replacement account settles`, async () => {
		const { dir, file } = tempFile();
		try {
			const h = await lifecycleHarness(file);
			if (event === "reload") {
				h.contents.emit(
					"did-start-navigation",
					{},
					"file:///app/index.html",
					false,
					true,
				);
				h.contents.mainFrame = { url: "file:///app/index.html" };
				h.contents.emit(
					"did-frame-navigate",
					{},
					"file:///app/index.html",
					200,
					"OK",
					true,
				);
			} else h.contents.emit(event);
			assert.equal(
				h.banners[0].closed,
				false,
				"renderer lifecycle must not withdraw delivery",
			);
			h.window.destroyed = true;
			h.banners[0].emit("click");
			assert.equal(h.reopens.length, 1, "native click reopens a closed window");
			assert.equal(
				h.notifier.takePendingOpen(),
				null,
				"unsettled document must not consume click",
			);
			h.notifier.setAuthority({ accountId: "acct_a", epoch: 0 });
			assert.equal(h.notifier.takePendingOpen()?.conversationId, "bcv_abc123");
			assert.equal(
				h.notifier.takePendingOpen(),
				null,
				"route is consumed exactly once",
			);
		} finally {
			globalThis.__teamBridgeHandlers = undefined;
			rmSync(dir, { recursive: true, force: true });
		}
	});
}

test("Q2 cancelled Electron navigation preserves later notification admission", async () => {
	const { dir, file } = tempFile();
	try {
		const h = await lifecycleHarness(file);
		// QA measured Electron 44.3: did-start-navigation precedes a prevented
		// will-frame-navigate, and cancellation produces NO did-frame-navigate.
		h.contents.emit(
			"did-start-navigation",
			{},
			"https://blocked.invalid/",
			false,
			true,
		);
		h.contents.emit("will-frame-navigate", { defaultPrevented: true });
		assert.equal(h.banners[0].closed, false);
		assert.deepEqual(
			await h.invoke(
				"notify",
				request({ owner: { accountId: "acct_a", epoch: 5 }, seq: 5 }),
			),
			{ shown: true },
		);
	} finally {
		globalThis.__teamBridgeHandlers = undefined;
		rmSync(dir, { recursive: true, force: true });
	}
});

for (const nextAccount of ["acct_a", "acct_b", undefined]) {
	test(`D2 credential refresh preserves pending click until ${nextAccount ?? "sign-out"} settles`, async () => {
		const { dir, file } = tempFile();
		try {
			const h = harness({ file });
			await h.notifier.notify(request());
			h.notifier.setAuthority({ epoch: 2, settling: true });
			assert.equal(h.banners[0].closed, false);
			assert.deepEqual(
				await h.notifier.notify(
					request({ owner: { accountId: "acct_a", epoch: 2 }, seq: 5 }),
				),
				{ shown: false },
			);
			h.banners[0].emit("click");
			assert.equal(
				h.notifier.takePendingOpen(),
				null,
				"click remains held during re-auth",
			);
			h.notifier.setAuthority({
				epoch: 2,
				...(nextAccount ? { accountId: nextAccount } : {}),
				settling: false,
			});
			const result = h.notifier.takePendingOpen();
			if (nextAccount === "acct_a")
				assert.equal(result?.conversationId, "bcv_abc123");
			else
				assert.deepEqual(
					result,
					{ unavailable: true },
					"mismatch feedback carries no private IDs",
				);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
}

test("D3 stale click foregrounds but returns only neutral feedback", async () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		await h.notifier.notify(request());
		h.notifier.setAuthority({ accountId: "acct_b", epoch: 2 });
		h.banners[0].emit("click");
		assert.equal(h.presented.length, 1);
		assert.deepEqual(h.notifier.takePendingOpen(), { unavailable: true });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

for (const nextAccount of ["acct_a", "acct_b"]) {
	test(`D2 delivered banner is ${nextAccount === "acct_a" ? "kept" : "withdrawn"} after settled re-sign-in`, async () => {
		const { dir, file } = tempFile();
		try {
			const h = harness({ file });
			await h.notifier.notify(request());
			h.notifier.setAuthority({ epoch: 2, settling: true });
			assert.equal(h.banners[0].closed, false);
			h.notifier.setAuthority({
				accountId: nextAccount,
				epoch: 2,
				settling: false,
			});
			assert.equal(h.banners[0].closed, nextAccount !== "acct_a");
			h.banners[0].emit("click");
			const result = h.notifier.takePendingOpen();
			if (nextAccount === "acct_a")
				assert.equal(result?.conversationId, "bcv_abc123");
			else assert.deepEqual(result, { unavailable: true });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
}

/**
 * A credential refresh that never settles (a failed account read, an abandoned
 * callout) must not leave message previews in Notification Center forever.
 */
const fakeSettleClock = () => {
	const queue = new Map();
	let next = 0;
	return {
		pending: () => queue.size,
		scheduledDelays: () => [...queue.values()].map((entry) => entry.delay),
		setSettleTimer: (callback, delay) => {
			next += 1;
			queue.set(next, { callback, delay });
			return next;
		},
		clearSettleTimer: (timer) => {
			queue.delete(timer);
		},
		fire: () => {
			const due = [...queue.values()];
			queue.clear();
			for (const entry of due) entry.callback();
			return due.length;
		},
	};
};

test("QA-M1 an unresolved credential refresh withdraws banners at the deadline", async () => {
	const { dir, file } = tempFile();
	try {
		const clock = fakeSettleClock();
		const h = harness({ file, timers: clock });
		assert.deepEqual(await h.notifier.notify(request()), { shown: true });
		h.notifier.setAuthority({ epoch: 2, settling: true });
		assert.equal(h.banners[0].closed, false, "settling keeps the banner");
		assert.deepEqual(clock.scheduledDelays(), [
			notifierModule.TEAM_BRIDGE_SETTLE_TIMEOUT_MS,
		]);
		assert.equal(clock.fire(), 1);
		assert.equal(
			h.banners[0].closed,
			true,
			"an unresolved refresh gives the preview up",
		);
		assert.equal(clock.pending(), 0);
		h.banners[0].emit("click");
		assert.deepEqual(
			h.notifier.takePendingOpen(),
			{ unavailable: true },
			"a clicked withdrawn banner still answers, without routing",
		);
		assert.deepEqual(
			await h.notifier.notify(
				request({ owner: { accountId: "acct_a", epoch: 2 } }),
			),
			{ shown: false },
			"an unresolved identity still admits nothing new",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/*
 * Round-3 code m1 == QA m1. `revoke()` already answers a parked click as
 * unavailable, but nothing TOLD the renderer: it pulls the answer only when
 * main signals or a window mounts. The deadline must therefore signal after it
 * withdraws, and it must be exactly one signal - the later settled-absence
 * update carries the same epoch and no account, so `setAuthority` dedupes it
 * and it can never signal on its own.
 */
test("CODE-M1 QA-M1 a click parked through the deadline is signalled and answers unavailable", async () => {
	const { dir, file } = tempFile();
	try {
		const clock = fakeSettleClock();
		const h = harness({ file, timers: clock });
		assert.deepEqual(await h.notifier.notify(request()), { shown: true });
		h.notifier.setAuthority({ epoch: 2, settling: true });
		h.banners[0].emit("click");
		const parkedSignals = h.signals.length;
		assert.equal(
			h.notifier.takePendingOpen(),
			null,
			"a click during a hold stays parked, unread",
		);
		assert.equal(clock.fire(), 1);
		assert.equal(
			h.signals.length,
			parkedSignals + 1,
			"the deadline tells the renderer exactly once",
		);
		assert.deepEqual(
			h.notifier.takePendingOpen(),
			{ unavailable: true },
			"the parked click resolves as unavailable rather than waiting on an unrelated event",
		);
		const settledSignals = h.signals.length;
		h.notifier.setAuthority({ epoch: 2, settling: false });
		assert.equal(
			h.signals.length,
			settledSignals,
			"a deduped settled-absence update signals nothing of its own",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("CODE-M1 QA-M1 a deduped signed-out settlement still answers the parked click", async () => {
	const { dir, file } = tempFile();
	try {
		const clock = fakeSettleClock();
		const h = harness({ file, timers: clock });
		await h.notifier.notify(request());
		h.notifier.setAuthority({ epoch: 2, settling: true });
		h.banners[0].emit("click");
		assert.equal(clock.fire(), 1);
		// The account read finally answers "still signed out": the very state the
		// deadline already wrote, so this update is deduped and signals nothing.
		h.notifier.setAuthority({ epoch: 2, settling: false });
		const signals = h.signals.length;
		assert.deepEqual(
			h.notifier.takePendingOpen(),
			{ unavailable: true },
			"the click is answered, not stranded by the dedupe",
		);
		assert.equal(signals, h.signals.length);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

for (const nextAccount of ["acct_a", "acct_b"]) {
	test(`QA-M1 a refresh settling to ${nextAccount} clears the deadline`, async () => {
		const { dir, file } = tempFile();
		try {
			const clock = fakeSettleClock();
			const h = harness({ file, timers: clock });
			await h.notifier.notify(request());
			h.notifier.setAuthority({ epoch: 2, settling: true });
			assert.equal(clock.pending(), 1);
			h.notifier.setAuthority({
				accountId: nextAccount,
				epoch: 2,
				settling: false,
			});
			assert.equal(clock.pending(), 0, "a settled refresh has no deadline");
			assert.equal(
				h.banners[0].closed,
				nextAccount !== "acct_a",
				"same account keeps the banner; a different one withdraws it",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
}

test("QA-M1 document replacement cancels a pending deadline instead of expiring it", async () => {
	const { dir, file } = tempFile();
	try {
		const clock = fakeSettleClock();
		const h = harness({ file, timers: clock });
		await h.notifier.notify(request());
		h.notifier.setAuthority({ epoch: 2, settling: true });
		h.notifier.resetAuthority();
		assert.equal(clock.pending(), 0);
		assert.equal(
			h.banners[0].closed,
			false,
			"a new document is not a sign-out",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/*
 * Code review round 2. M1 is the switch that BYPASSES this journal: a credential
 * replaced outside the app (a CLI sign-in) never advances the epoch, so the
 * focus re-read publishes "settling" and then a settled owner the same-epoch
 * fence used to reject outright - leaving the hold stuck with the departing
 * account's previews still delivered.
 */
test("CODE-M1 an out-of-band account switch at the same epoch withdraws and answers", async () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		assert.deepEqual(await h.notifier.notify(request()), { shown: true });
		// The commit-gap publish the renderer makes once the journal says B but
		// QueryClient still holds A.
		h.notifier.setAuthority({ epoch: 1, settling: true });
		assert.equal(h.banners[0].closed, false, "a refresh holds the banner");
		// The settled publish. Same epoch; the fence must not admit B...
		h.notifier.setAuthority({
			accountId: "acct_b",
			epoch: 1,
			settling: false,
		});
		// ...but it must not leave the hold stuck either.
		assert.equal(h.banners[0].closed, true, "the departing previews are gone");
		h.banners[0].emit("click");
		assert.deepEqual(h.notifier.takePendingOpen(), { unavailable: true });
		assert.deepEqual(
			await h.notifier.notify(
				request({ owner: { accountId: "acct_b", epoch: 1 } }),
			),
			{ shown: false },
			"B is not admitted through an epoch that never advanced",
		);
		assert.deepEqual(
			await h.notifier.notify(
				request({ owner: { accountId: "acct_a", epoch: 1 } }),
			),
			{ shown: false },
			"A is not re-admitted either",
		);
		// A real credential write establishes the next owner again.
		h.notifier.setAuthority({ accountId: "acct_b", epoch: 2 });
		assert.deepEqual(
			await h.notifier.notify(
				request({ owner: { accountId: "acct_b", epoch: 2 } }),
			),
			{ shown: true },
			"the fix must not permanently disable delivery for the new owner",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/*
 * Code review round 2 m1. A banner replaced by a newer one, or dismissed by the
 * OS, belongs to the account still signed in; only a banner this process
 * withdrew may answer with the stale sentence.
 */
for (const how of ["replaced by a newer message", "dismissed by the OS"]) {
	test(`CODE-m1 a banner ${how} still routes under the same account`, async () => {
		const { dir, file } = tempFile();
		try {
			const h = harness({ file });
			await h.notifier.notify(request());
			const clicked = h.banners[0];
			if (how === "replaced by a newer message") {
				await h.notifier.notify(request({ seq: 5 }));
			} else {
				clicked.emit("close");
			}
			clicked.emit("click");
			const target = h.notifier.takePendingOpen();
			assert.ok(target && !("unavailable" in target), "no stale toast");
			assert.equal(target.conversationId, "bcv_abc123");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
}

test("CODE-m1 a banner withdrawn by a sign-out still answers as stale", async () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		await h.notifier.notify(request());
		const withdrawn = h.banners[0];
		h.notifier.setAuthority({ accountId: "acct_b", epoch: 2 });
		withdrawn.emit("click");
		assert.deepEqual(h.notifier.takePendingOpen(), { unavailable: true });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// Sender v1 is additive; a bad optional identity/image never loses a message.
const personSender = (patch = {}) => ({
	v: 1,
	kind: "person",
	account_id: "acc_ben",
	display_name: "Ben Tran",
	...patch,
});
test("sender kinds and owner-avatar equality fail safe without suppressing delivery", async () => {
	for (const kind of ["person", "person_agent"]) {
		const sender = personSender({
			kind,
			agent_name: "Aida",
			avatar: { account_id: "acc_ben", hash: "0123456789abcdef" },
		});
		assert.equal(
			limits.parseTeamBridgeNotifyRequest(request({ sender })).sender.kind,
			kind,
		);
		sender.avatar.account_id = "acc_someone_else";
		assert.equal(
			limits.parseTeamBridgeNotifyRequest(request({ sender })).sender.avatar,
			undefined,
		);
	}
	for (const sender of [
		personSender({ kind: "local" }),
		personSender({ kind: "unknown" }),
		personSender({ v: 2 }),
		personSender({ display_name: "Ben\u202e" }),
		personSender({ kind: "person_agent" }),
	]) {
		const parsed = limits.parseTeamBridgeNotifyRequest(request({ sender }));
		assert.ok(parsed);
		assert.equal(parsed.sender, undefined);
	}
});

test("cold sender enrichment posts within its deadline; completion never re-alerts or changes click routing", async () => {
	const { dir, file } = tempFile();
	let resolve;
	const fetch = new Promise((done) => {
		resolve = done;
	});
	let warming = 0;
	const images = {
		read() {
			warming++;
			return fetch;
		},
		peek() {},
		clear() {},
	};
	const clock = waitClock();
	try {
		const h = harness({ file, images, timers: clock });
		const result = h.notifier.notify(request({ sender: personSender() }));
		clock.fireAll();
		assert.deepEqual(await result, { shown: true });
		assert.equal(h.banners[0].shown, true);
		assert.equal(h.banners[0].options.title, "Ben Tran");
		assert.equal(h.banners[0].options.icon, "app-icon");
		assert.equal(h.banners[0].options.silent, false);
		assert.equal(warming, 1);
		h.banners[0].emit("close");
		resolve();
		await fetch;
		assert.equal(
			h.banners.length,
			1,
			"image completion cannot resurrect the dismissed banner",
		);
		h.banners[0].emit("click");
		assert.deepEqual(h.notifier.takePendingOpen(), {
			owner: request().owner,
			conversationId: request().conversationId,
			tenantId: request().tenantId,
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("warm composite follows the person source kind; agent title names its owner and agent", async () => {
	const { dir, file } = tempFile();
	const images = {
		read: async (r) => (r.sender ? `${r.sender.kind}-composite` : undefined),
		peek() {},
		clear() {},
	};
	try {
		const h = harness({ file, images });
		await h.notifier.notify(
			request({
				sender: personSender({ kind: "person_agent", agent_name: "Aida" }),
			}),
		);
		assert.equal(h.banners[0].options.icon, "person_agent-composite");
		assert.match(h.banners[0].options.title, BEN_NAME);
		assert.match(h.banners[0].options.title, AIDA_NAME);
		await h.notifier.notify(
			request({ seq: 5, sender: personSender({ kind: "local" }) }),
		);
		assert.equal(h.banners[1].options.icon, "app-icon");
		assert.equal(
			h.banners[1].options.silent,
			true,
			"burst/DND behavior unchanged",
		);
		assert.equal("urgency" in h.banners[1].options, false);
		assert.equal("timeoutType" in h.banners[1].options, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// This header is enough for the bounded admission check. The bytes after it
// carry a TAG naming what core was asked to draw, and the fake decoder turns
// those bytes into `composite:<tag>`: every icon assertion below therefore
// proves which bytes reached the banner (QA Q-1), not merely that "something"
// did. Actual Pillow PNG decoding is covered by core loopback QA.
const compositePng = (tag = "untagged") => {
	const data = Buffer.alloc(100);
	Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data);
	data.writeUInt32BE(13, 8);
	data.write("IHDR", 12);
	data.writeUInt32BE(64, 16);
	data.writeUInt32BE(64, 20);
	data.write(tag, 33);
	return data;
};
const TRAILING_NUL = /\0+$/u;
const tagOf = (data) =>
	Buffer.from(data).subarray(33).toString("utf8").replace(TRAILING_NUL, "");
/** The tag a fake core stamps on a request: variant/kind/account(/hash). */
const coreTag = (input) =>
	input.avatar
		? `photo/${input.kind}/${input.accountId}/${input.avatar.hash}`
		: `initials/${input.kind}/${input.accountId}/${input.initials}`;
const coreBytes = (input) => ({
	kind: "bytes",
	status: 200,
	mimeType: "image/png",
	data: compositePng(coreTag(input)),
});
const BEN_INITIALS_TAG = "initials/person/acc_ben/BT";
const BEN_INITIALS = `composite:${BEN_INITIALS_TAG}`;
const tick = () => new Promise((resolve) => setImmediate(resolve));
function imageCache(options = {}) {
	return new notifierModule.TeamBridgeNotificationImages({
		enabled: () => true,
		theme: () => "light",
		request: async (input) => coreBytes(input),
		decode: (data) => `composite:${tagOf(data)}`,
		...options,
	});
}

test("photo cache hit/miss, TTL, LRU, tenant/epoch isolation and late auth fencing", async () => {
	let now = 0;
	let calls = 0;
	const cache = imageCache({
		now: () => now,
		request: async () => {
			calls++;
			return {
				kind: "bytes",
				status: 200,
				mimeType: "image/png",
				data: compositePng(BEN_INITIALS_TAG),
			};
		},
	});
	const r = request({
		sender: personSender({
			avatar: { account_id: "acc_ben", hash: "0123456789abcdef" },
		}),
	});
	assert.equal(await cache.read(r, 250), BEN_INITIALS);
	assert.equal(calls, 1);
	assert.equal(await cache.read(r, 250), BEN_INITIALS);
	assert.equal(calls, 1, "positive hit does not refetch");
	assert.equal(
		await cache.read({ ...r, tenantId: "tnt_other" }, 250),
		BEN_INITIALS,
	);
	assert.equal(calls, 2, "tenant is isolated");
	assert.equal(
		await cache.read({ ...r, owner: { ...r.owner, epoch: 2 } }, 250),
		BEN_INITIALS,
	);
	assert.equal(calls, 3, "epoch is isolated");
	// Pinned to the operator's 15 minutes in literal ms: a test that read the
	// constant back would follow any change to it and prove nothing.
	assert.equal(notifierModule.TEAM_BRIDGE_IMAGE_TTL_MS, 900_000);
	now = 899_999;
	assert.equal(await cache.read(r, 250), BEN_INITIALS);
	assert.equal(calls, 3, "inside the TTL is still a hit");
	now = 900_000;
	assert.equal(await cache.read(r, 250), BEN_INITIALS);
	assert.equal(calls, 4, "TTL expiry refetches");
	for (let i = 0; i <= notifierModule.TEAM_BRIDGE_IMAGE_MAX_ENTRIES; i++) {
		await cache.read(
			{ ...r, sender: personSender({ account_id: `acc_${i}` }) },
			250,
		);
	}
	assert.equal(
		cache.peek({ ...r, sender: personSender({ account_id: "acc_0" }) }),
		undefined,
	);
	assert.equal(
		cache.peek({ ...r, sender: personSender({ account_id: "acc_64" }) }),
		BEN_INITIALS,
	);
	let release;
	const pending = imageCache({
		request: () =>
			new Promise((done) => {
				release = done;
			}),
	});
	const late = pending.read(r, 250);
	pending.clear();
	release({
		kind: "bytes",
		status: 200,
		mimeType: "image/png",
		data: compositePng(BEN_INITIALS_TAG),
	});
	await late;
	assert.equal(
		pending.peek(r),
		undefined,
		"auth clear fences an in-flight completion",
	);
});

test("single-flight shares one request and photo is requested at banner size", async () => {
	const calls = [];
	let release;
	const cache = imageCache({
		request: (input) => {
			calls.push(input);
			return new Promise((done) => {
				release = done;
			});
		},
	});
	const r = request({ sender: personSender() });
	const first = cache.read(r, 250);
	const second = cache.read(r, 250);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].size, 64);
	release({
		kind: "bytes",
		status: 200,
		mimeType: "image/png",
		data: compositePng(BEN_INITIALS_TAG),
	});
	assert.equal(await first, BEN_INITIALS);
	assert.equal(await second, BEN_INITIALS);
});

test("directory refresh evicts missing members and changed hashes per tenant and warms", async () => {
	const cache = imageCache();
	const owner = { accountId: "acct_a", epoch: 1 };
	const sender = personSender({
		avatar: { account_id: "acc_ben", hash: "0123456789abcdef" },
	});
	const changed = personSender({
		avatar: { account_id: "acc_ben", hash: "fedcba9876543210" },
	});
	const one = request({ sender });
	const other = request({ tenantId: "tnt_other", sender });
	const OLD_PHOTO = "composite:photo/person/acc_ben/0123456789abcdef";
	const NEW_PHOTO = "composite:photo/person/acc_ben/fedcba9876543210";
	assert.equal(await cache.read(one, 250), OLD_PHOTO);
	assert.equal(await cache.read(other, 250), OLD_PHOTO);
	cache.syncDirectory({ owner, tenantId: "tnt_1", members: [changed] });
	await tick();
	await tick();
	// The old version's photo is gone; a banner still carrying it falls back to
	// the initials the same refresh warmed - never the revoked photo.
	assert.equal(cache.peek(one), BEN_INITIALS, "changed hash evicts the photo");
	assert.equal(cache.peek(request({ sender: changed })), NEW_PHOTO, "warmed");
	assert.equal(cache.peek(other), OLD_PHOTO, "other tenant survives");
	cache.syncDirectory({ owner, tenantId: "tnt_1", members: [] });
	assert.equal(cache.peek(one), undefined, "missing member evicts");
	assert.equal(
		cache.peek(request({ sender: changed })),
		undefined,
		"missing member evicts photo and initials",
	);
	assert.equal(cache.peek(other), OLD_PHOTO);
});

test("every auth transition clears photo cache including settling and document reset", async () => {
	for (const transition of [
		"sign-in",
		"sign-out",
		"switch",
		"epoch",
		"settling",
		"reset",
	]) {
		const { dir, file } = tempFile();
		try {
			const cache = imageCache();
			const h = harness({ file, images: cache });
			const r = request({ sender: personSender() });
			await cache.read(r, 250);
			assert.equal(cache.peek(r), BEN_INITIALS);
			if (transition === "sign-in")
				h.notifier.setAuthority({ accountId: "acct_a", epoch: 2 });
			if (transition === "sign-out") h.notifier.setAuthority({ epoch: 1 });
			if (transition === "switch")
				h.notifier.setAuthority({ accountId: "acct_b", epoch: 2 });
			if (transition === "epoch")
				h.notifier.setAuthority({ accountId: "acct_a", epoch: 2 });
			if (transition === "settling")
				h.notifier.setAuthority({
					accountId: "acct_a",
					epoch: 1,
					settling: true,
				});
			if (transition === "reset") h.notifier.resetAuthority();
			assert.equal(cache.peek(r), undefined, transition);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

test("the 250 ms deadline posts at once (app icon: no roster warm, so unknown sender); a late composite is cached, never re-posted", async () => {
	const { dir, file } = tempFile();
	try {
		let release;
		const cache = imageCache({
			request: () =>
				new Promise((done) => {
					release = done;
				}),
		});
		const clock = waitClock();
		const h = harness({ file, images: cache, timers: clock });
		const pending = h.notifier.notify(request({ sender: personSender() }));
		assert.equal(h.banners.length, 0, "nothing is shown before the deadline");
		assert.equal(
			[...clock.pending.values()][0].delay,
			250,
			"deadline is 250 ms",
		);
		clock.fireAll();
		assert.deepEqual(await pending, { shown: true });
		assert.equal(
			h.banners[0].options.icon,
			"app-icon",
			"no warmed initials exist for a sender no roster named",
		);
		release({
			kind: "bytes",
			status: 200,
			mimeType: "image/png",
			data: compositePng(BEN_INITIALS_TAG),
		});
		await tick();
		assert.equal(h.banners.length, 1, "a late composite never posts again");
		assert.equal(
			h.banners[0].options.icon,
			"app-icon",
			"the shown banner is not replaced",
		);
		assert.equal(cache.peek(request({ sender: personSender() })), BEN_INITIALS);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a second banner is not delayed by an in-flight first", async () => {
	const { dir, file } = tempFile();
	try {
		let releaseFirst;
		const cache = imageCache({
			request: (input) =>
				input.accountId === "acc_ben"
					? new Promise((done) => {
							releaseFirst = done;
						})
					: Promise.resolve({
							kind: "bytes",
							status: 200,
							mimeType: "image/png",
							data: compositePng(BEN_INITIALS_TAG),
						}),
		});
		const clock = waitClock();
		const h = harness({ file, images: cache, timers: clock });
		const first = h.notifier.notify(request({ sender: personSender() }));
		const second = h.notifier.notify(
			request({
				conversationId: "bcv_second",
				seq: 9,
				sender: personSender({ account_id: "acc_ada", display_name: "Ada" }),
			}),
		);
		assert.deepEqual(await second, { shown: true });
		assert.equal(
			h.banners.length,
			1,
			"the second banner posts while the first waits",
		);
		assert.equal(
			clock.pending.size,
			1,
			"the first still holds its own deadline",
		);
		clock.fireAll();
		await first;
		assert.equal(h.banners[0].options.icon, BEN_INITIALS);
		releaseFirst({
			kind: "bytes",
			status: 200,
			mimeType: "image/png",
			data: compositePng(BEN_INITIALS_TAG),
		});
		await tick();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("renderer_busy is not negative cached; other errors are cached for 30 seconds", async () => {
	let now = 0;
	const bySender = {
		acc_ben: {
			kind: "error",
			status: 503,
			detail: "busy",
			code: "renderer_busy",
		},
		acc_ada: { kind: "error", status: 404, detail: "missing" },
		acc_cy: { kind: "error", status: 503, detail: "plane closed" },
	};
	let calls = 0;
	const cache = imageCache({
		now: () => now,
		request: async (input) => {
			calls++;
			return bySender[input.accountId];
		},
	});
	// Distinct senders keep each case on its own cache key.
	const busy = request({ sender: personSender() });
	const missing = request({ sender: personSender({ account_id: "acc_ada" }) });
	const uncoded = request({ sender: personSender({ account_id: "acc_cy" }) });

	assert.equal(await cache.read(busy, 250), undefined);
	assert.equal(await cache.read(busy, 250), undefined);
	assert.equal(calls, 2, "busy retries on the next banner: no negative cache");

	assert.equal(await cache.read(missing, 250), undefined);
	assert.equal(calls, 3);
	assert.equal(await cache.read(missing, 250), undefined);
	assert.equal(calls, 3, "a non-busy error suppresses the next read");

	// The bare status must never stand in for the code: a 503 without
	// renderer_busy is an ordinary error and IS remembered (core review M1).
	assert.equal(await cache.read(uncoded, 250), undefined);
	assert.equal(calls, 4);
	assert.equal(await cache.read(uncoded, 250), undefined);
	assert.equal(calls, 4, "an uncoded 503 is negative cached");

	assert.equal(notifierModule.TEAM_BRIDGE_IMAGE_NEGATIVE_TTL_MS, 30_000);
	now = 30_000;
	assert.equal(await cache.read(missing, 250), undefined);
	assert.equal(calls, 5, "negative TTL expiry retries");
	assert.equal(await cache.read(busy, 250), undefined);
	assert.equal(
		calls,
		6,
		"an expired positive/negative never blocks a fresh read",
	);
});

test("approved no-store composite is retained in memory with its avatar hash", async () => {
	const calls = [];
	const cache = imageCache({
		request: async (input) => {
			calls.push(input);
			return {
				kind: "bytes",
				status: 200,
				mimeType: "image/png",
				data: compositePng(BEN_INITIALS_TAG),
			};
		},
	});
	const r = request({
		sender: personSender({
			avatar: { account_id: "acc_ben", hash: "0123456789abcdef" },
		}),
	});
	assert.equal(await cache.read(r, 250), BEN_INITIALS);
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0].avatar, {
		account_id: "acc_ben",
		hash: "0123456789abcdef",
	});
});

test("directory sync is fenced by the live authority and never crosses tenants", async () => {
	const { dir, file } = tempFile();
	try {
		let calls = 0;
		const cache = imageCache({
			request: async () => {
				calls++;
				return {
					kind: "bytes",
					status: 200,
					mimeType: "image/png",
					data: compositePng(BEN_INITIALS_TAG),
				};
			},
		});
		const h = harness({ file, images: cache });
		const sender = personSender({
			avatar: { account_id: "acc_ben", hash: "0123456789abcdef" },
		});
		const one = request({ sender });

		// A refused sync must WARM NOTHING, so the discriminator is the request
		// count rather than a peek: `clear()` already emptied the cache, and an
		// empty cache makes "refused" and "cleared" look identical.
		h.notifier.resetAuthority();
		h.notifier.syncDirectory({ tenantId: "tnt_1", members: [sender] });
		await tick();
		assert.equal(calls, 0, "no warm before a settled account exists");

		h.notifier.setAuthority({ epoch: 1, accountId: "acct_a" });
		await cache.read(one, 250);
		assert.equal(calls, 1);
		h.notifier.setAuthority({ epoch: 1, settling: true });
		h.notifier.syncDirectory({ tenantId: "tnt_1", members: [sender] });
		await tick();
		assert.equal(calls, 1, "settling authority refuses the roster too");

		// A settled owner accepts the roster, but ONLY for the tenant it names.
		h.notifier.setAuthority({ accountId: "acct_a", epoch: 2 });
		const owner = { accountId: "acct_a", epoch: 2 };
		const scoped = request({ owner, sender });
		const other = request({ owner, tenantId: "tnt_other", sender });
		await cache.read(scoped, 250);
		await cache.read(other, 250);
		assert.equal(cache.peek(scoped), BEN_INITIALS);
		h.notifier.syncDirectory({ tenantId: "tnt_1", members: [] });
		assert.equal(cache.peek(scoped), undefined, "named tenant evicted");
		assert.equal(
			cache.peek(other),
			BEN_INITIALS,
			"another tenant's photo survives a per-tenant revocation",
		);

		// Malformed envelopes are ignored rather than throwing into IPC.
		for (const bad of [
			null,
			{},
			{ tenantId: 5 },
			{ tenantId: "t", members: {} },
		])
			h.notifier.syncDirectory(bad);
		assert.equal(cache.peek(other), BEN_INITIALS);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a composite in flight for an identity the roster revoked is discarded, not stored", async () => {
	const pending = new Map();
	const cache = imageCache({
		request: (input) =>
			new Promise((done) => {
				pending.set(input.avatar?.hash ?? "none", done);
			}),
	});
	const owner = { accountId: "acct_a", epoch: 1 };
	const oldSender = personSender({
		avatar: { account_id: "acc_ben", hash: "0123456789abcdef" },
	});
	const newSender = personSender({
		avatar: { account_id: "acc_ben", hash: "fedcba9876543210" },
	});
	void cache.read(request({ sender: oldSender }), 250);
	assert.ok(
		pending.has("0123456789abcdef"),
		"the old-hash request is in flight",
	);
	// The roster now says Ben's photo is a DIFFERENT version.
	cache.syncDirectory({ owner, tenantId: "tnt_1", members: [newSender] });
	pending.get("0123456789abcdef")({
		kind: "bytes",
		status: 200,
		mimeType: "image/png",
		data: compositePng(BEN_INITIALS_TAG),
	});
	await tick();
	assert.equal(
		cache.peek(request({ sender: oldSender })),
		undefined,
		"the revoked version's late result is discarded",
	);
	assert.ok(
		pending.has("fedcba9876543210"),
		"the refresh warmed the new version",
	);
	pending.get("fedcba9876543210")({
		kind: "bytes",
		status: 200,
		mimeType: "image/png",
		data: compositePng(BEN_INITIALS_TAG),
	});
	await tick();
	assert.equal(
		cache.peek(request({ sender: newSender })),
		BEN_INITIALS,
		"the current version is cached",
	);
});

/**
 * A fake core for the round-1 remediation tests: records every request, answers
 * with tagged bytes, and HANGS any request `hold` selects until released.
 */
function fakeCore(hold = () => false) {
	const calls = [];
	const held = [];
	return {
		calls,
		held,
		request(input) {
			calls.push(input);
			if (!hold(input)) return Promise.resolve(coreBytes(input));
			return new Promise((done) => held.push({ input, done }));
		},
		releaseAll() {
			for (const { input, done } of held.splice(0)) done(coreBytes(input));
		},
	};
}
const settle = async () => {
	for (let i = 0; i < 6; i++) await tick();
};
const openBanners = (h) => h.banners.filter((b) => b.shown && !b.closed);
const photoOf = (account, hash) => ({
	account_id: account,
	hash,
});

for (const [label, next] of [
	["sign-out", { epoch: 2 }],
	["account switch", { accountId: "acct_b", epoch: 2 }],
	["same-epoch out-of-band switch", { accountId: "acct_b", epoch: 1 }],
]) {
	test(`M1 a ${label} during the image wait posts nothing`, async () => {
		const { dir, file } = tempFile();
		try {
			const core = fakeCore(() => true);
			const cache = imageCache({ request: core.request });
			const clock = waitClock();
			const h = harness({ file, images: cache, timers: clock });
			const pending = h.notifier.notify(request({ sender: personSender() }));
			assert.equal(core.calls.length, 1, "the wait is genuinely in flight");
			h.notifier.setAuthority(next);
			clock.fireAll();
			assert.deepEqual(await pending, { shown: false });
			assert.equal(h.banners.length, 0, "no preview reaches the screen");
			assert.equal(
				h.store.notifiedSeq("acct_a", "bcv_abc123"),
				undefined,
				"a banner never shown never consumes its seq",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
}

test("M1 the window gaining focus during the wait suppresses the banner", async () => {
	const { dir, file } = tempFile();
	try {
		let focused = false;
		const window = { ...fakeWindow(), isFocused: () => focused };
		const core = fakeCore(() => true);
		const clock = waitClock();
		const h = harness({
			file,
			window,
			images: imageCache({ request: core.request }),
			timers: clock,
		});
		const pending = h.notifier.notify(request({ sender: personSender() }));
		focused = true;
		clock.fireAll();
		assert.deepEqual(await pending, { shown: false });
		assert.equal(h.banners.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

for (const seqs of [
	[4, 5],
	[5, 4],
	[4, 4],
]) {
	test(`M1 two notifies (seq ${seqs.join(" then ")}) in one conversation during the wait leave exactly one tracked banner, closed by sign-out`, async () => {
		const { dir, file } = tempFile();
		try {
			const core = fakeCore(() => true);
			const clock = waitClock();
			const h = harness({
				file,
				images: imageCache({ request: core.request }),
				timers: clock,
			});
			const first = h.notifier.notify(
				request({ seq: seqs[0], sender: personSender() }),
			);
			const second = h.notifier.notify(
				request({ seq: seqs[1], sender: personSender() }),
			);
			assert.equal(core.calls.length, 1, "one shared flight");
			clock.fireAll();
			await Promise.all([first, second]);
			assert.equal(openBanners(h).length, 1, "exactly one banner on screen");
			if (seqs[0] === seqs[1])
				assert.equal(h.banners.length, 1, "a duplicate seq raises nothing");
			assert.equal(
				h.store.notifiedSeq("acct_a", "bcv_abc123"),
				Math.max(...seqs),
			);
			h.notifier.setAuthority({ epoch: 2 });
			assert.equal(
				openBanners(h).length,
				0,
				"sign-out closes every banner shown",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
}

test("M2 a warmed person composite never answers an agent banner", async () => {
	const core = fakeCore();
	const cache = imageCache({ request: core.request });
	const owner = { accountId: "acct_a", epoch: 1 };
	const avatar = photoOf("acc_ben", "0123456789abcdef");
	cache.syncDirectory({
		owner,
		tenantId: "tnt_1",
		members: [personSender({ avatar })],
	});
	await settle();
	const person = request({ sender: personSender({ avatar }) });
	assert.equal(
		await cache.read(person, 250),
		"composite:photo/person/acc_ben/0123456789abcdef",
	);
	const before = core.calls.length;
	const agent = request({
		sender: personSender({ kind: "person_agent", agent_name: "Aida", avatar }),
	});
	assert.equal(
		await cache.read(agent, 250),
		"composite:photo/person_agent/acc_ben/0123456789abcdef",
		"the agent banner carries core's agent-marker composite",
	);
	assert.deepEqual(
		core.calls.slice(before).map((input) => input.kind),
		["person_agent"],
		"the agent variant is requested, not served from the person entry",
	);
});

test("M2 a roster carrying a member's agent warms both variants", async () => {
	const core = fakeCore();
	const cache = imageCache({ request: core.request });
	const avatar = photoOf("acc_ben", "0123456789abcdef");
	cache.syncDirectory({
		owner: { accountId: "acct_a", epoch: 1 },
		tenantId: "tnt_1",
		members: [
			personSender({ avatar }),
			personSender({ kind: "person_agent", agent_name: "Aida", avatar }),
		],
	});
	await settle();
	const before = core.calls.length;
	assert.equal(
		await cache.read(
			request({
				sender: personSender({
					kind: "person_agent",
					agent_name: "Aida",
					avatar,
				}),
			}),
			250,
		),
		"composite:photo/person_agent/acc_ben/0123456789abcdef",
	);
	assert.equal(
		await cache.read(request({ sender: personSender({ avatar }) }), 250),
		"composite:photo/person/acc_ben/0123456789abcdef",
		"the person variant is its own entry, not overwritten by the agent's",
	);
	assert.equal(core.calls.length, before, "both served warm, no request");
});

test("Q-1 the deadline posts the warmed initials bytes; no request is made for them in the post path", async () => {
	const { dir, file } = tempFile();
	try {
		// Initials render without the hub and answer; the photo hangs.
		const core = fakeCore((input) => Boolean(input.avatar));
		const cache = imageCache({ request: core.request });
		const clock = waitClock();
		const h = harness({ file, images: cache, timers: clock });
		const sender = personSender({
			avatar: photoOf("acc_ben", "0123456789abcdef"),
		});
		h.notifier.syncDirectory({ tenantId: "tnt_1", members: [sender] });
		await settle();
		core.releaseAll();
		await settle();
		cache.clear();
		h.notifier.syncDirectory({ tenantId: "tnt_1", members: [sender] });
		await settle();
		// Only the initials warm has landed; the photo warm is held.
		assert.equal(cache.peek(request({ sender })), BEN_INITIALS);
		const before = core.calls.length;
		const pending = h.notifier.notify(request({ sender }));
		clock.fireAll();
		assert.deepEqual(await pending, { shown: true });
		assert.equal(
			h.banners[0].options.icon,
			BEN_INITIALS,
			"the banner carries core's initials composite, not the app icon",
		);
		assert.deepEqual(
			core.calls.slice(before),
			[],
			"the photo was already in flight (joined) and no initials request ran",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("Q-1 renderer_busy and refusals fall back to the warmed initials immediately", async () => {
	for (const refusal of [
		{ kind: "error", status: 503, detail: "busy", code: "renderer_busy" },
		{ kind: "error", status: 503, detail: "plane closed" },
		{ kind: "error", status: 401, detail: "x", code: "not_signed_in" },
		{ kind: "error", status: 409, detail: "x", code: "account_mismatch" },
		{ kind: "error", status: 404, detail: "x" },
		{ kind: "error", status: 502, detail: "x", code: "malformed_page" },
	]) {
		const cache = imageCache({
			request: async (input) => (input.avatar ? refusal : coreBytes(input)),
		});
		const sender = personSender({
			avatar: photoOf("acc_ben", "0123456789abcdef"),
		});
		cache.syncDirectory({
			owner: { accountId: "acct_a", epoch: 1 },
			tenantId: "tnt_1",
			members: [sender],
		});
		await settle();
		assert.equal(
			await cache.read(request({ sender }), 250),
			BEN_INITIALS,
			`${refusal.status} ${refusal.code ?? "uncoded"}`,
		);
	}
});

test("Q-1 the app icon is used only for a sender this cache does not know", async () => {
	const { dir, file } = tempFile();
	try {
		const core = fakeCore(() => true);
		const clock = waitClock();
		const h = harness({
			file,
			images: imageCache({ request: core.request }),
			timers: clock,
		});
		// No sender descriptor at all (legacy payload / not in the directory).
		await h.notifier.notify(request());
		assert.equal(h.banners[0].options.icon, "app-icon");
		assert.equal(core.calls.length, 0, "no sender, no request");
		// A sender whose roster never reached main: nothing is warmed for them,
		// so the deadline can only post the app icon.
		const pending = h.notifier.notify(
			request({
				conversationId: "bcv_other",
				sender: personSender({ account_id: "acc_zed" }),
			}),
		);
		clock.fireAll();
		await pending;
		assert.equal(h.banners[1].options.icon, "app-icon");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("Q-2 an identical roster re-sent warms nothing", async () => {
	const core = fakeCore();
	const cache = imageCache({ request: core.request });
	const owner = { accountId: "acct_a", epoch: 1 };
	const members = [
		"acc_ben",
		"acc_cara",
		"acc_dan",
		"acc_eve",
		"acc_fay",
		"acc_gus",
	].map((account_id, i) =>
		personSender({
			account_id,
			avatar: photoOf(account_id, `${i}123456789abcdef`),
		}),
	);
	cache.syncDirectory({ owner, tenantId: "tnt_1", members });
	await settle();
	assert.equal(core.calls.length, 12, "initials + photo for each of six");
	for (let i = 0; i < 4; i++) {
		cache.syncDirectory({ owner, tenantId: "tnt_1", members });
		await settle();
	}
	assert.equal(core.calls.length, 12, "no refetch of live entries");
	// One member changes their photo: exactly one request.
	cache.syncDirectory({
		owner,
		tenantId: "tnt_1",
		members: [
			{ ...members[0], avatar: photoOf("acc_ben", "fedcba9876543210") },
			...members.slice(1),
		],
	});
	await settle();
	assert.deepEqual(
		core.calls
			.slice(12)
			.map((input) => `${input.accountId}/${input.avatar?.hash}`),
		["acc_ben/fedcba9876543210"],
	);
});

test("Q-2 a large roster is warmed completely, in order, never more than two at once", async () => {
	const core = fakeCore(() => true);
	const cache = imageCache({ request: core.request });
	const owner = { accountId: "acct_a", epoch: 1 };
	const accounts = Array.from(
		{ length: 10 },
		(_, i) => `acc_m${String(i).padStart(2, "0")}`,
	);
	cache.syncDirectory({
		owner,
		tenantId: "tnt_1",
		// Deliberately shuffled: warm order must not depend on roster order.
		members: [...accounts]
			.reverse()
			.map((account_id) => personSender({ account_id })),
	});
	let peak = 0;
	while (core.held.length > 0) {
		peak = Math.max(peak, core.held.length);
		core.releaseAll();
		await settle();
	}
	assert.deepEqual(
		core.calls.map((input) => input.accountId),
		accounts,
		"all ten warmed, deterministically by account id",
	);
	assert.equal(peak, 2, "never more than one request per core render slot");
});

test("Q-2 a banner for an uncached sender starts its own fetch while warming is saturated", async () => {
	const { dir, file } = tempFile();
	try {
		const core = fakeCore((input) => input.accountId !== "acc_zed");
		const cache = imageCache({ request: core.request });
		const clock = waitClock();
		const h = harness({ file, images: cache, timers: clock });
		h.notifier.syncDirectory({
			tenantId: "tnt_1",
			members: ["acc_ben", "acc_cara", "acc_dan", "acc_eve"].map((account_id) =>
				personSender({ account_id }),
			),
		});
		const zed = personSender({
			account_id: "acc_zed",
			display_name: "Zed Ode",
		});
		const shown = await h.notifier.notify(
			request({ conversationId: "bcv_zed", sender: zed }),
		);
		assert.deepEqual(shown, { shown: true });
		assert.deepEqual(
			core.calls.filter((input) => input.accountId === "acc_zed").length,
			1,
			"the banner's miss was fetched, not starved by warming",
		);
		assert.equal(core.held.length, 2, "warming stayed saturated meanwhile");
		assert.equal(
			h.banners[0].options.icon,
			"composite:initials/person/acc_zed/ZO",
		);
		core.releaseAll();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("m1 the banner lane holds at most four requests and theme separates entries", async () => {
	const core = fakeCore(() => true);
	const cache = imageCache({ request: core.request });
	for (let i = 0; i < 6; i++)
		void cache.read(
			request({ sender: personSender({ account_id: `acc_b${i}` }) }),
			250,
		);
	assert.equal(core.calls.length, 4);
	assert.equal(notifierModule.TEAM_BRIDGE_IMAGE_POST_CONCURRENCY, 4);
	core.releaseAll();
	await settle();

	let theme = "light";
	const themed = fakeCore();
	const both = imageCache({ request: themed.request, theme: () => theme });
	const r = request({ sender: personSender() });
	await both.read(r, 250);
	theme = "dark";
	await both.read(r, 250);
	assert.deepEqual(
		themed.calls.map((input) => input.theme),
		["light", "dark"],
		"a light composite never answers a dark banner",
	);
});

test("m5 a roster sent while a known account is settling is refused", async () => {
	const { dir, file } = tempFile();
	try {
		const core = fakeCore();
		const cache = imageCache({ request: core.request });
		const h = harness({ file, images: cache });
		h.notifier.setAuthority({ accountId: "acct_a", epoch: 1, settling: true });
		h.notifier.syncDirectory({ tenantId: "tnt_1", members: [personSender()] });
		await settle();
		assert.equal(core.calls.length, 0);
		// n1: a tenant id outside the notify id vocabulary is refused at the edge.
		h.notifier.setAuthority({ accountId: "acct_a", epoch: 2 });
		h.notifier.syncDirectory({ tenantId: "../x", members: [personSender()] });
		await settle();
		assert.equal(core.calls.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
