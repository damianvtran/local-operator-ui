import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Bundle the real pure modules together so they share the same locale store.
// No browser, backend or device is needed to prove labels are read lazily.
const { outputFiles } = await build({
	stdin: {
		contents: `export * from './src/renderer/src/features/chat/utils/image-actions';
			export * from './src/renderer/src/features/chat/right-slot-notices';
			export * from './src/renderer/src/features/chat/chat-list-sections';
			export { resolveChatTitle } from './src/renderer/src/features/chat/chat-title';
			export { registerCatalogue, clearRegisteredCatalogues, setLocale } from './src/i18n';`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	write: false,
	platform: "node",
	format: "esm",
	alias: { "@shared": "./src/renderer/src/shared" },
});
const copy = await import(
	`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);

test("sidebar time arms and untitled fallback resolve localized copy", () => {
	copy.registerCatalogue("fr", {
		"ui.chat.sidebar_view.relative_short":
			"{unit, select, now {instant témoin} other {{count} unité témoin}}",
		"ui.chat.sidebar_view.relative_active": "activité {count}",
		"ui.chat.sidebar_view.relative_created": "création {count}",
	});
	try {
		copy.setLocale("fr");
		const now = 1_800_000_000_000;
		for (const age of [
			0, 60_000, 3_600_000, 86_400_000, 604_800_000, 31_536_000_000,
		]) {
			const row = {
				updated_at: (now - age) / 1000,
				created_at: (now - age) / 1000,
			};
			assert.match(copy.relativeTime(row, now, "active"), /témoin/);
			assert.match(copy.relativeTimeSentence(row, now, "active"), /^activité /);
			assert.match(
				copy.relativeTimeSentence(row, now, "created"),
				/^création /,
			);
		}
		assert.equal(copy.resolveChatTitle({}), "Conversation sans titre");
		assert.equal(copy.relativeTime({}, now, "active"), "");
	} finally {
		copy.setLocale("en");
		copy.clearRegisteredCatalogues();
	}
});

test("image actions and frozen notices resolve copy after a locale change", () => {
	copy.registerCatalogue("fr", {
		"ui.common.file_actions.open_file": "Fichier témoin",
		"ui.chat.slot_notice.run_draft_title": "Conversation témoin.",
	});
	try {
		copy.setLocale("fr");
		const actions = copy.imageActions("path", {});
		assert.equal(
			actions.find((action) => action.id === "open-file").label,
			"Fichier témoin",
		);
		assert.equal(copy.RUN_NOTICE_DRAFT.title, "Conversation témoin.");
		copy.setLocale("en");
		assert.equal(
			copy.imageActions("path", {}).find((action) => action.id === "open-file")
				.label,
			"Open file",
		);
		assert.equal(
			copy.RUN_NOTICE_DRAFT.title,
			"Run details need a conversation.",
		);
	} finally {
		copy.setLocale("en");
		copy.clearRegisteredCatalogues();
	}
});
