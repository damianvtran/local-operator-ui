/*
 * The markdown table width fix, executable: the CSS contract, the one shared
 * wrapper component, and the fixtures the fix's frames are taken from.
 *
 * WHAT THIS FILE PINS, and what it deliberately cannot (design note D1, the
 * invariants list; each assertion below names the invariant it carries):
 *
 *   - I1: the stylesheet's text contract - a `th, td` rule with
 *     `word-break: normal; overflow-wrap: break-word; max-width: 64ch`, the
 *     required `td code` override (`.lo-markdown code` sets `break-word`
 *     directly and a direct declaration cannot be overridden by inheritance),
 *     the `.lo-md-table-scroll` wrapper rule, and the root `break-word` prose
 *     rule left alone;
 *   - I9: the wrapper is a module-scope component with no hooks, effects,
 *     observers or measuring, wired into BOTH render maps - the transcript
 *     renderer's and the projects surface's - from ONE shared module rather
 *     than forked;
 *   - the structural half of the wiring, rendered for real (jsdom, the
 *     shipped components): a table arrives wrapped in `.lo-md-table-scroll`,
 *     on the plain map, the citations map, and the projects surface;
 *   - the two new fixtures' shapes (three 40-character sha columns;
 *     a 263-character unbreakable digest) and their capture rows.
 *
 * WHAT IT CANNOT PIN, stated rather than implied: every COMPUTED number. The
 * squeeze - and its fix - are properties of a real layout engine (min-content,
 * line boxes, scrollWidth), so I2/I3/I5/I6/I7 and the Tab-order half of I10
 * are measured in a real browser and recorded with the AFTER frames in
 * `docs/evidence/chat-markdown-tables/README.md` (`MEASUREMENTS.md` in the
 * before half is the same reading for the unfixed tree). A jsdom host has no
 * layout, so a computed-style assertion here would measure jsdom's defaults,
 * not the fix. That is the same split `chat-measure-handle.test.mjs` records
 * for the measure handle.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const CSS = "src/renderer/src/features/chat/components/markdown.css";
const WRAPPER = "src/renderer/src/features/chat/components/markdown-table.tsx";
const RENDERER =
	"src/renderer/src/features/chat/components/markdown-renderer.tsx";
const PROJECTS = "src/renderer/src/features/projects/project-markdown.tsx";
const STORY =
	"src/renderer/src/features/chat/canonical/markdown-tables.stories.tsx";
const CAPTURE = "scripts/capture-evidence.mjs";

const read = (path) => readFileSync(path, "utf8");

/*
 * Every pattern at the top level: `scripts/` is held to
 * `lint/performance/useTopLevelRegex` (see `lint:scripts`), so a literal built
 * inside a test would fail `pnpm lint:scripts` even though it runs once.
 */
