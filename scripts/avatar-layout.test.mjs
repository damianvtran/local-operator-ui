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

/* Source tripwires only; live geometry/keyboard assertions require fresh D2 admission. */
test("selected agent summary binds only the existing local agent picture", () => {
	const source = read("src/renderer/src/features/agents/components/agent-detail.tsx");
	const start = source.indexOf('data-agent-summary-portrait=""');
	const end = source.indexOf("<AgentMeta profile={profile} />", start);
	assert.ok(start >= 0 && end > start);
	const portrait = source.slice(start, end);
	assert.ok(portrait.includes("<AgentMark"));
	assert.ok(portrait.includes("agentId={profile.agent_id}"));
	assert.ok(portrait.includes('className="size-full border-0 bg-transparent"'));
	assert.equal(portrait.split('<Bot className="size-8" aria-hidden="true" />').length - 1, 2);
	for (const accountSource of ["useAccountAvatar", "useRadientAuth", "avatar_url", "account_id"])
		assert.ok(!source.includes(accountSource));
	// No writes or crop-specific overrides belong in a read-only summary.
	for (const mutation of ["setAgentAvatar(", "clearAgentAvatar(", "renderAgentAvatarCrop("])
		assert.ok(!source.includes(mutation));
});

test("summary portrait reserves its box and actions wrap without title offsets", () => {
	const source = read("src/renderer/src/features/agents/components/agent-detail.tsx");
	assert.ok(source.includes('className="size-20 shrink-0"'));
	assert.ok(source.includes("flex flex-wrap items-center justify-between gap-x-4 gap-y-3"));
	assert.ok(source.includes("flex min-w-0 flex-wrap items-center gap-2"));
	assert.ok(source.includes('data-agent-summary-actions=""'));
	assert.ok(source.includes("flex min-w-0 flex-[1_1_16rem] items-center gap-4"));
	assert.ok(source.includes('className="min-w-0 flex-1 space-y-1"'));
	assert.ok(source.includes('className="truncate text-title focus:outline-none"'));
	assert.ok(source.includes('aria-hidden="true"'));
});

test("summary keeps the existing Edit workflow and agent-keyed picture field", () => {
	const source = read("src/renderer/src/features/agents/components/agent-detail.tsx");
	assert.ok(source.includes('t("ui.agents.detail.action.edit")'));
	assert.ok(source.includes("setEditing(true)"));
	assert.ok(source.includes("baseRevisionRef.current = profile.definition_revision"));
	assert.ok(source.includes("key={profile.agent_id}"));
	assert.ok(source.includes("agentId={profile.agent_id}"));
	assert.ok(source.includes("openPictureEditor = false"));
	// Summary adds no competing picture link or alternative editor route.
	assert.ok(!source.includes("AgentAvatarEditLink"));
});

/* Review regressions for fixture provenance; these do not replace running the stories. */
test("summary fixture seeds its provider and isolates both local transports", () => {
	const source = read("src/renderer/src/features/agents/components/agent-avatar.stories.tsx");
	const start = source.indexOf("const SummaryPortraitScene:");
	const end = source.indexOf("export const SummaryPortraitPopulated:", start);
	const scene = source.slice(start, end);
	assert.ok(scene.includes("const client = useQueryClient()"));
	assert.ok(scene.includes("client.setQueryData(agentAvatarsQueryKey, map)"));
	assert.ok(!scene.includes("useSeedPictures("));
	assert.ok(scene.includes('input.op !== "legacy.agents.list"'));
	assert.ok(scene.includes("api.api.desktop.request = previousRequest"));
	assert.ok(scene.includes("api.api.desktop.media = previousMedia"));
	assert.ok(scene.includes("{ready ?"));
});

test("summary state checks require requested loading and native decode error evidence", () => {
	const source = read("src/renderer/src/features/agents/components/agent-avatar.stories.tsx");
	const checks = source.slice(source.indexOf("async function assertSummaryPortrait("));
	assert.ok(checks.includes("evidence.requests > 0 && evidence.inFlight > 0"));
	assert.ok(checks.includes("evidence.bytesDelivered && evidence.decodeErrorSource"));
	assert.ok(source.includes("image.src === peekBlobUrl(agentAvatarPath(id, SHA))"));
	assert.ok(source.includes('image.addEventListener("error", onError, { once: true })'));
	assert.ok(source.includes('image.removeEventListener("error", onError)'));
	assert.ok(source.includes("window.Image = NativeImage"));
});
