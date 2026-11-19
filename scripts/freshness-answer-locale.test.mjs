/** Execute the real freshness hook/runner with a stubbed disk bridge. A completed
 * re-read's answer must repaint, without another read or restarting its lifetime.
 * jsdom checks returned text, not pixels; no live daemon/session is contacted.
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
let reads = 0;
let probes = 0;
window.api = {
	probeFiles: async ([path]) => {
		probes++;
		return [
			{
				input: path,
				resolved: path,
				exists: true,
				isFile: true,
				sizeBytes: 4,
				mtimeMs: 1000,
			},
		];
	},
	readFile: async () => {
		reads++;
		return { success: true, data: "same" };
	},
};
const STORE = /@shared\/store\/canvas-store$/;
const ALL = /.*/;
const built = await build({
	stdin: {
		contents: `
		export { useFileFreshness } from './src/renderer/src/features/chat/components/canvas/use-file-freshness';
		export { useI18nLocale } from './src/renderer/src/shared/i18n/use-locale';
		export { t, setLocale, registerCatalogue } from './src/i18n';
		export * as React from 'react';
		export { createRoot } from 'react-dom/client';
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
	plugins: [
		{
			name: "canvas-store-port",
			setup(builder) {
				builder.onResolve({ filter: STORE }, () => ({
					path: "store",
					namespace: "port",
				}));
				builder.onLoad({ filter: ALL, namespace: "port" }, () => ({
					loader: "js",
					contents:
						"const state = {updateOneFile() {}}; export const useCanvasStore = Object.assign(selector => selector(state), {getState: () => state});",
				}));
			},
		},
	],
});
const {
	React,
	createRoot,
	useFileFreshness,
	useI18nLocale,
	t,
	setLocale,
	registerCatalogue,
} = await import(
	`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);
after(() => {
	dom.window.close();
	for (const handle of process._getActiveHandles?.() ?? [])
		if (handle?.constructor?.name === "MessagePort") handle.close();
});

test("completed mocked re-read answer and detail follow locale without new I/O", async () => {
	registerCatalogue("fr", {
		"ui.canvas.use_file_freshness.up_to_date": "A-JOUR-FR",
		"ui.canvas.use_file_freshness.already_up_to_date_the_file_is_unchanged":
			"DETAIL-FR",
	});
	setLocale("en");
	const document = {
		id: "synthetic-freshness",
		path: "/synthetic/test.txt",
		title: "test.txt",
		type: "text",
		content: "same",
		readMtimeMs: 1000,
	};
	let current;
	function Probe() {
		// The freshness bar's parent can repaint independently. That alone must
		// not leave an answer's previously resolved string in hook state.
		useI18nLocale();
		current = useFileFreshness({
			document,
			conversationId: "synthetic-conversation",
		});
		return React.createElement("output", null, current.note);
	}
	const root = createRoot(window.document.createElement("div"));
	try {
		await React.act(async () => root.render(React.createElement(Probe)));
		await React.act(async () => current.refresh());
		assert.equal(reads, 1, "forced refresh actually re-read the mocked file");
		assert.equal(current.note, t("ui.canvas.use_file_freshness.up_to_date"));
		const before = { reads, probes };
		await React.act(async () => setLocale("fr"));
		assert.equal(
			current.note,
			"A-JOUR-FR",
			"stored answer must not keep English after a locale repaint",
		);
		assert.equal(current.detail, "DETAIL-FR");
		assert.deepEqual(
			{ reads, probes },
			before,
			"locale repaint must not re-probe or re-read",
		);
	} finally {
		await React.act(async () => root.unmount());
		setLocale("en");
	}
});