const TRAILING_BRACE = / \{$/;
const TS_FILE = /\.tsx?$/;
const WRAPPER_EXPORT = /export const MarkdownTable/;
const WRAPPER_CLASS = /className="lo-md-table-scroll"/;
const WRAPPER_TABLE_SPREAD = /<table \{\.\.\.rest\} \/>/;
const RENDERER_IMPORT = /import \{ MarkdownTable \} from "\.\/markdown-table";/;
const PROJECTS_IMPORT =
	/import \{ MarkdownTable \} from "\.\.\/chat\/components\/markdown-table";/;
const RENDERER_MAP =
	/const MARKDOWN_COMPONENTS: Components = \{[\s\S]*?\btable: MarkdownTable,/;
const CITATIONS_MAP =
	/const MARKDOWN_COMPONENTS_WITH_CITATIONS: Components = \{[\s\S]*?\.\.\.MARKDOWN_COMPONENTS,/;
const PROJECTS_MAP =
	/const COMPONENTS: Components = \{[\s\S]*?\btable: MarkdownTable,/;
const THREE_SHAS_LITERAL = /const THREE_SHAS = \[([\s\S]*?)\]\.join\("\\n"\)/;
const GIANT_TOKEN_LITERAL = /const GIANT_TOKEN = \[([\s\S]*?)\]\.join\("\\n"\)/;
const QUOTED = /"([^"]+)"/g;
const SHA_40 = /^[0-9a-f]{40}$/;
const SHA256_TOKEN = /^sha256:[0-9a-f]+$/;
const WHITESPACE = /\s/;

/*
 * All rule bodies in `css` whose flattened selector is `selector`.
 *
 * All, because the fix adds a SECOND `.lo-markdown th, .lo-markdown td` rule
 * on purpose - the base rule stays exactly as it was, and the override is a
 * separate, later block so the diff reads as what it is. Matching only the
 * first occurrence would assert the unfixed rule and pass on a reverted tree
 * (or fail on an unchanged one); which body carries the declarations is the
 * question, not where the selector first appears.
 *
 * The blank-text check is load-bearing, not tidy: selectors also appear inside
 * COMMENTS ("`.lo-markdown code` applied..."), and without it the scan dragged
 * from such a mention to the next rule's opening brace - and on the last
 * mention in the file there was no brace left, so `from` went to -1 and the
 * loop pushed bodies forever (V8 OOM, found by running it). A selector's own
 * brace follows it directly; anything else is a mention.
 */
const ruleBodies = (css, selector) => {
	const flat = css.replace(/\s+/g, " ");
	// Callers may pass the selector bare or with the rule's opening brace;
	// the trailing brace is stripped so one scanner serves both.
	const wanted = selector.replace(/\s+/g, " ").replace(TRAILING_BRACE, "");
	const bodies = [];
	let from = 0;
	for (;;) {
		const start = flat.indexOf(wanted, from);
		if (start === -1) return bodies;
		const open = flat.indexOf("{", start + wanted.length);
		if (open === -1) return bodies;
		if (flat.slice(start + wanted.length, open).trim() !== "") {
			from = start + wanted.length;
			continue;
		}
		const close = flat.indexOf("}", open);
		if (close === -1) return bodies;
		bodies.push(flat.slice(open + 1, close));
		from = open;
	}
};

const someRule = (css, selector, ...declarations) => {
	const bodies = ruleBodies(css, selector);
	assert.notEqual(
		bodies.length,
		0,
		`markdown.css: no rule for \`${selector}\``,
	);
	return bodies.some((body) =>
		declarations.every((declaration) => body.includes(declaration)),
	);
};

test("I1: the cell rules make a table cell's min-content its longest word", () => {
	const css = read(CSS);
	/*
	 * The trio must live in ONE `th, td` rule - a word-break here and a
	 * max-width somewhere else would still compute, but the design's recipe
	 * (and the review of it) reads them as one decision about cells.
	 */
	assert.ok(
		someRule(
			css,
			".lo-markdown th, .lo-markdown td",
			"word-break: normal",
			"overflow-wrap: break-word",
			"max-width: 64ch",
		),
		"the `th, td` override must carry word-break: normal, overflow-wrap: break-word and max-width: 64ch in one rule",
	);
	/*
	 * The code-span override is REQUIRED, not defensive: `.lo-markdown code`
	 * sets `word-break: break-word` directly on every span, and inheritance
	 * cannot beat a direct declaration. Measured in the design consult: without
	 * this line a `<code>#684 (1a)</code>` cell keeps the 1ch squeeze.
	 */
	assert.ok(
		someRule(
			css,
			".lo-markdown td code, .lo-markdown th code",
			"word-break: normal",
			"overflow-wrap: inherit",
		),
		"the code-span override must be present - inheritance cannot override `.lo-markdown code`'s direct word-break",
	);
	// The root keeps prose's behaviour: the fix is FOR TABLES ONLY.
	assert.ok(
		someRule(css, ".lo-markdown {", "word-break: break-word"),
		"the `.lo-markdown` root must keep `word-break: break-word` (prose unchanged)",
	);
});

test("I1: the wrapper rule contains, scrolls and carries the margin", () => {
	const css = read(CSS);
	assert.ok(
		someRule(
			css,
			".lo-md-table-scroll {",
			"overflow-x: auto",
			"max-width: 100%",
			"overscroll-behavior-x: contain",
			"margin: 0.75rem 0",
		),
		"the wrapper must scroll, contain overscroll, and take the table's margin",
	);
	assert.ok(
		someRule(css, ".lo-md-table-scroll > table {", "margin: 0"),
		"the table inside the wrapper must drop its own margin (the wrapper carries it)",
	);
	/*
	 * I7's text half: the box keeps filling the measure and stays on auto
	 * layout - the mode the fix depends on. `fixed` would take the content
	 * pricing away, so it is pinned explicitly.
	 */
	assert.ok(
		someRule(css, ".lo-markdown table {", "width: 100%", "table-layout: auto"),
		"the table keeps `width: 100%` and an explicit `table-layout: auto`",
	);
});

test("I9: one shared wrapper module, no hooks, no measuring", () => {
	const wrapper = read(WRAPPER);
	assert.match(wrapper, WRAPPER_EXPORT);
	assert.match(wrapper, WRAPPER_CLASS);
	assert.match(wrapper, WRAPPER_TABLE_SPREAD);
	/*
	 * The perf lane's rule, as a source contract: this component mounts once
	 * per table on the streaming path, so nothing in it may observe layout or
	 * keep state. A regex over the module's own text - the module is small by
	 * design and a helper imported into it would have to be named here to
	 * evade, which is exactly the review the comment invites.
	 */
	for (const banned of [
		"useEffect",
		"useLayoutEffect",
		"useState",
		"useRef",
		"useMemo",
		"ResizeObserver",
		"getBoundingClientRect",
		"clientWidth",
		"scrollWidth",
	]) {
		assert.ok(
			!wrapper.includes(banned),
			`markdown-table.tsx must not contain \`${banned}\` - the wrapper is static markup`,
		);
	}
});

test("I9: both render maps wire the ONE shared component, not a copy", () => {
	const renderer = read(RENDERER);
	const projects = read(PROJECTS);
	// The same import specifier in both files: one module, two consumers.
	assert.match(renderer, RENDERER_IMPORT);
	assert.match(projects, PROJECTS_IMPORT);
	// The table entry rides the BASE map; the citations map spreads that map,
	// so a third map cannot exist without this test seeing it go missing.
	assert.match(renderer, RENDERER_MAP);
	assert.match(renderer, CITATIONS_MAP);
	assert.match(projects, PROJECTS_MAP);
});

test("I1/I9: the class is named in one source file only", () => {
	/*
	 * A second copy of the wrapper - a fork in another component - is the
	 * "second implementation of one thing" this repo refuses, and the import
	 * assertions above cannot see it (a copy carries no import). Walked with
	 * `readdirSync` rather than a shelled-out `grep`: this suite runs from
	 * several worktrees at once and needs no external tool to answer a
	 * question about its own tree.
	 */
	const naming = [];
	for (const file of readdirSync("src", { recursive: true })) {
		if (!TS_FILE.test(file)) continue;
		const path = join("src", file);
		if (readFileSync(path, "utf8").includes("lo-md-table-scroll")) {
			naming.push(path);
		}
	}
	assert.deepEqual(naming, [WRAPPER]);
});

/*
 * The rendered half: the shipped components, mounted for real. Externals keep
 * the bundle on THIS process's React (element symbols and hooks are
 * per-instance), which is the same reason `turn-timestamp.test.mjs` bundles
 * this way and imports the result back.
 */
const bootstrapDOM = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = bootstrapDOM;
const originals = new Map();
const shims = {
	window,
	document: window.document,
	HTMLElement: window.HTMLElement,
	Node: window.Node,
	Element: window.Element,
	SVGElement: window.SVGElement,
	MouseEvent: window.MouseEvent,
	KeyboardEvent: window.KeyboardEvent,
	Event: window.Event,
	CustomEvent: window.CustomEvent,
	localStorage: window.localStorage,
	navigator: window.navigator,
	getComputedStyle: window.getComputedStyle.bind(window),
	requestAnimationFrame: () => 0,
	cancelAnimationFrame: () => {},
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	matchMedia: (query) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
		dispatchEvent: () => false,
	}),
};
for (const [key, value] of Object.entries(shims)) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
window.matchMedia ??= shims.matchMedia;
/*
 * jsdom has no canvas, and a module in the renderer's import graph measures a
 * console cell at load - jsdom answers with a loud "Not implemented:
 * HTMLCanvasElement.prototype.getContext" on stderr, which is not this file's
 * subject and reads like a failure in a green run. A null context is what that
 * caller's own guard handles (it falls back to a constant), so the stub only
 * silences the noise - the same one `secret-ask.test.mjs` installs.
 */
