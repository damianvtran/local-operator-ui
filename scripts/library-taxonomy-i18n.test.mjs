/**
 * The Library's kind and tag-category words are catalogue copy (census B5/B6).
 *
 * `asset.kind` and a tag's `category` are wire tokens ("pptx", "topic") the
 * Library used to paint verbatim in five places. They now reach the screen
 * through `libraryKindLabel` / `tagCategoryLabel` at RENDER time, while the raw
 * values keep doing the work of sorting, grouping, glyphs and React keys.
 *
 * WHAT THIS MOUNTS: the real grid card, list row, preview header badge,
 * filter-rail tag-group header and the unsupported-file viewer (docx / other /
 * an unknown future kind), in en, fr and ur, with the locale switched on the
 * MOUNTED tree and no new props. Expected words are read from the shipped
 * catalogues, never restated. A mutation control reverts one call site to the raw
 * value in a scratch copy of the source and must fail the same assertion.
 *
 * WHAT IT DOES NOT PROVE: pixels, truncation or RTL layout of a badge (the
 * Library stories and independent browser QA own those); the desktop bridge is a
 * stub that answers every request with a refusal, which the views tolerate.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// jsdom accessors that cannot be redefined; the DOM globals above suffice.
	}
}
for (const name of ["Event", "CustomEvent", "MouseEvent", "KeyboardEvent"]) {
	globalThis[name] = dom.window[name];
}
dom.window.Element.prototype.scrollIntoView = () => {};
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class Silent {
	observe() {}
	unobserve() {}
	disconnect() {}
}
globalThis.ResizeObserver = Silent;
dom.window.ResizeObserver = Silent;
globalThis.IntersectionObserver = Silent;
dom.window.IntersectionObserver = Silent;
dom.window.HTMLCanvasElement.prototype.getContext = () => null;
URL.createObjectURL = () => "blob:library-taxonomy-test";
URL.revokeObjectURL = () => {};
// Every bridge call is a refusal: the views under test paint chrome, not bytes.
const refuse = async () => ({ status: 404, kind: "error", detail: "stub" });
// The preview mounts the shared composer and trajectory: inert transport shims
// satisfy their imports without delivering a frame (as library-page.cases does).
globalThis.EventSource = class {
	readyState = 0;
	addEventListener() {}
	removeEventListener() {}
	close() {}
};
dom.window.electron = {
	ipcRenderer: {
		on: () => () => {},
		once() {},
		send() {},
		invoke: async () => null,
		removeListener() {},
		removeAllListeners() {},
	},
};
globalThis.window.api = {
	desktop: { media: refuse, request: refuse },
	openFile: () => {},
};

const MARKDOWN_TOKEN = /markdown/;
// The runtime wraps message arguments in bidi isolates (U+2066-2069) in RTL locales.
const BIDI_ISOLATES = /[\u2066-\u2069]/g;
/*
 * The shared composer pulls the theme module into this graph and its only MUI
 * value is `createTheme`; left external, Node refuses the package's directory
 * import. Same passthrough stub library-page.cases.mjs uses.
 */
