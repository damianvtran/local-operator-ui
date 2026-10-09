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
 * not the fix.
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
const THREE_SHAS_LINKED_LITERAL =
	/const THREE_SHAS_LINKED = \[([\s\S]*?)\]\.join\("\\n"\)/;
const CODE_IN_CELLS_LITERAL =
	/const CODE_IN_CELLS = \[([\s\S]*?)\]\.join\("\\n"\)/;
const QUOTED = /"([^"]+)"/g;
const SHA_40 = /^[0-9a-f]{40}$/;
const SHA256_TOKEN = /^sha256:[0-9a-f]+$/;
const WHITESPACE = /\s/;
/* A cell that is ONE markdown link, whole, pointing at a GitHub pull request. */
const MARKDOWN_LINK = /^\[([^\]]+)\]\((https:\/\/github\.com\/[^)]+)\)$/;
const PULL_LINK = /\/pull\/\d+$/;
/* A cell that is ONE code span, whole (`value` and nothing around it). */
const CODE_SPAN = /^`[^`]+`$/;
/* The user-turn state's two wiring facts, pinned on its own line. */
const USER_TURN_EXPORT = /export const UserTurn: Story = \{/;
const USER_TURN_RENDER =
	/render: \(\) => <Frame records=\{\[user\("u1", OPERATOR_SHAPE\)\]\} \/>/;

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

/*
 * The source offset of the FIRST real rule whose selector is `selector`.
 *
 * A MENTION IS NOT A RULE, and a bare `indexOf` cannot tell them apart: the
 * file names both selectors inside comments (the wrapper rule's own comment
 * says "the table's old ones", the cell rule's says "`.lo-markdown code`"),
 * so the scan repeats `ruleBodies`' test - selector immediately followed by
 * its own brace - rather than trusting the first textual hit. Without this the
 * NIT-2 order assertion below could pin the position of a comment.
 */
const ruleStart = (css, selector) => {
	const flat = css.replace(/\s+/g, " ");
	const wanted = selector.replace(/\s+/g, " ");
	let from = 0;
	for (;;) {
		const at = flat.indexOf(wanted, from);
		if (at === -1) return -1;
		const open = flat.indexOf("{", at + wanted.length);
		if (open === -1) return -1;
		if (flat.slice(at + wanted.length, open).trim() === "") return at;
		from = at + wanted.length;
	}
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
	 * NIT-2 (agent review round 1): the child rule TIES `.lo-markdown table` on
	 * specificity - both are one class plus one type, (0,1,1) - and wins only by
	 * SOURCE ORDER. Nothing pinned that order, so a reorder inside this
	 * stylesheet would silently restore the table's `0.75rem 0` margin inside
	 * the scroll box (putting the bar's space back around the table it was
	 * moved off) and every other assertion here would still pass. Pin the
	 * sequence itself, on the rules rather than on their text.
	 */
	const childAt = ruleStart(css, ".lo-md-table-scroll > table");
	const baseAt = ruleStart(css, ".lo-markdown table");
	assert.ok(childAt !== -1, "no `.lo-md-table-scroll > table` rule found");
	assert.ok(baseAt !== -1, "no `.lo-markdown table` rule found");
	assert.ok(
		childAt > baseAt,
		"`.lo-md-table-scroll > table` must come AFTER `.lo-markdown table` in source order - the two tie on specificity, so order is the only thing making `margin: 0` win",
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
	/*
	 * Round 1's remediation rows: the mixed keyboard state at both rig rungs,
	 * and the user-turn and code-in-cells states at 1280. AFTER-half only, for
	 * the same reason the two edge states are: each photographs the fix's own
	 * behaviour (or, for the user turn, a container the fix reaches) and there
	 * is nothing before it to pair against.
	 */
	for (const row of [
		'["chat-markdown-tables--three-shas-linked", 1280, 900]',
		'["chat-markdown-tables--three-shas-linked", 920, 900]',
		'["chat-markdown-tables--user-turn", 1280, 900]',
		'["chat-markdown-tables--code-in-cells", 1280, 900]',
	]) {
		assert.ok(
			capture.includes(row),
			`capture-evidence.mjs is missing the remediation row \`${row}\``,
		);
	}
	for (const leaf of ["three-shas-linked", "user-turn", "code-in-cells"]) {
		for (const width of [1280, 920]) {
			assert.ok(
				!capture.includes(`"chat-markdown-tables-before--${leaf}", ${width}`),
				`the before half must not carry \`${leaf}\``,
			);
		}
	}
});

