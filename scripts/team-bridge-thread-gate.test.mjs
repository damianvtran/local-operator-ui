import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The thread-surface hold, exercised through the SHIPPED modules.
 *
 * WHY THIS FILE EXISTS. The pane and the reply-in-thread affordance carry
 * cross-account isolation defects inherited from #1304, so this build must not
 * reach them however the runtime answers. The matrix below is the fail-closed
 * rule (`unknown`, `below-version`, `unpaired` AND `enabled` all hidden) and
 * the source half pins every mount and route the reviewer census named: a
 * capability that answers `enabled` is the easiest path to accidentally reopen,
 * so it is the case the render test in `team-bridge-directory.test.mjs` uses.
 *
 * THE RETURN PATH IS TESTED, NOT ASSUMED. `teamBridgeThreadsAvailable` accepts
 * the shipped flag so the capability half can be proven without shipping the
 * surface: `enabled` with the flag on is the ONLY true answer.
 */
const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/features/team-bridge/team-bridge-thread-gate";
			export * from "./src/shared/team-bridge-notify";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
});
const gate = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const read = (path) => readFileSync(path, "utf8");
const page = read("src/renderer/src/features/team-bridge/team-bridge-page.tsx");
const messageList = read(
	"src/renderer/src/features/team-bridge/team-bridge-message-list.tsx",
);
const toolbar = read(
	"src/renderer/src/features/team-bridge/team-bridge-message-toolbar.tsx",
);
const pane = read(
	"src/renderer/src/features/team-bridge/team-bridge-thread-pane.tsx",
);
const notifications = read(
	"src/renderer/src/features/team-bridge/use-team-bridge-notifications.ts",
);

test("the build holds the surface: every capability answer is hidden", () => {
	for (const state of [
		undefined,
		"unknown",
		"below-version",
		"unpaired",
		"enabled",
	]) {
		assert.equal(
			gate.teamBridgeThreadsAvailable(state),
			false,
			`${String(state)} must leave the thread surface hidden`,
		);
	}
	assert.equal(
		gate.TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD,
		false,
		"the constant, not the runtime, closes the surface",
	);
});

test("the return path is the capability, and only `enabled` opens it", () => {
	assert.equal(gate.teamBridgeThreadsAvailable("enabled", true), true);
	for (const state of [undefined, "unknown", "below-version", "unpaired"]) {
		assert.equal(
			gate.teamBridgeThreadsAvailable(state, true),
			false,
			`${String(state)} must stay hidden even when shipped`,
		);
	}
});

test("a notification click lands on the conversation, never on a thread", () => {
	const target = {
		conversationId: "bcv_1",
		tenantId: "tnt_1",
		threadId: "bmsg_root",
	};
	const path = gate.teamBridgeOpenPath(target);
	assert.match(path, /^\/team-bridge\?/);
	assert.match(path, /tenant=tnt_1/);
	assert.match(path, /conversation=bcv_1/);
	assert.doesNotMatch(path, /thread=/, "a held build must not route a thread");
	assert.doesNotMatch(path, /bmsg_root/);
});

// ---------------------------------------------------------------------------
// Source wiring: every mount and route the containment census named
// ---------------------------------------------------------------------------

test("the page asks the capability and hands the answer to the view", () => {
	assert.match(
		page,
		/desktopFeatureState\(\s*capabilities\.data,\s*"team_bridge_threads",?\s*\)/,
	);
	assert.match(page, /useDesktopCapabilities\(\)/);
	assert.match(page, /threadsCapabilityState=\{desktopFeatureState\(/);
	assert.match(page, /teamBridgeThreadsAvailable\(threadsCapabilityState\)/);
});

test("the page's thread state, reply handler and pane mount are all held", () => {
	// Selection cannot be seeded or updated while held.
	assert.match(page, /threadsAvailable \? \(threadLink \?\? null\) : null/);
	assert.match(
		page,
		/if \(threadsAvailable && threadLink\) setThreadSelection\(threadLink\)/,
	);
	// The wide-viewport rule that hides the timeline while a thread is open
	// must also require the hold, or a stale selection blanks the pane.
	assert.match(page, /threadsAvailable &&\s*threadSelection &&\s*shown/);
	// The reply affordance is omitted, not passed and ignored.
	assert.match(page, /onReply=\{\s*threadsAvailable/);
	// The pane block itself is gated on the same term.
	assert.match(page, /\{threadsAvailable &&\s*threadSelection &&\s*shown &&/);
});

test("a `?thread=` deep link cannot seed a thread target", () => {
	assert.match(
		page,
		/TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD\s*\?\s*threadTargetFromSearch\(searchParams\)\s*:\s*null/,
	);
	assert.match(
		page,
		/TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD\s*\?\s*threadTargetFromSearch\(/,
		"the notification-route effect must not rebuild a thread link",
	);
});

test("the message row renders no reply control while held", () => {
	assert.match(
		messageList,
		/const canReply =\s*TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD &&/,
	);
	assert.match(messageList, /\{canReply && summary\.count > 0 && \(/);
});

test("the toolbar drops a directly-passed onReply while held", () => {
	assert.match(
		toolbar,
		/const reply = TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD \? onReply : undefined/,
	);
	assert.match(toolbar, /\{reply && \(/);
	assert.match(toolbar, /onClick=\{reply\}/);
	assert.doesNotMatch(toolbar, /\{onReply && \(/);
});

test("both pane exports guard before any hook mounts", () => {
	const viewStart = pane.indexOf("export function TeamBridgeThreadPaneView(");
	const bodyStart = pane.indexOf("function TeamBridgeThreadPaneBody(");
	assert.notEqual(viewStart, -1, "the view export must exist");
	assert.notEqual(bodyStart, -1, "the view body must be a separate component");
	const viewWrapper = pane.slice(viewStart, bodyStart);
	assert.match(
		viewWrapper,
		/if \(!TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD\) return null;/,
	);
	assert.match(viewWrapper, /<TeamBridgeThreadPaneBody \{\.\.\.props\} \/>/);
	assert.doesNotMatch(viewWrapper, /useEffect|useState|useRef|useI18nLocale/);

	const mountStart = pane.indexOf("export function TeamBridgeThreadPane(");
	const mountBody = pane.indexOf("function TeamBridgeThreadPaneMount(");
	assert.notEqual(mountStart, -1, "the pane container export must exist");
	assert.notEqual(
		mountBody,
		-1,
		"the container body must be a separate component",
	);
	const mountWrapper = pane.slice(mountStart, mountBody);
	assert.match(
		mountWrapper,
		/if \(!TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD\) return null;/,
	);
	assert.match(mountWrapper, /<TeamBridgeThreadPaneMount \{\.\.\.props\} \/>/);
	assert.doesNotMatch(
		mountWrapper,
		/useQueryClient|useInfiniteQuery|useMutation|useRef|useCallback/,
	);
});

test("no notification path reads thread replies while held", () => {
	assert.match(
		notifications,
		/const threadId = TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD\s*\?\s*candidate\.threadId\s*:\s*undefined/,
	);
	assert.match(notifications, /const newest = threadId\s*\?/);
	assert.match(
		notifications,
		/listReplies\(candidate\.conversationId, threadId/,
	);
	assert.doesNotMatch(
		notifications,
		/listReplies\(\s*candidate\.conversationId,\s*candidate\.threadId/,
	);
});
