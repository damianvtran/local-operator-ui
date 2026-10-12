/**
 * What a picture's action menu offers, per source kind — the per-kind matrix
 * and the byte-resolution behind `Copy image`, as PURE logic.
 *
 *     node --test scripts/image-actions.test.mjs
 *
 * WHY THIS FILE EXISTS. The operator's ask of 2026-10-11 was that hovering an
 * image offers its actions, and the honest hard half of that is not the menu's
 * markup: it is which actions each kind of picture may be offered. The menu that
 * shipped before this change was guarded by `isLocalFile`, so every picture the
 * canonical transcript draws — a durable `blob:` digest, a live `data:` URI —
 * had NO menu, while a path-backed one got file-shaped entries only. The kinds
 * and their action sets are declared once, as data, in
 * `src/renderer/src/features/chat/utils/image-actions.ts`; this file pins that
 * table, the two admission rules around it (a relative token is a path for an
 * attachment and NOT one for a markdown image), the byte-resolution the
 * `Copy image` entry performs, and the decision that sits between those bytes
 * and the clipboard — `needsPngEncode`, the clipboard's one writable image type
 * (2026-10-11: a JPEG written under its own MIME was refused with `Type
 * image/jpeg not supported on write.`, so everything non-PNG is encoded first).
 *
 * WHY THERE IS NO JSDOM OR REACT HERE (agent review round 1, R3). The MOUNTED
 * half — that the menu appears on the surfaces where it was missing — needs the
 * component bundle and a jsdom document, and the suite already pays for BOTH
 * `chat-image-expand.test.mjs`'s bundle and its document stack. This file's own
 * copy of that stack was measured as the extra weight that tipped the desktop
 * suite's memory bound (R3; the CI evidence is on the pull request), so the
 * renderer-side cases MOVED to `chat-image-expand.test.mjs`'s harness — one
 * component bundle from this delta in the whole suite — and what remains here
 * is the logic, bundled from the two PURE modules it pins (no jsdom, no react,
 * no components).
 *
 * ISOLATION. No app, no fork, no Electron, no window mode to name, synthetic
 * ids only; the one bridge stub is installed on a scratch `globalThis.window`
 * and removed in `finally`.
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = resolve(import.meta.dirname, "..");

/*
 * The SHIPPED modules, bundled: they reach each other through the path aliases
 * node's ESM resolver will not take (`@shared/…`). The entry is the PURE half
 * only — `image-actions.ts`, the cache it reads bytes from, and the type-only
 * import beside them — never a component, which is the whole point of the split
 * above.
 */