window.HTMLCanvasElement.prototype.getContext = () => null;
const { createRoot } = await import("react-dom/client");
// `createElement` rather than calling the components: both exports are
// `memo()`'d, and a memo component is an object, not a callable function.
const { act, createElement: h } = await import("react");

const bundle = await build({
	stdin: {
		contents: [
			'export { MarkdownRenderer } from "./src/renderer/src/features/chat/components/markdown-renderer";',
			'export { ProjectMarkdown } from "./src/renderer/src/features/projects/project-markdown";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	jsx: "automatic",
	mainFields: ["module", "main"],
	conditions: ["import"],
	loader: { ".css": "empty", ".svg": "text", ".png": "dataurl" },
	define: { "import.meta.env": "{}" },
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
});
const bundlePath = new URL(
	`./_markdown-table-widths-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { MarkdownRenderer, ProjectMarkdown } = await import(bundlePath.href);
await unlink(bundlePath);

after(() => {
	bootstrapDOM.window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

const TABLE = [
	"| PR | State | What it fixes |",
	"| --- | --- | --- |",
	"| #684 (1a) | MERGED f11952f1d2 | fix(chat): a cell `with code` that wraps |",
].join("\n");

/** Mount a component, hand back the container and the unmount. */
const mount = async (element) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(element);
	});
	return {
		container,
		close: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
};

test("a table renders inside the wrapper on the transcript map", async () => {
	const mounted = await mount(
		h(MarkdownRenderer, { content: TABLE, linkify: false }),
	);
	const wrapper = mounted.container.querySelector(".lo-md-table-scroll");
	assert.ok(wrapper, "no `.lo-md-table-scroll` wrapper rendered");
	assert.equal(wrapper.firstElementChild?.tagName, "TABLE");
	// The structure inside is untouched: header and body cells arrive as usual.
	assert.equal(mounted.container.querySelectorAll("table").length, 1);
	assert.equal(mounted.container.querySelectorAll("th").length, 3);
	assert.equal(mounted.container.querySelectorAll("td").length, 3);
	mounted.close();
});

test("the citations map inherits the wrapper through its spread", async () => {
	const mounted = await mount(
		h(MarkdownRenderer, {
			content: TABLE,
			linkify: false,
			credentialCitations: true,
		}),
	);
	const wrapper = mounted.container.querySelector(".lo-md-table-scroll");
	assert.ok(wrapper, "the citations map lost the table entry");
	assert.equal(wrapper.firstElementChild?.tagName, "TABLE");
	mounted.close();
});

test("the projects surface renders the same wrapper from the same module", async () => {
	const mounted = await mount(h(ProjectMarkdown, { children: TABLE }));
	const wrapper = mounted.container.querySelector(".lo-md-table-scroll");
	assert.ok(wrapper, "ProjectMarkdown must share the scroll wrapper");
	assert.equal(wrapper.firstElementChild?.tagName, "TABLE");
	mounted.close();
});

test("the fixtures carry the shapes the edge states exist for", () => {
	const story = read(STORY);
	/*
	 * `three-shas`: three columns of 40-character object names beside one
	 * short label - each column's min-content is a whole token, which is what
	 * makes the sum exceed the 810px measure in a real layout (I5's condition).
	 */
	const threeShas = story.match(THREE_SHAS_LITERAL);
	assert.ok(threeShas, "no THREE_SHAS literal");
	const rows = [...threeShas[1].matchAll(QUOTED)].map((match) => match[1]);
	assert.equal(rows.length, 4, "header + delimiter + two data rows");
	const cells = (row) =>
		row
			.split("|")
			.slice(1, -1)
			.map((cell) => cell.trim());
	const header = cells(rows[0]);
	assert.equal(header.length, 4, "one label column + three sha columns");
	const shaColumns = [1, 2, 3];
	for (const row of rows.slice(2)) {
		const columns = cells(row);
		for (const index of shaColumns) {
			assert.match(
				columns[index],
				SHA_40,
				`column ${index + 1} must be a 40-character sha, got \`${columns[index]}\``,
			);
		}
	}
	/*
	 * `giant-token`: ONE 263-character unbreakable token (I6's subject). The
	 * cell cap acts on exactly this class, and 263 is the design consult's own
	 * stress length - kept verbatim so the after numbers are comparable.
	 */
	const giant = story.match(GIANT_TOKEN_LITERAL);
	assert.ok(giant, "no GIANT_TOKEN literal");
	const giantRows = [...giant[1].matchAll(QUOTED)].map((match) => match[1]);
	const digest = giantRows.flatMap(cells).find((cell) => cell.length > 64);
	assert.ok(digest, "no over-cap token in GIANT_TOKEN");
	assert.equal(digest.length, 263);
	assert.match(digest, SHA256_TOKEN, "one token, no whitespace");
	assert.ok(!WHITESPACE.test(digest));
});

