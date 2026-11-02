/**
 * Structural tripwires for the avatar layout contract. Actual centre coordinates
 * are asserted by HeaderGeometry's Storybook play function against the rendered
 * DOM; these cheap checks stop the responsible sizing/alignment tokens drifting
 * without pretending a Node test can lay out fonts or cropper canvases.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("header siblings share centre alignment and interactive rows can grow", () => {
	const source = read(
		"src/renderer/src/features/chat/components/chat-header.tsx",
	);
	assert.ok(
		source.includes("@container/chathdr flex min-h-10 shrink-0 items-center"),
	);
	assert.ok(source.includes("flex min-w-0 flex-1 items-center gap-x-2"));
	assert.ok(
		source.includes('identity ? "min-h-5" : "h-5 flex-wrap overflow-clip"'),
	);
	assert.ok(!source.includes("items-baseline"));
	assert.ok(!source.includes("overflow-clip-margin"));
});

test("settings picture and empty fallback use the same comfortable preview size", () => {
	const source = read(
		"src/renderer/src/features/agents/components/agent-avatar-field.tsx",
	);
	const probe = source.slice(source.indexOf("function PictureProbe("));
	assert.equal(probe.split("size-20").length - 1, 2);
	assert.ok(!probe.includes("size-10"));
	assert.ok(probe.includes("<AgentMark"));
	assert.ok(probe.includes("onPresence={onPresence}"));
});
