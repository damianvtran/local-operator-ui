import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Source-only copy contract through the actual composer components. The file
 * bridge and UI primitives are isolated so this does not acquire a microphone,
 * fetch private files or boot Electron. It is not rendered-frame evidence.
 */
const STUB_DEPENDENCY = /^@shared\/(components\/ui|hooks\/use-file-blob-url)$/;
const ANY_MODULE = /.*/;
const bundle = await build({
	stdin: {
		contents: `
			import React from "react";
			import { renderToStaticMarkup } from "react-dom/server";
			import { AudioRecordingIndicator } from "./src/renderer/src/features/chat/components/audio-recording-indicator";
			import { AttachmentsPreview } from "./src/renderer/src/features/chat/components/attachments-preview";
			export * from "./src/i18n";
			export const recording = (isRecording) => renderToStaticMarkup(React.createElement(AudioRecordingIndicator, { isRecording }));
			export const attachments = (paths) => renderToStaticMarkup(React.createElement(AttachmentsPreview, { attachments: paths.map((path, index) => ({ id: "a" + index, path })), onRemoveAttachment() {} }));
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
			name: "isolated-composer-dependencies",
			setup(build) {
				build.onResolve({ filter: STUB_DEPENDENCY }, (args) => ({
					path: args.path,
					namespace: "copy-fixture",
				}));
				build.onLoad(
					{ filter: ANY_MODULE, namespace: "copy-fixture" },
					(args) => ({
						contents: args.path.endsWith("components/ui")
							? `import React from "react"; export const Button = ({children, size, variant, ...props}) => React.createElement("button", props, children); export const Tooltip = ({children}) => children;`
							: `export const useFileBlobUrl = () => ({status: "loading"}); export const previewFailureReason = () => "bridge failure";`,
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

test("recording keeps English copy and keycaps, and inactive recording stays absent", () => {
	ui.setLocale("en");
	const html = ui.recording(true);
	for (const text of ["Recording", "confirms", "cancels", "Enter", "Esc"])
		assert.ok(html.includes(text), text);
	assert.equal(ui.recording(false), "");
});

test("attachment captions preserve MIME parameters and filenames", () => {
	ui.setLocale("en");
	assert.equal(ui.attachments([]), "");
	for (const [path, name] of [
		["data:application/pdf;base64,AA", "Pasted application/pdf"],
		["data:;base64,AA", "Pasted file"],
		["/tmp/report.pdf", "report.pdf"],
	]) {
		const html = ui.attachments([path]);
		assert.ok(html.includes(name), name);
		assert.ok(html.includes('aria-label="Remove attachment"'));
	}
});

test("registered locale uses translated composer copy with English per-key fallback", () => {
	ui.registerCatalogue("fr", {
		"ui.chat.composer_media.recording": "Capture test",
		"ui.chat.composer_media.remove_attachment": "Remove test",
		"ui.chat.composer_media.pasted_type": "Type test {mimeType}",
	});
	ui.setLocale("fr");
	assert.ok(ui.recording(true).includes("Capture test"));
	assert.ok(ui.recording(true).includes("confirms"));
	const html = ui.attachments(["data:application/pdf;base64,AA"]);
	assert.ok(html.includes("Type test application/pdf"));
	assert.ok(html.includes('aria-label="Remove test"'));
	ui.clearRegisteredCatalogues();
	ui.setLocale("en");
});
