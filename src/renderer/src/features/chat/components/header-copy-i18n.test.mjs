import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/* Source-only fallback and wiring contract; it is not a header mount, native
 * action-menu flow or rendered-fit check. CI owns the full component typecheck.
 */
const bundle = await build({
	stdin: { contents: 'export * from "./src/i18n";', resolveDir: process.cwd() },
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const copy = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const expected = {
	"ui.chat.header.conversation_name": "Conversation name",
	"ui.chat.header.archived_hint":
		"This conversation is archived. It is hidden from your chats until you restore it.",
	"ui.chat.header.archived": "Archived",
	"ui.chat.header.actions": "Conversation actions",
	"ui.chat.header.copy_id": "Copy session ID",
	"ui.chat.header.move_device": "Move to another device…",
	"ui.chat.header.transcript_display": "Transcript display",
	"ui.chat.header.delete": "Delete conversation…",
	"ui.chat.header.close_run_details": "Close run details",
	"ui.chat.header.open_run_details": "Open run details",
};
test("header keys preserve exact English and render-time locale subscription", () => {
	copy.setLocale("en");
	const source = readFileSync(
		new URL("./chat-header.tsx", import.meta.url),
		"utf8",
	);
	assert.ok(source.includes("useI18nLocale();"));
	for (const [key, text] of Object.entries(expected)) {
		assert.equal(copy.t(key), text);
		assert.ok(source.includes(`t("${key}")`), key);
	}
});
test("registered header copy changes with locale and keeps English per-key fallback", () => {
	copy.registerCatalogue("fr", { "ui.chat.header.archived": "Archived test" });
	copy.setLocale("fr");
	assert.equal(copy.t("ui.chat.header.archived"), "Archived test");
	assert.equal(copy.t("ui.chat.header.move_device"), "Move to another device…");
	copy.clearRegisteredCatalogues();
	copy.setLocale("en");
});
