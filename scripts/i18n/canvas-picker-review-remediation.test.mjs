import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import {
	backendUsagePath,
	parseMuseNotes,
	readManifest,
} from "./muse-usage-manifest.mjs";

// Locale is process-wide: these cases must never reset it under one another.
const testSerial = (name, fn) => test(name, { concurrency: false }, fn);

/*
 * Round-2 source-review reproductions. These mount the real leaf components,
 * not their backend-heavy parent panes, and use a synthetic registered French
 * catalogue so locale-switch evidence never requires target-locale edits.
 */
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const FORCE = [
	"Event",
	"CustomEvent",
	"UIEvent",
	"MouseEvent",
	"PointerEvent",
	"KeyboardEvent",
	"FocusEvent",
	"InputEvent",
	"HTMLElement",
	"HTMLInputElement",
	"HTMLTextAreaElement",
	"Element",
	"Node",
	"DocumentFragment",
	"Range",
	"Selection",
	"DOMRect",
	"MutationObserver",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"localStorage",
];
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (["window", "self", "globalThis"].includes(key)) continue;
	if (key in globalThis && !FORCE.includes(key)) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// Some jsdom accessors cannot leave their realm and are not needed here.
	}
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {
	value: dom.window.navigator,
	configurable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CSS = { escape: (value) => String(value) };
globalThis.matchMedia = (query) => ({
	matches: false,
	media: String(query),
	onchange: null,
	addEventListener: () => {},
	removeEventListener: () => {},
	addListener: () => {},
	removeListener: () => {},
	dispatchEvent: () => false,
});
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
dom.window.Element.prototype.scrollIntoView = () => {};
dom.window.Element.prototype.scrollTo = () => {};
const openedPaths = [];
dom.window.api = {
	openFile: (path) => {
		openedPaths.push(path);
		return Promise.resolve();
	},
};

const built = await build({
	stdin: {
		contents: [
			'export * as React from "react";',
			'export { act } from "react";',
			'export { createRoot } from "react-dom/client";',
			'export * as messages from "./src/i18n/messages";',
			'export * as locale from "./src/i18n/locale";',
			'export { EditorState } from "@codemirror/state";',
			'export { ViewSwitcher } from "./src/renderer/src/features/chat/components/canvas/index";',
			'export { OpenInOsButton } from "./src/renderer/src/features/chat/components/canvas/file-viewer-state";',
			'export { CreateFileDialog } from "./src/renderer/src/features/chat/components/canvas/create-file-dialog";',
			'export { VariableFormDialog } from "./src/renderer/src/features/chat/components/canvas/variable-form-dialog";',
			'export { buildDiffContainer } from "./src/renderer/src/features/chat/components/canvas/wysiwyg-markdown-editor";',
			'export { diffHighlight } from "./src/renderer/src/features/chat/components/canvas/code-editor-diff";',
			'export { DEFAULT_FINDER, finderSections, sanitizeFinderPreferences } from "./src/renderer/src/features/chat/components/canvas/finder-layout";',
			'export { PickerRow } from "./src/renderer/src/features/chat/pickers/picker-host";',
			'export { ThemePicker, FORK_CUT_NOTE, modelPickerOptions } from "./src/renderer/src/features/chat/pickers/destination-pickers";',
			'export { OwnerRowsTable } from "./src/renderer/src/features/chat/pickers/panels/context-panel";',
			'export { CACHE_HIT_MEANING } from "./src/renderer/src/features/chat/pickers/panels/analytics-model";',
			'export { MCP_NOT_READ_NOTE } from "./src/renderer/src/features/chat/pickers/panels/info-model";',
			'export { ProviderBlockView } from "./src/renderer/src/features/chat/pickers/usage-view";',
			'export { currentUsageReport, hasMuseAllowanceNote, accountNote } from "./src/renderer/src/features/chat/pickers/usage-view-model";',
			'export { isBreakdownUnavailable } from "./src/renderer/src/features/chat/pickers/panels/context-model";',
			'export { META_MUSE_ALLOWANCE_NOTE, META_MUSE_PASSIVE_NOTE, META_MUSE_STALE_NOTE, META_MUSE_NO_OBSERVATION_NOTE } from "./src/renderer/src/features/chat/pickers/muse-usage-notes";',
			'export { CategoriesInputChips } from "./src/renderer/src/shared/components/common/categories-input-chips";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	define: { "import.meta.env": "{}" },
	format: "esm",
	platform: "browser",
	loader: { ".css": "empty" },
	jsx: "automatic",
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	write: false,
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);
const {
	React,
	act,
	createRoot,
	messages,
	locale,
	EditorState,
	ViewSwitcher,
	OpenInOsButton,
	CreateFileDialog,
	VariableFormDialog,
	buildDiffContainer,
	diffHighlight,
	DEFAULT_FINDER,
	finderSections,
	sanitizeFinderPreferences,
	PickerRow,
	ThemePicker,
	FORK_CUT_NOTE,
	modelPickerOptions,
	OwnerRowsTable,
	CACHE_HIT_MEANING,
	MCP_NOT_READ_NOTE,
	ProviderBlockView,
	currentUsageReport,
	hasMuseAllowanceNote,
	accountNote,
	isBreakdownUnavailable,
	META_MUSE_ALLOWANCE_NOTE,
	META_MUSE_PASSIVE_NOTE,
	META_MUSE_STALE_NOTE,
	META_MUSE_NO_OBSERVATION_NOTE,
	CategoriesInputChips,
} = mod;
const MUSE_MIRROR = {
	META_MUSE_ALLOWANCE_NOTE,
	META_MUSE_PASSIVE_NOTE,
	META_MUSE_STALE_NOTE,
	META_MUSE_NO_OBSERVATION_NOTE,
};

const FRENCH = {
	"ui.canvas": {
		"ui.canvas.create_file_dialog.markdown_md": "Markdown FR",
		"ui.canvas.variable_form_dialog.value_json_object": "Objet JSON FR",
		"ui.canvas.finder_layout.working_files": "Fichiers FR",
		"ui.canvas.wysiwyg_markdown_editor.remove": "- Retirer FR",
		"ui.canvas.wysiwyg_markdown_editor.add": "+ Ajouter FR",
		"ui.canvas.code_editor_diff.proposed_change": "Changement FR",
		"ui.canvas.code_editor_diff.remove": "- Retirer FR :",
		"ui.canvas.code_editor_diff.add": "+ Ajouter FR :",
	},
	"ui.chat.pickers": {
		"ui.chat.pickers.destination_pickers.ports": "Ports FR",
		"ui.chat.pickers.destination_pickers.needs_sign_in":
			" · connexion requise FR",
		"ui.chat.pickers.destination_pickers.needs_sign_in660cb8":
			"Connexion requise FR",
		"ui.chat.pickers.destination_pickers.if_that_message_was_sent_just_now_it_may_not_be_in_the_conversation_s_hi":
			"Note de fork FR",
		"ui.chat.pickers.analytics_model.cache_reads_as_a_share_of_read_context_tokens_means_no_call_reported_a_c":
			"Lecture du cache FR",
		"ui.chat.pickers.info_model.not_read_in_this_view": "MCP non lu FR",
	},
	"ui.common.forms": {
		"ui.common.forms.categories_input_chips.category":
			"{category, select, role_play {Jeu de rôle FR} other_category {Autre FR} other {{category}}}",
		"ui.common.forms.categories_input_chips.remove_category":
			"Retirer la catégorie {value} FR",
	},
};
messages.registerCatalogue("fr", Object.assign({}, ...Object.values(FRENCH)));
locale.setLocale("en");

const roots = new Set();
async function mount(element) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.add(root);
	await act(async () => root.render(element));
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	return {
		container,
		async setLocale(next) {
			await act(async () => locale.setLocale(next));
		},
		async unmount() {
			await act(async () => root.unmount());
			roots.delete(root);
			container.remove();
		},
	};
}
async function switchLocale(next) {
	await act(async () => locale.setLocale(next));
}
const noIcon = () => null;
const viewProps = (onChange) => ({
	current: "files",
	onChange,
	views: [
		{ value: "files", label: "Files", tourTag: "files", Icon: noIcon },
		{ value: "goals", label: "Goals", tourTag: "goals", Icon: noIcon },
	],
	fileCount: 0,
	goalCount: 1,
	goalTruncated: false,
});
const hookErrors = [];
const originalError = console.error;
console.error = (...args) => {
	hookErrors.push(args.map(String).join(" "));
	originalError(...args);
};

after(async () => {
	for (const root of roots) await act(async () => root.unmount());
	messages.clearRegisteredCatalogues();
	locale.applyCapabilities(null);
	for (const handle of process._getActiveHandles?.() ?? []) {
		try {
			if (handle?.constructor?.name === "MessagePort") handle.close();
		} catch {
			// A handle that cannot close is not this suite's to force.
		}
	}
	console.error = originalError;
	dom.window.close();
});

function assertNoInvalidHook() {
	assert.deepEqual(
		hookErrors.filter((line) =>
			/invalid hook call|rendered more hooks|hook order|hooks can only be called/i.test(
				line,
			),
		),
		[],
		"render and event callbacks must not call useI18nLocale",
	);
	hookErrors.length = 0;
}

testSerial(
	"ViewSwitcher click uses a top-level subscription, not an event hook",
	async () => {
		const changes = [];
		const view = await mount(
			React.createElement(
				ViewSwitcher,
				viewProps((value) => changes.push(value)),
			),
		);
		try {
			const button = view.container.querySelector('[data-tour-tag="goals"]');
			assert.ok(button);
			await act(async () => {
				button.dispatchEvent(
					new dom.window.MouseEvent("click", { bubbles: true }),
				);
			});
			assert.deepEqual(changes, ["goals"]);
			assertNoInvalidHook();
		} finally {
			await view.unmount();
		}
	},
);

testSerial("PickerRow hover calls onHover without an event hook", async () => {
	const hovered = [];
	const view = await mount(
		React.createElement(PickerRow, {
			option: { value: "one", label: "One" },
			index: 2,
			active: false,
			picked: false,
			onPick: () => {},
			onHover: (index) => hovered.push(index),
		}),
	);
	try {
		const row = view.container.querySelector('[role="option"]');
		assert.ok(row);
		await act(async () => {
			row.dispatchEvent(
				new dom.window.MouseEvent("mouseover", { bubbles: true }),
			);
		});
		assert.deepEqual(hovered, [2]);
		assertNoInvalidHook();
	} finally {
		await view.unmount();
	}
});

testSerial(
	"OpenInOsButton click opens the path without an event hook",
	async () => {
		const view = await mount(
			React.createElement(OpenInOsButton, { path: "/tmp/example.txt" }),
		);
		try {
			const button = view.container.querySelector("button");
			await act(async () => {
				button.dispatchEvent(
					new dom.window.MouseEvent("click", { bubbles: true }),
				);
			});
			assert.deepEqual(openedPaths, ["/tmp/example.txt"]);
			assertNoInvalidHook();
		} finally {
			await view.unmount();
		}
	},
);

testSerial(
	"OwnerRowsTable and ProviderBlockView map rows without render hooks",
	async () => {
		const owners = await mount(
			React.createElement(OwnerRowsTable, {
				rows: [
					["System", "10"],
					["History", "20"],
				],
			}),
		);
		const block = {
			report: { provider: "anthropic", state: "ok", notes: "" },
			binding: null,
			note: "",
			rows: [
				{
					limit: { id: "daily", label: "Daily" },
					status: "ok",
					fraction: null,
					amount: "not reported",
					eligibilityNote: "",
					countdown: "",
					subordinate: false,
				},
			],
			degraded: false,
			emptyNote: "",
		};
		const usage = await mount(
			React.createElement(ProviderBlockView, { block }),
		);
		try {
			assert.match(owners.container.textContent, /System/);
			assert.match(owners.container.textContent, /History/);
			assert.match(usage.container.textContent, /Daily/);
			assertNoInvalidHook();
		} finally {
			await owners.unmount();
			await usage.unmount();
		}
	},
);

testSerial(
	"Working files keeps its stable id through toggles and locale changes",
	() => {
		const items = [
			{ highlighted: true, row: { kind: "images" } },
			{ highlighted: false, row: { kind: "images" } },
		];
		const collapsed = finderSections(items, DEFAULT_FINDER, false, new Set());
		const working = collapsed.find((section) => section.id === "Working files");
		assert.equal(working.open, false);
		assert.equal(working.label, "Working files");
		const opened = finderSections(
			items,
			{ ...DEFAULT_FINDER, workingOpen: true },
			false,
			new Set(),
		);
		assert.equal(
			opened.find((section) => section.id === "Working files").open,
			true,
		);
		assert.ok(opened.some((section) => section.id === "Images"));
		const preferences = sanitizeFinderPreferences({
			workingOpen: true,
			closedSections: ["Images"],
		});
		assert.equal(preferences.workingOpen, true);
		assert.deepEqual(preferences.closedSections, ["Images"]);
		locale.setLocale("fr");
		const translated = finderSections(items, DEFAULT_FINDER, false, new Set());
		assert.equal(
			translated.find((section) => section.id === "Working files").label,
			"Fichiers FR",
		);
		locale.setLocale("en");
	},
);

testSerial(
	"create-file and variable-form memoized labels repaint on locale switch",
	async () => {
		const create = await mount(
			React.createElement(CreateFileDialog, {
				open: true,
				onClose: () => {},
				onSave: () => {},
				isSaving: false,
				currentWorkingDirectory: "/tmp",
			}),
		);
		try {
			const fileType = document.querySelector('input[role="combobox"]');
			assert.equal(fileType.value, "Markdown (.md)");
			await create.setLocale("fr");
			assert.equal(
				messages.t("ui.canvas.create_file_dialog.markdown_md"),
				"Markdown FR",
			);
			assert.equal(fileType.value, "Markdown FR");
		} finally {
			await create.unmount();
			await switchLocale("en");
		}
		const variable = await mount(
			React.createElement(VariableFormDialog, {
				open: true,
				onClose: () => {},
				onSubmit: () => {},
				initialData: { key: "mapping", type: "dict", value: {} },
			}),
		);
		try {
			await variable.setLocale("fr");
			assert.match(document.body.textContent, /Objet JSON FR/);
		} finally {
			await variable.unmount();
			await switchLocale("en");
		}
	},
);

testSerial(
	"category display, search and aria labels localize while raw ids survive",
	async () => {
		const changes = [];
		const view = await mount(
			React.createElement(CategoriesInputChips, {
				value: ["role_play"],
				onChange: (value) => changes.push(value),
			}),
		);
		try {
			assert.match(view.container.textContent, /Role Play/);
			assert.equal(
				view.container.querySelector("button").getAttribute("aria-label"),
				"Remove category Role Play",
			);
			await view.setLocale("fr");
			assert.equal(
				messages.t("ui.common.forms.categories_input_chips.category", {
					category: "role_play",
				}),
				"Jeu de rôle FR",
			);
			assert.match(view.container.textContent, /Jeu de rôle FR/);
			const remove = view.container.querySelector(
				'button[aria-label*="Jeu de rôle FR"]',
			);
			assert.ok(
				remove,
				"remove-button accessible name uses the localized label",
			);
			assert.equal(
				remove.getAttribute("aria-label"),
				"Retirer la catégorie Jeu de rôle FR FR",
			);
			const input = view.container.querySelector("input");
			await act(async () => input.focus());
			const setValue = Object.getOwnPropertyDescriptor(
				dom.window.HTMLInputElement.prototype,
				"value",
			).set;
			setValue.call(input, "jeu");
			await act(async () => {
				input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
			});
			assert.match(view.container.textContent, /Jeu de rôle FR/);
			await act(async () => {
				remove.dispatchEvent(
					new dom.window.MouseEvent("click", { bubbles: true }),
				);
			});
			assert.deepEqual(
				changes.at(-1),
				[],
				"the callback emits raw category ids",
			);
		} finally {
			await view.unmount();
			await switchLocale("en");
		}

		for (const [id, english, french] of [
			["other", "Other", "Autre FR"],
			["unknown_future_id", "unknown_future_id", "unknown_future_id"],
		]) {
			const category = await mount(
				React.createElement(CategoriesInputChips, {
					value: [id],
					onChange: () => {},
				}),
			);
			try {
				assert.match(category.container.textContent, new RegExp(english));
				assert.equal(
					category.container.querySelector("button").getAttribute("aria-label"),
					`Remove category ${english}`,
				);
				await category.setLocale("fr");
				assert.match(category.container.textContent, new RegExp(french));
				assert.equal(
					category.container.querySelector("button").getAttribute("aria-label"),
					`Retirer la catégorie ${french} FR`,
				);
			} finally {
				await category.unmount();
				await switchLocale("en");
			}
		}
	},
);

testSerial(
	"model options re-read localized auth copy while ids stay raw",
	() => {
		const row = {
			selector: "anthropic/claude",
			model_id: "claude",
			label: "Claude",
			provider: "anthropic",
			connected: false,
		};
		locale.setLocale("en");
		assert.equal(
			modelPickerOptions([row], { credentialsKnown: true })[0].group,
			"Needs sign-in",
		);
		locale.setLocale("fr");
		const option = modelPickerOptions([row], { credentialsKnown: true })[0];
		assert.equal(option.value, "anthropic/claude");
		assert.equal(option.label, "Claude");
		assert.equal(option.group, "Connexion requise FR");
		assert.match(option.description, /connexion requise FR/);
		locale.setLocale("en");
	},
);

testSerial(
	"theme groups, lazy notes and imperative diff widgets follow locale",
	async () => {
		const theme = await mount(
			React.createElement(ThemePicker, {
				onClose: () => {},
				action: { args: "", data: {} },
			}),
		);
		try {
			assert.match(document.body.textContent, /Local Operator/);
			assert.match(document.body.textContent, /Ports/);
			await theme.setLocale("fr");
			assert.equal(
				messages.t("ui.chat.pickers.destination_pickers.ports"),
				"Ports FR",
			);
			assert.match(document.body.textContent, /Ports FR/);
			assert.match(document.body.textContent, /Local Operator/);
			assert.equal(FORK_CUT_NOTE(), "Note de fork FR");
			assert.equal(CACHE_HIT_MEANING(), "Lecture du cache FR");
			assert.equal(MCP_NOT_READ_NOTE(), "MCP non lu FR");
			const wysiwyg = buildDiffContainer({ find: "old", replace: "new" });
			assert.match(wysiwyg.textContent, /- Retirer FR/);
			assert.match(wysiwyg.textContent, /\+ Ajouter FR/);
			const plugin = diffHighlight({
				diffs: [{ find: "old", replace: "new" }],
				currentIndex: 0,
				approvedDiffs: [],
				originalContent: "old",
			});
			const instance = plugin.create({
				state: EditorState.create({ doc: "old" }),
			});
			const widget = instance.decorations.iter().value.spec.widget;
			const rendered = widget.toDOM();
			assert.match(rendered.textContent, /Changement FR/);
			assert.match(rendered.textContent, /- Retirer FR :/);
			assert.match(rendered.textContent, /\+ Ajouter FR :/);
		} finally {
			await theme.unmount();
			await switchLocale("en");
		}
	},
);

testSerial(
	"security and machine tokens stay literal, and editor rebuilds depend on locale",
	() => {
		const updateSource = readFileSync(
			join(
				process.cwd(),
				"src/renderer/src/shared/components/common/update-notification.tsx",
			),
			"utf8",
		);
		assert.equal(
			(updateSource.match(/rel="noopener noreferrer"/g) ?? []).length,
			3,
		);
		assert.doesNotMatch(updateSource, /rel=\{t\(/);
		for (const [file, marker] of [
			[
				"src/renderer/src/features/chat/components/canvas/inline-edit.tsx",
				'const acceptAllTooltipText =\n\t\tplatform === "darwin"',
			],
			[
				"src/renderer/src/features/chat/components/canvas/finder-files-view.tsx",
				"[narrowed, prefs, narrowing, closed, locale]",
			],
			[
				"src/renderer/src/features/chat/pickers/destination-pickers.tsx",
				"[catalogueDocument, scoped, shownSelector, locale]",
			],
			[
				"src/renderer/src/features/chat/components/canvas/code-editor.tsx",
				"[reviewState, locale]",
			],
			[
				"src/renderer/src/features/chat/components/canvas/wysiwyg-markdown-editor.tsx",
				"[locale]",
			],
		]) {
			assert.ok(
				readFileSync(join(process.cwd(), file), "utf8").includes(marker),
				`${file} must rebuild its imperative labels on locale change`,
			);
		}
	},
);

/*
 * Round-1 review B1. `report.notes` is the BACKEND's fixed provenance
 * vocabulary (`local_operator/providers/usage.py` META_MUSE_*), so the aging
 * rule must compare those English constants, never catalogue copy. Before the
 * fix the comparison set was built from `t()`: an `en` UI aged a 1h-old passive
 * note to unavailable, while `ru`/`es` left it available and lost the passive
 * provenance sentence. The assertion is the invariant, not one language's text:
 * every locale resolves the same payload to the same state and the same server
 * vocabulary, and only the rendered sentence changes.
 */
const META_MUSE_PASSIVE =
	"Last response allowance; refresh does not query Muse.";
const META_MUSE_STALE =
	"Stale response allowance; current usage unknown; refresh does not query Muse.";
const realPickersCatalogue = (locale) =>
	JSON.parse(
		readFileSync(
			join(process.cwd(), `src/i18n/catalogues/${locale}/ui.chat.pickers.json`),
			"utf8",
		),
	);

testSerial(
	"Muse provenance ages identically in every UI language",
	async () => {
		const now = 1_760_000_000_000;
		const report = {
			provider: "meta-muse",
			fetched_at: now - 60 * 60 * 1000,
			limits: [
				{
					id: "meta-muse:window",
					label: "5 hour",
					amount: {
						used: 1,
						limit: 100,
						remaining: 99,
						used_fraction: 0.01,
						unit: "percent",
					},
					window: "five_hour",
					status: null,
					resets_at: null,
					resets_at_ms: null,
					tier: "",
					shared: false,
				},
			],
			notes: META_MUSE_PASSIVE,
			identity: null,
			consecutive_failures: 0,
			usage_unavailable: false,
			next_probe_at_ms: null,
			credential_invalid: false,
			age_ms: 60 * 60 * 1000,
			state: "available",
		};
		const resolved = {};
		for (const language of ["en", "ru", "es"]) {
			messages.clearRegisteredCatalogues();
			if (language !== "en")
				messages.registerCatalogue(language, realPickersCatalogue(language));
			await locale.setLocale(language);
			assert.equal(
				hasMuseAllowanceNote(report),
				true,
				`${language}: the server's passive note must be recognised`,
			);
			const aged = currentUsageReport(report, now);
			assert.equal(
				aged.state,
				"unavailable",
				`${language}: a 1h-old passive note must age out`,
			);
			assert.equal(
				aged.notes,
				META_MUSE_STALE,
				`${language}: the aged report must keep server vocabulary`,
			);
			resolved[language] = { state: aged.state, notes: aged.notes };
			const note = accountNote(report, now, now);
			assert.ok(
				!note.includes(META_MUSE_PASSIVE),
				`${language}: rendered copy must not fall back to server English`,
			);
			assert.ok(
				note.includes(
					realPickersCatalogue(language)[
						"ui.chat.pickers.usage_view_model.stale_response_allowance_current_usage_unknown_refresh_does_not_query_mu"
					],
				),
				`${language}: the stale sentence must be the translated catalogue entry`,
			);
		}
		assert.deepEqual(resolved.ru, resolved.en);
		assert.deepEqual(resolved.es, resolved.en);
		await locale.setLocale("en");
	},
);

/*
 * The same class, second site: the context panel recognises the backend's
 * "no breakdown" answer by its fixed English sentence. The matcher used `t()`,
 * so under `ru`/`es` the server's own answer no longer matched and the panel
 * drew a breakdown body for a notice. The English wire sentence must match in
 * every locale; a translated sentence cannot, because the wire never sends one.
 */
testSerial(
	"the no-breakdown notice is matched on the server's sentence, not the catalogue",
	async () => {
		const notice = { kind: "notice", text: "context breakdown unavailable." };
		for (const language of ["en", "ru", "es"]) {
			messages.clearRegisteredCatalogues();
			if (language !== "en")
				messages.registerCatalogue(language, realPickersCatalogue(language));
			await locale.setLocale(language);
			assert.equal(
				isBreakdownUnavailable(notice),
				true,
				`${language}: the backend's English notice must still match`,
			);
			const translated =
				realPickersCatalogue(language)[
					"ui.chat.pickers.context_model.context_breakdown_unavailable"
				];
			assert.equal(
				isBreakdownUnavailable({ kind: "notice", text: translated }),
				false,
				`${language}: catalogue copy is not the wire vocabulary`,
			);
		}
		await locale.setLocale("en");
	},
);

/*
 * M5: the Muse mirror is a CROSS-REPO contract, so the pin is not a second copy
 * of the four sentences. The committed manifest is generated from
 * `local_operator/providers/usage.py` (`muse-usage-manifest.mjs --write`); the
 * portable assertion below compares the TypeScript mirror to it in CI. On a
 * machine with the backend checkout beside this repo, the same test parses the
 * Python source too, so a backend rename fails before the app silently stops
 * recognising its own payloads.
 */
test("the Muse mirror is the backend's generated vocabulary", () => {
	const manifest = readManifest();
	assert.deepEqual(
		Object.keys(MUSE_MIRROR).sort(),
		Object.keys(manifest.constants).sort(),
	);
	for (const [name, value] of Object.entries(manifest.constants)) {
		assert.equal(
			MUSE_MIRROR[name],
			value,
			`${name} must match the generated manifest`,
		);
	}
	const backend = backendUsagePath();
	if (!backend) return;
	assert.deepEqual(
		parseMuseNotes(readFileSync(backend, "utf8")),
		manifest.constants,
		"usage.py changed without regenerating scripts/i18n/fixtures/muse-usage-notes.json",
	);
});
