import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The Library markdown baseline, against the SHIPPED buffer owner.
 *
 * THE REGRESSION THIS PINS (review finding on #1195): the document was given
 * `Math.round(asset.modified_at * 1000)` as `readMtimeMs`, but the owner compares
 * the probe's floating-point `mtimeMs` strictly. A clean file with a fractional
 * stat reading then looked "moved" on the first autosave and stayed held. The
 * builder now takes the probe's own value; this test drives a clean buffer whose
 * probe matches that baseline and requires the first autosave to be WRITTEN, then
 * keeps the rounded-baseline control to show the comparison is the strict one.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export { adoptBuffer, proposeBuffer, saveBuffer, setBufferPorts } from "./src/renderer/src/features/chat/components/canvas/document-buffers";',
			'export { libraryMarkdownDocument } from "./src/renderer/src/features/library/library-markdown";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@features/chat/components/canvas/file-freshness": `${process.cwd()}/scripts/library-test-stubs/file-freshness.ts`,
		"@shared/store/canvas-store": `${process.cwd()}/scripts/library-test-stubs/canvas-store.ts`,
	},
	loader: { ".css": "empty" },
});
const {
	adoptBuffer,
	proposeBuffer,
	saveBuffer,
	setBufferPorts,
	libraryMarkdownDocument,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const ASSET = {
	id: "la_0000000000000031",
	ref: {
		type: "path",
		path: "/tmp/library-clean.md",
		display_path: "~/library-clean.md",
		digest: null,
		content_type: "text/markdown",
	},
	name: "Clean document",
	derived_name: "library-clean.md",
	description: "",
	kind: "markdown",
	category: "document",
	origin: "written",
	origin_group: "created",
	origins: ["written"],
	tags: [],
	primary_tag: null,
	size_bytes: 128,
	width: null,
	height: null,
	duration_s: null,
	created_at: 1,
	modified_at: 1,
	last_seen_at: 1,
	exists: true,
	highlighted: false,
	highlight_why: null,
	occurrences: [],
	session_count: 1,
	chat: null,
	preview: { state: "ready", mime_type: "text/markdown", pages: null },
	organized: null,
	locked: false,
	favorite: false,
	archived: false,
};

test("a clean Library document's first autosave is accepted", async () => {
	/* A stat reading with a real fractional millisecond part: rounding it is
	 * exactly what produced the false "moved" answer. */
	const probeMtime = 1_759_000_000_123.4568;
	const document = libraryMarkdownDocument(ASSET, "# Clean\n", probeMtime);
	assert.equal(document.readMtimeMs, probeMtime);

	let writes = 0;
	setBufferPorts({
		probe: async () => ({
			exists: true,
			isFile: true,
			mtimeMs: probeMtime,
		}),
		write: async () => {
			writes += 1;
		},
	});
	adoptBuffer({
		documentId: document.id,
		path: document.path,
		text: document.content,
		mtimeMs: document.readMtimeMs,
	});
	proposeBuffer(document.id, "# Clean\n\nAn edit.\n");
	const outcome = await saveBuffer(document.id);
	assert.deepEqual(outcome.status, "written");
	assert.equal(writes, 1);
});

test("the rounded baseline is the defect the exact probe fixes", async () => {
	const probeMtime = 1_759_000_000_123.4568;
	const document = libraryMarkdownDocument(ASSET, "# Clean\n", probeMtime);
	let writes = 0;
	setBufferPorts({
		probe: async () => ({
			exists: true,
			isFile: true,
			mtimeMs: probeMtime,
		}),
		write: async () => {
			writes += 1;
		},
	});
	adoptBuffer({
		documentId: `${document.id}:rounded`,
		path: document.path,
		text: document.content,
		mtimeMs: Math.round(probeMtime),
	});
	proposeBuffer(`${document.id}:rounded`, "# Clean\n\nAn edit.\n");
	const outcome = await saveBuffer(`${document.id}:rounded`);
	assert.equal(outcome.status, "blocked");
	assert.equal(outcome.fact, "disk-changed");
	assert.equal(writes, 0);
});
