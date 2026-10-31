import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * Team Bridge OS banners: WHAT they say and HOW a burst coalesces.
 *
 * The companion of `team-bridge-notify.test.mjs` (which owns the poll policy,
 * the payload limits and the persisted cursor). This file pins the
 * tb-os-notifications slice: sender-as-title, place-as-subtitle, a sanitised
 * one-line preview, the "N new messages" count, one OS id per conversation,
 * a silent replacement inside the coalescing window, per-conversation quiet,
 * the #agents rule, and the thread hook on the click target.
 *
 * Same house pattern: esbuild bundles the SHIPPED TypeScript; main gets a fake
 * Electron `Notification`.
 */
async function load(entry, options = {}) {
	const out = await build({
		stdin: { contents: `export * from "${entry}";`, resolveDir: process.cwd() },
		bundle: true,
		format: "esm",
		platform: options.platform ?? "neutral",
		write: false,
		plugins: options.plugins ?? [],
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`
	);
}

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
			contents:
				"export class Notification { static isSupported() { return true; } }",
		}));
	},
};

const format = await load(
	"./src/renderer/src/features/team-bridge/team-bridge-banner-format",
);
const policy = await load(
	"./src/renderer/src/features/team-bridge/team-bridge-notify-model",
);
const contract = await load("./src/shared/team-bridge-notify");
const notifierModule = await load("./src/main/team-bridge-notifier", {
	platform: "node",
	plugins: [electronFixture],
});
const storeModule = await load("./src/main/team-bridge-notify-store", {
	platform: "node",
});

/* English copy, injected the way the hook injects the catalogue. */
const copy = {
	untitled: "Untitled conversation",
	directMessage: "Direct message",
	group: "Group",
	channel: (name) => `#${name}`,
	subtitle: (place, organization) => `${place} · ${organization}`,
	count: (count) => `${count} new messages`,
	countPreview: (count, preview) => `${count} new messages: ${preview}`,
	fallback: "New message",
};

// ---------------------------------------------------------------------------
// Preview text
// ---------------------------------------------------------------------------

test("markdown is stripped to the words a person wrote", () => {
	assert.equal(
		format.teamBridgePreviewText(
			"## Status\n- **Deploy** is _done_, see [the run](https://x.test/1)\n- `pnpm test` green",
		),
		"Status Deploy is done, see the run pnpm test green",
	);
	assert.equal(
		format.teamBridgePreviewText("> quoted\n\n```ts\nconst a = 1;\n```\nafter"),
		"quoted const a = 1; after",
	);
	assert.equal(format.teamBridgePreviewText("![diagram](x.png)"), "diagram");
	assert.equal(
		format.teamBridgePreviewText("see <https://x.test/a>"),
		"see https://x.test/a",
	);
	// A lone underscore is an identifier, not emphasis.
	assert.equal(
		format.teamBridgePreviewText("rename snake_case_name now"),
		"rename snake_case_name now",
	);
});

test("the preview is one line and carries nothing main would refuse", () => {
	const preview = format.teamBridgePreviewText(
		"a > b\nand <b>bold</b>\tx\u202Eevil\u0007",
	);
	assert.equal(preview, "a › b and bold x evil");
	// The same validator main runs must accept it inside a payload.
	assert.ok(
		contract.parseTeamBridgeNotifyRequest({
			owner: { accountId: "acct_a", epoch: 1 },
			conversationId: "bcv_1",
			tenantId: "tnt_1",
			title: "Ada",
			body: preview,
			seq: 1,
		}),
	);
});

test("the preview is bounded by code points and never splits an emoji", () => {
	const long = `${"🚀".repeat(150)}`;
	const preview = format.teamBridgePreviewText(long);
	assert.equal(Array.from(preview).length, format.TEAM_BRIDGE_PREVIEW_MAX + 1);
	assert.ok(preview.endsWith("…"));
	assert.ok(!preview.includes("\uFFFD"));
	// 140 astral points + ellipsis + the count lead still fits main's limit.
	const body = copy.countPreview(99, preview);
	assert.ok(body.length <= contract.TEAM_BRIDGE_NOTIFY_MAX_BODY, body.length);
	assert.equal(
		format.teamBridgePreviewText("short"),
		"short",
		"no ellipsis when it fits",
	);
});

test("an empty or unreadable body is no preview, not an empty line", () => {
	assert.equal(format.teamBridgePreviewText(null), null);
	assert.equal(format.teamBridgePreviewText(undefined), null);
	assert.equal(format.teamBridgePreviewText("   \n "), null);
	assert.equal(format.teamBridgePreviewText("![](x.png)"), null);
	assert.equal(format.teamBridgePreviewText("---"), null);
});

// ---------------------------------------------------------------------------
// Banner composition
// ---------------------------------------------------------------------------

const facts = (patch = {}) => ({
	senderLabel: "Ada Lovelace",
	conversationName: "general",
	place: { kind: "channel", name: "general" },
	organizationName: "Minerva",
	preview: "Can you look at the deploy?",
	unreadCount: 1,
	...patch,
});

test("a channel post: sender, #channel · org, preview", () => {
	assert.deepEqual(format.teamBridgeBannerText(facts(), copy), {
		title: "Ada Lovelace",
		subtitle: "#general · Minerva",
		body: "Can you look at the deploy?",
	});
});

test("a DM from a chief of staff: the composed agent label, Direct message", () => {
	assert.deepEqual(
		format.teamBridgeBannerText(
			facts({ senderLabel: "Aida (Ben)", place: { kind: "dm" } }),
			copy,
		),
		{
			title: "Aida (Ben)",
			subtitle: "Direct message · Minerva",
			body: "Can you look at the deploy?",
		},
	);
});

test("several unread become one count line that keeps the newest preview", () => {
	assert.equal(
		format.teamBridgeBannerText(facts({ unreadCount: 3 }), copy).body,
		"3 new messages: Can you look at the deploy?",
	);
	assert.equal(
		format.teamBridgeBannerText(facts({ unreadCount: 3, preview: null }), copy)
			.body,
		"3 new messages",
	);
});

test("missing facts degrade honestly instead of inventing them", () => {
	assert.deepEqual(
		format.teamBridgeBannerText(
			facts({
				senderLabel: null,
				organizationName: null,
				preview: null,
				place: { kind: "group", name: null },
				conversationName: "Ada, Bea",
			}),
			copy,
		),
		{ title: "Ada, Bea", subtitle: "Ada, Bea", body: "New message" },
	);
	assert.equal(
		format.teamBridgeBannerText(
			facts({ senderLabel: null, conversationName: null }),
			copy,
		).title,
		"Untitled conversation",
	);
});

// ---------------------------------------------------------------------------
// Who may be notified
// ---------------------------------------------------------------------------

const human = (accountId) => ({
	account_id: accountId,
	kind: "human",
	display_label: accountId,
	role: "member",
	state: "active",
});
const agent = (accountId) => ({ ...human(accountId), kind: "agent" });

test("#agents is silent; #humans and ordinary channels are not", () => {
	const base = { member: true, members: [], notify: "all", muted: false };
	assert.equal(
		policy.shouldNotifyTeamBridge({ ...base, builtin: "agents" }, "acct_a"),
		false,
	);
	assert.equal(
		policy.shouldNotifyTeamBridge({ ...base, builtin: "humans" }, "acct_a"),
		true,
	);
	assert.equal(policy.shouldNotifyTeamBridge(base, "acct_a"), true);
	// #general is a people channel too: the reader's own preference decides.
	assert.equal(
		policy.shouldNotifyTeamBridge({ ...base, builtin: "general" }, "acct_a"),
		true,
	);
	assert.equal(
		policy.shouldNotifyTeamBridge(
			{ ...base, builtin: "general", notify: "mention" },
			"acct_a",
		),
		false,
	);
});

test("agent-to-agent traffic the human is not a member of raises nothing", () => {
	// Two chiefs of staff in a DM: the reader's account appears only as an
	// AGENT member's owner id, which is not human membership.
	const agentDm = {
		members: [agent("acct_a"), agent("acct_b")],
		notify: "all",
		muted: false,
	};
	assert.equal(policy.shouldNotifyTeamBridge(agentDm, "acct_a"), false);
});

// ---------------------------------------------------------------------------
// Main: one OS id per conversation, silent coalescing, quiet, subtitle, thread
// ---------------------------------------------------------------------------

function fakeBanner(options) {
	const banner = {
		options,
		shown: false,
		closed: false,
		handlers: {},
		once(event, handler) {
			const wrapper = () => {
				banner.handlers[event] = banner.handlers[event].filter(
					(entry) => entry !== wrapper,
				);
				handler();
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

function harness({
	focused = false,
	platform = "darwin",
	images,
	waitTimers,
} = {}) {
	const dir = mkdtempSync(join(tmpdir(), "team-bridge-banner-"));
	const banners = [];
	const signals = [];
	let clock = 1_000_000;
	const window = {
		isDestroyed: () => false,
		isFocused: () => focused,
		isVisible: () => true,
		isMinimized: () => false,
	};
	const notifier = new notifierModule.TeamBridgeNotifier({
		window: () => window,
		show: "focus",
		store: new storeModule.TeamBridgeNotifyStore(join(dir, "cursors.json")),
		host: { signalOpen: () => signals.push(true), reopen: () => undefined },
		canNotify: () => true,
		platform,
		now: () => clock,
		...(images ? { images } : {}),
		...(waitTimers ?? {}),
		createBanner: (options) => {
			const banner = fakeBanner(options);
			banners.push(banner);
			return banner;
		},
	});
	notifier.setAuthority({ accountId: "acct_a", epoch: 1 });
	return {
		notifier,
		banners,
		signals,
		advance: (ms) => {
			clock += ms;
		},
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

const request = (patch = {}) => ({
	owner: { accountId: "acct_a", epoch: 1 },
	conversationId: "bcv_abc123",
	tenantId: "tnt_1",
	title: "Ada Lovelace",
	subtitle: "#general · Minerva",
	body: "Can you look at the deploy?",
	seq: 4,
	...patch,
});

test("macOS gets title, native subtitle and preview, under a stable id", async () => {
	const h = harness();
	try {
		assert.deepEqual(await h.notifier.notify(request()), { shown: true });
		const options = h.banners[0].options;
		assert.equal(options.title, "Ada Lovelace");
		assert.equal(options.subtitle, "#general · Minerva");
		assert.equal(options.body, "Can you look at the deploy?");
		assert.equal(options.id, "team-bridge:acct_a:bcv_abc123");
		assert.equal(options.groupId, "team-bridge:acct_a:bcv_abc123");
		assert.equal(options.silent, false);
	} finally {
		h.cleanup();
	}
});

test("Windows and Linux fold the place into the body", async () => {
	for (const platform of ["win32", "linux"]) {
		const h = harness({ platform });
		try {
			await h.notifier.notify(request());
			const options = h.banners[0].options;
			assert.equal(options.subtitle, undefined);
			assert.equal(
				options.body,
				"#general · Minerva — Can you look at the deploy?",
			);
		} finally {
			h.cleanup();
		}
	}
});

test("a burst replaces the banner under the same id and sounds once", async () => {
	const h = harness();
	try {
		await h.notifier.notify(request({ seq: 4 }));
		h.advance(3_000);
		await h.notifier.notify(
			request({ seq: 6, body: "3 new messages: also the flag" }),
		);
		assert.equal(h.banners.length, 2);
		assert.equal(h.banners[0].closed, true, "the earlier banner is replaced");
		assert.equal(h.banners[1].options.id, h.banners[0].options.id);
		assert.equal(h.banners[1].options.silent, true, "no second sound");
		assert.equal(h.banners[1].options.body, "3 new messages: also the flag");

		// Outside the window it is a new moment and sounds again.
		h.advance(notifierModule.TEAM_BRIDGE_COALESCE_MS + 1);
		await h.notifier.notify(request({ seq: 7 }));
		assert.equal(h.banners[2].options.silent, false);
	} finally {
		h.cleanup();
	}
});

test("a different conversation is never coalesced into another's banner", async () => {
	const h = harness();
	try {
		await h.notifier.notify(request());
		await h.notifier.notify(request({ conversationId: "bcv_other", seq: 1 }));
		assert.equal(h.banners[0].closed, false);
		assert.equal(h.banners[1].options.silent, false);
		assert.notEqual(h.banners[1].options.id, h.banners[0].options.id);
	} finally {
		h.cleanup();
	}
});

test("a focused window is quiet only for the conversation on screen", async () => {
	const h = harness({ focused: true });
	try {
		assert.deepEqual(await h.notifier.notify(request({ viewing: true })), {
			shown: false,
		});
		// Reading #general does not hide a DM from someone else.
		assert.deepEqual(
			await h.notifier.notify(
				request({ conversationId: "bcv_dm", seq: 9, viewing: false }),
			),
			{ shown: true },
		);
		// An older renderer that cannot say keeps the original rule.
		assert.deepEqual(
			await h.notifier.notify(request({ conversationId: "bcv_old", seq: 1 })),
			{ shown: false },
		);
	} finally {
		h.cleanup();
	}
});

test("the thread hook routes the parked target in the shipped build", async () => {
	// ASYNC because main made the notify path asynchronous; the assertion is this
	// branch's, because the hold is flipped here so the parked thread target is
	// routed rather than dropped. Taking either side whole would be wrong: the
	// branch's version did not await, and main's asserts the held (unrouted) path.
	const h = harness();
	try {
		await h.notifier.notify(request({ threadId: "bms_root1" }));
		h.banners[0].emit("click");
		const target = h.notifier.takePendingOpen();
		assert.deepEqual(target, {
			owner: { accountId: "acct_a", epoch: 1 },
			conversationId: "bcv_abc123",
			tenantId: "tnt_1",
			threadId: "bms_root1",
		});
		assert.equal(
			contract.teamBridgeOpenPath(target),
			"/team-bridge?tenant=tnt_1&conversation=bcv_abc123&thread=bms_root1",
		);
		assert.equal(h.signals.length, 1);
	} finally {
		h.cleanup();
	}
});

test("the additive fields are optional and refused whole when malformed", () => {
	const minimal = {
		owner: { accountId: "acct_a", epoch: 1 },
		conversationId: "bcv_1",
		tenantId: "tnt_1",
		title: "Ada",
		body: "hi",
		seq: 1,
	};
	// Display additions remain optional; the captured owner is mandatory.
	assert.deepEqual(contract.parseTeamBridgeNotifyRequest(minimal), minimal);
	for (const bad of [
		{ subtitle: "<i>x</i>" },
		{ subtitle: "" },
		{ threadId: "has space" },
		{ viewing: "yes" },
	]) {
		assert.equal(
			contract.parseTeamBridgeNotifyRequest({ ...minimal, ...bad }),
			null,
			JSON.stringify(bad),
		);
	}
});

// R1-1: all native lines share one policy. A hostile label must neither spoof
// another line nor make the watcher silently lose the whole banner.
test("hostile sender/place/body labels are sanitised before IPC and strictly refused raw", () => {
	const hostile = [
		"\n",
		"\t",
		"\u0005",
		"\u007f",
		"\u0085",
		"\u009f",
		"\u061c",
		"\u200e",
		"\u200f",
		"\u2028",
		"\u2029",
	];
	for (let code = 0x202a; code <= 0x202e; code += 1)
		hostile.push(String.fromCodePoint(code));
	for (let code = 0x2066; code <= 0x2069; code += 1)
		hostile.push(String.fromCodePoint(code));
	for (const unsafe of hostile) {
		const text = format.teamBridgeBannerText(
			facts({
				senderLabel: `Ada${unsafe}<admin>`,
				place: { kind: "channel", name: `general${unsafe}<ops>` },
				organizationName: `Minerva${unsafe}<org>`,
				preview: `hello${unsafe}<world>`,
			}),
			copy,
		);
		assert.deepEqual(text, {
			title: "Ada ‹admin›",
			subtitle: "#general ‹ops› · Minerva ‹org›",
			body: "hello ‹world›",
		});
		assert.ok(contract.parseTeamBridgeNotifyRequest(request(text)));
		for (const field of ["title", "subtitle", "body"]) {
			assert.equal(
				contract.parseTeamBridgeNotifyRequest(
					request({ [field]: `Ada${unsafe}FAKE` }),
				),
				null,
			);
			assert.equal(
				contract.parseTeamBridgeNotifyRequest(
					request({ [field]: `Ada${unsafe}` }),
				),
				null,
			);
		}
	}
	for (const unsafe of ["<", ">"]) {
		for (const field of ["title", "subtitle", "body"]) {
			assert.equal(
				contract.parseTeamBridgeNotifyRequest(
					request({ [field]: `Ada${unsafe}admin` }),
				),
				null,
			);
		}
	}
});

test("oversized labels and bodies are bounded to each IPC limit without dropping the banner", () => {
	const text = format.teamBridgeBannerText(
		facts({
			senderLabel: "👩‍💻".repeat(500),
			place: { kind: "channel", name: "long".repeat(500) },
			organizationName: "Org".repeat(500),
			preview: "🙂".repeat(500),
		}),
		copy,
	);
	assert.ok(text.title.length <= contract.TEAM_BRIDGE_NOTIFY_MAX_TITLE);
	assert.ok(text.subtitle.length <= contract.TEAM_BRIDGE_NOTIFY_MAX_SUBTITLE);
	assert.ok(text.body.length <= contract.TEAM_BRIDGE_NOTIFY_MAX_BODY);
	assert.ok(contract.parseTeamBridgeNotifyRequest(request(text)));
	assert.ok(text.title.endsWith("👩‍💻…"));
});

// D1: fit the longest whole-grapheme prefix within the 140-codepoint content
// budget, not the first 140 points of a family emoji, flag or accented letter.
test("preview truncation keeps ZWJ emoji, flags and combining marks whole", () => {
	for (const grapheme of ["👩‍💻", "👨‍👩‍👧‍👦", "🇻🇳", "e\u0301"]) {
		const size = Array.from(grapheme).length;
		const shortPrefix = "x".repeat(140 - size + 1);
		assert.equal(
			format.teamBridgePreviewText(`${shortPrefix}${grapheme}tail`),
			`${shortPrefix}…`,
		);
		const exactPrefix = "x".repeat(140 - size);
		assert.equal(
			format.teamBridgePreviewText(`${exactPrefix}${grapheme}tail`),
			`${exactPrefix}${grapheme}…`,
		);
		assert.equal(
			format.teamBridgePreviewText(`${exactPrefix}${grapheme}`),
			`${exactPrefix}${grapheme}`,
		);
	}
});

test("retained handlers receive only routing IDs, never the preview-bearing request", async () => {
	const h = harness();
	try {
		const retained = [];
		const original = h.notifier.retainTarget.bind(h.notifier);
		h.notifier.retainTarget = (notification, target) => {
			retained.push(target);
			return original(notification, target);
		};
		await h.notifier.notify(
			request({ threadId: "bms_root1", body: "private preview fixture" }),
		);
		assert.deepEqual(retained, [
			{
				owner: { accountId: "acct_a", epoch: 1 },
				conversationId: "bcv_abc123",
				tenantId: "tnt_1",
				threadId: "bms_root1",
			},
		]);
		h.banners[0].emit("click");
		assert.deepEqual(h.notifier.takePendingOpen(), retained[0]);
	} finally {
		h.cleanup();
	}
});

/**
 * notify() awaits a bounded sender-image wait (<=250 ms) before it posts. The
 * post-wait half must re-check what the wait could have changed, and must
 * do the replace/burst step only then. An image source that never answers
 * stands in for a slow core, and the captured deadline is fired by hand.
 */
function hangingWait() {
	const armed = [];
	return {
		images: {
			read: () => new Promise(() => {}),
			peek: () => undefined,
			syncDirectory() {},
			clear() {},
		},
		waitTimers: {
			setWaitTimer: (callback) => {
				armed.push(callback);
				return armed.length;
			},
			clearWaitTimer() {},
		},
		fire: () => {
			for (const callback of armed.splice(0)) callback();
		},
	};
}

test("a banner waiting on its image is not posted after a sign-out, and nothing is posted before the wait ends", async () => {
	const wait = hangingWait();
	const h = harness(wait);
	try {
		const pending = h.notifier.notify(request());
		assert.equal(h.banners.length, 0, "nothing posts during the wait");
		h.notifier.setAuthority({ epoch: 2 });
		wait.fire();
		assert.deepEqual(await pending, { shown: false });
		assert.equal(h.banners.length, 0, "no preview after the sign-out");
	} finally {
		h.cleanup();
	}
});

test("a burst that arrives during the image wait replaces once and sounds once", async () => {
	const wait = hangingWait();
	const h = harness(wait);
	try {
		const first = h.notifier.notify(request({ seq: 4 }));
		const second = h.notifier.notify(
			request({ seq: 6, body: "3 new messages: also the flag" }),
		);
		wait.fire();
		assert.deepEqual(await first, { shown: true });
		assert.deepEqual(await second, { shown: true });
		assert.equal(h.banners.length, 2);
		assert.equal(h.banners[0].closed, true, "the earlier banner is replaced");
		assert.equal(h.banners[1].closed, false);
		assert.equal(h.banners[1].options.silent, true, "no second sound");
		assert.equal(h.banners[1].options.body, "3 new messages: also the flag");
	} finally {
		h.cleanup();
	}
});
