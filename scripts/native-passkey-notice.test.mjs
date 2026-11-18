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
		/send\("browser-webauthn-request", request\);\s*if \(\s*nativePasskeyNotice\.started\(/,
	);
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
