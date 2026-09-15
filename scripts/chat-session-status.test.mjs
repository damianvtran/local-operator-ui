import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
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
});
for (const [code, icon, ink] of [
	["error", "circle-alert", "danger"],
	["wedged", "circle-alert", "danger"],
	["busy", "loader-circle", "info"],
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
		const before = render(code, true),
			after = render(code, false);
		assert.equal(after, before);
		assert.match(after, new RegExp(`lucide-${icon}`));
		assert.match(after, new RegExp(`text-${ink}`));
	});
}
