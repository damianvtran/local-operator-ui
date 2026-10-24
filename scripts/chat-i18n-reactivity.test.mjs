/**
 * The chat surface under a NON-ENGLISH locale: protocol strings stay fixed,
 * model names stay neutral, and copy is read when it is rendered.
 *
 * WHY THIS FILE EXISTS (agent review round 3, BLOCKER + MAJOR reactivity). The
 * extraction lane initially routed things through `t()` that must never follow
 * a language: micromark's event/token names, the fixed security token
 * `rel="noopener noreferrer"`, React `key`/`id`/`data-*` values and the
 * audio engine's owner ids. It also froze copy into module constants and into
 * request-settled state. English-only tests cannot see any of that: with one
 * catalogue the translated and the fixed spellings are the same bytes. Every
 * case here therefore registers a FIXTURE `fr` catalogue that deliberately
 * replaces the old English spellings with `FIXTURE …` values, then asserts the
 * behaviour is unchanged — a counterfactual that fails on the pre-fix code.
 *
 * WHAT THIS FILE CANNOT SEE. No Electron, no window: the render half is
 * `react-dom/server` markup on the real `MarkdownRenderer`/`AgentReasoning`
 * bundles, so it proves the attribute/text bytes and not a rendered frame.
 *
 * ISOLATION. Nothing boots a session; the catalogues registered here are
 * cleared in each case's `finally` and the locale returns to `en`.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = resolve(import.meta.dirname, "..");
const CACHE = resolve(ROOT, "node_modules", ".cache", "chat-i18n-reactivity");
mkdirSync(CACHE, { recursive: true });

/* React stays out of the bundles so the mounted tree shares THIS instance. */
const EXTERNAL = /^(react|react-dom)(\/.*)?$/;
const ALIAS = {
	"@renderer": resolve(ROOT, "src/renderer/src"),
	"@shared": resolve(ROOT, "src/renderer/src/shared"),
	"@features": resolve(ROOT, "src/renderer/src/features"),
	"@assets": resolve(ROOT, "src/renderer/src/assets"),
};
const REACT_STAYS_OUT = {
	name: "react-stays-out",
	setup(builder) {
		builder.onResolve({ filter: /^[^./]/ }, (args) =>
			EXTERNAL.test(args.path) ? { path: args.path, external: true } : null,
		);
	},
};

async function bundleAndImport(name, contents, extraPlugins = []) {
	const result = await build({
		stdin: { contents, resolveDir: ROOT },
		bundle: true,
		format: "esm",
		platform: "node",
		jsx: "automatic",
		mainFields: ["module", "main"],
		conditions: ["import", "module", "default"],
		define: { "import.meta.env": "{}" },
		loader: { ".css": "empty", ".svg": "text", ".png": "dataurl" },
		plugins: [REACT_STAYS_OUT, ...extraPlugins],
		alias: ALIAS,
		write: false,
	});
	const file = resolve(CACHE, `${name}.mjs`);
	writeFileSync(file, result.outputFiles[0].text);
	return import(pathToFileURL(file).href);
}

