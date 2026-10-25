import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const bundle = await build({
	entryPoints: [
		new URL("surface-copy-reactivity-entry.ts", import.meta.url).pathname,
	],
	bundle: true,
	platform: "node",
	format: "esm",
	banner: {
		js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
	},
	write: false,
	absWorkingDir: process.cwd(),
	external: ["react", "react-dom", "react/jsx-runtime", "electron"],
	plugins: [
		{
			name: "shared-source-paths",
			setup(builder) {
				builder.onResolve({ filter: /^@shared\// }, async (args) =>
					builder.resolve(`./${args.path.slice(8)}`, {
						resolveDir: resolve("src/renderer/src/shared"),
						kind: args.kind,
					}),
				);
				builder.onResolve({ filter: /^@features\// }, async (args) =>
					builder.resolve(`./${args.path.slice(10)}`, {
						resolveDir: resolve("src/renderer/src/features"),
						kind: args.kind,
					}),
				);
			},
		},
	],
});
const outputFile = bundle.outputFiles[0];
assert.ok(outputFile, "surface reactivity bundle did not compile");
const cache = resolve("node_modules/.cache/surface-copy-reactivity");
mkdirSync(cache, { recursive: true });
const compiled = resolve(cache, "surface-copy-reactivity.mjs");
writeFileSync(compiled, outputFile.text);
const mod = await import(pathToFileURL(compiled).href);

const fixture = {
	"ui.hub.updates.sign_in": "fixture hub sign-in",
	"ui.common.errors.dictation_empty": "fixture empty dictation",
	"ui.common.errors.desktop_refusal_placeholder": "fixture desktop refusal",
	"ui.common.errors.speech_failure": "fixture speech failure",
	"ui.common.actions.retry": "fixture retry",
	"ui.common.actions.clear": "fixture clear",
	"ui.common.errors.session_unvalidated": "fixture unvalidated",
	"ui.common.errors.leading_slash_message": "fixture leading slash",
	"ui.common.updates.error.version_unknown_required": "fixture unknown version",
	"ui.chat.canonical.untitled": "fixture untitled",
	"ui.chat.canonical.this_chat": "fixture this chat",
	"ui.settings.appearance.theme.dracula": "fixture dracula",
};

/** Every arm runs the whole cycle: a one-way switch misses stale module reads. */
function assertLocaleCycle(read, english, localized) {
	mod.setLocale("en");
	assert.equal(read(), english, "English baseline before fixture locale");
	mod.registerCatalogue("xx-surface-fixture", fixture);
	mod.setLocale("xx-surface-fixture");
	assert.equal(read(), localized, "Fixture locale must replace bootstrap copy");
	mod.setLocale("en");
	assert.equal(read(), english, "Switching back must not retain fixture copy");
}

test("hub, transcription, speech and canonical actions resolve per call", () => {
	const needingSignIn = {
		credential: "none",
		items: [{ error_class: "no-credential" }],
	};
	assertLocaleCycle(
		() => mod.hubSignInLine(needingSignIn),
		"Sign in to Radient to get hub updates",
		"fixture hub sign-in",
	);
	assertLocaleCycle(
		mod.emptyTranscriptionMessage,
		"No words were picked up. Try again a little closer to the microphone.",
		"fixture empty dictation",
	);
	assertLocaleCycle(
		mod.speechFailureFallbackCopy,
		"Couldn't speak this aloud. Try again.",
		"fixture speech failure",
	);
	assertLocaleCycle(
		mod.speechPlaybackCopy,
		"Couldn't speak this aloud. Try again.",
		"fixture speech failure",
	);
	assertLocaleCycle(mod.retryLabel, "Retry", "fixture retry");
	assertLocaleCycle(mod.clearLabel, "Clear", "fixture clear");
	assertLocaleCycle(
		mod.sessionUnvalidatedMessage,
		"This chat is not ready for messages yet, so the message was not sent. Sending works once it is ready.",
		"fixture unvalidated",
	);
	assertLocaleCycle(
		mod.leadingSlashMessage,
		"A message can't start with / — that is a command. Move it below your text, or send it on its own.",
		"fixture leading slash",
	);
});

test("an empty desktop refusal keeps a stable sentinel and localizes on presentation", async () => {
	const previousWindow = globalThis.window;
	globalThis.window = {
		api: {
			desktop: {
				request: async () => ({ status: 418, body: {} }),
			},
		},
	};
	try {
		const error = await mod.desktopResult({ op: "settings.list" }).then(
			() => null,
			(caught) => caught,
		);
		assert.ok(error, "the empty refusal must reject");
		assert.equal(error.message, mod.DESKTOP_REFUSAL_PLACEHOLDER);
		assertLocaleCycle(
			() => mod.userFacingMessage(error, "fixture fallback"),
			"This server did not answer the request for its desktop controls.",
			"fixture desktop refusal",
		);
	} finally {
		if (previousWindow === undefined) globalThis.window = undefined;
		else globalThis.window = previousWindow;
	}
});

test("the palette carries the description key and the registry resolves it per call", () => {
	/*
	 * Two halves, both lazy. The palette is colour DATA: `descriptionKey` is the
	 * static message key, and nothing in the palette resolves copy (a frozen
	 * `description` here was the import-time-English bug). The registry's getter
	 * is the resolution point, and it must answer per call - English, the
	 * registered locale, then English again.
	 */
	assert.equal(
		mod.dracula.descriptionKey,
		"ui.settings.appearance.theme.dracula",
	);
	assertLocaleCycle(
		() => mod.themes.dracula.description,
		"Blue-grey ground with the signature Dracula purple.",
		"fixture dracula",
	);
});

test("version state keeps its sentinel while its presenter switches", async () => {
	const stored = await mod.HealthApi.getServerVersion({});
	assert.equal(stored, "Unknown (update required)");
	assertLocaleCycle(
		() => mod.versionDisplay(stored),
		"Unknown (update required)",
		"fixture unknown version",
	);
});

test("title state and legacy English sentinels localize only at presentation", () => {
	for (const stored of ["", "Untitled chat"]) {
		assertLocaleCycle(
			() => mod.conversationTitleForDisplay(stored),
			"Untitled chat",
			"fixture untitled",
		);
	}
	assertLocaleCycle(
		() => mod.conversationTitleForDisplay("this chat"),
		"this chat",
		"fixture this chat",
	);
	assertLocaleCycle(
		() => mod.conversationTitleForDisplay("", "this_chat"),
		"this chat",
		"fixture this chat",
	);
	mod.setLocale("en");
});
