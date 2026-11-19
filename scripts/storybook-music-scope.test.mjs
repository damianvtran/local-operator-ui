import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build, transform } from "esbuild";
import { JSDOM } from "jsdom";
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

// Exercise the extracted story fixture through the real transport, capability
// query and inventory hooks. The small DOM projection is NOT a Canvas screenshot.
test("nameless fixture settles real file and attachment hooks into loaded DOM", async () => {
	const source = await readFile(
		"src/renderer/src/features/chat/components/canvas/canvas.stories.tsx",
		"utf8",
	);
	const fixture = source.slice(
		source.indexOf("const NamelessArtifactFiles ="),
		source.indexOf("export const NamelessGeneratedArtifacts"),
	);
	const bridge = source.slice(
		source.indexOf("const installProjectsBridge ="),
		source.indexOf("const projectsFrame ="),
	);
	const bundle = await build({
		stdin: {
			contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSessionFiles } from "./src/renderer/src/features/chat/canonical/use-session-files";
import { useUserAttachments } from "./src/renderer/src/features/chat/canonical/use-user-attachments";
import { indexedDocument } from "./src/renderer/src/features/chat/canonical/session-files";
import { canvasDocumentForArtifact } from "./src/renderer/src/features/chat/utils/canvas-document";
import { useI18nLocale } from "./src/renderer/src/shared/i18n/use-locale";
import { setLocale } from "./src/i18n/locale";
const STORY_SESSION_ID = "story-session";
const ok = result => ({status:200,body:{status:200,message:"ok",result}});
const observed = () => ok({});
const refused = () => ({status:404,body:{}});
${bridge}
${fixture}
function CanvasFrame() {
 const index = useSessionFiles(STORY_SESSION_ID, true);
 const attachments = useUserAttachments(STORY_SESSION_ID, null);
 return <section data-state={index.state} data-mode={index.mode} data-attachments={attachments.state}>
 {index.state === "ready" && index.rows.map(row => <p key={row.id}>{indexedDocument(row, STORY_SESSION_ID).title}</p>)}
 </section>;
}
exports.mount = (node, locale, unconfigured = false) => {
 setLocale(locale);
 const client = new QueryClient({defaultOptions:{queries:{retry:false,networkMode:"always",gcTime:0}}});
 const root = createRoot(node);
 root.render(<QueryClientProvider client={client}>{unconfigured ? <CanvasFrame /> : <NamelessArtifactFiles />}</QueryClientProvider>);
 return () => { root.unmount(); client.clear(); };
};`,
			resolveDir: process.cwd(),
			loader: "tsx",
		},
		bundle: true,
		format: "cjs",
		platform: "node",
		write: false,
		tsconfig: "tsconfig.web.json",
		jsx: "automatic",
		define: { "import.meta.env": "{}" },
		loader: {
			".css": "empty",
			".svg": "text",
			".png": "dataurl",
			".webp": "dataurl",
		},
	});
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
	});
	const previous = new Map();
	for (const key of [
		"window",
		"document",
		"localStorage",
		"navigator",
		"HTMLElement",
	]) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			value: dom.window[key],
		});
	}
	const module = { exports: {} };
	try {
		new Function("require", "module", "exports", bundle.outputFiles[0].text)(
			createRequire(`${process.cwd()}/package.json`),
			module,
			module.exports,
		);
		// Negative control: the preview's refusing bridge leaves the REAL query
		// unresolved and renders no inventory. Seeding documents cannot cure it.
		dom.window.api = {
			desktop: {
				request: async () => {
					throw new Error("unconfigured preview bridge");
				},
			},
		};
		const negativeCleanup = module.exports.mount(
			dom.window.document.getElementById("root"),
			"en",
			true,
		);
		try {
			await new Promise((resolve) => setTimeout(resolve, 50));
			const section = dom.window.document.querySelector("section");
			assert.equal(section?.dataset.mode, "negotiating");
			assert.notEqual(section?.dataset.state, "ready");
			assert.equal(section.querySelectorAll("p").length, 0);
		} finally {
			negativeCleanup();
		}
		for (const locale of ["en", "fr", "ur"]) {
			dom.window.api = {
				desktop: {
					request: async () => {
						throw new Error("unconfigured preview bridge");
					},
				},
			};
			const cleanup = module.exports.mount(
				dom.window.document.getElementById("root"),
				locale,
			);
			try {
				// Observe calls to the fixture's actual bridge, not a fake hook result.
				for (let turn = 0; turn < 100; turn++) {
					await new Promise((resolve) => setTimeout(resolve, 10));
					const section = dom.window.document.querySelector("section");
					if (
						section?.dataset.state === "ready" &&
						section.dataset.attachments === "ready"
					)
						break;
				}
				const section = dom.window.document.querySelector("section");
				assert.equal(section?.dataset.mode, "index");
				assert.equal(section?.dataset.state, "ready");
				assert.equal(section?.dataset.attachments, "ready");
				const labels = [...section.querySelectorAll("p")].map(
					(p) => p.textContent,
				);
				assert.equal(labels.length, 4);
				for (let i = 0; i < 4; i++)
					assert.ok(labels[i].includes(String(i + 1).repeat(8)));
				console.log("Loaded inventory DOM", locale, labels);
			} finally {
				cleanup();
			}
		}
	} finally {
		dom.window.close();
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	}
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
	const dom = new JSDOM(`<button data-header-identity="agent"></button>
		<div data-header-identity-menu="agent" data-header-identity-closed hidden>
		<p data-header-identity-constraint>team lopdev owns this session: manager is the speaker, so /agent is closed. Run /team clear to release it.</p></div>`);
	const canvasElement = dom.window.document.body;
	const agent = canvasElement.querySelector("button");
	const caption = canvasElement.querySelector("div");
	const constraint = caption.querySelector("p");
	const run = new Function(
		"expect",
		"userEvent",
		"waitFor",
		"within",
		`${code}; return openStrictAgentCaption;`,
	)(
		(value) => ({
			not: { toBeNull: () => assert.notEqual(value, null) },
			toBeVisible: () =>
				assert.ok(value?.isConnected && !value.closest("[hidden]")),
			toHaveTextContent: (text) =>
				assert.ok(
					value?.textContent.includes(text),
					`Missing ${text} in scoped constraint`,
				),
		}),
		{
			click: async (target) => {
				assert.equal(target, agent);
				caption.hidden = false;
			},
		},
		async (fn) => fn(),
		// Match real exact text semantics: the previous assertion MUST fail on
		// a sentence containing a token, rather than returning fake success.
		(target) => ({
			getByText: (text) => {
				const match = [...target.querySelectorAll("*")].find(
					(el) => el.textContent === text,
				);
				assert.ok(match, `No exact text element: ${text}`);
				return match;
			},
		}),
	);
	try {
		await run({ canvasElement });
		constraint.textContent = "Wrong /role command; run /team clear.";
		await assert.rejects(run({ canvasElement }), /Missing \/agent/);
		constraint.textContent = "Only /agent remains; wrong /team reset command.";
		await assert.rejects(run({ canvasElement }), /Missing \/team clear/);
		constraint.remove();
		// Tokens elsewhere in the open dialog must not substitute for its caption.
		caption.append("/agent /team clear");
		await assert.rejects(run({ canvasElement }));
	} finally {
		dom.window.close();
	}

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