const CACHE = join(ROOT, "node_modules", ".cache", "image-actions");
const bundle = await build({
	stdin: {
		contents: `
			export {
				barePath,
				blobFromDataUrl,
				classifyAttachmentSource,
				classifyImageSource,
				hasImageActions,
				httpImageFetchable,
				imageActions,
				needsPngEncode,
				resolveCopyableImage,
			} from "./src/renderer/src/features/chat/utils/image-actions";
			export {
				blobAt,
				createBlobUrl,
				revokeBlobUrl,
			} from "./src/renderer/src/shared/lib/blob-url-cache";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	/* The aliases the two modules reach each other through. */
	alias: {
		"@assets": resolve(ROOT, "src/renderer/src/assets"),
		"@features": resolve(ROOT, "src/renderer/src/features"),
		"@renderer": resolve(ROOT, "src/renderer/src"),
		"@shared": resolve(ROOT, "src/renderer/src/shared"),
	},
	write: false,
});
mkdirSync(CACHE, { recursive: true });
const bundlePath = join(CACHE, "image-actions.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const {
	barePath,
	blobAt,
	blobFromDataUrl,
	classifyAttachmentSource,
	classifyImageSource,
	createBlobUrl,
	hasImageActions,
	httpImageFetchable,
	imageActions,
	needsPngEncode,
	resolveCopyableImage,
	revokeBlobUrl,
} = await import(pathToFileURL(bundlePath).href);

/* The assertion subjects the matcher lint wants hoisted (they are regexes
   ABOUT a claim, not per-run computation — the `UNTABBABLE_REVEAL` precedent). */
const MALFORMED_DATA_URL = /Malformed/;
const NO_FILE_AT_GONE = /No file at \/tmp\/gone\.png/;
const NOT_IN_THIS_WINDOW = /not available in this window/;
const MARKDOWN_IMG_ENTRY = /\bimg: MarkdownImage,/;
const MARKDOWN_IMG_IMPORT =
	/import \{ MarkdownImage \} from "\.\/markdown-image";/;

/* --------------------------------------------------------------------- matrix */

test("a source is classified by what it IS, not where it came from", () => {
	assert.equal(classifyImageSource("data:image/png;base64,AAAA"), "data");
	assert.equal(classifyImageSource("blob:http://localhost/abc"), "blob");
	assert.equal(classifyImageSource("http://localhost:1111/x.png"), "http");
	assert.equal(classifyImageSource("https://example.com/a.png"), "http");
	assert.equal(classifyImageSource("file:///tmp/a.png"), "path");
	assert.equal(classifyImageSource("/tmp/a.png"), "path");
	assert.equal(classifyImageSource("~/workspace/a.png"), "path");
	/*
	 * The refused shape: a relative token names no file this app can address —
	 * it would resolve against the PAGE's origin — and both admissions below
	 * hinge on this answer.
	 */
	assert.equal(classifyImageSource("shot.png"), "other");
	assert.equal(classifyImageSource("./assets/shot.png"), "other");
	assert.equal(classifyImageSource(""), "other");
});

test("an attachment token that is not URL-shaped is a path; a markdown one is not", () => {
	/*
	 * The attachment rule is the guard this menu replaces, spelled as data: the
	 * file menu showed for every spelling that was not `data:`/`blob:`/`http`,
	 * and `openFile` has always resolved such a token against main's cwd.
	 */
	assert.equal(classifyAttachmentSource("shot.png"), "path");
	assert.equal(classifyAttachmentSource("~/shot.png"), "path");
	assert.equal(classifyAttachmentSource("file:///tmp/a.png"), "path");
	// URL-shaped spellings are unchanged between the two rules.
	assert.equal(classifyAttachmentSource("data:image/png;base64,AA"), "data");
	assert.equal(classifyAttachmentSource("blob:x"), "blob");
	assert.equal(classifyAttachmentSource("https://e.test/a.png"), "http");
	// A markdown image's relative src is `other` — that ruling is the classifier's.
	assert.equal(classifyImageSource("shot.png"), "other");
});

test("the per-kind action table IS the feature", () => {
	const ids = (kind, canShowInCanvas, source = "") =>
		imageActions(kind, { canShowInCanvas, source }).map((a) => a.id);

	const canvas = true;
	const noCanvas = false;

	// A path-backed picture: the four file-shaped actions this menu inherits,
	// in the file menu's own order, plus the new byte action.
	assert.deepEqual(ids("path", canvas), [
		"show-in-canvas",
		"open-file",
		"open-folder",
		"copy-file-path",
		"copy-image",
	]);
	assert.deepEqual(ids("path", noCanvas), [
		"open-file",
		"open-folder",
		"copy-file-path",
		"copy-image",
	]);

	// A live `data:` URI: the canvas branch works today and is kept; the bytes
	// are in the string.
	assert.deepEqual(ids("data", canvas), ["show-in-canvas", "copy-image"]);
	assert.deepEqual(ids("data", noCanvas), ["copy-image"]);

	/*
	 * A durable `blob:` handle: `Copy image` ONLY. The canvas entry is absent by
	 * decision (a session-only handle would paint a dead tab after a restart
	 * because canvas documents persist), and the path entries by fact.
	 */
	assert.deepEqual(ids("blob", canvas), ["copy-image"]);
	assert.deepEqual(ids("blob", noCanvas), ["copy-image"]);

	/*
	 * An `http(s)` picture: the two entries that are facts about the URL, and
	 * the bytes entry only where the page's own CSP lets the fetch land
	 * (loopback) — the split every remote-URL case is.
	 */
	assert.deepEqual(ids("http", noCanvas, "http://localhost:1111/a.png"), [
		"copy-image",
		"copy-image-url",
		"open-in-browser",
	]);
	assert.deepEqual(ids("http", noCanvas, "https://example.com/a.png"), [
		"copy-image-url",
		"open-in-browser",
	]);

	// A relative token gets no menu, and no trigger is rendered for it.
	assert.deepEqual(ids("other", canvas, "shot.png"), []);
	assert.equal(
		hasImageActions("other", { canShowInCanvas: canvas, source: "" }),
		false,
	);
	// ... while every other kind does.
	assert.equal(
		hasImageActions("blob", { canShowInCanvas: canvas, source: "blob:x" }),
		true,
	);
});

test("the fetchability predicate is the CSP's own list", () => {
	assert.equal(
		httpImageFetchable("http://localhost:1111/v1/static/images?path=/a.png"),
		true,
	);
	assert.equal(httpImageFetchable("http://127.0.0.1:8080/x.png"), true);
	assert.equal(httpImageFetchable("http://localhost:3000/x.png"), false);
	assert.equal(httpImageFetchable("https://example.com/a.png"), false);
	/*
	 * The scheme is part of the list: the CSP spells its loopback sources as
	 * `http://` with an explicit port, so the `https:` spelling of the same host
	 * is NOT admitted — a predicate one scheme wider than the policy offers a
	 * copy that always fails (agent review round 1, R2).
	 */
	assert.equal(httpImageFetchable("https://localhost:1111/x.png"), false);
	assert.equal(httpImageFetchable("https://127.0.0.1:8080/x.png"), false);
	assert.equal(httpImageFetchable("not a url"), false);
});

/* -------------------------------------------------------------- byte routes */

test("barePath strips the file:// spelling and nothing else", () => {
	assert.equal(barePath("file:///tmp/a.png"), "/tmp/a.png");
	assert.equal(barePath("/tmp/a.png"), "/tmp/a.png");
	assert.equal(barePath("~/a.png"), "~/a.png");
});

test("only a PNG skips the clipboard transcode — the one image type the write accepts", () => {
	/*
	 * Chromium's sanitized async clipboard write takes `text/plain`, `text/html`
	 * and `image/png` and nothing else image-shaped (measured in the built app,
	 * 2026-10-11: `Type image/jpeg not supported on write.`), so every other
	 * type has to be re-encoded before the entry is built. This is the decision
	 * on its own; the ENCODE half (an `<img>` decoding the object URL, a canvas,
	 * `toBlob`) needs a real document, so it is proven by the `image-copy`
	 * scene's real-click run (`docs/evidence/image-copy/`) rather than faked in
	 * a jsdom harness that has no canvas and no image decoder.
	 */
	assert.equal(needsPngEncode("image/png"), false);
	for (const type of [
		"image/jpeg",
		"image/webp",
		"image/gif",
		"image/svg+xml",
		"",
		"application/octet-stream",
	]) {
		assert.equal(
			needsPngEncode(type),
			true,
			`needsPngEncode(${JSON.stringify(type)})`,
		);
	}
	/*
	 * The comparison is on the normalized spelling: a MIME carrying case or
	 * padding still skips the encode, because re-encoding a PNG could only lose
	 * pixels — the pass-through is the byte-exact path and nothing should leave
	 * it by accident.
	 */
	assert.equal(needsPngEncode("IMAGE/PNG"), false);
	assert.equal(needsPngEncode(" image/png "), false);
	/*
	 * A PARAMETERIZED spelling is deliberately on the encode side: it is not
	 * an exact match, so the bytes are re-encoded rather than written
	 * byte-for-byte. The write still succeeds - the entry is always
	 * `image/png` - and only byte-exactness is given up, the safe side of the
	 * rule (see `needsPngEncode`'s comment for why the same side is taken for
	 * case and padding).
	 */
	assert.equal(needsPngEncode("image/png;charset=utf-8"), true);
});

test("a data: URI decodes in memory — base64 and percent-encoded alike", async () => {
	const decoded = blobFromDataUrl("data:image/png;base64,AQID");
	assert.equal(decoded.type, "image/png");
	assert.deepEqual([...new Uint8Array(await decoded.arrayBuffer())], [1, 2, 3]);

	const text = blobFromDataUrl("data:image/svg+xml,%3Csvg/%3E");
	assert.equal(text.type, "image/svg+xml");
	assert.equal(await text.text(), "<svg/>");

	assert.throws(
		() => blobFromDataUrl("data:image/png;base64"),
		MALFORMED_DATA_URL,
	);
});

test("Copy image reads a path through the bridge, typed by extension", async () => {
	const calls = [];
	globalThis.window = {
		api: {
			readFileBytes: async (path, cap) => {
				calls.push([path, cap]);
				return {
					success: true,
					data: Uint8Array.from([1, 2, 3]),
					sizeBytes: 3,
				};
			},
		},
	};
	try {
		const blob = await resolveCopyableImage("path", "file:///tmp/a.png");
		// The bridge speaks bare paths, and no ceiling is passed: main's own
		// default (64 MiB) is the bound.
		assert.deepEqual(calls, [["/tmp/a.png", undefined]]);
		assert.equal(blob.type, "image/png");
		assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]);
	} finally {
		Reflect.deleteProperty(globalThis, "window");
	}
});

