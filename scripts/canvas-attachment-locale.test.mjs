/** Mounted viewer regression: a locale switch must cross BOTH memo boundaries.
 * Finder is a prop recorder, not a layout substitute; this asserts the real
 * attachment builder's copy and stable memo identity, not pixels.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const captures = [];
globalThis.__canvasLocaleCaptures = captures;
const bundle = await build({
	stdin: {
		contents: `
		export { CanvasFileViewer } from './src/renderer/src/features/chat/components/canvas/canvas-file-viewer';
		export * as React from 'react';
		export { createRoot } from 'react-dom/client';
		export { t, setLocale, registerCatalogue } from './src/i18n';
	`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "browser",
	write: false,
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	loader: {
		".css": "empty",
		".png": "empty",
		".svg": "empty",
		".webp": "empty",
	},
	plugins: [
		{
			name: "viewer-ports",
			setup(builder) {
				builder.onResolve(
					{ filter: /(?:finder-files-view|@shared\/store\/canvas-store)$/ },
					({ path }) => ({ path, namespace: "ports" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "ports" }, ({ path }) => ({
					loader: "js",
					contents: path.endsWith("finder-files-view")
						? "export function FinderFilesView(props) { globalThis.__canvasLocaleCaptures.push(props); return null; }"
						: "const noop = () => {}; const state = { conversations: {}, setFiles: noop, setOpenTabs: noop, setSelectedTab: noop, setViewMode: noop }; export const useCanvasStore = Object.assign(selector => selector(state), {getState: () => state});",
				}));
			},
		},
	],
});
const { React, createRoot, CanvasFileViewer, t, setLocale, registerCatalogue } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
after(() => {
	dom.window.close();
	for (const handle of process._getActiveHandles?.() ?? [])
		if (handle?.constructor?.name === "MessagePort") handle.close();
	globalThis.__canvasLocaleCaptures = undefined;
});

test("same mounted memoized viewer rebuilds attachment copy only on locale/data changes", async () => {
	registerCatalogue("fr", {
		"ui.chat.attachments.saved_copy_label": "COPIE-FR",
		"ui.canvas.files.attachmentImage": "IMAGE-FR",
		"ui.canvas.files.attachmentRetained": "RETAINED-FR",
	});
	setLocale("en");
	const host = document.createElement("div");
	const root = createRoot(host);
	const items = [
		{
			key: "synthetic:0",
			digest: "a".repeat(64),
			filename: null,
			kind: "image",
			mimeType: "image/png",
			availability: "retained",
			materialisable: true,
			ts: 0,
		},
	];
	const props = {
		conversationId: "synthetic-canvas-locale",
		sessionId: "synthetic-session",
		index: { mode: "index", rows: [] },
		attachments: { items, capable: true },
		onSwitchToDocumentView() {},
	};
	try {
		await React.act(async () =>
			root.render(React.createElement(CanvasFileViewer, props)),
		);
		const before = captures.at(-1).attachments.items;
		assert.ok(before?.length, "fixture reaches real attachment items");
		await React.act(async () => setLocale("fr"));
		const afterSwitch = captures.at(-1).attachments.items;
		assert.notStrictEqual(
			afterSwitch,
			before,
			"locale must invalidate the viewer AND inner attachment memo",
		);
		assert.equal(
			afterSwitch[0].row.document.title,
			t("ui.canvas.files.attachmentImage"),
		);
		assert.equal(afterSwitch[0].attachment.tileStatus, "COPIE-FR");
		assert.equal(afterSwitch[0].attachment.note, "RETAINED-FR");
		await React.act(async () =>
			root.render(
				React.createElement(CanvasFileViewer, { ...props, cwd: "/synthetic" }),
			),
		);
		assert.strictEqual(
			captures.at(-1).attachments.items,
			afterSwitch,
			"unrelated render must preserve finder attachment identity",
		);
	} finally {
		await React.act(async () => root.unmount());
		setLocale("en");
	}
});
