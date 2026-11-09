/** Production settings owner, codec and UndoManager. The rich-editor boundary is
 * a small contenteditable adapter so this lane fits the reviewer's 1 GB process
 * group ceiling; it does not bundle canvas networking, toolbars or query clients.
 * The adapter follows the production document-id initialization/history lifetime.
 * Full rich-dialog behavior stays covered by system-prompt-dialog.test.mjs.
 * No pixels, native selection or live application negotiation claim. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://fixture.invalid",
});
for (const key of [
	"window",
	"document",
	"Element",
	"HTMLElement",
	"Node",
	"MutationObserver",
	"Event",
	"MouseEvent",
])
	globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const PORTS = /wysiwyg-markdown-editor$|shared\/components\/ui$/;
const ALL = /.*/;
const built = await build({
	stdin: {
		contents: `
            export {SystemPromptEditor} from './src/renderer/src/features/settings/components/system-prompt-editor';
            export {t, setLocale, registerCatalogue} from './src/i18n';
            export * as React from 'react';
            export {createRoot} from 'react-dom/client';
        `,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "browser",
	write: false,
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	plugins: [
		{
			name: "bounded-editor-boundary",
			setup(builder) {
				builder.onResolve({ filter: PORTS }, ({ path }) => ({
					path,
					namespace: "port",
				}));
				builder.onLoad({ filter: ALL, namespace: "port" }, ({ path }) => ({
					resolveDir: process.cwd(),
					loader: "tsx",
					contents: path.endsWith("components/ui")
						? `import React from 'react'; export const Button = ({variant,...props}) => <button {...props}/>; export const Textarea = props => <textarea {...props}/>;`
						: `import React, {useEffect, useRef} from 'react';
                        import {UndoManager} from './src/renderer/src/shared/lib/undo-manager';
                        export function WysiwygMarkdownEditor({document, draft}) {
                            const ref = useRef(null);
                            useEffect(() => {
                                const root = ref.current;
                                root.innerHTML = draft.codec.render(document.content);
                                const manager = new UndoManager(root, {debounceDelay: 1});
                                manager.connect();
                                globalThis.__promptHistoryFixture = {root, manager, codec: draft.codec};
                                return () => {manager.disconnect(); globalThis.__promptHistoryFixture = undefined;};
                            }, [document.id]);
                            globalThis.__promptDraftFixture = draft;
                            return <div ref={ref} role="textbox" aria-label={draft.label} contentEditable suppressContentEditableWarning/>;
                        }`,
				}));
			},
		},
	],
});
const {
	React,
	createRoot,
	SystemPromptEditor,
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

const accessibleLabel = (node) =>
	node.getAttribute("aria-labelledby")
		? document.getElementById(node.getAttribute("aria-labelledby"))?.textContent
		: node.getAttribute("aria-label");
const translated = {
	"ui.settings.model.system_prompt.instructions": "INSTRUCTIONS-FR",
	"ui.settings.model.system_prompt.source_edit": "SOURCE-FR",
	"ui.settings.model.system_prompt.source_stale": "STALE-FR",
	"ui.canvas.wysiwyg_markdown_editor.checklist": "CHECKLIST-FR",
};
async function withEditor(source, exercise) {
	setLocale("en");
	registerCatalogue("fr", translated);
	const host = document.createElement("div");
	document.body.append(host);
	const reactRoot = createRoot(host);
	const changes = [];
	const onChange = (value) => changes.push(value);
	try {
		await React.act(async () =>
			reactRoot.render(
				React.createElement(SystemPromptEditor, { value: source, onChange }),
			),
		);
		await exercise({ ...globalThis.__promptHistoryFixture, host, changes });
	} finally {
		await React.act(async () => reactRoot.unmount());
		host.remove();
		setLocale("en");
	}
}

// Reviewer R1 used a 1 ms production debounce and a 30 ms observation window.
// This drain is the same negative-control instrument, not a product timing gate.
const drainHistory = async () =>
	React.act(async () => {
		await delay(30);
	});

test("R1: locale preserves pending redo and undo/redo keep current source labels", async () => {
	const source = "<policy>exact</policy>\n\nOriginal paragraph.\n";
	await withEditor(source, async ({ root, manager, codec, changes }) => {
		assert.equal(codec.read(root), source);
		const paragraph = [
			...root.querySelectorAll("p span[data-prompt-node]"),
		].find((node) => node.textContent === "Original paragraph.");
		assert.ok(paragraph);
		paragraph.textContent = "First edit.";
		manager.saveCurrentState();
		paragraph.textContent = "Second edit.";
		manager.saveCurrentState();
		assert.equal(manager.undo(), true);
		assert.equal(manager.canRedo(), true);
		const before = manager.getHistoryState();
		await React.act(async () => setLocale("fr"));
		await drainHistory();
		assert.deepEqual(
			manager.getHistoryState(),
			before,
			"locale must not append history or truncate redo",
		);
		assert.equal(
			manager.canRedo(),
			true,
			"pending redo survives the locale switch",
		);
		assert.equal(
			accessibleLabel(root.querySelector("[data-prompt-opaque]")),
			"SOURCE-FR",
		);
		assert.equal(manager.undo(), true);
		assert.equal(
			codec.read(root),
			source,
			"undo restores exact original source",
		);
		assert.equal(
			accessibleLabel(root.querySelector("[data-prompt-opaque]")),
			"SOURCE-FR",
			"undo must not restore English labels",
		);
		assert.equal(manager.redo(), true);
		assert.equal(manager.redo(), true);
		assert.equal(
			accessibleLabel(root.querySelector("[data-prompt-opaque]")),
			"SOURCE-FR",
			"redo also resolves current presentation",
		);
		assert.equal(
			codec.read(root),
			source.replace("Original paragraph.", "Second edit."),
		);
		assert.deepEqual(
			changes,
			[],
			"presentation refresh does not report a settings edit",
		);
	});
});

test("draft labels refresh while codec, editor and source nodes stay owned by the same draft", async () => {
	await withEditor(
		"<policy>keep exact</policy>\n",
		async ({ root, codec, host, changes }) => {
			const atom = root.querySelector("[data-prompt-opaque]");
			assert.equal(
				accessibleLabel(atom),
				t("ui.settings.model.system_prompt.source_edit"),
			);
			await React.act(async () => setLocale("fr"));
			assert.equal(root.getAttribute("aria-label"), "INSTRUCTIONS-FR");
			assert.equal(globalThis.__promptDraftFixture.sourceLabel, "SOURCE-FR");
			assert.equal(
				globalThis.__promptDraftFixture.sourceStaleLabel,
				"STALE-FR",
			);
			assert.equal(globalThis.__promptDraftFixture.codec, codec);
			assert.equal(host.querySelector("[contenteditable]"), root);
			assert.equal(root.querySelector("[data-prompt-opaque]"), atom);
			assert.deepEqual(changes, []);
		},
	);
});
