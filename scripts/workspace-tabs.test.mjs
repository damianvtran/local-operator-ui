import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
	stdin: {
		contents: `
			export * from "./workspace-tabs-model";
			export * from "./workspace-tab-cleanup";
			export { translate } from "../../../../i18n/messages";
		`,
		resolveDir: new URL("../src/renderer/src/features/chat/", import.meta.url)
			.pathname,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	WORKSPACE_INACTIVE_MINUTES,
	WORKSPACE_INACTIVE_MS,
	advanceWorkspaceCleanup,
	confirmedWorkspaceRest,
	displayedWorkspaceTabs,
	makeWorkspaceTab,
	moveWorkspaceTab,
	sanitizeSavedWorkspaceTabs,
	saveWorkspaceTabs,
	syncWorkspaceTabs,
	translate,
	workspaceNeighbor,
	workspaceSessionPathMatches,
	workspaceTarget,
} = await import(
	`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
);

const targetA = { kind: "session", id: "000000aaaaaa" };
const targetB = { kind: "session", id: "000000bbbbbb" };
const targetC = { kind: "session", id: "000000cccccc" };
const draft = { kind: "draft", id: "draft:synthetic" };
const sessionA = makeWorkspaceTab(targetA);
const sessionB = makeWorkspaceTab(targetB);
const sessionC = makeWorkspaceTab(targetC);
const draftTab = makeWorkspaceTab(draft);

const source = (name) =>
	readFileSync(new URL(`../src/renderer/src/${name}`, import.meta.url), "utf8");
const modelPath = "features/chat/components/";
const routePath = /^\/chat\//;

test("reopening canonical ids focuses the existing target without adding a duplicate", () => {
	const opened = syncWorkspaceTabs([], targetA, {});
	assert.strictEqual(syncWorkspaceTabs(opened, { ...targetA }, {}), opened);
	assert.deepEqual(workspaceTarget(null, targetA.id, {}), targetA);
	assert.deepEqual(
		workspaceTarget(draft.id, targetB.id, { [draft.id]: {} }),
		draft,
	);
	assert.equal(workspaceTarget(draft.id, targetB.id, {}), undefined);
	assert.equal(
		workspaceSessionPathMatches(`/chat/${targetA.id}`, targetA.id),
		true,
	);
	for (const path of [
		"/chat",
		`/chat/${targetA.id}/extra`,
		`/settings/${targetA.id}`,
	]) {
		assert.equal(workspaceSessionPathMatches(path, targetA.id), false);
	}
});

test("a background admission preserves the exact draft tab position and either pin", () => {
	const staged = [sessionB, draftTab, { ...sessionA, pinned: true }, sessionC];
	const result = syncWorkspaceTabs(
		staged,
		targetC,
		{},
		{ [draft.id]: { sessionId: targetA.id } },
	);
	assert.deepEqual(result, [
		sessionB,
		{ ...draftTab, target: targetA, pinned: true },
		sessionC,
	]);
	assert.deepEqual(
		workspaceTarget(draft.id, null, { [draft.id]: { sessionId: targetA.id } }),
		targetA,
	);
	assert.deepEqual(syncWorkspaceTabs(staged, targetC, {}), [
		sessionB,
		staged[2],
		sessionC,
	]);
});

test("close fallback follows visible order and reordering cannot cross lanes", () => {
	const tabs = [sessionA, { ...sessionB, pinned: true }, sessionC];
	assert.deepEqual(
		displayedWorkspaceTabs(tabs).map((tab) => tab.key),
		[sessionB.key, sessionA.key, sessionC.key],
	);
	assert.equal(workspaceNeighbor(tabs, sessionA.key), sessionC);
	assert.equal(workspaceNeighbor(tabs, sessionB.key), sessionA);
	assert.strictEqual(moveWorkspaceTab(tabs, sessionA.key, sessionB.key), tabs);
	assert.strictEqual(moveWorkspaceTab(tabs, "external", sessionC.key), tabs);
	assert.deepEqual(
		displayedWorkspaceTabs(
			moveWorkspaceTab(tabs, sessionA.key, sessionC.key),
		).map((tab) => tab.key),
		[sessionB.key, sessionC.key, sessionA.key],
	);
});

test("saved preferences consist of known session identities, order and boolean pins only", () => {
	const saved = saveWorkspaceTabs([
		sessionB,
		{ ...draftTab, pinned: true },
		sessionA,
	]);
	assert.deepEqual(saved, [
		{ id: targetB.id, pinned: false },
		{ id: targetA.id, pinned: false },
	]);
	assert.deepEqual(
		sanitizeSavedWorkspaceTabs([
			...saved,
			{ ...saved[0], pinned: true },
			{ id: draft.id, pinned: true },
			{ id: targetC.id, pinned: "true" },
			{ id: targetC.id, pinned: true, message: "not copied" },
		]),
		[...saved, { id: targetC.id, pinned: true }],
	);
});

const receipt = { epoch: "fixture", revision: 3, code: "idle" };
const resting = {
	locality: "local",
	status_epoch: receipt.epoch,
	status_revision: receipt.revision,
	status: { code: receipt.code },
	active: false,
	background_work: false,
	waiting_on: 0,
	jobs_running: 0,
	pending: null,
	asks_open: 0,
};

test("only a positively confirmed resting local session can age out", () => {
	assert.equal(
		confirmedWorkspaceRest(resting, receipt, undefined, false),
		true,
	);
	for (const patch of [
		{ locality: undefined },
		{ locality: "remote" },
		{ link_down: true },
		{ active: true },
		{ active: undefined },
		{ background_work: true },
		{ background_work: undefined },
		{ waiting_on: 1 },
		{ jobs_running: 1 },
		{ pending: "approve" },
		{ asks_open: 1 },
		{ asks_open: undefined },
		{ status_revision: 2 },
		{ status_epoch: "prior" },
		{ status: { code: "answer" } },
	])
		assert.equal(
			confirmedWorkspaceRest(
				{ ...resting, ...patch },
				receipt,
				undefined,
				false,
			),
			false,
			JSON.stringify(patch),
		);
	assert.equal(
		confirmedWorkspaceRest(resting, undefined, undefined, false),
		false,
	);
	assert.equal(
		confirmedWorkspaceRest(resting, receipt, undefined, true),
		false,
	);
	for (const draftInput of [
		{ currentInput: "unsent" },
		{ attachments: ["file"] },
		{ replies: ["quote"] },
		{ inFlight: {} },
		{ returned: {} },
	]) {
		assert.equal(
			confirmedWorkspaceRest(
				resting,
				receipt,
				{ attachments: [], replies: [], ...draftInput },
				false,
			),
			false,
		);
	}
});

test("the fake clock confirms expiry at exactly the configured interval and resets on lost proof", () => {
	const tabs = [sessionA, { ...sessionB, pinned: true }, sessionC, draftTab];
	const now = 125;
	const check = (at, prior, evidence = () => "fixture:3") =>
		advanceWorkspaceCleanup(tabs, targetC, at, prior, evidence);
	const start = check(now, new Map());
	assert.deepEqual([...start.next.keys()], [sessionA.key]);
	assert.equal(start.wakeAt, now + WORKSPACE_INACTIVE_MS);
	assert.equal(check(start.wakeAt - 1, start.next).expired.size, 0);
	assert.deepEqual(
		[...check(start.wakeAt, start.next).expired],
		[sessionA.key],
	);
	assert.equal(
		check(start.wakeAt, start.next, () => "fixture:4").expired.size,
		0,
	);
	const interrupted = check(start.wakeAt - 1, start.next, () => undefined);
	assert.equal(check(start.wakeAt, interrupted.next).expired.size, 0);
});

// This label sits next to manual Close tab in a narrow menu. Keep the tab
// terminology consistent and the timeout's number/unit together where the locale calls for it.
for (const [locale, check] of Object.entries({
	fr: (label) => label.endsWith(`${WORKSPACE_INACTIVE_MINUTES}\u202fmin`),
	ur: (label, closeTab) =>
		label.includes(
			`${WORKSPACE_INACTIVE_MINUTES} منٹ تک غیر فعال رہنے کے بعد`,
		) && label.endsWith(closeTab),
	vi: (label, closeTab) =>
		label.startsWith(`${closeTab} sau ${WORKSPACE_INACTIVE_MINUTES} phút`),
	"zh-CN": (label) => label.startsWith(`闲置${WORKSPACE_INACTIVE_MINUTES}分钟`),
})) {
	test(`cleanup menu label follows ${locale} terminology and number spacing`, () => {
		const label = translate(
			"ui.chat.header.auto_close_inactive_tabs",
			{
				minutes: WORKSPACE_INACTIVE_MINUTES,
			},
			locale,
		);
		const closeTab = translate(
			"ui.browser.browser_tab_strip.close_tab",
			{},
			locale,
		);
		assert.ok(check(label, closeTab), label);
	});
}

test("titlebar activation and actions keep one navigation owner and never trust a drop payload", () => {
	const strip = source(`${modelPath}workspace-tabs.tsx`);
	const hook = source(`${modelPath}use-workspace-tabs.ts`);
	const page = source(`${modelPath}chat-page.tsx`);
	assert.equal((page.match(/<SessionPanel\b/g) ?? []).length, 1);
	assert.ok(strip.includes("button.focus({ preventScroll: true })"));
	assert.ok(strip.includes('data-titlebar-no-drag=""'));
	assert.ok(strip.includes('data-titlebar-drag=""'));
	assert.ok(
		strip.includes('data-workspace-pinned=""') &&
			strip.includes('data-workspace-regular=""'),
	);
	assert.ok(strip.includes('data-workspace-tab-menu=""'));
	assert.ok(strip.includes('dataTransfer.setData(WORKSPACE_DRAG, "")'));
	assert.ok(!strip.includes("dataTransfer.getData"));
	assert.ok(hook.includes("store.openDraft(target.id)"));
	assert.ok(hook.includes("return openConversation(navigate, target.id)"));
	assert.ok(hook.includes("if (!(await open(next))) return;"));
	assert.ok(hook.includes("state.validatingSessionId === next.target.id"));
	assert.ok(hook.includes("state.forgotten[handoff.to.id] === undefined"));
	assert.ok(!routePath.test(hook));
});
