import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build, transform } from "esbuild";
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

// These are fixture/interaction contracts, not a rendered-frame claim. Execute
// the factory input and play body taken from the story itself so a substitute
// English name or opening the neighboring team chip cannot pass unnoticed.
test("nameless artifact story uses the real locale-time factory for every kind", async () => {
	const source = await readFile(
		"src/renderer/src/features/chat/components/canvas/canvas.stories.tsx",
		"utf8",
	);
	const fixture = source.slice(
		source.indexOf("const NamelessArtifactFiles ="),
		source.indexOf("export const NamelessGeneratedArtifacts"),
	);
	assert.ok(fixture.includes("useI18nLocale();"));
	assert.ok(
		fixture.indexOf("useI18nLocale();") <
			fixture.indexOf("canvasDocumentForArtifact("),
	);
	assert.match(fixture, /mentionedFiles=\{documents\}/);
	const input = fixture.match(
		/canvasDocumentForArtifact\((\{[\s\S]*?\})\)/,
	)?.[1];
	assert.ok(input);
	const bundle = await build({
		stdin: {
			contents: `import { canvasDocumentForArtifact } from "./src/renderer/src/features/chat/utils/canvas-document";
export { setLocale } from "./src/i18n/locale";
export const make = (kind, index) => canvasDocumentForArtifact(${input});
const STORY_SESSION_ID = "story-session";`,
			resolveDir: process.cwd(),
		},
		tsconfig: "tsconfig.web.json",
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	const { make, setLocale } = await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
	const titles = {};
	for (const locale of ["en", "fr", "ur"]) {
		setLocale(locale);
		titles[locale] = ["image", "video", "audio", "file"].map((kind, index) => {
			const document = make(kind, index);
			assert.equal(Object.hasOwn(document.artifact, "name"), false);
			assert.match(document.artifact.digest, /^[0-9a-f]{32}$/);
			assert.equal(document.path, `artifact:${document.artifact.digest}`);
			assert.ok(document.title.includes(document.artifact.digest.slice(0, 8)));
			return document.title;
		});
	}
	assert.notDeepEqual(titles.en, titles.fr);
	assert.notDeepEqual(titles.en, titles.ur);
	console.log("Real nameless factory titles:", JSON.stringify(titles));
});

test("strict caption play opens agent and checks the closed caption and both shortcuts", async () => {
	const source = await readFile(
		"src/renderer/src/features/chat/components/chat-header-identity.stories.tsx",
		"utf8",
	);
	const play = source.slice(
		source.indexOf("const openStrictAgentCaption:"),
		source.indexOf("export const StrictTeam:"),
	);
	const { code } = await transform(
		play.replace(
			/const openStrictAgentCaption: NonNullable<Story\["play"\]>/,
			"const openStrictAgentCaption",
		),
		{ loader: "ts" },
	);
	const agent = {};
	const caption = {
		querySelector: (selector) => {
			assert.equal(selector, "[data-header-identity-constraint]");
			return caption;
		},
	};
	let clicked = false;
	const tokens = [];
	const run = new Function(
		"expect",
		"userEvent",
		"waitFor",
		"within",
		`${code}; return openStrictAgentCaption;`,
	)(
		(value) => ({
			not: { toBeNull: () => assert.notEqual(value, null) },
			toBeVisible: () => assert.ok(value),
		}),
		{
			click: async (target) => {
				assert.equal(target, agent);
				clicked = true;
			},
		},
		async (fn) => fn(),
		(target) => {
			assert.equal(target, caption);
			return {
				getByText: (token) => {
					tokens.push(token);
					return caption;
				},
			};
		},
	);
	await run({
		canvasElement: {
			querySelector: (selector) => {
				assert.equal(selector, '[data-header-identity="agent"]');
				return agent;
			},
			ownerDocument: {
				querySelector: (selector) => {
					assert.ok(clicked);
					assert.equal(
						selector,
						'[data-header-identity-menu="agent"][data-header-identity-closed]',
					);
					return caption;
				},
			},
		},
	});
	assert.deepEqual(tokens, ["/agent", "/team clear"]);
	for (const name of [
		"StrictTeam",
		"StrictTeamNoSpeaker",
		"StrictTeamLongSpeaker",
		"StrictTeamLongTeamAndSpeaker",
	]) {
		assert.match(
			source,
			new RegExp(
				`export const ${name}: Story = \\{\\s*play: openStrictAgentCaption`,
			),
		);
	}
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
