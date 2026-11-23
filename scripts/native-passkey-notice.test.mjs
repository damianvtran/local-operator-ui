import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/browser/native-passkey-notice";',
			'export * from "./src/main/browser/extensions/subframe-policy";',
			'export * from "./src/main/browser/extensions/tab-engagement";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	NativePasskeyNotice,
	TabEngagement,
	refusesExtensionSubframe,
	dismissNativePasskeyNoticeOnEscape,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const agent = { tabId: 7, owner: "agent", presented: true };
const request = { requestId: "native-1", tabId: agent.tabId };
const source = {
	owner: "agent",
	documentEpoch: 1,
	origin: "https://rp.example",
};

test("passive provider frame is denied both before and after trusted selection", () => {
	const engagement = new TabEngagement();
	const notices = new NativePasskeyNotice();
	const frame = {
		isMainFrame: false,
		url: "chrome-extension://fixture/inline/notification/notification.html#type=notificationManager",
		owner: agent.owner,
	};
	assert.equal(refusesExtensionSubframe(frame), true);
	assert.equal(notices.viewFor(agent), null);
	engagement.selected(7, true, true);
	assert.equal(engagement.has(7), true);
	assert.equal(refusesExtensionSubframe(frame), true);
	assert.equal(notices.viewFor(agent), null);
	assert.equal(refusesExtensionSubframe({ ...frame, owner: "user" }), false);
	const wiring = readFileSync("src/main/browser/index.ts", "utf8");
	assert.match(
		wiring,
		/will-frame-navigate[\s\S]*?if \(\s*!refusesExtensionSubframe\([\s\S]*?\)\s*return;\s*(?:(?!\breturn\b)[\s\S])*?event\.preventDefault\(\);/,
	);
	assert.match(wiring, /waitingOnUser: \(\) => heldPopups\.entries\(\)/);
	assert.equal(wiring.match(/nativePasskeyNotice\.started\(/g)?.length, 1);
	assert.match(
		wiring,
		/send\("browser-webauthn-request", request\);[\s\S]*?if \(\s*nativePasskeyNotice\.started\(/,
	);
});

test("unattended native auth is request-specific and never takes tab custody", () => {
	const notices = new NativePasskeyNotice();
	const engagement = new TabEngagement();
	const hiddenAgent = { ...agent, presented: false };
	assert.equal(
		notices.started(request, hiddenAgent, engagement, source),
		false,
	);
	assert.equal(notices.viewFor(agent), null);
	assert.deepEqual(notices.pendingFor(7), [
		{
			status: "pending-auth",
			blocking: false,
			requestId: request.requestId,
			tabId: 7,
		},
	]);
	assert.deepEqual(notices.pendingFor(8), []);
	assert.deepEqual(notices.pendingFor(7, 2), []);
	// A conflicting request can report pending immediately, but neither reading
	// that outcome nor dismissing chrome settles a provider callback.
	assert.equal(notices.dismiss(7, 1), false);
	assert.equal(notices.pendingFor(7).length, 1);
	const copy = notices.pendingFor(7);
	copy[0].tabId = 99;
	assert.equal(notices.pendingFor(7)[0].tabId, 7);
	assert.equal(notices.settled(request.requestId), false);
	assert.deepEqual(notices.pendingFor(7), []);
});

test("two agent tabs and overlapping requests clean up only their own auth state", () => {
	const notices = new NativePasskeyNotice();
	const engagement = new TabEngagement();
	for (const [requestId, tabId] of [
		["a-1", 7],
		["a-2", 7],
		["b-1", 8],
	])
		notices.started({ requestId, tabId }, null, engagement, source);
	assert.deepEqual(
		notices.pendingFor(7).map((r) => r.requestId),
		["a-1", "a-2"],
	);
	assert.deepEqual(
		notices.pendingFor(8).map((r) => r.requestId),
		["b-1"],
	);
	// Cancellation/expiry settles one request, never its sibling or another tab.
	notices.settled("a-1");
	notices.settled("a-1"); // Late settlement is harmless.
	assert.deepEqual(
		notices.pendingFor(7).map((r) => r.requestId),
		["a-2"],
	);
	assert.deepEqual(
		notices.pendingFor(8).map((r) => r.requestId),
		["b-1"],
	);
	// Navigation/close invalidates only the originating tab's projection.
	notices.clearTab(7);
	assert.deepEqual(notices.pendingFor(7), []);
	assert.deepEqual(
		notices.pendingFor(8).map((r) => r.requestId),
		["b-1"],
	);
	notices.settled("a-2");
	assert.equal(notices.pendingFor(8).length, 1);
	notices.clearTab(8);
	assert.deepEqual(notices.pendingFor(8), []);
});

test("unattributed and human-owned native requests cannot create agent auth state", () => {
	const notices = new NativePasskeyNotice();
	const engagement = new TabEngagement();
	for (const unowned of [undefined, { ...source, owner: "user" }])
		notices.started(request, null, engagement, unowned);
	notices.started(
		{ requestId: "unknown", tabId: null },
		null,
		engagement,
		source,
	);
	assert.deepEqual(notices.pendingFor(7), []);
});

test("untrusted selection and background focus never arm the native request", () => {
	const engagement = new TabEngagement();
	const notices = new NativePasskeyNotice();
	for (const [trusted, focused] of [
		[false, true],
		[true, false],
		[false, false],
	]) {
		engagement.selected(7, trusted, focused);
		assert.equal(notices.started(request, agent, engagement), false);
	}
	engagement.selected(7, true, true);
	for (const other of [
		null,
		{ ...agent, tabId: 8 },
		{ ...agent, owner: "user" },
		{ ...agent, presented: false },
	]) {
		assert.equal(notices.started(request, other, engagement), false);
	}
	engagement.activated(8);
	assert.equal(notices.started(request, agent, engagement), false);
});

test("request IDs dedupe; dismissal and settlement cannot clear a different request", () => {
	const engagement = new TabEngagement();
	const notices = new NativePasskeyNotice();
	engagement.selected(7, true, true);
	assert.equal(notices.started(request, agent, engagement), true);
	const first = notices.viewFor(agent);
	assert.deepEqual(first, { tabId: 7, at: 1 });
	assert.equal(notices.started(request, agent, engagement), false);
	assert.equal(notices.dismiss(8, first.at), false);
	assert.equal(notices.dismiss(7, first.at), true);
	assert.equal(notices.started(request, agent, engagement), false);
	assert.equal(notices.viewFor(agent), null);
	assert.equal(
		notices.started({ ...request, requestId: "native-2" }, agent, engagement),
		true,
	);
	assert.equal(notices.settled(request.requestId), true);
	assert.equal(notices.dismiss(7, first.at), false);
	assert.deepEqual(notices.viewFor(agent), { tabId: 7, at: 2 });
	assert.equal(notices.settled("native-2"), true);
	assert.equal(notices.viewFor(agent), null);
});

test("tab cleanup drops projection without answering the chooser", () => {
	const engagement = new TabEngagement();
	const notices = new NativePasskeyNotice();
	engagement.selected(7, true, true);
	assert.equal(notices.started(request, agent, engagement), true);
	assert.equal(notices.clearTab(8), false);
	assert.equal(notices.clearTab(7), true);
	assert.equal(notices.viewFor(agent), null);
	assert.equal(notices.settled(request.requestId), false);
});

test("only page-focused physical Escape claims the visible notice", () => {
	let prevented = 0;
	let dismissed = 0;
	const options = {
		input: { type: "keyDown", key: "Escape" },
		event: {
			defaultPrevented: false,
			preventDefault() {
				prevented++;
			},
		},
		ownsFocusedPage: true,
		agentKey: false,
		providerFocused: false,
		dismiss() {
			dismissed++;
			return true;
		},
	};
	for (const override of [
		{ ownsFocusedPage: false },
		{ agentKey: true },
		{ input: { type: "keyUp", key: "Escape" } },
		{ input: { ...options.input, meta: true } },
		{ input: { ...options.input, isComposing: true } },
		{ input: { ...options.input, isAutoRepeat: true } },
		{ dismiss: () => false },
		// U10: Esc inside a password manager's prompt backs out of THAT prompt.
		{ providerFocused: true },
	])
		assert.equal(
			dismissNativePasskeyNoticeOnEscape({ ...options, ...override }),
			false,
		);
	assert.equal(prevented, 0);
	assert.equal(dismissed, 0);
	assert.equal(dismissNativePasskeyNoticeOnEscape(options), true);
	assert.equal(prevented, 1);
	assert.equal(dismissed, 1);
});

test("U10: the host passes the focused frame's provider-ness to the Escape claim", () => {
	const wiring = readFileSync("src/main/browser/index.ts", "utf8");
	assert.match(
		wiring,
		/dismissNativePasskeyNoticeOnEscape\(\{[\s\S]{0,600}providerFocused: providerFrameFocused\(contents\),/,
	);
});