/*
 * The remediation states' shapes - the two that are new FIXTURES (the user
 * turn reuses `OPERATOR_SHAPE`, so its pin is the wiring line, not a literal).
 */
test("the mixed-case fixture links a three-shas shape rather than replacing it", () => {
	const story = read(STORY);
	/*
	 * `three-shas-linked` must change ONE variable against `THREE_SHAS`: the
	 * Repo cells become real links. If its chain stopped being the same three
	 * 40-character columns, the keyboard question the state exists for (UX-1:
	 * does a link-bearing OVERFLOWING wrapper still scroll?) would no longer be
	 * asked of the overflowing shape - so both halves are pinned.
	 */
	const linked = story.match(THREE_SHAS_LINKED_LITERAL);
	assert.ok(linked, "no THREE_SHAS_LINKED literal");
	const rows = [...linked[1].matchAll(QUOTED)].map((match) => match[1]);
	assert.equal(rows.length, 4, "header + delimiter + two data rows");
	const cells = (row) =>
		row
			.split("|")
			.slice(1, -1)
			.map((cell) => cell.trim());
	assert.equal(cells(rows[0]).length, 4, "one link column + three sha columns");
	const destinations = new Set();
	for (const row of rows.slice(2)) {
		const columns = cells(row);
		const link = columns[0].match(MARKDOWN_LINK);
		assert.ok(
			link,
			`the Repo cell must be one markdown link, got \`${columns[0]}\``,
		);
		assert.match(
			link[2],
			PULL_LINK,
			"the link must point at a pull request, not a bare repo",
		);
		destinations.add(link[2]);
		for (const index of [1, 2, 3]) {
			assert.match(
				columns[index],
				SHA_40,
				`column ${index + 1} must stay a 40-character sha, got \`${columns[index]}\``,
			);
		}
	}
	assert.equal(
		destinations.size,
		rows.length - 2,
		"one link per row, distinct destinations",
	);
});

test("the code-in-cells fixture carries spans the override has to win against", () => {
	const story = read(STORY);
	/*
	 * `code-in-cells` exists for the `td code, th code` override: `.lo-markdown
	 * code` declares `word-break: break-word` directly, so a cell that is a code
	 * span is the only shape where the override is load-bearing. The three
	 * classes the consult measured are pinned - the reported `#684 (1a)`, a word
	 * plus a token in ONE span, and a single unbreakable 40-character sha - and
	 * every value cell must be exactly one span, or the state is asking a
	 * different question than the one Q3 opened.
	 */
	const fixture = story.match(CODE_IN_CELLS_LITERAL);
	assert.ok(fixture, "no CODE_IN_CELLS literal");
	const rows = [...fixture[1].matchAll(QUOTED)].map((match) => match[1]);
	assert.equal(rows.length, 5, "header + delimiter + three data rows");
	const cells = (row) =>
		row
			.split("|")
			.slice(1, -1)
			.map((cell) => cell.trim());
	const spans = rows.slice(2).map((row) => {
		const value = cells(row)[1];
		assert.ok(
			CODE_SPAN.test(value),
			`the Value cell must be one code span, got \`${value}\``,
		);
		return value.slice(1, -1);
	});
	assert.ok(
		spans.some((span) => span.includes(" ")),
		"one span must carry a space - the word-plus-token class",
	);
	assert.ok(
		spans.some((span) => SHA_40.test(span)),
		"one span must be a single unbreakable 40-character token",
	);
	assert.ok(
		spans.some((span) => span === "#684 (1a)"),
		"the reported cell itself must be one of the spans",
	);
});

test("the user-turn state carries the reported table in a user record", () => {
	const story = read(STORY);
	/*
	 * The D1 state: the bubble is only photographed if the record is a USER
	 * record (an assistant answer would render in the 810px measure instead) and
	 * the text is the REPRODUCED table (a different table would photograph a
	 * different geometry). Two wiring facts, both on the state's own line.
	 */
	assert.match(story, USER_TURN_EXPORT);
	assert.match(story, USER_TURN_RENDER);
});
