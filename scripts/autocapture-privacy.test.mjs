/**
 * The renderer's PostHog privacy filter (`autocapture-privacy.ts`): no user
 * content in autocapture, rageclick, dead-click or exception events, and short
 * control labels unchanged.
 *
 * Two layers of evidence, because the second is the one that can fail for a
 * reason the first cannot see:
 *
 * 1. The rule, on hostile values directly: POSIX, Windows and tilde paths, file
 *    names (CJK too), emails, URLs, 360-character text, tokens - and the labels
 *    the onboarding funnel counts ("Check again", "Send again", "More", "更多").
 * 2. The REAL posthog-js (the installed version, not a re-implementation of its
 *    chain format) initialised in jsdom with the same `before_send` the renderer
 *    passes, clicking real elements. What the test reads is what posthog-js
 *    would have queued: a second `before_send` step records the event and
 *    returns null, so nothing is sent anywhere.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const repo = process.cwd();
const POSTHOG_IMPORT = /^posthog-js(\/.*)?$/;
const built = await build({
	entryPoints: [
		join(repo, "src/renderer/src/shared/analytics/autocapture-privacy.ts"),
	],
	bundle: true,
	format: "esm",
	platform: "browser",
	write: false,
	plugins: [
		{
			// Only TYPES may come from posthog-js: node-side bundles cannot load it.
			name: "refuse-posthog",
			setup(b) {
				b.onResolve({ filter: POSTHOG_IMPORT }, (args) => ({
					errors: [{ text: `posthog-js runtime import from ${args.importer}` }],
				}));
			},
		},
	],
});
const dir = mkdtempSync(join(tmpdir(), "autocapture-privacy-"));
let mod;
try {
	const path = join(dir, "bundle.mjs");
	writeFileSync(path, built.outputFiles[0].text);
	mod = await import(pathToFileURL(path).href);
} finally {
	rmSync(dir, { recursive: true, force: true });
}

const LONG_TEXT = "Summarize the attached quarterly report and "
	.repeat(8)
	.slice(0, 360);

const HOSTILE = [
	[
		"/Users/jane/.local-operator/scratchpad/7569cc/Acme Corp Due Diligence.pdf",
		"path",
	],
	["~/Documents/clients/acme.docx", "path"],
	["./notes/today.md", "path"],
	["src/main/index.ts", "path"],
	["C:\\Users\\Jane\\Desktop\\合同.pdf", "path"],
	["C:/Users/Jane/Desktop/report.xlsx", "path"],
	["\\\\fileserver\\share\\board.pptx", "path"],
	["Acme Corp Due Diligence.pdf", "filename"],
	["报告.docx", "filename"],
	["invoice-2026-11.csv", "filename"],
	["jane.doe@acme-corp.com", "email"],
	["Contact jane@acme.io now", "email"],
	["https://acme.sharepoint.com/sites/legal/contract", "url"],
	["www.acme.com/pricing", "url"],
	["file:///Users/jane/a.txt", "url"],
	[LONG_TEXT, "long-text"],
	[
		"请帮我总结这份文件的内容，并且把重点列出来给我看看，谢谢你，这个文件非常重要，关系到我们公司明年的预算安排和人事计划",
		"long-text",
	],
	["Line one\nLine two", "multiline"],
	// Built at runtime so no key-shaped literal sits in the repository.
	[`sk-proj-${"a1B2c3D4".repeat(4)}`, "token"],
	["4c1f0a52-8d3e-4b6a-9f21-7e5c3d2b1a09", "token"],
];

const LABELS = [
	"Check again",
	"Send again",
	"More",
	"Try again",
	"更多",
	"Повторить попытку",
	"Thử lại",
	"New chat",
	"1/3",
	"Read / Write",
	"Continue",
	"gpt-4.1",
	"Settings",
	"v0.59.2",
	"3 more",
	"chat-composer-send-button",
];

test("hostile values are redacted whole, by kind", () => {
	for (const [value, kind] of HOSTILE) {
		assert.equal(
			mod.scrubLabel(value),
			`[redacted:${kind}]`,
			JSON.stringify(value),
		);
	}
});

test("short control labels arrive unchanged, localized ones too", () => {
	for (const label of LABELS) assert.equal(mod.scrubLabel(label), label, label);
	assert.equal(mod.scrubLabel(""), "");
	assert.equal(mod.MAX_LABEL_CHARS, 64);
	assert.equal(mod.scrubLabel("x".repeat(64)), "x".repeat(64));
	assert.equal(mod.scrubLabel("x".repeat(65)), "[redacted:long-text]");
});

test("links keep an origin or a route, never a path", () => {
	assert.equal(
		mod.scrubUrl("https://docs.example.com"),
		"https://docs.example.com",
	);
	assert.equal(
		mod.scrubUrl("https://docs.example.com/"),
		"https://docs.example.com",
	);
	assert.equal(
		mod.scrubUrl("https://drive.google.com/file/d/abc/view?usp=sharing"),
		"https://drive.google.com/[redacted:url]",
	);
	assert.equal(mod.scrubUrl("#/chat/4c1f0a52-8d3e"), "#/chat");
	assert.equal(mod.scrubUrl("#/settings"), "#/settings");
	assert.equal(mod.scrubUrl("file:///Users/jane/a.pdf"), "[redacted:url]");
	assert.equal(mod.scrubUrl("mailto:jane@acme.com"), "[redacted:url]");
	assert.equal(mod.scrubUrl("/Users/jane/a.pdf"), "[redacted:url]");
});

test("a chain is rebuilt from scrubbed parts; Tailwind classes with ':' survive", () => {
	const chain =
		'span.truncate:text="/Users/jane/Acme.pdf"nth-child="2"nth-of-type="1";' +
		'button.hover:bg-ink/10.px-2:nth-child="1"nth-of-type="1"attr__aria-label="Open Acme.pdf"attr__title="Check again"attr__class="hover:bg-ink/10 px-2";' +
		'a:text="Docs"nth-child="1"nth-of-type="1"href="https://acme.com/private/x"attr__href="https://acme.com/private/x"';
	assert.equal(
		mod.scrubElementsChain(chain),
		'span.truncate:text="[redacted:path]"nth-child="2"nth-of-type="1";' +
			'button.hover:bg-ink/10.px-2:nth-child="1"nth-of-type="1"attr__aria-label="[redacted:filename]"attr__title="Check again"attr__class="hover:bg-ink/10 px-2";' +
			'a:text="Docs"nth-child="1"nth-of-type="1"href="https://acme.com/[redacted:url]"attr__href="https://acme.com/[redacted:url]"',
	);
});

test("a value carrying quotes cannot smuggle text past the scrub", () => {
	// posthog-js does not escape quotes, so a hostile value can mimic the grammar.
	const chain =
		'button:text="a"attr__title="jane@acme.com" x="/Users/jane/b.pdf"nth-child="1"nth-of-type="1"';
	const out = mod.scrubElementsChain(chain);
	assert.ok(!out.includes("jane"), out);
	assert.ok(!out.includes("b.pdf"), out);
});

test("an unparseable chain is dropped, not passed through", () => {
	assert.equal(mod.scrubElementsChain("garbage /Users/jane/a.pdf"), "");
	assert.equal(
		mod.scrubElementsChain('div:nth-child="1"nth-of-type="1"; /Users/x'),
		"",
	);
});

test("inside a ph-sensitive region only structural attributes survive", () => {
	const chain =
		'button:nth-child="1"nth-of-type="1"attr__aria-label="New chat with Acme Analyst"attr__data-state="open";' +
		'div.ph-mask.ph-sensitive:nth-child="1"nth-of-type="1"attr__title="Q3 board prep"attr__class="ph-sensitive ph-mask";' +
		'nav:nth-child="1"nth-of-type="1"attr__aria-label="Chats"';
	assert.equal(
		mod.scrubElementsChain(chain),
		'button:nth-child="1"nth-of-type="1"attr__data-state="open";' +
			'div.ph-mask.ph-sensitive:nth-child="1"nth-of-type="1"attr__class="ph-sensitive ph-mask";' +
			'nav:nth-child="1"nth-of-type="1"attr__aria-label="Chats"',
	);
});

test("exceptions keep their sentence, lose paths, emails, URLs and the account name", () => {
	const props = {
		$exception_list: [
			{
				type: "Error",
				value:
					"ENOENT: no such file, open '/Users/jane/Clients/Acme.pdf' (jane@acme.com) at https://api.acme.com/v1/x?k=1",
				stacktrace: {
					frames: [
						{
							filename:
								"file:///Users/jane/Applications/Local Operator.app/Contents/Resources/app.asar/out/renderer/index.js",
							abs_path: "C:\\Users\\Jane\\AppData\\Local\\app\\index.js",
						},
					],
				},
			},
		],
	};
	const result = mod.scrubCaptureResult({
		event: "$exception",
		properties: props,
	});
	const [exception] = result.properties.$exception_list;
	assert.equal(
		exception.value,
		"ENOENT: no such file, open '[redacted:path]' ([redacted:email]) at https://api.acme.com/[redacted:url]",
	);
	assert.ok(!exception.stacktrace.frames[0].filename.includes("jane"));
	assert.ok(
		exception.stacktrace.frames[0].filename.endsWith("out/renderer/index.js"),
	);
	assert.ok(!exception.stacktrace.frames[0].abs_path.includes("Jane"));
	assert.equal(
		mod.scrubExceptionMessage("t.map is not a function"),
		"t.map is not a function",
	);
});

test("named product events and other properties pass through untouched", () => {
	const event = {
		event: "provider_connected",
		properties: { provider: "openai", method: "sign_in", $current_url: "x" },
	};
	assert.deepEqual(mod.scrubCaptureResult(structuredClone(event)), event);
	assert.equal(mod.scrubCaptureResult(null), null);
});

/*
 * THE REAL PATH: posthog-js's own autocapture building `$el_text`,
 * `$elements` and `$elements_chain` from a DOM, then this module's hook.
 */
