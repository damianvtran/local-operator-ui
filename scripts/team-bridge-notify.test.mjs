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
			'export * from "./src/main/team-bridge-notifier"; export { registerDesktopIPC } from "./src/main/desktop-ipc";',
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

test("a valid notification payload parses exactly", () => {
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

test("bad payloads are refused, not repaired", () => {
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

test("the click path names the organization and the conversation", () => {
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

test("the first complete answer seeds every cursor and raises nothing", () => {
	const result = plan({ seeded: false });
	assert.equal(result.candidates.length, 0);
	assert.equal(result.cursors.get("bcv_1"), 2);
	assert.equal(result.seeded, true);
});

test("a newer seq for a member on notify=all is a candidate", () => {
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

test("the same seq is never notified twice", () => {
	const first = plan({ cursors: new Map([["bcv_1", 1]]) });
	const second = plan({ cursors: first.cursors });
	assert.equal(first.candidates.length, 1);
	assert.equal(second.candidates.length, 0);
});

test("member=false is never notified, even with unread", () => {
	const result = plan({
		conversations: [conversation({ member: false, discoverable: true })],
		cursors: new Map([["bcv_1", 1]]),
	});
	assert.equal(result.candidates.length, 0);
	assert.equal(result.cursors.get("bcv_1"), 2);
});

test("notify=mention and notify=mute are silent in v1", () => {
	for (const notify of ["mention", "mute"]) {
		const result = plan({
			conversations: [conversation({ notify })],
			cursors: new Map([["bcv_1", 1]]),
		});
		assert.equal(result.candidates.length, 0, notify);
		assert.equal(result.cursors.get("bcv_1"), 2, notify);
	}
});

test("the legacy muted flag is silent when notify is absent", () => {
	const result = plan({
		conversations: [conversation({ muted: true })],
		cursors: new Map([["bcv_1", 1]]),
	});
	assert.equal(result.candidates.length, 0);
});

test("membership is derived from an active human member when the flag is absent", () => {
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

test("a focused window suppresses the banner but consumes the seq", () => {
	const result = plan({ cursors: new Map([["bcv_1", 1]]), quiet: true });
	assert.equal(result.candidates.length, 0);
	assert.equal(result.cursors.get("bcv_1"), 2);
});

test("an unread row without conversation metadata waits for the next poll", () => {
	const result = plan({
		conversations: [],
		cursors: new Map([["bcv_1", 1]]),
	});
	assert.equal(result.candidates.length, 0);
	assert.equal(result.cursors.get("bcv_1"), 1);
});

test("a conversation that first appears after the seed is a candidate", () => {
	const result = plan({ cursors: new Map() });
	assert.equal(result.candidates.length, 1);
	assert.equal(result.candidates[0].seq, 2);
});

test("a read row advances its cursor instead of notifying", () => {
	const result = plan({
		rows: [notifyRow({ unread_count: 0, last_read_seq: 2 })],
		cursors: new Map([["bcv_1", 1]]),
	});
	assert.equal(result.candidates.length, 0);
	assert.equal(result.cursors.get("bcv_1"), 2);
});

test("the QA account + tenant payloads produce one candidate and one banner", () => {
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
		assert.deepEqual(h.notifier.notify(request), { shown: true });
		assert.equal(h.banners.length, 1);
		assert.equal(h.banners[0].options.title, "QA Notify Group (QA Org)");
		assert.equal(h.banners[0].options.body, "New message");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an organization with a zero total contributes no read and no rows", () => {
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

test("the sender label is the list row's, trimmed, and absent means fallback", () => {
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

test("an organization the caller cannot name is omitted from the subject", () => {
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
	});
	notifier.setAuthority?.({ accountId: "acct_a", epoch: 1 });
	return { notifier, banners, signals, reopens, presented, store, window };
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

test("account transition revokes old banners and cannot route their clicks", () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		h.notifier.setAuthority?.({ accountId: "acct_a", epoch: 1 });
		h.notifier.notify(request({ owner: { accountId: "acct_a", epoch: 1 } }));
		h.notifier.setAuthority?.({ accountId: "acct_b", epoch: 2 });
		assert.equal(h.banners[0].closed, true);
		h.banners[0].emit("click");
		assert.equal(h.notifier.takePendingOpen(), null);
		assert.equal(h.signals.length, 0);
		assert.equal(h.presented.length, 0);
		assert.deepEqual(
			h.notifier.notify(request({ owner: { accountId: "acct_b", epoch: 2 } })),
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

test("main raises one banner with the exact renderer strings", () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		assert.deepEqual(h.notifier.notify(request()), { shown: true });
		assert.equal(h.banners.length, 1);
		assert.equal(h.banners[0].options.title, "Ada (Minerva)");
		assert.equal(h.banners[0].options.body, "Ada sent a message");
		assert.equal(h.banners[0].options.silent, false);
		assert.equal(h.banners[0].shown, true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("main refuses a malformed payload", () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		assert.throws(() => h.notifier.notify(request({ title: "<b>x</b>" })));
		assert.equal(h.banners.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a duplicate seq is collapsed and a newer seq replaces the banner", () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		h.notifier.notify(request());
		assert.deepEqual(h.notifier.notify(request()), { shown: false });
		assert.equal(h.banners.length, 1);

		assert.deepEqual(h.notifier.notify(request({ seq: 5 })), { shown: true });
		assert.equal(h.banners.length, 2);
		assert.equal(h.banners[0].closed, true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the persisted cursor survives a restart", () => {
	const { dir, file } = tempFile();
	try {
		const first = harness({ file });
		first.notifier.notify(request());
		const raw = readFileSync(file, "utf8");
		assert.equal(
			JSON.parse(raw).cursors[JSON.stringify(["acct_a", "bcv_abc123"])],
			4,
		);
		assert.equal(raw.includes("Ada sent"), false);

		const second = harness({ file });
		assert.deepEqual(second.notifier.notify(request()), { shown: false });
		assert.equal(second.banners.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a focused window is quiet", () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file, window: fakeWindow({ focused: true }) });
		assert.deepEqual(h.notifier.notify(request()), { shown: false });
		assert.equal(h.banners.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("headless and unsupported runs raise nothing", () => {
	const { dir, file } = tempFile();
	try {
		const headless = harness({ file, show: "never" });
		assert.deepEqual(headless.notifier.notify(request()), { shown: false });
		assert.equal(headless.banners.length, 0);

		const unsupported = harness({ file, supported: false });
		assert.deepEqual(unsupported.notifier.notify(request()), { shown: false });
		assert.equal(unsupported.banners.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a click signals and parks the target until the renderer pulls it", () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		h.notifier.notify(request());
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

test("a click with no window asks for one and parks the target", () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file, window: null });
		h.notifier.notify(request());
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

test("a corrupt cursor file fails toward a possible duplicate, never a crash", () => {
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

test("load enforces the cursor bound, not only record", () => {
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

test("reply summary seq/root survive planning, native click and old-root navigation", () => {
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
		h.notifier.notify(
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

test("same conversation cursor is isolated by account across restart", () => {
	const { dir, file } = tempFile();
	try {
		const a = harness({ file });
		assert.deepEqual(a.notifier.notify(request()), { shown: true });
		const b = harness({ file });
		b.notifier.setAuthority?.({ accountId: "acct_b", epoch: 2 });
		assert.deepEqual(
			b.notifier.notify(request({ owner: { accountId: "acct_b", epoch: 2 } })),
			{ shown: true },
		);
		assert.deepEqual(
			b.notifier.notify(request({ owner: { accountId: "acct_b", epoch: 2 } })),
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

test("logout revokes preview retention and parked targets; late authority cannot rearm them", () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		h.notifier.notify(request());
		h.banners[0].emit("click");
		h.notifier.notify(request({ seq: 5 }));
		h.notifier.setAuthority({ epoch: 2 });
		assert.equal(h.banners[1].closed, true);
		assert.equal(h.notifier.takePendingOpen(), null);
		assert.equal(
			h.notifier.lifetime.size,
			0,
			"even an adapter without close events releases previews",
		);
		h.notifier.setAuthority({ accountId: "acct_a", epoch: 1 });
		assert.deepEqual(h.notifier.notify(request({ seq: 6 })), { shown: false });
		h.notifier.setAuthority({ accountId: "acct_b", epoch: 2 });
		h.notifier.setAuthority({ accountId: "acct_a", epoch: 2 });
		assert.deepEqual(
			h.notifier.notify(
				request({ owner: { accountId: "acct_a", epoch: 2 }, seq: 6 }),
			),
			{ shown: false },
		);
		h.banners[1].emit("click");
		assert.equal(h.notifier.takePendingOpen(), null);
		assert.equal(h.signals.length, 1, "only the click before logout signalled");
		assert.throws(() => h.notifier.notify(request({ owner: undefined })));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("A to B to A cannot revive an earlier credential epoch click or notify", () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		h.notifier.notify(request());
		h.notifier.setAuthority({ accountId: "acct_b", epoch: 2 });
		h.notifier.setAuthority({ accountId: "acct_a", epoch: 3 });
		h.banners[0].emit("click");
		assert.equal(h.notifier.takePendingOpen(), null);
		assert.deepEqual(h.notifier.notify(request({ seq: 5 })), { shown: false });
		assert.deepEqual(
			h.notifier.notify(
				request({ owner: { accountId: "acct_a", epoch: 3 }, seq: 5 }),
			),
			{ shown: true },
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("legacy accountless cursor is never assigned to the next account", () => {
	const { dir, file } = tempFile();
	try {
		writeFileSync(
			file,
			JSON.stringify({ version: 1, cursors: { bcv_abc123: 999 } }),
		);
		const h = harness({ file });
		assert.deepEqual(h.notifier.notify(request()), { shown: true });
		const persisted = JSON.parse(readFileSync(file, "utf8"));
		assert.equal(persisted.version, 2);
		assert.equal(persisted.cursors.bcv_abc123, undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("authorized IPC fences late epochs, auxiliary frames and document replacement", () => {
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
			invoke("notify", request({ owner: { accountId: "acct_a", epoch: 5 } })),
			{ shown: true },
		);
		invoke("authority", { epoch: 6 });
		assert.equal(h.banners[0].closed, true);
		invoke("authority", { accountId: "acct_a", epoch: 5 });
		assert.deepEqual(
			invoke(
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
		invoke("notify", request({ owner: { accountId: "acct_b", epoch: 6 } }));
		contents.emit(
			"did-start-navigation",
			{},
			"file:///app/index.html",
			false,
			true,
		);
		assert.equal(h.banners[1].closed, true);
		assert.throws(
			() => invoke("authority", { accountId: "acct_b", epoch: 6 }),
			DOCUMENT_REFUSAL,
		);
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
			invoke(
				"notify",
				request({ owner: { accountId: "acct_b", epoch: 0 }, seq: 5 }),
			),
			{ shown: true },
		);
		contents.emit("destroyed");
		assert.equal(h.banners[2].closed, true);
		h.banners[2].emit("click");
		assert.equal(invoke("pending-open"), null);
	} finally {
		globalThis.__teamBridgeHandlers = undefined;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("native identifiers cannot collide across colon-bearing owner/conversation pairs", () => {
	assert.notEqual(
		notifierModule.teamBridgeBannerId("acct:a", "bcv"),
		notifierModule.teamBridgeBannerId("acct", "a:bcv"),
	);
});

test("R2 unknown revocation preserves the established epoch owner", () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		h.notifier.setAuthority({ accountId: "acct_a", epoch: 5 });
		h.notifier.setAuthority({ epoch: 5 });
		assert.deepEqual(
			h.notifier.notify(request({ owner: { accountId: "acct_a", epoch: 5 } })),
			{ shown: false },
		);
		h.notifier.setAuthority({ accountId: "acct_b", epoch: 5 });
		assert.deepEqual(
			h.notifier.notify(request({ owner: { accountId: "acct_b", epoch: 5 } })),
			{ shown: false },
		);
		h.notifier.setAuthority({ accountId: "acct_a", epoch: 5 });
		assert.deepEqual(
			h.notifier.notify(request({ owner: { accountId: "acct_a", epoch: 5 } })),
			{ shown: true },
			"the established owner can resolve a temporary unknown",
		);
		h.notifier.setAuthority({ epoch: 6 });
		h.notifier.setAuthority({ accountId: "acct_b", epoch: 5 });
		assert.deepEqual(
			h.notifier.notify(
				request({ owner: { accountId: "acct_b", epoch: 5 }, seq: 7 }),
			),
			{ shown: false },
		);
		h.notifier.setAuthority({ accountId: "acct_b", epoch: 6 });
		assert.deepEqual(
			h.notifier.notify(request({ owner: { accountId: "acct_b", epoch: 6 } })),
			{ shown: true },
			"higher epoch can establish a new owner",
		);
		h.notifier.resetAuthority();
		h.notifier.setAuthority({ accountId: "acct_c", epoch: 0 });
		assert.deepEqual(
			h.notifier.notify(
				request({ owner: { accountId: "acct_c", epoch: 0 }, seq: 8 }),
			),
			{ shown: true },
			"trusted document reset clears epoch binding",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
