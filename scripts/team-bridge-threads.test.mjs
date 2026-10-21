import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Execute the shipped model and render the real pane, not a second state map.
const bundle = await build({
	stdin: {
		contents: `export {threadSummary} from './src/renderer/src/features/team-bridge/team-bridge-threads-model'; export {TeamBridgeThreadPaneView} from './src/renderer/src/features/team-bridge/team-bridge-thread-pane'; export {teamBridgeMessageSchema} from './src/shared/team-bridge-contract'; export {createElement} from 'react'; export {renderToStaticMarkup} from 'react-dom/server';`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	external: ["react", "react-dom/server"],
	packages: "external",
	jsx: "automatic",
	loader: { ".css": "empty" },
});
// Keep external packages resolving from the repo, not a data URL.
const { writeFile, unlink } = await import("node:fs/promises");
const path = `${process.cwd()}/.threads-test-${process.pid}.mjs`;
await writeFile(path, bundle.outputFiles[0].text);
let mod;
try {
	mod = await import(path);
} finally {
	await unlink(path);
}
const root = {
	id: "bcmsg_root0001",
	conversation_id: "bcv_test0001",
	seq: 1,
	sender: { account_id: "acct_a", kind: "human", display_label: "Ada" },
	body: "Root question",
	origin: "human",
	created_at: "2026-10-21T10:00:00Z",
};
test("thread rollup accepts old messages and bounds participant facepile", () => {
	assert.equal(
		mod.threadSummary(mod.teamBridgeMessageSchema.parse(root)).count,
		0,
	);
	const summary = mod.threadSummary({
		...root,
		reply_count: 4,
		reply_participants: ["A", "B", "C", "D"],
		last_reply_at: "bad",
	});
	assert.equal(summary.count, 4);
	assert.equal(summary.participants.length, 3);
	assert.equal(summary.lastReply, null);
	assert.throws(() =>
		mod.teamBridgeMessageSchema.parse({ ...root, reply_count: -1 }),
	);
});
for (const state of ["ready", "loading", "error"])
	test(`thread pane renders ${state} without fake reply actions`, () => {
		const html = mod.renderToStaticMarkup(
			mod.createElement(mod.TeamBridgeThreadPaneView, {
				root,
				replies: [],
				state,
				labelFor: (s) => s.display_label,
				onClose() {},
				onRetry() {},
				onSend: async () => {},
			}),
		);
		assert.match(html, /Root question/);
		assert.match(html, /Close thread/);
		assert.match(
			html,
			state === "ready"
				? /No replies yet/
				: state === "loading"
					? /Loading messages/
					: /Messages could not be loaded/,
		);
		assert.doesNotMatch(html, /title="Reply in thread"/);
	});
test("populated thread renders reply through safe markdown, never image requests", () => {
	const html = mod.renderToStaticMarkup(
		mod.createElement(mod.TeamBridgeThreadPaneView, {
			root,
			replies: [
				{
					...root,
					id: "bcmsg_reply001",
					seq: 2,
					thread_root_id: root.id,
					body: "I claim this ![tracking](https://evil.example/pixel)",
				},
			],
			state: "ready",
			labelFor: (s) => s.display_label,
			onClose() {},
			onRetry() {},
			onSend: async () => {},
		}),
	);
	assert.match(html, /I claim this/);
	assert.doesNotMatch(html, /<img/);
});
