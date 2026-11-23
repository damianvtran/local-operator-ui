import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { withAbsentLocale } from "../../../../../../scripts/i18n/absent-locale.mjs";

const ISOLATED_DEPENDENCY =
	/^@shared\/(components\/common\/confirmation-modal|store\/canonical-sessions-store)$/;
const ANY_MODULE = /.*/;
/* Source-only copy proof. Synthetic state never calls the real delete/archive
 * backend; the modal fixture exposes copy while leaving effects and handlers
 * unexecuted. No rendered-frame or real-focus evidence is claimed here. */
const bundle = await build({
	stdin: {
		contents: `
			import React from "react";
			import { renderToStaticMarkup } from "react-dom/server";
			import { DeleteConversationDialog } from "./src/renderer/src/features/chat/components/delete-conversation-dialog";
			import { ArchiveConversationDialog } from "./src/renderer/src/features/chat/components/archive-conversation-dialog";
			export * from "./src/i18n";
			export const deletion = () => renderToStaticMarkup(React.createElement(DeleteConversationDialog, {title: "Quarterly notes", hasSubagentRuns: true}));
			export const archive = () => renderToStaticMarkup(React.createElement(ArchiveConversationDialog));
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	jsx: "automatic",
	format: "cjs",
	platform: "node",
	write: false,
	tsconfig: "tsconfig.web.json",
	plugins: [
		{
			name: "isolated-confirmation-state",
			setup(build) {
				build.onResolve({ filter: ISOLATED_DEPENDENCY }, (args) => ({
					path: args.path,
					namespace: "copy-fixture",
				}));
				build.onLoad(
					{ filter: ANY_MODULE, namespace: "copy-fixture" },
					(args) => ({
						contents: args.path.endsWith("confirmation-modal")
							? `import React from "react"; export const ConfirmationModal = ({title, message, confirmText, cancelText}) => React.createElement("section", null, React.createElement("h2", null, title), message, React.createElement("button", null, cancelText), React.createElement("button", null, confirmText));`
							: `const state = {deleteCandidate: "dialog-test", archiveCandidate: {sessionId: "dialog-test", fromRow: false}, sessions: [{session_id: "dialog-test", title: "Quarterly notes"}]}; export const useCanonicalSessionsStore = (selector) => selector(state);`,
						resolveDir: process.cwd(),
					}),
				);
			},
		},
	],
});
const compiled = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
	createRequire(import.meta.url),
	compiled,
	compiled.exports,
);
const ui = compiled.exports;

test("confirmation source preserves English heading, buttons and consequence copy", () => {
	ui.setLocale("en");
	const deletion = ui.deletion();
	for (const text of [
		"Delete this conversation?",
		">Cancel<",
		">Delete<",
		"Every message in “Quarterly notes” is permanently removed from this machine. This cannot be undone. The subagent runs it started are kept.",
	])
		assert.ok(deletion.includes(text), text);
	const archive = ui.archive();
	assert.ok(archive.includes(">Archive<"));
	assert.ok(archive.includes(">Cancel<"));
	assert.ok(archive.includes("Quarterly notes"));
	assert.ok(archive.includes("It leaves your lists. You can undo for"));
});

/* WHY TWO LOCALES. This test used to select `fr`, register only two keys and
 * assert `>Delete<` to prove the per-key English fallback. That premise expired
 * when the shipped fr catalogue gained `ui.chat.dialogs.delete_action`
 * ("Supprimer"): fr now localizes the control, which is correct (fr must show
 * no English). So the two halves are split:
 *   1. registered copy + the SHIPPED fr bundle resolve to localized values
 *      (registered keys win over the bundle; unregistered keys come from
 *      `catalogues/fr/ui.chat.dialogs.json`, pinned literally below);
 *   2. the per-key English fallback is driven with ABSENT_LOCALE, a tag no
 *      catalogue can ship, so it cannot expire when a tranche lands. Only the
 *      title is registered there, so the delete control must still come from
 *      the English source through the real runtime lookup (no mocking). */
test("dialog controls resolve registered copy and the shipped localized bundle", () => {
	ui.registerCatalogue("fr", {
		"ui.chat.dialogs.delete_title": "Delete title test",
		"ui.chat.dialogs.cancel": "Cancel test",
	});
	ui.setLocale("fr");
	const deletion = ui.deletion();
	assert.ok(deletion.includes("Delete title test"), "registered title wins");
	assert.ok(
		deletion.includes(">Supprimer<"),
		"unregistered control resolves to the shipped fr bundle",
	);
	assert.ok(!deletion.includes(">Delete<"), "no English control under fr");
	assert.ok(ui.archive().includes(">Cancel test<"), "registered cancel wins");
	assert.ok(ui.archive().includes(">Archiver<"), "shipped fr archive control");
	ui.clearRegisteredCatalogues();
	ui.setLocale("en");
});

test("a locale missing a dialog key falls back to English per key", () => {
	const restore = withAbsentLocale(ui, {
		"ui.chat.dialogs.delete_title": "Delete title test",
	});
	try {
		const deletion = ui.deletion();
		assert.ok(deletion.includes("Delete title test"), "registered key wins");
		assert.ok(deletion.includes(">Delete<"), "absent key -> English source");
		assert.ok(deletion.includes(">Cancel<"), "absent key -> English source");
		assert.ok(
			ui.archive().includes(">Archive<"),
			"absent key -> English source",
		);
	} finally {
		ui.clearRegisteredCatalogues();
		restore();
	}
});
