/** Table HTML stays inert, except for explicitly supported presentation markup.
 * This exercises the production plugin with react-markdown, not an HTML mock.
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
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const BREAKS = /<br\/>/g;
const INLINE_FORMATTING = /<strong>bold<\/strong><em>italic<\/em> &amp; /;
const RAW_BREAK = /&lt;br/i;
const TABLE_TAG = /<table>/;
const HEADER = /<th>Field<\/th>/;
const HTML_BREAK = /one<br\/>\s*two/;
const LITERAL_CODE = /<code>&lt;br\/&gt;<\/code>/;
const STRONG = /<strong>bold<\/strong>/;
const DOC_HREF = /href="https:\/\/example.com"/;
const ESCAPED_BREAK = /&lt;br&gt;/;
const SAFE_STRONG = /<strong>safe<\/strong>/;
const ACTIVE_HTML = /onclick|onerror|onload|<script|<img|<svg|javascript:/;
const PROSE_LITERAL = /outside&lt;br&gt;table/;

const root = resolve(import.meta.dirname, "..");
const cache = resolve(root, "node_modules/.cache/markdown-table-html");
mkdirSync(cache, { recursive: true });
const bundle = await build({
	entryPoints: [
		resolve(root, "src/renderer/src/features/chat/utils/remark-table-html.ts"),
	],
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
});
const path = resolve(cache, "plugin.mjs");
writeFileSync(path, bundle.outputFiles[0].text);
const { remarkTableHtml } = await import(pathToFileURL(path).href);
const render = (source) =>
	renderToStaticMarkup(
		React.createElement(
			ReactMarkdown,
			{
				remarkPlugins:
					process.env.TABLE_HTML_BASELINE === "1"
						? [remarkGfm]
						: [remarkGfm, remarkTableHtml],
			},
			source,
		),
	);
const table = (cell) => `| Notes |\n| --- |\n| ${cell} |`;

test("model break spellings and inline formatting render inside GFM cells", () => {
	const html = render(
		table(
			"a<br>b<BR/>c<br />d<strong>bold</strong><em>italic</em> &amp; &nbsp;",
		),
	);
	assert.equal((html.match(BREAKS) || []).length, 3);
	assert.match(html, INLINE_FORMATTING);
	assert.doesNotMatch(html, RAW_BREAK);
});
test("HTML tables use semantic safe table nodes", () => {
	const html = render(
		"<table><thead><tr><th>Field</th></tr></thead><tbody><tr><td>one<br/>two</td></tr></tbody></table>",
	);
	assert.match(html, TABLE_TAG);
	assert.match(html, HEADER);
	assert.match(html, HTML_BREAK);
});
test("code, markdown emphasis, links and escaped HTML retain their meaning", () => {
	const html = render(
		table("`<br/>` **bold** [doc](https://example.com) &lt;br&gt;"),
	);
	assert.match(html, LITERAL_CODE);
	assert.match(html, STRONG);
	assert.match(html, DOC_HREF);
	assert.match(html, ESCAPED_BREAK);
	assert.doesNotMatch(render("```html\n<table><br/></table>\n```"), TABLE_TAG);
});
test("active HTML, attributes, images and unsafe links never survive", () => {
	const html = render(
		table(
			'<strong onclick="alert(1)">safe</strong><img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">bad</a><svg onload="alert(4)"></svg>',
		),
	);
	assert.match(html, SAFE_STRONG);
	assert.doesNotMatch(html, ACTIVE_HTML);
});

test("structural table geometry is numeric and safe; cell blocks stay separate", () => {
	const html = render(
		'<table style="color:red" id="outside"><caption>Title &amp; notes</caption><colgroup span="2"><col span="2" onclick="alert(1)"></colgroup><thead><tr><th colspan="2" scope="colgroup" align="center">Heading</th></tr></thead><tbody><tr><td rowspan="0"><p>one</p><p>two</p><ul><li>three</li><li>four</li></ul></td><td colspan="-1" rowspan="bad">other</td></tr></tbody><tfoot><tr><td>foot</td></tr></tfoot></table>',
	);
	const dom = new JSDOM(html);
	try {
		const doc = dom.window.document;
		assert.equal(doc.querySelector("th").colSpan, 2);
		assert.equal(doc.querySelector("th").getAttribute("scope"), "colgroup");
		// react-markdown normalizes legacy alignment to a text-align style.
		assert.equal(doc.querySelector("th").style.textAlign, "center");
		assert.equal(doc.querySelector("td").rowSpan, 0);
		assert.equal(doc.querySelector("colgroup").span, 2);
		assert.equal(doc.querySelector("col").span, 2);
		assert.equal(doc.querySelectorAll("td p").length, 2);
		assert.equal(doc.querySelectorAll("td li").length, 2);
		assert.equal(doc.querySelector("tfoot td").textContent, "foot");
		assert.equal(
			doc.querySelectorAll("[style]:not(th),[id],[onclick]").length,
			0,
		);
		assert.equal(doc.querySelectorAll("td")[1].hasAttribute("colspan"), false);
		assert.equal(doc.querySelectorAll("td")[1].hasAttribute("rowspan"), false);
	} finally {
		dom.window.close();
	}
});

test("HTML tables spanning CommonMark blank-line blocks retain rows and following prose", () => {
	const html = render(
		'<table data-note="</table>">\n\n<thead><tr><th>Heading</th></tr></thead>\n\n<tbody><tr><td>one<br/>two</td></tr></tbody>\n\n</table>\n\n**After** the table.',
	);
	const dom = new JSDOM(html);
	try {
		const doc = dom.window.document;
		assert.equal(doc.querySelectorAll("table").length, 1);
		assert.equal(doc.querySelector("th").textContent, "Heading");
		assert.equal(doc.querySelectorAll("td br").length, 1);
		assert.equal(doc.querySelector("p strong").textContent, "After");
	} finally {
		dom.window.close();
	}
});

test("unfinished HTML tables cannot consume later Markdown fences or prose", () => {
	const html = render(
		"<table>\n\n```html\n<table><td>literal</td></table>\n```\n\n**After** the example.",
	);
	const dom = new JSDOM(html);
	try {
		const doc = dom.window.document;
		assert.equal(
			doc.querySelector("pre code").textContent.trim(),
			"<table><td>literal</td></table>",
		);
		assert.equal(doc.querySelector("p strong").textContent, "After");
	} finally {
		dom.window.close();
	}
});

test("blank-line reconstruction retains a second table in the consumed HTML node", () => {
	const dom = new JSDOM(
		render(
			"<table>\n\n<tr><td>one</td></tr>\n</table>\n<table><tr><td>TWO</td></tr></table>",
		),
	);
	try {
		assert.deepEqual(
			[...dom.window.document.querySelectorAll("td")].map(
				(cell) => cell.textContent,
			),
			["one", "TWO"],
		);
	} finally {
		dom.window.close();
	}
});

test("container-normalized tables do not expose quote or list prefixes", () => {
	for (const source of [
		"> <table>\n>\n> <tr><td>one</td></tr>\n>\n> <tr><td>two</td></tr>\n>\n> </table>\n>\n> AFTER",
		"- <table>\n\n  <tr><td>one</td></tr>\n\n  <tr><td>two</td></tr>\n\n  </table>\n\n  AFTER",
	]) {
		const dom = new JSDOM(render(source));
		try {
			assert.deepEqual(
				[...dom.window.document.querySelectorAll("td")].map(
					(cell) => cell.textContent,
				),
				["one", "two"],
			);
			assert.equal(
				dom.window.document.body.textContent.replace(/\s/g, ""),
				"onetwoAFTER",
			);
		} finally {
			dom.window.close();
		}
	}
});

test("unknown and prototype-named elements cannot escape the allowlist", () => {
	for (const tag of [
		"constructor",
		"toString",
		"__proto__",
		"iframe",
		"style",
		"math",
		"svg",
		"template",
	]) {
		const html = render(table(`<${tag}>hidden</${tag}><br/>visible`));
		assert.ok(html.includes("visible"));
		assert.ok(!html.includes(`<${tag}`));
	}
});

test("placeholder-looking model HTML does not impersonate original markdown", () => {
	const html = render(
		table(
			'<lo-table-node data-index="0">injected</lo-table-node><strong>safe</strong> `<br>`',
		),
	);
	assert.match(html, SAFE_STRONG);
	assert.ok(!html.includes("injected"));
	assert.ok(html.includes("<code>&lt;br&gt;</code>"));
});

test("prose HTML stays literal and malformed streaming table cells are safe", () => {
	assert.match(render("outside<br>table"), PROSE_LITERAL);
	for (const cell of [
		"",
		"a<br",
		"a<br>",
		"<strong>open",
		"<!--comment--><br/>",
	]) {
		assert.doesNotThrow(() => render(table(cell)));
	}
});