test("a bridge refusal rejects with the bridge's own sentence", async () => {
	globalThis.window = {
		api: {
			readFileBytes: async () => ({
				success: false,
				code: "not-found",
				error: "No file at /tmp/gone.png",
			}),
		},
	};
	try {
		await assert.rejects(
			() => resolveCopyableImage("path", "/tmp/gone.png"),
			NO_FILE_AT_GONE,
		);
	} finally {
		Reflect.deleteProperty(globalThis, "window");
	}
});

test("a blob: source resolves from the bytes this document built the URL from — no fetch (QA round 1, Q-1)", async () => {
	const bytes = Uint8Array.from([7, 8, 9]);
	const url = createBlobUrl(bytes, "image/png");
	const originalFetch = globalThis.fetch;
	/*
	 * The no-fetch claim, pinned where it is falsifiable: the renderer's CSP
	 * admits `blob:` for `img-src` and NOT for `connect-src`, so a fetch of the
	 * URL is refused by the page's own policy in the built app (measured, QA
	 * round 1 Q-1) — and the resolution must not attempt one at all. A fetch
	 * here fails the test by throwing.
	 */
	globalThis.fetch = () => {
		throw new Error("resolveCopyableImage must not fetch a blob: URL");
	};
	try {
		const blob = await resolveCopyableImage("blob", "blob:x", url);
		assert.equal(blob.type, "image/png");
		assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [7, 8, 9]);
	} finally {
		globalThis.fetch = originalFetch;
	}
	revokeBlobUrl(url);
	assert.equal(
		blobAt(url),
		null,
		"the shared revoke forgets the bytes in the same step as the URL",
	);
	await assert.rejects(
		() => resolveCopyableImage("blob", "blob:x", url),
		NOT_IN_THIS_WINDOW,
		"a URL this document did not build has no bytes to hand over, and says so",
	);
});

test("the shipped markdown renderer wires the image component in", () => {
	/*
	 * A SOURCE pin rather than a mount, and the reason is cost: importing
	 * `markdown-renderer.tsx` pulls mermaid, katex and the full remark/rehype
	 * stack into a test bundle — the weight `chat-link-affordances.test.mjs`
	 * already pays in the suite — for a claim that is one map entry. What the
	 * pin reads is the entry and its import, which is exactly what a dropped
	 * `img:` line would remove; the MOUNTED half of a markdown image's menu is
	 * `chat-image-expand.test.mjs`'s, and the rendered half on a real page is
	 * the evidence set's `markdown` state, whose capture refuses a frame
	 * without it.
	 */
	const source = readFileSync(
		join(
			ROOT,
			"src/renderer/src/features/chat/components/markdown-renderer.tsx",
		),
		"utf8",
	);
	assert.match(
		source,
		MARKDOWN_IMG_ENTRY,
		"MARKDOWN_COMPONENTS must map `img` to the shipped MarkdownImage",
	);
	assert.match(
		source,
		MARKDOWN_IMG_IMPORT,
		"and the map's entry must be imported",
	);
});
