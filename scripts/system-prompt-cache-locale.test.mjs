/** Production system-prompt rich editor and codec across a locale switch. No layout claim. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

Error.stackTraceLimit = 0;
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost",
});
for (const key of [
	"window",
	"document",
	"Element",
	"HTMLElement",
	"Node",
	"MutationObserver",
	"CustomEvent",
	"Event",
	"MouseEvent",
])
	globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		/* Context-only accessors. */
	}
}
globalThis.NodeFilter = dom.window.NodeFilter;
Object.defineProperty(globalThis, "navigator", {
	configurable: true,
	value: dom.window.navigator,
});
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
dom.window.document.execCommand = () => false;
const built = await build({
	stdin: {
		contents: `
        export { QueryClient, QueryClientProvider } from '@tanstack/react-query';
        export { SystemPromptEditor } from './src/renderer/src/features/settings/components/system-prompt-editor';
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
	loader: {
		".css": "empty",
		".svg": "empty",
		".png": "empty",
		".webp": "empty",
	},
});
const {
	React,
	createRoot,
	QueryClient,
	QueryClientProvider,
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
test("system prompt draft and codec labels refresh without replacing the rich draft", async () => {
	setLocale("en");
	registerCatalogue("fr", {
		"ui.settings.model.system_prompt.instructions": "INSTRUCTIONS-FR",
		"ui.settings.model.system_prompt.source_edit": "SOURCE-FR",
		"ui.settings.model.system_prompt.source_stale": "STALE-FR",
		"ui.canvas.wysiwyg_markdown_editor.checklist": "CHECKLIST-FR",
	});
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const changes = [];
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	const source =
		"<policy>keep exact</policy>\n\n- [ ] ![](https://fixture.invalid/task.png)\n";
	const onChange = (value) => changes.push(value);
	const render = (sourceVersion = 0) =>
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(SystemPromptEditor, {
					value: source,
					onChange,
					sourceVersion,
				}),
			),
		);
	try {
		await React.act(async () => render());
		const editor = host.querySelector("[contenteditable]");
		const atom = editor.querySelector("[data-prompt-opaque]");
		assert.ok(atom, "production codec renders an opaque source atom");
		assert.equal(
			atom.getAttribute("aria-label"),
			t("ui.settings.model.system_prompt.source_edit"),
		);
		assert.equal(
			editor.getAttribute("aria-label"),
			t("ui.settings.model.system_prompt.instructions"),
		);
		await React.act(async () =>
			atom.dispatchEvent(new MouseEvent("click", { bubbles: true })),
		);
		const dialog = document.querySelector('[role="dialog"]');
		assert.ok(dialog, "the real opaque-source dialog opens");
		const draftSource = dialog.querySelector("textarea").value;
		await React.act(async () => render(1));
		assert.ok(
			dialog.textContent.includes(
				t("ui.settings.model.system_prompt.source_stale"),
			),
			"a changed source version marks the retained dialog stale",
		);
		await React.act(async () => setLocale("fr"));
		assert.deepEqual(
			{
				draft: editor.getAttribute("aria-label"),
				codec: atom.getAttribute("aria-label"),
				checklist: editor
					.querySelector("input[type=checkbox]")
					?.getAttribute("aria-label"),
			},
			{
				draft: "INSTRUCTIONS-FR",
				codec: "SOURCE-FR",
				checklist: "CHECKLIST-FR",
			},
		);
		assert.ok(
			dialog.textContent.includes("SOURCE-FR"),
			"open source dialog gets new draft labels",
		);
		assert.ok(
			dialog.textContent.includes("STALE-FR"),
			"retained stale-source alert follows locale too",
		);
		assert.equal(
			dialog.querySelector("textarea").getAttribute("aria-label"),
			"SOURCE-FR",
		);
		assert.equal(
			dialog.querySelector("textarea").value,
			draftSource,
			"open source edit survives locale",
		);
		assert.equal(
			host.querySelector("[contenteditable]"),
			editor,
			"locale does not remount the draft",
		);
		assert.equal(
			editor.querySelector("[data-prompt-opaque]"),
			atom,
			"locale preserves source span identity",
		);
		assert.deepEqual(changes, [], "locale is not a user edit");
	} finally {
		await React.act(async () => root.unmount());
		host.remove();
		client.clear();
		setLocale("en");
	}
});