const MUI_STUB = new URL(
	`./_library-taxonomy-mui-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(
	MUI_STUB,
	`export const createTheme = (options) => options;
export const ThemeProvider = ({ children }) => children;
export const useTheme = () => ({});
export const alpha = (colour) => colour;`,
);
const FEATURE = "./src/renderer/src/features/library";
const ENTRY = `
export { LibraryCard, LibraryRow } from "${FEATURE}/components/library-card";
export { LibraryFilterRail } from "${FEATURE}/components/library-filter-rail";
export { LibraryPreview } from "${FEATURE}/components/library-preview";
export { LibraryViewer } from "${FEATURE}/components/library-viewers";
export { setLocale } from "./src/i18n/locale";
export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
`;
const CARD_PATH = /library-card\.tsx$/;
const CARD_FILE = `${process.cwd()}/src/renderer/src/features/library/components/library-card.tsx`;

/** Bundle the real views; `rewriteCard` swaps in a scratch copy of the card source. */
async function load(rewriteCard) {
	const result = await build({
		stdin: {
			contents: ENTRY,
			resolveDir: process.cwd(),
			sourcefile: "taxonomy.mjs",
		},
		bundle: true,
		format: "esm",
		platform: "node",
		packages: "external",
		define: { "import.meta.env": "{}" },
		jsx: "automatic",
		alias: {
			"@shared": `${process.cwd()}/src/renderer/src/shared`,
			"@features": `${process.cwd()}/src/renderer/src/features`,
			"@features/chat/components/chat-sidebar": `${process.cwd()}/scripts/library-test-stubs/chat-sidebar.ts`,
			"@shared/components/common/chat-layout": `${process.cwd()}/scripts/library-test-stubs/chat-layout.ts`,
			"@mui/material/styles": MUI_STUB.pathname,
			"@assets": `${process.cwd()}/src/renderer/src/assets`,
		},
		loader: { ".css": "empty", ".png": "dataurl", ".svg": "dataurl" },
		write: false,
		plugins: rewriteCard
			? [
					{
						name: "scratch-card",
						setup(b) {
							b.onLoad({ filter: CARD_PATH }, () => ({
								contents: rewriteCard(readFileSync(CARD_FILE, "utf8")),
								loader: "tsx",
								resolveDir: `${process.cwd()}/src/renderer/src/features/library/components`,
							}));
						},
					},
				]
			: [],
	});
	const path = new URL(
		`./_library-taxonomy-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`,
		import.meta.url,
	);
	await writeFile(path, result.outputFiles[0].text);
	cleanups.push(path);
	return import(path.href);
}
const cleanups = [];
after(async () => {
	for (const path of [...cleanups, MUI_STUB])
		await unlink(path).catch(() => {});
	dom.window.close();
});

const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");

const LOCALES = ["en", "fr", "ur"];
const catalogue = (tag) =>
	JSON.parse(
		readFileSync(`src/i18n/catalogues/${tag}/ui.library.json`, "utf8"),
	);

const asset = (kind, id = `la_${kind}`) => ({
	id,
	ref: {
		type: "path",
		path: `/tmp/${id}.bin`,
		display_path: `${id}.bin`,
		digest: null,
		content_type: "application/octet-stream",
	},
	name: "",
	derived_name: `${id}.bin`,
	description: "",
	kind,
	category: "other",
	origin: "generated",
	origin_group: "generated",
	origins: ["generated"],
	tags: [],
	primary_tag: null,
	size_bytes: 4096,
	width: null,
	height: null,
	duration_s: null,
	created_at: 1_700_000_000,
	modified_at: 1_700_000_100,
	last_seen_at: 1_700_000_200,
	exists: true,
	highlighted: false,
	highlight_why: null,
	favorite: false,
	session_ids: [],
	occurrences: [],
});
const actions = {
	onSelect() {},
	onOpenConversation() {},
	onFilterSession() {},
	onAsk() {},
	onToggleFavorite() {},
	onOpenMenu() {},
	onRename() {},
	onEditTags() {},
};

async function mount(api, node) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const client = new api.QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	await act(async () =>
		root.render(h(api.QueryClientProvider, { client }, node)),
	);
	return {
		container,
		async close() {
			await act(async () => root.unmount());
			client.clear();
			container.remove();
		},
	};
}

/** Switch the locale on the MOUNTED tree - no new props, no remount. */
const switchTo = (api, tag) => act(async () => api.setLocale(tag));

test("library-card-and-row-kind: the card caption and list row name the kind in the active locale", async () => {
	const api = await load();
	const view = await mount(
		api,
		h(
			"div",
			null,
			h(api.LibraryCard, {
				asset: asset("pptx", "la_card"),
				selected: false,
				...actions,
			}),
			h(api.LibraryRow, {
				asset: asset("markdown", "la_row"),
				selected: false,
				...actions,
			}),
		),
	);
	try {
		const card = view.container.querySelector(
			'[data-library-card-id="la_card"]',
		);
		const row = view.container.querySelector('[data-library-card-id="la_row"]');
		assert.ok(card && row, "card and row mounted");
		for (const tag of LOCALES) {
			await switchTo(api, tag);
			const words = catalogue(tag);
			assert.ok(
				card.textContent.includes(words["ui.library.kind.pptx"]),
				`${tag} card: ${card.textContent}`,
			);
			assert.ok(
				row.textContent.includes(words["ui.library.kind.markdown"]),
				`${tag} row: ${row.textContent}`,
			);
			// The raw token is gone wherever the label differs from it.
			if (words["ui.library.kind.markdown"] !== "markdown")
				assert.ok(!MARKDOWN_TOKEN.test(row.textContent), `${tag} raw token`);
			// The raw value still does the machine work.
			assert.equal(row.getAttribute("data-library-card-id"), "la_row");
		}
	} finally {
		await view.close();
		api.setLocale("en");
	}
});

test("library-filter-rail-tag-group: tag group headers are translated, unknown categories stay raw, order stays raw-keyed", async () => {
	const api = await load();
	const tags = [
		{ id: "t1", name: "finance", category: "topic", count: 2 },
		{ id: "t2", name: "ready", category: "status", count: 1 },
		{ id: "t3", name: "misc", category: "zeta", count: 1 },
		{ id: "t4", name: "bare", category: "", count: 1 },
	];
	const view = await mount(
		api,
		h(api.LibraryFilterRail, {
			filters: {},
			onChange() {},
			counts: undefined,
			tags,
			total: 5,
			scopeTotal: null,
		}),
	);
	try {
		const headers = () =>
			[...view.container.querySelectorAll("span.px-2.pt-1.text-meta")].map(
				(el) => el.textContent,
			);
		for (const tag of LOCALES) {
			await switchTo(api, tag);
			const words = catalogue(tag);
			const found = headers();
			for (const category of ["topic", "status", "custom"])
				assert.ok(
					found.includes(words[`ui.library.tag_category.${category}`]),
					`${tag} header ${category} in ${JSON.stringify(found)}`,
				);
			assert.ok(
				found.includes("zeta"),
				"an unknown category is the raw string",
			);
			// Known categories first, unknown last: ranked on the raw value.
			assert.equal(found.at(-1), "zeta");
		}
	} finally {
		await view.close();
		api.setLocale("en");
	}
});

/*
 * The real preview mounts the shared composer and trajectory, whose timers
 * (debounces, polls) would keep this process alive after the cases finish. They
 * are not under test, so record every timer created while the preview is up and
 * clear the survivors on the way out instead of forcing the process to exit.
 */
function trackTimers() {
	const live = new Set();
	const real = { setTimeout, setInterval, clearTimeout, clearInterval };
	globalThis.setTimeout = (...args) => {
		const id = real.setTimeout(...args);
		live.add(id);
		return id;
	};
	globalThis.setInterval = (...args) => {
		const id = real.setInterval(...args);
		live.add(id);
		return id;
	};
	return () => {
		Object.assign(globalThis, real);
		for (const id of live) {
			real.clearTimeout(id);
			real.clearInterval(id);
		}
	};
}

test("library-preview-badge-and-unsupported: the preview badge and the unsupported sentence follow the locale", async () => {
	const api = await load();
	const cases = [
		{ kind: "docx", generic: false },
		{ kind: "other", generic: true },
		{ kind: "hologram", generic: false },
	];
	for (const { kind, generic } of cases) {
		const view = await mount(
			api,
			h(api.LibraryViewer, { asset: asset(kind, `la_${kind}`) }),
		);
		try {
			for (const tag of LOCALES) {
				await switchTo(api, tag);
				const words = catalogue(tag);
				const text = view.container.textContent.replace(BIDI_ISOLATES, "");
				if (generic) {
					assert.ok(
						text.includes(words["ui.library.preview.unsupported_generic"]),
						`${tag} ${kind}: ${text}`,
					);
				} else {
					const label = words[`ui.library.kind.${kind}`] ?? kind;
					const expected = words["ui.library.preview.unsupported"].replace(
						"{kind}",
						label,
					);
					assert.ok(text.includes(expected), `${tag} ${kind}: ${text}`);
				}
			}
			// English `other` no longer reads "A Other file".
			await switchTo(api, "en");
			assert.ok(!view.container.textContent.includes("A Other file"));
		} finally {
			await view.close();
			api.setLocale("en");
		}
	}

	const releaseTimers = trackTimers();
	const preview = await mount(
		api,
		h(api.LibraryPreview, {
			asset: asset("pptx", "la_preview"),
			nowMs: 1_700_000_300_000,
			onClose() {},
			onOpenConversation() {},
			onFilterSession() {},
			onAsk() {},
			onToggleFavorite() {},
			composerFocusSignal: 0,
			focusRequest: null,
		}),
	);
	try {
		for (const tag of LOCALES) {
			await switchTo(api, tag);
			assert.ok(
				preview.container.textContent.includes(
					catalogue(tag)["ui.library.kind.pptx"],
				),
				`${tag} preview badge`,
			);
		}
	} finally {
		await preview.close();
		releaseTimers();
		api.setLocale("en");
	}
});

test("library-taxonomy-mutation-control: a call site reverted to the raw kind fails the same assertion", async () => {
	// Scratch rewrite of the card SOURCE (never the worktree): the list row's
	// KindLabel goes back to painting the raw wire value.
	const api = await load((source) => {
		const needle = "return <>{libraryKindLabel(kind)}</>;";
		assert.ok(source.includes(needle), "the keyed leaf exists in the source");
		return source.replace(needle, "return <>{kind}</>;");
	});
	const view = await mount(
		api,
		h(api.LibraryRow, {
			asset: asset("markdown", "la_mut"),
			selected: false,
			...actions,
		}),
	);
	try {
		await switchTo(api, "fr");
		const row = view.container.querySelector('[data-library-card-id="la_mut"]');
		// The mutant paints the raw token under fr: exactly what the real
		// assertion (the label is present, the raw token is not) rejects.
		assert.ok(MARKDOWN_TOKEN.test(row.textContent), `row: ${row.textContent}`);
		assert.ok(
			!row.textContent.includes(catalogue("fr")["ui.library.kind.markdown"]) ||
				catalogue("fr")["ui.library.kind.markdown"] === "markdown",
		);
	} finally {
		await view.close();
		api.setLocale("en");
	}
});