/* React DOM feature-detects the document at import time. */
const bootstrap = new JSDOM('<!doctype html><div id="root"></div>', {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
globalThis.localStorage = bootstrap.window.localStorage;
globalThis.HTMLElement = bootstrap.window.HTMLElement;
globalThis.Element = bootstrap.window.Element;
globalThis.Node = bootstrap.window.Node;
globalThis.NodeFilter = bootstrap.window.NodeFilter;
globalThis.MutationObserver = bootstrap.window.MutationObserver;
globalThis.getComputedStyle = bootstrap.window.getComputedStyle;
/* The disclosure row consults both; a no-op observer is the jsdom floor the
 * other component suites use, not a claim that anything was seen on screen. */
globalThis.IntersectionObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.Text = bootstrap.window.Text;
globalThis.DocumentFragment = bootstrap.window.DocumentFragment;
globalThis.DOMRect = bootstrap.window.DOMRect;
globalThis.Event = bootstrap.window.Event;
globalThis.CustomEvent = bootstrap.window.CustomEvent;
globalThis.KeyboardEvent = bootstrap.window.KeyboardEvent;
globalThis.MouseEvent = bootstrap.window.MouseEvent;
globalThis.FocusEvent = bootstrap.window.FocusEvent;
globalThis.PointerEvent =
	bootstrap.window.PointerEvent ?? bootstrap.window.MouseEvent;
globalThis.HTMLInputElement = bootstrap.window.HTMLInputElement;
globalThis.HTMLButtonElement = bootstrap.window.HTMLButtonElement;
globalThis.HTMLAnchorElement = bootstrap.window.HTMLAnchorElement;
globalThis.requestAnimationFrame = bootstrap.window.requestAnimationFrame.bind(
	bootstrap.window,
);
globalThis.cancelAnimationFrame = bootstrap.window.cancelAnimationFrame.bind(
	bootstrap.window,
);
globalThis.getSelection = bootstrap.window.getSelection.bind(bootstrap.window);
/* Radix's presence/scroll-lock path asks for both; a stub, not a polyfill. */
globalThis.matchMedia = () => ({
	matches: false,
	addEventListener() {},
	removeEventListener() {},
	addListener() {},
	removeListener() {},
	dispatchEvent: () => false,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const { act } = React;

const chat = await bundleAndImport(
	"chat",
	`
		export { t, setLocale, registerCatalogue, clearRegisteredCatalogues } from "./src/i18n";
		export {
			archiveConfirmMessage,
			archiveConfirmUnnamed,
			archiveConfirmVerb,
		} from "./src/renderer/src/features/chat/archive-confirm";
		export {
			getFileName,
			fileNameForDisplay,
			documentNameForDisplay,
		} from "./src/renderer/src/features/chat/utils/get-file-name";
		export { artifactTabLabels } from "./src/renderer/src/features/chat/utils/artifact-identity";
		export { buildFileRows } from "./src/renderer/src/features/chat/components/canvas/file-rows";
		export {
			channelBasisLabel,
			channelBasisWords,
			childBasisDetail,
			childBasisLine,
		} from "./src/renderer/src/features/chat/session-status/session-cost";
		export { linkToolbarModel } from "./src/renderer/src/features/chat/utils/link-actions";
		export { contextTooltipLines } from "./src/renderer/src/features/chat/session-status/session-context";
		export { chatStatusDisplay } from "./src/renderer/src/features/chat/chat-status";
		export { fileIndexErrorMessage } from "./src/renderer/src/features/chat/canonical/use-session-files";
		export { MarkdownRenderer } from "./src/renderer/src/features/chat/components/markdown-renderer";
		export { ImageGenCard } from "./src/renderer/src/features/chat/canonical/image-gen-card";
		export { AgentReasoning } from "./src/renderer/src/features/chat/components/trace/agent-reasoning";
		export { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";
	`,
);

/*
 * THE HEADER'S OWN BUNDLE, with the two picker modules it reads replaced: this
 * case is about the panel's row copy, and the real pickers pull a query client
 * and a backend seam that have their own suites. Everything else in the tree -
 * the header, its menu, the model, the stores - is the shipped code.
 */
const HEADER_STUBS = [
	[
		/pickers\/destination-pickers$/,
		"export const useEntities = () => ({ data: globalThis.__headerEntities ?? { entities: [] }, error: null, isLoading: false });",
	],
	[
		/pickers\/use-picker-backend$/,
		"export const errorText = (error) => String(error);\nexport const useSessionCommand = () => ({ busy: false, run: async () => undefined, reset() {}, outcome: null, result: null });",
	],
	[
		/^@shared\/api\/local-operator\/profile-hooks$/,
		"export const useTeams = () => ({ data: [], error: null, isLoading: false, refetch: async () => undefined });\nexport const useProfiles = () => ({ data: [], error: null, isLoading: false, refetch: async () => undefined });\nexport const useTeamLabelFor = () => () => null;",
	],
];
const headerStubPlugin = {
	name: "header-stubs",
	setup(builder) {
		for (const [filter] of HEADER_STUBS) {
			builder.onResolve({ filter }, () => ({
				path: `stub:${String(filter)}`,
				namespace: "header-stub",
			}));
		}
		builder.onLoad({ filter: /.*/, namespace: "header-stub" }, (args) => {
			const entry = HEADER_STUBS.find(
				([filter]) => args.path === `stub:${String(filter)}`,
			);
			return entry === undefined
				? undefined
				: { contents: entry[1], loader: "js", resolveDir: ROOT };
		});
	},
};

const header = await bundleAndImport(
	"header",
	`
		export { ChatHeaderIdentity } from "./src/renderer/src/features/chat/components/chat-header-identity";
		export { setLocale, registerCatalogue, clearRegisteredCatalogues } from "./src/i18n";
		export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
	`,
	[headerStubPlugin],
);

const math = await bundleAndImport(
	"math",
	`
		export { default as remarkGuardedMath } from "./src/renderer/src/features/chat/components/markdown-math-guarded";
		export { setLocale, registerCatalogue, clearRegisteredCatalogues } from "./src/i18n";
	`,
);

const { unified } = await import("unified");
const { default: remarkParse } = await import("remark-parse");
const { default: remarkGfm } = await import("remark-gfm");

const h = React.createElement;

/**
 * The fixture catalogue: the spellings the pre-fix code would have read.
 *
 * Each value is invalid where the fixed value must survive — a token name, a
 * `rel` token, a React id — so a regression fails loudly instead of comparing
 * two strings nobody can tell apart.
 */
const FIXTURE_FR = {
	"ui.chat.markdown_math_guarded.mathtext": "FIXTURE-MATH-TEXT",
	"ui.chat.markdown_math_guarded.mathtextsequence": "FIXTURE-MATH-SEQUENCE",
	"ui.chat.markdown_math_guarded.mathtextdata": "FIXTURE-MATH-DATA",
	"ui.chat.markdown_math_guarded.lineending": "FIXTURE-LINE-ENDING",
	"ui.chat.markdown_renderer.noopener_noreferrer": "FIXTURE-REL",
	"ui.chat.archive_confirm.undo_explanation":
		"FIXTURE quitte vos listes, annulation {seconds, number} secondes.",
	"ui.chat.archive_confirm.this_conversation": "FIXTURE cette conversation",
	"ui.chat.archive_confirm.archive": "FIXTURE Archiver",
	"ui.chat.get_file_name.pasted_image": "FIXTURE image collee",
	"ui.chat.get_file_name.pasted_file": "FIXTURE fichier colle",
	"ui.chat.get_file_name.pasted_simpletype_file":
		"FIXTURE fichier {simpleType} colle",
	"ui.chat.session_status.session_cost.basis_billed": "FIXTURE facture",
	"ui.chat.session_status.session_cost.basis_included": "FIXTURE inclus",
	"ui.chat.session_status.session_cost.basis_estimated": "FIXTURE estime",
	"ui.chat.session_status.session_cost.subagents_amount":
		"FIXTURE Sous-agents {amount}",
	"ui.chat.link_actions.open": "FIXTURE Ouvrir",
	"ui.chat.link_actions.quote": "FIXTURE Citer",
	"ui.chat.session_status.session_context.context": "FIXTURE Contexte",
	"ui.chat.trace.agent_reasoning.reasoning": "FIXTURE Raisonnement",
	"ui.chat.canonical.use_session_files.remote_files_cannot_be_opened_on_this_device":
		"FIXTURE fichiers distants indisponibles",
	"ui.chat.canonical.image_gen_card.stop": "FIXTURE Arreter",
	"ui.chat.canonical.image_gen_card.retry": "FIXTURE Reessayer",
	"ui.chat.canonical.image_gen_card.restart": "FIXTURE Redemarrer",
};

function registerFixture(instance) {
	instance.registerCatalogue("fr", FIXTURE_FR);
	instance.setLocale("fr");
}

function restore(instance) {
	instance.clearRegisteredCatalogues();
	instance.setLocale("en");
}

const parse = (source) =>
	unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(math.remarkGuardedMath)
		.parse(source);

const nodesOf = (tree, type) => {
	const found = [];
	const walk = (node) => {
		if (node.type === type) found.push(node);
		for (const child of node.children ?? []) walk(child);
	};
	walk(tree);
	return found;
};

const withoutPositions = (node) => {
	const { position, ...rest } = node;
	if (Array.isArray(rest.children)) {
		rest.children = rest.children.map(withoutPositions);
	}
	return rest;
};

test("micromark math tokens are protocol literals, not catalogue copy", () => {
	const source = "cost $0.30/M fresh-in and $3.20/M cached, so $w^2$ holds";
	/*
	 * THE CONTROL: the same parse in English, kept for the counterfactual
	 * below. A token name read from a catalogue would make the FRENCH tree
	 * differ from this one (or break the span outright); the pre-fix code did
	 * exactly that.
	 */
	const english = withoutPositions(parse(source));
	registerFixture(math);
	let french;
	try {
		french = parse(source);
		const maths = nodesOf(french, "inlineMath");
		assert.deepEqual(
			maths.map((node) => node.value),
			["w^2"],
			"the one real span survives a non-English catalogue",
		);
		const serialised = JSON.stringify(withoutPositions(french));
		assert.match(
			serialised,
			/\$0\.30\/M/,
			"prices stay literal text under the fixture locale",
		);
		assert.equal(
			serialised.includes("FIXTURE-MATH-TEXT"),
			false,
			"no catalogue value reached the token tree",
		);
	} finally {
		restore(math);
	}
	assert.deepEqual(
		withoutPositions(french),
		english,
		"the parse tree is locale-independent",
	);
});

test("markdown anchors keep the fixed rel token under a non-English locale", () => {
	registerFixture(chat);
	try {
		const html = renderToStaticMarkup(
			h(chat.MarkdownRenderer, {
				content: "See [the docs](https://example.com/docs).",
			}),
		);
		assert.match(
			html,
			/rel="noopener noreferrer"/,
			"the security token is not translated, even where the old key is overridden",
		);
		assert.equal(html.includes("FIXTURE-REL"), false);
		assert.match(html, /href="https:\/\/example\.com\/docs"/);
	} finally {
		restore(chat);
	}
	const english = renderToStaticMarkup(
		h(chat.MarkdownRenderer, {
			content: "See [the docs](https://example.com/docs).",
		}),
	);
	assert.match(english, /rel="noopener noreferrer"/);
});

test("archive confirmation copy is read at call time, en to fr and back", () => {
	assert.equal(chat.archiveConfirmVerb(), "Archive");
	const englishBody = chat.archiveConfirmMessage();
	registerFixture(chat);
	try {
		assert.equal(chat.archiveConfirmVerb(), "FIXTURE Archiver");
		assert.equal(chat.archiveConfirmUnnamed(), "FIXTURE cette conversation");
		assert.match(
			chat.archiveConfirmMessage(),
			/^FIXTURE quitte vos listes, annulation 8 secondes\.$/,
			"the interpolated timer rides the fixture sentence",
		);
	} finally {
		restore(chat);
	}
	assert.equal(chat.archiveConfirmVerb(), "Archive");
	assert.equal(chat.archiveConfirmMessage(), englishBody);
});

test("pasted filenames: neutral in the model, localized at display", () => {
	const pasted = "data:image/png;base64,iVBORw0KGgo=";
	assert.equal(chat.getFileName(pasted), "Pasted image");
	assert.equal(chat.fileNameForDisplay(pasted), "Pasted image");
	assert.equal(
		chat.documentNameForDisplay({ path: pasted, title: "Pasted image" }),
		"Pasted image",
	);
	registerFixture(chat);
	try {
		assert.equal(
			chat.getFileName(pasted),
			"Pasted image",
			"the MODEL name is locale-neutral: it is written into CanvasDocument.title",
		);
		assert.equal(chat.fileNameForDisplay(pasted), "FIXTURE image collee");
		assert.equal(
			chat.documentNameForDisplay({ path: pasted, title: "Pasted image" }),
			"FIXTURE image collee",
			"an existing document whose stored title is English still displays in the active locale",
		);
		const labels = chat.artifactTabLabels([
			{ id: "doc-1", title: "Pasted image", path: pasted },
			{ id: "doc-2", title: "notes.md", path: "/tmp/notes.md" },
		]);
		assert.equal(labels.get("doc-1"), "FIXTURE image collee");
		assert.equal(
			labels.get("doc-2"),
			"notes.md",
			"a real filename is untouched",
		);
		const rows = chat.buildFileRows([
			{ id: pasted, path: pasted, title: "Pasted image", type: "image" },
		]);
		assert.equal(
			rows[0].name,
			"FIXTURE image collee",
			"the Files list derives a pasted document's display name at render time",
		);
	} finally {
		restore(chat);
	}
	assert.equal(chat.fileNameForDisplay(pasted), "Pasted image");
});

test("spend basis words and the child line follow the locale", () => {
	assert.equal(chat.channelBasisLabel("billed", null), "billed");
	const children = {
		childrenMicro: 2_500_000,
		childrenByBasis: [{ basis: "billed" }],
		childrenKnowledge: "exact",
	};
	assert.match(chat.childBasisLine(children), /^Subagents \$2\.50 · Billed/);
	assert.equal(
		chat.childBasisDetail(children),
		"$2.50 · Billed",
		"the by-agent column's half carries no label for a translated one to strip",
	);
	assert.deepEqual(chat.channelBasisWords(["billed", "estimated"]), [
		"Billed",
		"Estimated",
	]);
	registerFixture(chat);
	try {
		assert.equal(chat.channelBasisLabel("billed", null), "FIXTURE facture");
		assert.equal(
			chat.channelBasisLabel("subscription_api_equivalent", null),
			"FIXTURE inclus",
		);
		assert.match(
			chat.childBasisLine(children),
			/^FIXTURE Sous-agents \$2\.50 · FIXTURE facture/,
		);
		assert.equal(
			chat.childBasisDetail(children),
			"$2.50 · FIXTURE facture",
			"the detail half carries only the amount and its basis words",
		);
	} finally {
		restore(chat);
	}
	assert.equal(chat.channelBasisLabel("billed", null), "billed");
});

test("link toolbar verbs follow the locale", () => {
	const input = (target) => ({
		kind: "url",
		target,
		probe: null,
		quotable: false,
		canOpenInCanvas: false,
	});
	const english = chat.linkToolbarModel(input("https://example.com/x"));
	assert.deepEqual(
		english.actions.map((action) => action.label),
		["Copy link", "Open in browser", "Quote"],
	);
	registerFixture(chat);
	try {
		const french = chat.linkToolbarModel(input("https://example.com/x"));
		assert.deepEqual(
			french.actions.map((action) => action.label),
			["Copy link", "Open in browser", "FIXTURE Citer"],
			"the fixed copy is unchanged; the newly keyed quote verb follows the locale",
		);
	} finally {
		restore(chat);
	}
});

test("context heading, reasoning default and index errors read the locale", async () => {
	assert.equal(
		chat.contextTooltipLines({ status: "no-reading" })[0],
		"Context",
	);
	assert.equal(
		chat.fileIndexErrorMessage("remote-unavailable"),
		"Remote files cannot be opened on this device.",
	);
	const preference = chat.useUiPreferencesStore.getState().showAgentReasoning;
	chat.useUiPreferencesStore.setState({ showAgentReasoning: true });
	/*
	 * A jsdom MOUNT, not `renderToStaticMarkup`: the disclosure row defers its
	 * body through an observer, and the server renderer never reaches it. The
	 * label is what is under test, and it paints on the trigger.
	 */
	const host = document.getElementById("root");
	const root = createRoot(host);
	const reasoningText = async () => {
		await act(async () => {
			root.render(
				h(chat.AgentReasoning, { content: "weighing the two paths" }),
			);
		});
		return host.textContent;
	};
	try {
		assert.match(await reasoningText(), /Reasoning/);
		registerFixture(chat);
		try {
			assert.equal(
				chat.contextTooltipLines({ status: "no-reading" })[0],
				"FIXTURE Contexte",
			);
			assert.equal(
				chat.fileIndexErrorMessage("remote-unavailable"),
				"FIXTURE fichiers distants indisponibles",
			);
			const french = await reasoningText();
			assert.match(french, /FIXTURE Raisonnement/);
			assert.equal(french.includes("Reasoning"), false);
		} finally {
			restore(chat);
		}
		assert.match(await reasoningText(), /Reasoning/);
	} finally {
		chat.useUiPreferencesStore.setState({ showAgentReasoning: preference });
		await act(async () => {
			root.unmount();
		});
	}
});

test("image generation controls follow the locale", () => {
	const progress = { fraction: null, logs: [], queuePosition: null };
	const card = (view, actions) =>
		renderToStaticMarkup(h(chat.ImageGenCard, { view, scope: null, actions }));
	const running = card(
		{ state: "running", startedAtMs: 3000, progress, note: null },
		{ onCancel: () => {} },
	);
	assert.equal(running.includes(">Stop<"), true);
	const failed = card(
		{ state: "failed", startedAtMs: 3000, progress, note: null },
		{ onRestart: () => {} },
	);
	assert.equal(failed.includes(">Retry<"), true);
	const cancelled = card(
		{ state: "cancelled", startedAtMs: 3000, progress, note: null },
		{ onRestart: () => {} },
	);
	assert.equal(cancelled.includes(">Restart<"), true);
	registerFixture(chat);
	try {
		assert.equal(
			card(
				{ state: "running", startedAtMs: 3000, progress, note: null },
				{ onCancel: () => {} },
			).includes("FIXTURE Arreter"),
			true,
		);
		assert.equal(
			card(
				{ state: "failed", startedAtMs: 3000, progress, note: null },
				{ onRestart: () => {} },
			).includes("FIXTURE Reessayer"),
			true,
		);
		assert.equal(
			card(
				{ state: "cancelled", startedAtMs: 3000, progress, note: null },
				{ onRestart: () => {} },
			).includes("FIXTURE Redemarrer"),
			true,
		);
	} finally {
		restore(chat);
	}
});

test("a retry row carries no authored label; the strip resolves the key", () => {
	const display = chat.chatStatusDisplay({
		connectivityIssue: "server_offline",
		server: null,
		internetOffline: false,
	});
	assert.equal(display.action, "retry");
	assert.equal(
		display.actionLabel,
		null,
		"the model stores no English word for the control",
	);
	assert.equal(chat.t("ui.common.actions.retry"), "Retry");
	registerFixture(chat);
	try {
		chat.registerCatalogue("fr", {
			...FIXTURE_FR,
			"ui.common.actions.retry": "FIXTURE Reessayer",
		});
		assert.equal(chat.t("ui.common.actions.retry"), "FIXTURE Reessayer");
	} finally {
		restore(chat);
	}
});

test("a header roster row re-labels in place on a locale change", async () => {
	/*
	 * THE REAL HEADER, with the roster answered by the stub above. The row's
	 * description is built inside the `options` memo with `t()`; the locale
	 * value is what rebuilds that memo. The POPOVER NODE is captured before the
	 * switch and compared after it, so a repaint by remount cannot pass this.
	 */
	globalThis.__headerEntities = {
		entities: [
			{
				value: "platform-team",
				name: "Our Platform",
				label: "Platform",
				description: "Handles the platform",
				kind: "team",
				delegate: true,
			},
		],
	};
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const client = new header.QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const chip = () =>
		[...document.querySelectorAll("button")].find((button) =>
			(button.getAttribute("aria-label") ?? "").startsWith("Team:"),
		);
	const panel = () =>
		document.querySelector("[data-radix-popper-content-wrapper]");
	const panelText = () => panel()?.textContent ?? "";
	try {
		await act(async () => {
			root.render(
				h(
					header.QueryClientProvider,
					{ client },
					h(header.ChatHeaderIdentity, {
						sessionId: "session-fixture",
						activeTeam: "platform-team",
					}),
				),
			);
		});
		const trigger = chip();
		assert.ok(chip(), "the team chip is the control this fixture binds");
		await act(async () => {
			trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 50));
		});
		const openedPanel = panel();
		assert.ok(panel(), "the roster panel opened on the chip's press");
		assert.match(
			panelText(),
			/platform-team · Handles the platform/,
			"the row's description is the keyed value · description line",
		);
		header.registerCatalogue("fr", {
			"ui.chat.header.chat_header_identity.value_description":
				"FIXTURE {value} / {description}",
		});
		await act(async () => header.setLocale("fr"));
		assert.equal(
			panel(),
			openedPanel,
			"the panel node survives the switch: the label repaints, the panel does not remount",
		);
		assert.match(panelText(), /FIXTURE platform-team \/ Handles the platform/);
		await act(async () => header.setLocale("en"));
		assert.match(panelText(), /platform-team · Handles the platform/);
	} finally {
		header.clearRegisteredCatalogues();
		await act(async () => header.setLocale("en"));
		await act(async () => {
			root.unmount();
		});
		client.clear();
		container.remove();
		globalThis.__headerEntities = undefined;
	}
});
