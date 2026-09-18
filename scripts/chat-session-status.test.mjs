import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const result = await build({
	stdin: {
		contents:
			'export { ChatSessionStatus } from "./src/renderer/src/features/chat/components/chat-session-status"; export { renderToStaticMarkup } from "react-dom/server"; export { createElement } from "react";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	write: false,
	jsx: "automatic",
	tsconfig: "tsconfig.app.json",
});
const output = { exports: {} };
new Function("module", "exports", "require", result.outputFiles[0].text)(
	output,
	output.exports,
	require,
);
const { ChatSessionStatus, renderToStaticMarkup, createElement } =
	output.exports;
const render = (code, unseen) =>
	renderToStaticMarkup(
		createElement(ChatSessionStatus, {
			row: {
				session_id: "fixture",
				status: { code, label: code },
				attention: { unseen },
			},
		}),
	);
test("read complete rests, unread complete keeps the attention check", () => {
	assert.match(render("complete", true), /lucide-check/);
	assert.match(render("complete", true), /text-success/);
	assert.match(render("complete", false), /lucide-circle /);
	assert.doesNotMatch(render("complete", false), /lucide-check|text-success/);
	assert.match(render("complete", undefined), /lucide-circle /);
	/*
	 * THE NAME IS ASSERTED ON THE MARKUP, not on the code path (review round 4,
	 * R4-2). The suffix is the half a screen reader hears and the half the ink
	 * cannot carry, and nothing else in this repository asserts it: deleting it
	 * left all twelve cases here green. Rendered names, not a regex over the
	 * source — `text-success` is already asserted above for the same reason.
	 */
	assert.match(render("complete", true), /sr-only">complete, unread</);
	assert.match(render("complete", false), /sr-only">complete</);
	assert.doesNotMatch(render("complete", false), /unread/);
	// The narrow gating is a contract, not an accident: a code that keeps its own
	// meaning keeps its own name, whether or not the row is unseen.
	assert.doesNotMatch(render("danger", true), /unread/);
});
for (const [code, icon, ink] of [
	["error", "circle-alert", "danger"],
	["wedged", "circle-alert", "danger"],
	["busy", "loader-circle", "accent"],
	["answer", "circle-alert", "warning"],
	["approval", "circle-alert", "warning"],
	["interrupted", "pause", "warning"],
	["scheduled", "clock", "ink-dim"],
	["attached", "message-square", "ink-dim"],
	["idle", "circle", "ink-dim"],
	["dormant", "pause", "ink-dim"],
	["unknown", "circle-help", "ink-dim"],
]) {
	test(`${code} does not lose status when acknowledged`, () => {
		const before = render(code, true);
		const after = render(code, false);
		assert.equal(after, before);
		assert.match(after, new RegExp(`lucide-${icon}`));
		assert.match(after, new RegExp(`text-${ink}`));
	});
}

/*
 * ------------------------------------------------------------ the row the
 *                                                                FEED produced
 *
 * Everything above renders a row built by hand, which cannot tell the difference
 * between a status that came from a `sessions.list` response and one a
 * `session_status` frame patched in afterwards - and that difference is the whole
 * point of the frame. So this case builds its row the way the app does: a
 * catalogue row as a list response leaves it, then the two frames that move it
 * (the status frame with the completion, the attention frame with the unseen
 * mark), then the SAME component over the row the store actually holds.
 *
 * It is deliberately not a substitute for the rendered frames under
 * `docs/evidence/`: those show the sidebar, and this shows the icon and its
 * name. What it adds that a screenshot cannot is that the row reaching the
 * component is the frame's, with the frame's stamp on it.
 *
 * The store is bundled here rather than in a second file because the claim
 * couples the two: a frame applies to the row, and that row renders as the
 * unread completion. Two files would let each half pass while the seam between
 * them was broken.
 */
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};
const storeResult = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/store/canonical-sessions-store";',
		resolveDir: process.cwd(),
	},
	alias: {
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "chat-session-status-fixture",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-api/ },
					() => ({
						path: "transport",
						namespace: "chat-session-status-fixture",
					}),
				);
				builder.onLoad(
					{ filter: /.*/, namespace: "chat-session-status-fixture" },
					() => ({
						contents: `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
							`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
						)}
export const desktopResult = async () => ({});`,
						loader: "js",
						resolveDir: process.cwd(),
					}),
				);
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-canonical-session/ },
					() => ({ path: "echo", namespace: "echo-fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "echo-fixture" }, () => ({
					contents: `export const echoPendingUser = () => undefined;
export const retractPendingUser = () => undefined;
export const discardPendingEchoes = () => undefined;`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
});
const { useCanonicalSessionsStore, replaceSessionRows } = await import(
	`data:text/javascript;base64,${Buffer.from(storeResult.outputFiles[0].text).toString("base64")}`
);

const FEED_SESSION = "0f1e2d3c4b5a";
const FEED_EPOCH = "9f2c1a6b7d3e4051";

test("a completion delivered by frames renders as an unread complete row", () => {
	// What a `sessions.list` response left in the store: busy, stamped by the
	// feed process that is serving this client.
	useCanonicalSessionsStore.setState({
		sessions: replaceSessionRows(
			[],
			[
				{
					session_id: FEED_SESSION,
					title: "Quarterly revenue model",
					binding: { agent: null, team: null },
					status: { code: "busy", label: "Working" },
					status_revision: 2,
					status_epoch: FEED_EPOCH,
				},
			],
		),
	});
	// The turn finishes: the derived pair arrives on `session_status`, the unseen
	// mark on `attention`. Both through the store, both as the hook calls them.
	useCanonicalSessionsStore
		.getState()
		.applySessionStatus(
			FEED_SESSION,
			{ code: "complete", label: "Complete" },
			3,
			FEED_EPOCH,
		);
	useCanonicalSessionsStore.getState().applyAttention(FEED_SESSION, {
		conversation_id: `session/${FEED_SESSION}`,
		completion_token: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		anchor_id: "row-1",
		kind: "complete",
		unseen: true,
		revision: [4, 2],
	});

	const [fed] = useCanonicalSessionsStore.getState().sessions;
	// The row is the frame's, stamp and all - otherwise the render below would be
	// of something the feed never sent.
	assert.deepEqual(fed.status, { code: "complete", label: "Complete" });
	assert.equal(fed.status_revision, 3);
	assert.equal(fed.status_epoch, FEED_EPOCH);

	const markup = renderToStaticMarkup(
		createElement(ChatSessionStatus, { row: fed }),
	);
	assert.match(markup, /lucide-check/);
	assert.match(markup, /text-success/);
	// The label is the frame's own (`Complete`), so the name reads with it.
	assert.match(markup, /sr-only">Complete, unread</);

	// And the mark is not what makes it complete: acknowledging the completion
	// rests the ICON back to a plain ring and keeps the code, which is the
	// behaviour the twelve cases above pin for a hand-built row.
	useCanonicalSessionsStore.getState().applyAttention(FEED_SESSION, {
		conversation_id: `session/${FEED_SESSION}`,
		completion_token: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		anchor_id: "row-1",
		kind: "complete",
		unseen: false,
		revision: [4, 3],
	});
	const acknowledged = renderToStaticMarkup(
		createElement(ChatSessionStatus, {
			row: useCanonicalSessionsStore.getState().sessions[0],
		}),
	);
	assert.match(acknowledged, /lucide-circle /);
	assert.doesNotMatch(acknowledged, /lucide-check|text-success|unread/);
});
