import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
const req = createRequire(`${process.cwd()}/package.json`);
const { build } = req("esbuild");
const { JSDOM } = req("jsdom");
const React = req("react");
const { act } = React;

const BOUNDARIES =
	/use-system-prompt$|use-update-system-prompt$|shared\/components\/ui$|shared\/i18n$|use-locale$|date-utils$|common\/spinner$|base-dialog$|find-replace-widget$|text-selection-controls$|inline-edit$|insert-image-dialog$|insert-link-dialog$|insert-table-popover$|text-style-dropdown$/;
const ANY_MODULE = /.*/;
const PRESENTATION_HELPERS =
	/find-replace-widget|text-selection-controls|inline-edit|insert-image-dialog|insert-link-dialog|insert-table-popover|text-style-dropdown/;

// Reuse independent QA's discriminator: real settings host, editor, dialog,
// codec and history; only transport/query and presentation helpers are adapted.
// Native navigation/clipboard are not measured by this bounded component host.
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
	"Node",
	"Element",
	"Text",
	"KeyboardEvent",
	"InputEvent",
])
	globalThis[key] = dom.window[key];
const { createRoot } = req("react-dom/client");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.document.queryCommandState = () => false;
window.document.queryCommandValue = () => "";
let notify;
const writes = [];
globalThis.promptTest = {
	data: {
		content:
			"# Original\n\nBefore <policy> after. [Guide](https://example.invalid/guide)\n",
		last_modified: "2026-11-04T12:00:00Z",
	},
	subscribe: (fn) => {
		notify = fn;
		return () => {};
	},
	save: async (update) => {
		writes.push(update.content);
		globalThis.promptTest.data = {
			...globalThis.promptTest.data,
			content: update.content,
		};
		notify?.();
	},
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
						else if (path.endsWith("shared/components/ui"))
							contents =
								'import React from "react"; export const Button = React.forwardRef(({variant,...props},ref) => <button ref={ref} {...props}/>); export const Label = props => <label {...props}/>; export const Alert = ({variant,...props}) => <div role="alert" {...props}/>; export const Textarea = ({onChange,...props}) => <textarea onInput={onChange} {...props}/>; export const Tooltip=({children})=><>{children}</>; export const DropdownMenu=Tooltip; export const DropdownMenuContent=Tooltip; export const DropdownMenuTrigger=Tooltip; export const DropdownMenuItem=({children,onSelect,...props})=><button onClick={onSelect} {...props}>{children}</button>; export const DropdownMenuSeparator=()=>null;';
						else if (path.endsWith("base-dialog"))
							contents =
								'import React from "react"; export const BaseDialog=({open,title,children,actions})=>open?<div role="dialog" aria-label={title}>{children}{actions}</div>:null;';
						else if (PRESENTATION_HELPERS.test(path)) {
							const name = {
								"find-replace-widget": "FindReplaceWidget",
								"text-selection-controls": "TextSelectionControls",
								"inline-edit": "InlineEdit",
								"insert-image-dialog": "InsertImageDialog",
								"insert-link-dialog": "InsertLinkDialog",
								"insert-table-popover": "InsertTablePopover",
								"text-style-dropdown": "TextStyleDropdown",
							}[path.split("/").pop()];
							contents = `export const ${name}=()=>null;`;
						} else if (path.endsWith("use-locale"))
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
		`from ${JSON.stringify(`file://${req.resolve("react")}`)}`,
	)
	.replaceAll(
		'from "react/jsx-runtime"',
		`from ${JSON.stringify(`file://${req.resolve("react/jsx-runtime")}`)}`,
	)
	.replaceAll(
		'from "lucide-react"',
		`from ${JSON.stringify(`file://${req.resolve("lucide-react")}`)}`,
	);
const resolvedCode = code
	.replaceAll(
		'from "react-dom"',
		`from ${JSON.stringify(`file://${req.resolve("react-dom")}`)}`,
	)
	.replaceAll(
		'from "react-dom/client"',
		`from ${JSON.stringify(`file://${req.resolve("react-dom/client")}`)}`,
	);