test("the capture registers the edge states, after-half only", () => {
	const capture = read(CAPTURE);
	for (const row of [
		'["chat-markdown-tables--three-shas", 1280, 900]',
		'["chat-markdown-tables--three-shas", 920, 900]',
		'["chat-markdown-tables--giant-token", 1280, 900]',
	]) {
		assert.ok(
			capture.includes(row),
			`capture-evidence.mjs is missing \`${row}\``,
		);
	}
	// The asymmetry, pinned: the giant-token state is NOT captured at 920 (it
	// is a two-column table; the width question it answers - the cap - is not
	// a function of the viewport), and the before half has neither state (the
	// wrapper is the fix's own; there is nothing to photograph before it).
	assert.ok(!capture.includes('["chat-markdown-tables--giant-token", 920'));
	assert.ok(!capture.includes("chat-markdown-tables-before--three-shas"));
	assert.ok(!capture.includes("chat-markdown-tables-before--giant-token"));
	// And the five reproduction states keep their rows.
	for (const leaf of [
		"operator-shape",
		"long-prose",
		"long-tokens",
		"many-columns",
		"few-rows",
	]) {
		assert.ok(
			capture.includes(`["chat-markdown-tables--${leaf}", 1280, 900]`),
			`the \`${leaf}\` row went missing`,
		);
	}
});
