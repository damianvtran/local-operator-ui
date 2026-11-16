/** Source and logic contracts for the Pele diagram renderer and the engine flag.
 * Pixels (theme recolouring, fullscreen, export in a browser) are covered by the
 * Chat/Pele diagram Storybook stories, not by this suite.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const SINGLE_VAR = /^var\((--[a-z-]+)\)$/;
const MERMAID_LAZY = /import\("mermaid"\)/;
const MERMAID_STATIC = /^import (?!type)[^;]*from "mermaid"/m;
const PELE_LAZY = /import\("pele\/lazy"\)/;
const PELE_STATIC = /from "pele(\/core)?"/;

const COMPONENTS = "src/renderer/src/features/chat/components";
const read = (name) => readFileSync(`${COMPONENTS}/${name}`, "utf8");

const bundle = async (entry, define = {}) => {
	const out = await build({
		stdin: {
			contents: `export * from "./${COMPONENTS}/${entry}";`,
			resolveDir: process.cwd(),
			loader: "ts",
		},
		bundle: true,
		format: "esm",
		platform: "node",
		packages: "external",
		write: false,
		define,
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`
	);
};

const storage = (entries, throws = false) => ({
	localStorage: {
		getItem: (key) => {
			if (throws) throw new Error("denied");
			return entries[key] ?? null;
		},
	},
});

const engine = await bundle("diagram-engine.ts");
const mermaidDefault = await bundle("diagram-engine.ts", {
	"import.meta.env": '{"VITE_DIAGRAM_ENGINE":"mermaid"}',
});
const theme = await bundle("pele-theme.ts");

test("engine defaults to pele and honours an explicit mermaid switch", () => {
	globalThis.window = storage({});
	assert.equal(engine.diagramEngine(), "pele");
	globalThis.window = storage({ diagramEngine: "mermaid" });
	assert.equal(engine.diagramEngine(), "mermaid");
	globalThis.window = storage({ diagramEngine: "pele" });
	assert.equal(engine.diagramEngine(), "pele");
});

test("engine ignores an unknown stored value and an unreadable store", () => {
	globalThis.window = storage({ diagramEngine: "svg" });
	assert.equal(engine.diagramEngine(), "pele");
	globalThis.window = storage({}, true);
	assert.equal(engine.diagramEngine(), "pele");
});

test("build-time engine applies unless the stored value overrides it", () => {
	globalThis.window = storage({});
	assert.equal(mermaidDefault.diagramEngine(), "mermaid");
	globalThis.window = storage({ diagramEngine: "pele" });
	assert.equal(mermaidDefault.diagramEngine(), "pele");
	globalThis.window = storage({}, true);
	assert.equal(mermaidDefault.diagramEngine(), "mermaid");
});

test("every Pele colour variable resolves to a theme role the app defines", () => {
	const css = readFileSync("src/renderer/src/styles/index.css", "utf8");
	const names = Object.entries(theme.PELE_THEME_STYLE);
	assert.ok(names.length >= 20);
	for (const [pele, value] of names) {
		assert.ok(pele.startsWith("--pele-"), pele);
		const role = SINGLE_VAR.exec(value)?.[1];
		assert.ok(role, `${pele} maps to a single var(): ${value}`);
		assert.ok(css.includes(`${role}:`), `${pele} -> ${role} is defined`);
	}
	for (let i = 1; i <= 8; i++) {
		assert.ok(`--pele-series-${i}` in theme.PELE_THEME_STYLE);
	}
});

test("on-fill text variables stay at Pele's contrast defaults", () => {
	assert.equal("--pele-fg-on-light" in theme.PELE_THEME_STYLE, false);
	assert.equal("--pele-fg-on-dark" in theme.PELE_THEME_STYLE, false);
});

test("export inlines resolved theme variables into the root svg style only", () => {
	const svg =
		'<svg class="pele" style="max-width:100%"><g style="color:red"/></svg>';
	const resolved = theme.inlinePeleTheme(svg, (role) =>
		role === "--font-sans" ? '"Geist", sans-serif' : "#123456",
	);
	assert.ok(resolved.startsWith('<svg class="pele" style="--pele-bg:#123456;'));
	assert.ok(resolved.includes("--pele-font:'Geist', sans-serif;"));
	assert.ok(resolved.endsWith('max-width:100%"><g style="color:red"/></svg>'));
	assert.equal(
		theme.inlinePeleTheme(svg, () => ""),
		svg,
	);
	assert.equal(
		theme.inlinePeleTheme("<svg>", () => "#fff"),
		"<svg>",
	);
});

const SOURCES = {
	flowchart: "flowchart TD\n  A[Start] --> B{Ok?}\n  B -->|yes| C[Done]",
	sequence: "sequenceDiagram\n  A->>B: hello\n  B-->>A: hi",
	state: "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy: go",
	journey: "journey\n  title T\n  section S\n    Task: 5: Me",
	pie: 'pie title P\n  "a" : 60\n  "b" : 40',
};

test("pele renders the transcript diagram types to themeable svg", async () => {
	const pele = await import("pele");
	for (const [name, source] of Object.entries(SOURCES)) {
		const { svg } = pele.render(source, { fontSize: 14 });
		assert.ok(svg.startsWith("<svg"), name);
		assert.ok(svg.includes("var(--pele-"), `${name} reads --pele-* variables`);
	}
});

test("pele reports an invalid source as an error the viewer can show", async () => {
	const pele = await import("pele");
	assert.throws(
		() => pele.render("flowchart TD\n  A[Start --> B"),
		(error) => error instanceof pele.PeleError && error.message.length > 0,
	);
});

test("pele and mermaid stay lazy and out of the startup chunk", () => {
	const mermaid = read("mermaid-diagram.tsx");
	assert.ok(MERMAID_LAZY.test(mermaid));
	assert.equal(MERMAID_STATIC.test(mermaid), false);
	const pele = read("pele-diagram.tsx");
	assert.ok(PELE_LAZY.test(pele));
	assert.equal(PELE_STATIC.test(pele), false);
});

test("both engines share one viewer and the transcript consumes the selector", () => {
	for (const file of ["mermaid-diagram.tsx", "pele-diagram.tsx"]) {
		const source = read(file);
		assert.ok(source.includes("<DiagramViewer"), file);
		assert.ok(source.includes("exportName="), file);
	}
	const markdown = read("markdown-renderer.tsx");
	assert.ok(markdown.includes('from "./chat-diagram"'));
	assert.equal(markdown.includes('from "./mermaid-diagram"'), false);
	const selector = read("chat-diagram.tsx");
	assert.ok(selector.includes("diagramEngine"));
	assert.ok(selector.includes("<MermaidDiagram"));
	assert.ok(selector.includes("<PeleDiagram"));
});