test("real posthog-js autocapture, through the renderer's before_send", async () => {
	const require = createRequire(join(repo, "package.json"));
	const { JSDOM } = require("jsdom");
	const dom = new JSDOM("<!doctype html><html><body></body></html>", {
		url: "https://app.local/index.html#/chat",
		pretendToBeVisual: true,
	});
	const saved = {};
	const globals = [
		"self",
		"window",
		"document",
		"navigator",
		"location",
		"localStorage",
		"sessionStorage",
		"XMLHttpRequest",
		"Node",
		"Element",
		"HTMLElement",
		"MouseEvent",
		"Event",
		"ShadowRoot",
		"DocumentFragment",
		"getComputedStyle",
	];
	for (const key of globals) {
		saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
		Object.defineProperty(globalThis, key, {
			value: dom.window[key],
			configurable: true,
			writable: true,
		});
	}
	/*
	 * posthog-js schedules its own timers (queue flushes, retries) on the global
	 * clock and never lets go of them, which keeps this file's process alive after
	 * the last test. The test owns those timers: every one it starts is recorded
	 * and cleared in the `finally`, so the file exits on its own.
	 */
	const timers = { setTimeout, setInterval };
	const started = [];
	globalThis.setTimeout = (...args) => {
		const handle = timers.setTimeout(...args);
		started.push(handle);
		return handle;
	};
	globalThis.setInterval = (...args) => {
		const handle = timers.setInterval(...args);
		started.push(handle);
		return handle;
	};
	try {
		const posthog = require("posthog-js").default;
		const queued = [];
		posthog.init("phc_test_never_sent", {
			api_host: "https://127.0.0.1:9",
			advanced_disable_decide: true,
			advanced_disable_flags: true,
			disable_session_recording: true,
			capture_pageview: false,
			capture_pageleave: false,
			autocapture: true,
			rageclick: false,
			persistence: "memory",
			request_batching: false,
			before_send: [
				mod.scrubCaptureResult,
				(event) => {
					queued.push(event);
					return null; // recorded here; nothing leaves the test
				},
			],
		});
		const body = dom.window.document.body;
		body.innerHTML = `
			<button id="check">Check again</button>
			<button id="cjk">更多</button>
			<button id="chip" title="Acme Corp Due Diligence.pdf"><span>/Users/jane/.local-operator/scratchpad/7569cc/Acme Corp Due Diligence.pdf</span></button>
			<button id="long"><span>${LONG_TEXT}</span></button>
			<div class="${mod.USER_CONTENT_CLASS}" title="Q3 board prep with Acme">
				<button id="row" aria-label="Open Q3 board prep"><span>Q3 board prep</span></button>
			</div>
			<a id="link" href="https://acme.sharepoint.com/sites/legal/contract">Docs</a>`;
		const click = (id) =>
			body.querySelector(`#${id}`).dispatchEvent(
				new dom.window.MouseEvent("click", {
					bubbles: true,
					clientX: 1,
					clientY: 1,
				}),
			);
		for (const id of ["check", "cjk", "chip", "long", "row", "link"]) click(id);

		const autocaptured = queued.filter((e) => e.event === "$autocapture");
		assert.equal(
			autocaptured.length,
			6,
			JSON.stringify(queued.map((e) => e.event)),
		);
		const [check, cjk, chip, long, row, link] = autocaptured.map(
			(e) => e.properties,
		);

		// The labels the funnel counts, byte for byte.
		assert.equal(check.$el_text, "Check again");
		assert.ok(
			check.$elements_chain.includes('text="Check again"'),
			check.$elements_chain,
		);
		assert.equal(cjk.$el_text, "更多");

		for (const props of [chip, long, row, link]) {
			const wire = JSON.stringify(props);
			for (const needle of [
				"jane",
				"Acme",
				"acme.sharepoint.com/sites",
				"Due Diligence",
				"Q3 board",
				"quarterly report",
			]) {
				assert.ok(!wire.includes(needle), `${needle} leaked: ${wire}`);
			}
		}
		assert.equal(chip.$el_text, "[redacted:path]");
		assert.equal(long.$el_text, "[redacted:long-text]");
		assert.equal(
			row.$el_text,
			undefined,
			"a region's text is withheld by posthog-js itself",
		);
		assert.equal(link.$el_text, "Docs");
		assert.equal(
			link.$external_click_url,
			"https://acme.sharepoint.com/[redacted:url]",
		);
	} finally {
		for (const key of globals) {
			if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
			else delete globalThis[key];
		}
		dom.window.close();
		globalThis.setTimeout = timers.setTimeout;
		globalThis.setInterval = timers.setInterval;
		for (const handle of started) clearTimeout(handle);
	}
});
