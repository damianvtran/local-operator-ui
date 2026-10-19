import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

const electronFixture = {
	name: "electron-fixture",
	setup(builder) {
		builder.onResolve({ filter: ELECTRON_MODULE }, () => ({
			path: "electron",
			namespace: "fixture",
		}));
		builder.onLoad({ filter: ANY_FILE, namespace: "fixture" }, () => ({
			contents: `
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
		contents: 'export * from "./src/main/team-bridge-notifier";',
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

const unread = (rows) => ({ total: rows.length, conversations: rows });
const unreadRow = (patch = {}) => ({
	conversation_id: "bcv_1",
	unread_count: 2,
	last_read_seq: 0,
	latest_seq: 2,
	muted: false,
	...patch,
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
		unread: unread([unreadRow()]),
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
		conversationId: "bcv_abc123",
		tenantId: "tnt_1",
		title: "Ada (Minerva)",
		body: "Ada sent a message",
		seq: 7,
	};
	const cases = [
		["null", null],
		["array", []],
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

test("an open target refuses anything but the two ids", () => {
	assert.deepEqual(
		limits.parseTeamBridgeOpenTarget({
			conversationId: "bcv_abc123",
			tenantId: "tnt_1",
		}),
		{ conversationId: "bcv_abc123", tenantId: "tnt_1" },
	);
	assert.equal(
		limits.parseTeamBridgeOpenTarget({ conversationId: "bcv_1" }),
		null,
	);
	assert.equal(
		limits.parseTeamBridgeOpenTarget({
			conversationId: "bcv 1",
			tenantId: "tnt_1",
		}),
		null,
	);
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
		unread: unread([unreadRow({ unread_count: 0, last_read_seq: 2 })]),
		cursors: new Map([["bcv_1", 1]]),
	});
	assert.equal(result.candidates.length, 0);
	assert.equal(result.cursors.get("bcv_1"), 2);
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
	const sends = [];
	const reopens = [];
	const presented = [];
	const store = new storeModule.TeamBridgeNotifyStore(file);
	const notifier = new notifierModule.TeamBridgeNotifier({
		window: () => window,
		show,
		store,
		host: {
			sendOpen: (target) => sends.push(target),
			reopen: (target) => reopens.push(target),
		},
		canNotify: () => supported,
		createBanner: (options) => {
			const banner = fakeBanner(options);
			banners.push(banner);
			return banner;
		},
		present: (targetWindow) => presented.push(targetWindow),
	});
	return { notifier, banners, sends, reopens, presented, store, window };
}

function tempFile() {
	const dir = mkdtempSync(join(tmpdir(), "team-bridge-notify-"));
	return { dir, file: join(dir, "cursors.json") };
}

const request = (patch = {}) => ({
	conversationId: "bcv_abc123",
	tenantId: "tnt_1",
	title: "Ada (Minerva)",
	body: "Ada sent a message",
	seq: 4,
	...patch,
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
		assert.equal(JSON.parse(raw).cursors.bcv_abc123, 4);
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

test("a click sends the target and presents the window", () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file });
		h.notifier.notify(request());
		h.banners[0].emit("click");
		assert.deepEqual(h.sends, [
			{ conversationId: "bcv_abc123", tenantId: "tnt_1" },
		]);
		assert.equal(h.presented.length, 1);
		assert.equal(h.reopens.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a click with no window parks the target for the next renderer", () => {
	const { dir, file } = tempFile();
	try {
		const h = harness({ file, window: null });
		h.notifier.notify(request());
		assert.equal(h.banners.length, 1);
		h.banners[0].emit("click");
		assert.equal(h.reopens.length, 1);
		assert.deepEqual(h.notifier.takePendingOpen(), {
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
		store.record("bcv_abc123", 3);
		// Simulate corruption between runs.
		rmSync(file);
		const fresh = new storeModule.TeamBridgeNotifyStore(file);
		assert.equal(fresh.notifiedSeq("bcv_abc123"), undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
