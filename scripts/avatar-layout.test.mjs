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

/*
 * Whitespace-collapsed source for the summary tripwires. They pin which calls and
 * conditions exist, not how the formatter happens to wrap them: matching raw text
 * failed on the first Biome reflow of a `&&` chain while the code was unchanged.
 */
const WHITESPACE = /\s+/g;
const readFlat = (path) => read(path).replace(WHITESPACE, " ");

test("header siblings share centre alignment and interactive rows can grow", () => {
	const source = read(
		"src/renderer/src/features/chat/components/chat-header.tsx",
	);
	assert.ok(
		source.includes("@container/chathdr flex min-h-10 shrink-0 items-center"),
	);
	assert.ok(source.includes("flex min-w-0 flex-1 items-center gap-x-2"));
	/* Whitespace-tolerant: the formatter may break this ternary across lines. */
	assert.match(
		source,
		/identity\s*\?\s*"min-h-5"\s*:\s*cn\(rowClassName, "flex-wrap overflow-clip"\)/,
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

/*
 * Source tripwires. The live geometry, media-state and plate checks are the
 * summary stories' play functions (agent-avatar.stories.tsx), which need a real
 * renderer and run in the Storybook preview, not under node.
 */
test("selected agent summary binds only the existing local agent picture", () => {
	const source = readFlat(
		"src/renderer/src/features/agents/components/agent-detail.tsx",
	);
	const start = source.indexOf('data-agent-summary-portrait=""');
	const end = source.indexOf("<AgentMeta profile={profile} />", start);
	assert.ok(start >= 0 && end > start);
	const portrait = source.slice(start, end);
	assert.ok(portrait.includes("<AgentMark"));
	assert.ok(portrait.includes("agentId={profile.agent_id}"));
	assert.ok(portrait.includes("className={SUMMARY_PORTRAIT_CLASS}"));
	assert.ok(portrait.includes("fallback={<SummaryPortraitPlate />}"));
	// One treatment for no-image/loading/error (design D1): the empty state is the
	// shared AgentAvatar + AvatarFallback plate, not a bespoke bare glyph.
	const plateStart = source.indexOf("function SummaryPortraitPlate()");
	assert.ok(plateStart >= 0);
	const plate = source.slice(plateStart, source.indexOf("function draftOf("));
	assert.ok(plate.includes("<AgentAvatar className={SUMMARY_PORTRAIT_CLASS}"));
	assert.ok(plate.includes("<AvatarFallback>"));
	assert.ok(plate.includes('<Bot className="size-8" aria-hidden="true" />'));
	assert.ok(
		source.includes('const SUMMARY_PORTRAIT_CLASS = "size-full border-0";'),
	);
	assert.ok(!source.includes("bg-transparent"));
	for (const accountSource of [
		"useAccountAvatar",
		"useRadientAuth",
		"avatar_url",
		"account_id",
	])
		assert.ok(!source.includes(accountSource));
	// No writes or crop-specific overrides belong in a read-only summary.
	for (const mutation of [
		"setAgentAvatar(",
		"clearAgentAvatar(",
		"renderAgentAvatarCrop(",
	])
		assert.ok(!source.includes(mutation));
});

test("summary portrait reserves its box and actions wrap without title offsets", () => {
	const source = readFlat(
		"src/renderer/src/features/agents/components/agent-detail.tsx",
	);
	assert.ok(source.includes('className="size-20 shrink-0"'));
	assert.ok(
		source.includes(
			"flex flex-wrap items-center justify-between gap-x-4 gap-y-3",
		),
	);
	assert.ok(source.includes("flex min-w-0 flex-wrap items-center gap-2"));
	assert.ok(source.includes('data-agent-summary-actions=""'));
	assert.ok(
		source.includes("flex min-w-0 flex-[1_1_16rem] items-center gap-4"),
	);
	assert.ok(source.includes('className="min-w-0 flex-1 space-y-1"'));
	assert.ok(
		source.includes('className="truncate text-title focus:outline-none"'),
	);
	assert.ok(source.includes('aria-hidden="true"'));
});

test("summary keeps the existing Edit workflow and agent-keyed picture field", () => {
	const source = readFlat(
		"src/renderer/src/features/agents/components/agent-detail.tsx",
	);
	assert.ok(source.includes('t("ui.agents.detail.action.edit")'));
	assert.ok(source.includes("setEditing(true)"));
	assert.ok(
		source.includes("baseRevisionRef.current = profile.definition_revision"),
	);
	assert.ok(source.includes("key={profile.agent_id}"));
	assert.ok(source.includes("agentId={profile.agent_id}"));
	assert.ok(source.includes("openPictureEditor = false"));
	// Summary adds no competing picture link or alternative editor route.
	assert.ok(!source.includes("AgentAvatarEditLink"));
});

/* Review regressions for fixture provenance; these do not replace running the stories. */
test("summary fixture seeds its provider and isolates both local transports", () => {
	const source = readFlat(
		"src/renderer/src/features/agents/components/agent-avatar.stories.tsx",
	);
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
	const source = readFlat(
		"src/renderer/src/features/agents/components/agent-avatar.stories.tsx",
	);
	const checks = source.slice(
		source.indexOf("async function assertSummaryPortrait("),
	);
	assert.ok(checks.includes("evidence.requests > 0 && evidence.inFlight > 0"));
	assert.ok(
		checks.includes("evidence.bytesDelivered && evidence.decodeErrorSource"),
	);
	assert.ok(
		source.includes("image.src === peekBlobUrl(agentAvatarPath(id, SHA))"),
	);
	assert.ok(
		source.includes('image.addEventListener("error", onError, { once: true })'),
	);
	assert.ok(source.includes('image.removeEventListener("error", onError)'));
	assert.ok(source.includes("window.Image = NativeImage"));
});

/*
 * THE SESSION ROW'S PENCIL LANDS ON THE PICTURE (presence round). The status cell
 * now leads the cluster, so the picture sits 22px right of where it did and the
 * old `start-1` put the pencil on the locality cell (measured 18px left of the
 * picture on main). The offset is the sum of the row's own box, and a change to
 * any term has to move the class: `px-1` 4 + locality cell `size-3.5` 14 + the
 * row's `gap-1` 4 + status cell 16 + the cluster's `gap-1.5` 6 = 44 = `start-11`;
 * a nested row's `ps-7` is 28 not 4, so +24 = 68 = `start-17`.
 */
test("the session row's pencil offset is the sum of the row's own boxes", () => {
	const avatar = read(
		"src/renderer/src/features/chat/components/chat-session-avatar.tsx",
	);
	const sidebar = read(
		"src/renderer/src/features/chat/components/chat-sidebar.tsx",
	);
	assert.ok(avatar.includes('nested ? "start-17" : "start-11"'));
	assert.ok(
		sidebar.includes('"flex h-8 min-w-0 items-center gap-1 rounded-md px-1'),
	);
	assert.ok(sidebar.includes('nested && "ps-7"'));
	// The locality cell is still a fixed 14 px box; `relative` only anchors the
	// settings-intent dot drawn inside it (PR #1823 design D4), which is
	// absolutely placed and adds no width to the sum below.
	assert.ok(
		sidebar.includes(
			'className="relative flex size-3.5 shrink-0 items-center justify-center"',
		),
	);
	assert.ok(avatar.includes('"relative flex shrink-0 items-center gap-1.5"'));
	assert.equal(4 + 14 + 4 + 16 + 6, 44);
	assert.equal(44 / 4, 11);
	assert.equal((28 + 14 + 4 + 16 + 6) / 4, 17);
});
