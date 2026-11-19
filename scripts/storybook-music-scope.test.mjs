import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { musicEvidenceRequested } from "./music-storybook-evidence.mjs";
import { musicStoryScope } from "./storybook-music-scope.mjs";

test("music evidence scope is explicit and preserves full gallery defaults", () => {
	const standard = {
		stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
		reactDocgen: "react-docgen",
	};
	assert.deepEqual(musicStoryScope({}), standard);
	assert.deepEqual(
		musicStoryScope({ LOP_STORYBOOK_MUSIC_EVIDENCE: "0" }),
		standard,
	);
	const scoped = musicStoryScope({ LOP_STORYBOOK_MUSIC_EVIDENCE: "1" });
	assert.equal(scoped.stories.length, 7);
	assert.equal(scoped.reactDocgen, false);
	assert.ok(scoped.stories[0].endsWith("/music.stories.tsx"));
	assert.ok(scoped.stories[1].endsWith("/sound-player.stories.tsx"));
});
test("carrier includes existing i18n surfaces without weakening the classifier", async () => {
	const scoped = musicStoryScope({ LOP_STORYBOOK_MUSIC_EVIDENCE: "1" });
	assert.deepEqual(scoped.stories.slice(2), [
		"../src/renderer/src/features/agents/components/agents-teams.stories.tsx",
		"../src/renderer/src/features/chat/components/run-details/run-details.stories.tsx",
		"../src/renderer/src/features/chat/canonical/turn-collapse.stories.tsx",
		"../src/renderer/src/features/chat/components/canvas/canvas.stories.tsx",
		"../src/renderer/src/features/chat/components/chat-header-identity.stories.tsx",
	]);
	for (const story of scoped.stories) {
		const source = await readFile(story.replace(/^\.\.\//, ""), "utf8");
		assert.match(source, /export const /);
	}
	assert.equal(musicEvidenceRequested([".storybook/main.ts"]), true);
	assert.equal(
		musicEvidenceRequested(["src/i18n/catalogues/fr/ui.agents.config.json"]),
		false,
	);
});

test("bounded scope retains every planned music state and the real stylesheet", async () => {
	const source = await readFile(
		"src/renderer/src/features/chat/canonical/music.stories.tsx",
		"utf8",
	);
	for (const state of [
		"Queued",
		"Running",
		"Narrow",
		"Populated",
		"PartialFailure",
		"Empty",
		"JobsCancel",
		"JobsCancelRtl",
		"CanonicalMissingBytes",
		"CanonicalRtl",
	]) {
		assert.match(source, new RegExp(`export const ${state}\\b`));
	}
	assert.ok(source.includes('import "../../../styles/index.css"'));
	assert.ok(source.includes("<MusicJobMotif"));
	assert.ok(source.includes("<MusicResult"));
});