const { SystemPrompt } = await import(
	`data:text/javascript;base64,${Buffer.from(resolvedCode).toString("base64")}`
);
const root = createRoot(document.getElementById("root"));
const buttons = () => [...document.querySelectorAll("button")];
const find = (text) => buttons().find((button) => button.textContent === text);
const save = () => find("ui.settings.model.system_prompt.save_changes");

test("real settings host: local draft refetch, stale refusal, Apply and image Cancel/history", async () => {
	await act(async () => root.render(React.createElement(SystemPrompt)));
	assert.equal(
		document.querySelector("[contenteditable=true] [href]"),
		null,
		"instruction links expose no navigation primitive",
	);
	const atom = document.querySelector("[data-prompt-opaque]");
	assert.ok(atom, "real codec rendered atom");
	await act(async () => atom.click());
	const input = document.querySelector("[role=dialog] textarea");
	assert.ok(input, "real WYS opened dialog");
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			window.HTMLTextAreaElement.prototype,
			"value",
		).set.call(input, '<policy draft="unapplied">');
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
	assert.equal(
		document.querySelector("[role=dialog] textarea").value,
		'<policy draft="unapplied">',
	);
	assert.equal(
		save().disabled,
		true,
		"host remains pristine while dialog draft is edited",
	);
	console.log(
		JSON.stringify({
			beforeRefetch: {
				dialogOpen: !!document.querySelector("[role=dialog]"),
				localDraft: input.value,
				hostSaveDisabled: save().disabled,
			},
		}),
	);
	await act(async () => {
		globalThis.promptTest.data = {
			content: "# External fictional update\n\nBefore <policy> after.\n",
		};
		notify();
	});
	console.log(
		JSON.stringify({
			afterRefetch: {
				dialogOpen: !!document.querySelector("[role=dialog]"),
				draftSurvives: document.body.textContent.includes("unapplied"),
				hostText: document.querySelector("[contenteditable=true]").textContent,
			},
		}),
	);
	const lost = !document.querySelector("[role=dialog]");
	assert.equal(
		document.querySelector("[role=dialog] textarea")?.value,
		'<policy draft="unapplied">',
	);
	assert.equal(
		find("ui.chat.pickers.picker_host.apply").disabled,
		true,
		"remote version makes Apply stale without committing local source",
	);
	assert.ok(
		document
			.querySelector("[role=alert]")
			?.textContent.includes("source_stale"),
	);
	assert.equal(save().disabled, true);
	await act(async () => find("ui.canvas.insert_link_dialog.cancel").click());
	assert.equal(document.querySelector("[role=dialog]"), null);
	assert.equal(
		document.querySelector("h1").textContent,
		"External fictional update",
		"Cancel explicitly releases ownership and adopts remote content",
	);
	await act(async () =>
		root.render(React.createElement(SystemPrompt, { key: "dirty-control" })),
	);
	const rich = document.querySelector("[contenteditable=true]");
	await act(async () => {
		rich.querySelector("h1 span").textContent = "Dirty accepted host draft";
		rich.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
	assert.equal(save().disabled, false);
	await act(async () => document.querySelector("[data-prompt-opaque]").click());
	const local = document.querySelector("[role=dialog] textarea");
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			window.HTMLTextAreaElement.prototype,
			"value",
		).set.call(local, '<policy draft="dirty-control">');
		local.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
	await act(async () => {
		globalThis.promptTest.data = {
			content: "# Third fictional update\n\nBefore <policy> after.\n",
		};
		notify();
	});
	console.log(
		JSON.stringify({
			dirtyHostControl: {
				dialogOpen: !!document.querySelector("[role=dialog]"),
				value: document.querySelector("[role=dialog] textarea")?.value,
			},
		}),
	);
	assert.equal(
		document.querySelector("[role=dialog] textarea")?.value,
		'<policy draft="dirty-control">',
	);
	// A fresh Apply proves the textarea change lives in React state, not just DOM.
	await act(async () =>
		root.render(React.createElement(SystemPrompt, { key: "fresh-apply" })),
	);
	await act(async () => document.querySelector("[data-prompt-opaque]").click());
	const applied = document.querySelector("[role=dialog] textarea");
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			window.HTMLTextAreaElement.prototype,
			"value",
		).set.call(applied, '<policy draft="applied">');
		applied.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
	await act(async () => find("ui.chat.pickers.picker_host.apply").click());
	assert.equal(
		document.querySelector("[data-prompt-opaque]").textContent,
		'<policy draft="applied">',
	);
	assert.equal(save().disabled, false);
	await act(async () => save().click());
	const saved =
		'# Third fictional update\n\nBefore <policy draft="applied"> after.\n';
	assert.deepEqual(writes, [saved]);
	console.log(
		JSON.stringify({
			freshApply: {
				canonicalExact: writes[0] === saved,
				writes: writes.length,
			},
		}),
	);
	// A real typing caret is the discriminating control for the Image/Cancel bug.
	const edited = document.querySelector("[contenteditable=true]");
	await act(async () => {
		edited.dispatchEvent(
			new window.InputEvent("beforeinput", {
				bubbles: true,
				inputType: "insertText",
				data: "fictional",
			}),
		);
		edited.querySelector("h1 span").textContent =
			"Fictional image cancellation";
		edited.dispatchEvent(
			new window.InputEvent("input", {
				bubbles: true,
				inputType: "insertText",
				data: "fictional",
			}),
		);
	});
	await act(async () => new Promise((resolve) => setTimeout(resolve, 550)));
	const leaf = edited.querySelector("h1 span").firstChild;
	const range = document.createRange();
	range.setStart(leaf, leaf.textContent.length);
	range.collapse(true);
	window.getSelection().removeAllRanges();
	window.getSelection().addRange(range);
	const beforeImage = edited.innerHTML;
	const undo = () =>
		document.querySelector(
			'[aria-label="ui.canvas.wysiwyg_markdown_editor.undo"]',
		);
	const redo = () =>
		document.querySelector(
			'[aria-label="ui.canvas.wysiwyg_markdown_editor.redo"]',
		);
	const beforeHistory = { undo: undo().disabled, redo: redo().disabled };
	window.document.execCommand = () => {
		throw new Error("Image Cancel must never issue an insertion command");
	};
	await act(async () =>
		find("ui.canvas.wysiwyg_markdown_editor.insert_image").click(),
	);
	assert.ok(document.querySelector("[role=dialog]"));
	assert.equal(
		edited.innerHTML,
		beforeImage,
		"opening Image does not change canonical DOM",
	);
	await act(async () => find("ui.canvas.insert_link_dialog.cancel").click());
	assert.equal(edited.innerHTML, beforeImage, "Cancel is an exact DOM no-op");
	assert.deepEqual(
		{ undo: undo().disabled, redo: redo().disabled },
		beforeHistory,
		"Cancel adds no history transaction",
	);
	assert.equal(
		save().disabled,
		false,
		"the pre-existing typing draft remains dirty",
	);
	await act(async () => undo().click());
	assert.equal(
		save().disabled,
		true,
		"one undo returns exactly to the saved baseline",
	);
	await act(async () => redo().click());
	assert.equal(save().disabled, false, "redo restores only the actual typing");
	await act(async () => find("ui.settings.model.system_prompt.source").click());
	assert.equal(
		document.querySelector("textarea").value,
		saved.replace("Third fictional update", "Fictional image cancellation"),
	);
	console.log(
		JSON.stringify({
			imageCancel: {
				domExact: true,
				historyUnchanged: true,
				undoBaselineExact: true,
				redoTypingOnly: true,
				placeholderRetained: false,
			},
		}),
	);
	await act(async () => root.unmount());
	dom.window.close();
	assert.equal(
		lost,
		false,
		"unapplied local source dialog draft must survive pristine host refetch",
	);
});
