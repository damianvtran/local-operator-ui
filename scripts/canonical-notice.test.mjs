import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// This is a separate file from the transport tests: bundling the transcript
// is asynchronous and must finish before any tests or HTTP teardown can run.
const bundle = await build({
	stdin: {
		contents: `export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";
 export { EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
});
const bundlePath = new URL("./_canonical-notice.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
let CanonicalTranscript;
let EMPTY_TRANSCRIPT;
try {
	({ CanonicalTranscript, EMPTY_TRANSCRIPT } = await import(bundlePath.href));
} finally {
	await unlink(bundlePath);
}

// Render through NoticeRow, not TraceLine alone: the regression was the caller
// omitting verbOverride, which changed the label, glyph AND narration length.
// In particular a detail-less row has no disclosure to recover a clipped error.
for (const [name, headline, detail] of [
	...["failed", "completed"].flatMap((outcome) =>
		[null, "The full supporting job output."].map((detail) => [
			`${outcome}, ${detail ? "with detail" : "without detail"}`,
			`background job 'long-verification-job' ${outcome}: ${"Complete diagnostic context must remain readable. ".repeat(3)}END OF RESULT`,
			detail,
		]),
	),
	[
		"ordinary job",
		"The independent reviewer finished inspecting every requested verification report and found no remaining blockers.",
		null,
	],
]) {
	test(`job result preserves label, glyph and full message: ${name}`, () => {
		const markup = renderToStaticMarkup(
			h(CanonicalTranscript, {
				transcript: {
					...EMPTY_TRANSCRIPT,
					records: [
						{
							kind: "custom",
							id: "job-regression",
							ts: 1_760_000_000_000,
							customType: "job_result",
							level: "info",
							category: null,
							provider: null,
							headline,
							text: [headline, detail].filter(Boolean).join("\n"),
							attribution: "system",
							detail,
						},
					],
				},
				gate: null,
				waiting: false,
				loadingOlder: false,
				onLoadOlder: async () => true,
				containerRef: { current: null },
				isSmallView: false,
				status: "live",
				failure: null,
				hydrated: true,
				onReconnect: () => {},
			}),
		);
		const text = markup.replace(/<[^>]*>/g, "").replaceAll("&#x27;", "'");
		assert.ok(
			text.includes(headline),
			"the full headline survives rendering, including its tail",
		);
		assert.ok(text.includes("job result:"));
		assert.ok(!text.includes("Worked on the request"));
		assert.ok(markup.includes("lucide-message-square-text"));
		assert.ok(!markup.includes("lucide-code-xml"));
		assert.equal(
			markup.includes('aria-expanded="false"'),
			Boolean(detail),
			"only a row with supporting detail has a disclosure",
		);
	});
}
