import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const BOUNDARIES =
	/use-system-prompt$|use-update-system-prompt$|wysiwyg-markdown-editor$|shared\/components\/ui$|shared\/i18n$|use-locale$|date-utils$|common\/spinner$/;
const ANY_MODULE = /.*/;

// Exercise the actual settings state machine. Only the query/mutation boundary
// and the separately browser-exercised rich editor are replaced, not draft logic.
const dom = new JSDOM('<div id="root"></div>', {
	url: "http://fixture.invalid",
});
for (const key of [
	"window",
	"document",
	"HTMLElement",
	"Event",
	"MouseEvent",
	"MutationObserver",
])
	globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let notify;
globalThis.promptTest = {
	data: { content: "# Original", last_modified: "2026-11-04T12:00:00Z" },
	subscribe: (fn) => {
		notify = fn;
		return () => {};
	},
	save: async () => {},
};
const bundle = await build({
	stdin: {
		contents:
			'export { SystemPrompt } from "./src/renderer/src/features/settings/components/system-prompt";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	external: ["react", "react/*", "react-dom", "react-dom/*", "lucide-react"],
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	plugins: [
		{
			name: "test-boundaries",
			setup(build) {
				build.onResolve(
					{
						filter: BOUNDARIES,
					},
					(args) => ({ path: args.path, namespace: "fixture" }),
				);
				build.onLoad(
					{ filter: ANY_MODULE, namespace: "fixture" },
					({ path }) => {
						let contents;
						if (path.endsWith("use-system-prompt"))
							contents =
								'import {useSyncExternalStore} from "react"; export const useSystemPrompt = () => ({ data: useSyncExternalStore(globalThis.promptTest.subscribe, () => globalThis.promptTest.data), isLoading: false, error: null });';
						else if (path.endsWith("use-update-system-prompt"))
							contents =
								'import {useState} from "react"; export const useUpdateSystemPrompt = () => { const [isPending,set] = useState(false); return {isPending, mutateAsync: async (update) => {set(true);try{return await globalThis.promptTest.save(update);}finally{set(false);}}};};';
						else if (path.endsWith("wysiwyg-markdown-editor"))
							contents =
								'import React from "react"; export const WysiwygMarkdownEditor = ({draft,document}) => { const [value,set] = React.useState(document.content); return <button disabled={draft.disabled} onClick={() => {const next=value + " edited";set(next);draft.onChange(next);}}>Edit rich fixture</button>; };';
						else if (path.endsWith("shared/components/ui"))
							contents =
								'import React from "react"; export const Button = ({variant,...props}) => <button {...props}/>; export const Label = props => <label {...props}/>; export const Alert = ({variant,...props}) => <div role="alert" {...props}/>; export const Textarea = props => <textarea {...props}/>;';
						else if (path.endsWith("use-locale"))
							contents = 'export const useI18nLocale = () => "en";';
						else if (path.endsWith("date-utils"))
							contents =
								"export const formatCalendarDateTime = value => value;";
						else if (path.endsWith("common/spinner"))
							contents = "export const Spinner = () => null;";
						else contents = "export const t = (key) => key;";
						return { contents, loader: "tsx", resolveDir: process.cwd() };
					},
				);
			},
		},
	],
});
// Resolve the shared React singleton before importing the in-memory bundle;
// a data URL has no package-resolution base and needs no scratch installation.
const code = bundle.outputFiles[0].text
	.replaceAll(
		'from "react"',
		`from ${JSON.stringify(import.meta.resolve("react"))}`,
	)
	.replaceAll(
		'from "react/jsx-runtime"',
		`from ${JSON.stringify(import.meta.resolve("react/jsx-runtime"))}`,
	)
	.replaceAll(
		'from "lucide-react"',
		`from ${JSON.stringify(import.meta.resolve("lucide-react"))}`,
	);
const { SystemPrompt } = await import(
	`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);
const root = createRoot(document.getElementById("root"));
const buttons = () => [...document.querySelectorAll("button")];
const find = (text) => buttons().find((button) => button.textContent === text);
const save = () => find("ui.settings.model.system_prompt.save_changes");
const cancel = () => find("ui.settings.model.system_prompt.cancel");
const edit = () => find("Edit rich fixture");

test("dirty refetch, pending save, failure retention, success baseline and cancel", async () => {
	await act(async () => root.render(React.createElement(SystemPrompt)));
	assert.equal(save().disabled, true);
	await act(async () => edit().click());
	assert.equal(save().disabled, false);
	await act(async () => {
		globalThis.promptTest.data = { content: "# External" };
		notify();
	});
	assert.equal(save().disabled, false);
	let finish;
	let submitted;
	globalThis.promptTest.save = (update) => {
		submitted = update.content;
		return new Promise((resolve, reject) => {
			finish = { resolve, reject };
		});
	};
	await act(async () => save().click());
	assert.equal(submitted, "# Original edited");
	assert.equal(edit().disabled, true);
	assert.equal(cancel().disabled, true);
	await act(async () => finish.reject(new Error("Synthetic conflict")));
	assert.equal(save().disabled, false);
	assert.ok(
		document
			.querySelector('[role="alert"]')
			.textContent.includes("Synthetic conflict"),
	);
	await act(async () => save().click());
	assert.equal(submitted, "# Original edited");
	await act(async () => finish.resolve());
	assert.equal(save().disabled, true);
	await act(async () => edit().click());
	await act(async () => cancel().click());
	assert.equal(save().disabled, true);
	await act(async () => edit().click());
	await act(async () => save().click());
	assert.equal(submitted, "# External edited");
	await act(async () => finish.resolve());
	await act(async () => root.unmount());
	dom.window.close();
});
