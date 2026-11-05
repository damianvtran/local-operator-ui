/**
 * The scanner and the sniffer: metadata extraction, format detection, dimensions.
 *
 * Everything here is a pure function over bytes, which is what makes it testable
 * without a network or an image decoder: the fixtures are hand-built HEADERS, not
 * pictures, because the property under test is that this code reads headers and
 * never decodes.
 *
 * The three refusals that matter are pinned here: HTML is HTML only when the bytes
 * say so, an image is an image only when the bytes say so, and a truncated header
 * yields `null` rather than an exception.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { bundleMainModules } from "./link-preview-bundle.mjs";

const mod = await import(
	await bundleMainModules("link-preview-parse", [
		"src/main/link-preview/sniff.ts",
		"src/main/link-preview/metadata.ts",
		"src/main/link-preview/dimensions.ts",
	])
);

const utf8 = (text) => new TextEncoder().encode(text);

/** A PNG header: signature, IHDR length, "IHDR", width, height, five more bytes. */
function pngHeader(width, height) {
	const bytes = new Uint8Array(29);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);
	writeU32(bytes, 16, width);
	writeU32(bytes, 20, height);
	bytes.set([0x08, 0x06, 0x00, 0x00, 0x00], 24);
	return bytes;
}

function writeU32(bytes, offset, value) {
	bytes[offset] = (value >>> 24) & 0xff;
	bytes[offset + 1] = (value >>> 16) & 0xff;
	bytes[offset + 2] = (value >>> 8) & 0xff;
	bytes[offset + 3] = value & 0xff;
}

/** A JPEG with a SOF0 marker stating the frame size. */
function jpegHeader(width, height) {
	const bytes = new Uint8Array(24);
	bytes.set([0xff, 0xd8], 0);
	bytes.set([0xff, 0xc0], 2);
	bytes.set([0x00, 0x11], 4);
	bytes[6] = 0x08;
	bytes[7] = (height >>> 8) & 0xff;
	bytes[8] = height & 0xff;
	bytes[9] = (width >>> 8) & 0xff;
	bytes[10] = width & 0xff;
	return bytes;
}

/** A GIF's logical screen descriptor. */
function gifHeader(width, height) {
	const bytes = new Uint8Array(13);
	bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
	bytes[6] = width & 0xff;
	bytes[7] = (width >>> 8) & 0xff;
	bytes[8] = height & 0xff;
	bytes[9] = (height >>> 8) & 0xff;
	return bytes;
}

/** A WebP in its extended (VP8X) form, whose canvas is stored as size-1. */
function webpHeader(width, height) {
	const bytes = new Uint8Array(30);
	bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
	bytes.set([0x00, 0x00, 0x00, 0x00], 4);
	bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
	bytes.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
	const w = width - 1;
	const h = height - 1;
	bytes[24] = w & 0xff;
	bytes[25] = (w >>> 8) & 0xff;
	bytes[26] = (w >>> 16) & 0xff;
	bytes[27] = h & 0xff;
	bytes[28] = (h >>> 8) & 0xff;
	bytes[29] = (h >>> 16) & 0xff;
	return bytes;
}

test("the sniff names each real format, whatever a server calls it", () => {
	assert.equal(mod.sniffBytes(pngHeader(10, 10)), "png");
	assert.equal(mod.sniffBytes(jpegHeader(10, 10)), "jpeg");
	assert.equal(mod.sniffBytes(gifHeader(10, 10)), "gif");
	assert.equal(mod.sniffBytes(webpHeader(10, 10)), "webp");
	assert.equal(mod.sniffBytes(new Uint8Array([0, 0, 1, 0, 1, 0])), "ico");
});

test("HTML sniffs as HTML from a doctype, a tag or a leading comment", () => {
	assert.equal(mod.sniffBytes(utf8("<!doctype html><html><head>")), "html");
	assert.equal(mod.sniffBytes(utf8('  \n<html lang="en">')), "html");
	assert.equal(
		mod.sniffBytes(utf8("<!-- generator: x --><!DOCTYPE HTML><p>hi")),
		"html",
	);
	assert.equal(
		mod.sniffBytes(utf8('<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN">')),
		"html",
	);
});

test("a JSON or PDF body is not HTML, and an empty body is nothing", () => {
	assert.equal(mod.sniffBytes(utf8('{"title":"not a page"}')), null);
	assert.equal(mod.sniffBytes(utf8("%PDF-1.7\n")), null);
	assert.equal(mod.sniffBytes(utf8("plain words, no markup at all")), null);
	assert.equal(mod.sniffBytes(new Uint8Array(0)), null);
});

test("a UTF-8 BOM before the doctype still sniffs as HTML", () => {
	// The BOM is EF BB BF on the wire. Decoded one byte per character it is three
	// characters ("ï»¿"), never U+FEFF, so a scanner that tests the string instead
	// of the bytes rejects every BOM-prefixed page as "not a document".
	const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
	const page = utf8(
		"<!DOCTYPE html><html><head><title>x</title></head></html>",
	);
	const withBom = new Uint8Array(bom.length + page.length);
	withBom.set(bom, 0);
	withBom.set(page, bom.length);
	assert.equal(mod.sniffBytes(withBom), "html");

	// The BOM is a prefix, not a licence: the bytes after it must still be markup.
	const json = utf8('{"a":1}');
	const withBomJson = new Uint8Array(bom.length + json.length);
	withBomJson.set(bom, 0);
	withBomJson.set(json, bom.length);
	assert.equal(mod.sniffBytes(withBomJson), null);
});

test("SVG is not an image this module accepts", () => {
	assert.equal(
		mod.sniffBytes(utf8('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
		null,
	);
	assert.equal(mod.isAcceptedImageKind(null), false);
	assert.equal(mod.isAcceptedImageKind("html"), false);
	assert.equal(mod.isAcceptedImageKind("png"), true);
});

test("OpenGraph tags win, and the mime is derived from the sniff", () => {
	const html = utf8(`<!doctype html><html><head>
		<title>the &amp; title</title>
		<meta property="og:title" content="OG title &quot;quoted&quot;">
		<meta property="og:description" content="OG description">
		<meta property="og:site_name" content="Example">
		<meta property="og:image" content="/img/card.png">
		<link rel="icon" href="/favicon.ico">
	</head><body></body></html>`);
	const metadata = mod.extractMetadata(html);
	assert.equal(metadata.title, 'OG title "quoted"');
	assert.equal(metadata.description, "OG description");
	assert.equal(metadata.siteName, "Example");
	assert.equal(metadata.imageHref, "/img/card.png");
	assert.equal(metadata.iconHref, "/favicon.ico");
	assert.equal(mod.mimeForKind("png"), "image/png");
	assert.equal(mod.mimeForKind("ico"), "image/x-icon");
});

test("a non-ASCII title and description decode as UTF-8, not Latin-1", () => {
	// The mojibake this pins: decoding UTF-8 bytes as latin-1 renders ``Café`` as
	// ``CafÃ©``. Every accented, Cyrillic, Greek and Arabic page hit it.
	const metadata = mod.extractMetadata(
		utf8(`<!doctype html><html><head><title>Café — naïve</title>
		<meta property="og:description" content="“quoted” and é">
		<meta property="og:title" content="Café — naïve"></head></html>`),
	);
	assert.equal(metadata.title, "Café — naïve");
	assert.equal(metadata.description, "“quoted” and é");
});

test("a CJK title and description survive as themselves", () => {
	const metadata = mod.extractMetadata(
		utf8(`<!doctype html><html><head><title>日本語のページ</title>
		<meta property="og:description" content="これはテストです。">
		<meta property="og:site_name" content="例えサイト"></head></html>`),
	);
	assert.equal(metadata.title, "日本語のページ");
	assert.equal(metadata.description, "これはテストです。");
	assert.equal(metadata.siteName, "例えサイト");
});

test("a declared charset is honoured, and UTF-8 is the default", () => {
	// Latin-1 bytes for "Café" carry 0xE9, which is not valid UTF-8 - so a page
	// that declares windows-1252 must be decoded with its own decoder.
	const bytes = new Uint8Array([
		...utf8('<meta charset="windows-1252"><title>Caf'),
		0xe9,
		...utf8("</title>"),
	]);
	assert.equal(mod.extractMetadata(bytes).title, "Café");

	// The same bytes with no declaration at all fall back to UTF-8 and the
	// replacement character, rather than to a byte-per-character guess.
	const undeclared = new Uint8Array([
		...utf8("<title>Caf"),
		0xe9,
		...utf8("</title>"),
	]);
	assert.equal(mod.extractMetadata(undeclared).title, "Caf\ufffd");

	// A charset on the Content-Type wins over the document's own declaration.
	assert.equal(
		mod.extractMetadata(
			new Uint8Array([
				...utf8('<meta charset="utf-8"><title>Caf'),
				0xe9,
				...utf8("</title>"),
			]),
			"text/html; charset=windows-1252",
		).title,
		"Café",
	);
});

test("og:image and an icon href are entity-decoded before they are fetched", () => {
	const metadata = mod.extractMetadata(
		utf8(`<html><head>
		<meta property="og:image" content="https://cdn.example.com/x.jpg?w=1200&amp;h=630">
		<link rel="icon" href="https://cdn.example.com/favicon.ico?a=1&amp;b=2">
		</head></html>`),
	);
	// The raw value would fetch a URL with a literal `&amp;`, which every CDN 404s.
	assert.equal(
		metadata.imageHref,
		"https://cdn.example.com/x.jpg?w=1200&h=630",
	);
	assert.equal(
		metadata.iconHref,
		"https://cdn.example.com/favicon.ico?a=1&b=2",
	);
});

test("twitter:* is the fallback when OpenGraph is absent", () => {
	const metadata = mod.extractMetadata(
		utf8(`<html><head><meta name="twitter:title" content="Twitter title">
		<meta name="twitter:description" content="Twitter description">
		<meta name="twitter:image" content="/t.png"></head></html>`),
	);
	assert.equal(metadata.title, "Twitter title");
	assert.equal(metadata.description, "Twitter description");
	assert.equal(metadata.imageHref, "/t.png");
});

test("a page with no usable tags has no metadata", () => {
	const metadata = mod.extractMetadata(
		utf8(
			'<html><head><script>var t=\'<meta property="og:title" content="fake">\';</script></head><body>hi</body></html>',
		),
	);
	assert.equal(metadata.title, null, "a script body is not a tag");
	assert.equal(mod.hasPreviewContent(metadata), false);
	assert.equal(
		mod.hasPreviewContent(
			mod.extractMetadata(utf8("<html><head></head></html>")),
		),
		false,
	);
});

test("a 512 KB body with a hundred thousand tags stays bounded", () => {
	const unit = '<div class="x">t</div>';
	const body = `<html><head><title>bounded</title></head><body>${unit.repeat(30000)}</body></html>`;
	const bytes = utf8(body);
	assert.ok(bytes.length > 300 * 1024, `fixture is ${bytes.length} bytes`);
	const started = process.hrtime.bigint();
	const metadata = mod.extractMetadata(bytes);
	const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
	assert.equal(metadata.title, "bounded");
	assert.ok(elapsedMs < 1500, `scan took ${elapsedMs.toFixed(1)} ms`);
});

test("dimensions come from each header, and a truncated one is null", () => {
	assert.deepEqual(mod.parseImageDimensions("png", pngHeader(640, 480)), {
		width: 640,
		height: 480,
	});
	assert.deepEqual(mod.parseImageDimensions("jpeg", jpegHeader(1200, 630)), {
		width: 1200,
		height: 630,
	});
	assert.deepEqual(mod.parseImageDimensions("gif", gifHeader(64, 32)), {
		width: 64,
		height: 32,
	});
	assert.deepEqual(mod.parseImageDimensions("webp", webpHeader(800, 600)), {
		width: 800,
		height: 600,
	});
	// Every truncation BELOW the format's own minimum is `null`, never a throw. The
	// minimum is where that format's size field ends: PNG's IHDR at 24 bytes, JPEG's
	// SOFn at 10, GIF's screen descriptor at 10, WebP's VP8X canvas at 30.
	for (const [kind, full, minimum] of [
		["png", pngHeader(640, 480), 24],
		["jpeg", jpegHeader(1200, 630), 10],
		["gif", gifHeader(64, 32), 10],
		["webp", webpHeader(800, 600), 30],
	]) {
		for (let length = 0; length < minimum; length += 1) {
			assert.equal(
				mod.parseImageDimensions(kind, full.subarray(0, length)),
				null,
				`${kind} truncated to ${length} bytes`,
			);
		}
	}
	assert.equal(
		mod.parseImageDimensions("ico", new Uint8Array([0, 0, 1, 0, 1, 0])),
		null,
	);
});

test("a closing tag before the metadata does not swallow it", () => {
	/*
	 * The real-page regression (MDN, measured): a document whose head opens with an
	 * inline `<script>…</script>` and then several `<script src=…></script>` tags
	 * before its `og:*` metas. Read as an opening `<script>`, a `</script>` skips
	 * forward to the NEXT script's end, so every tag after the first one vanished and
	 * a page with a full set of OpenGraph tags produced `no-metadata`.
	 */
	const html = utf8(`<!doctype html><html><head>
		<script>var theme = "light";</script>
		<script src="/a.js" type="module"></script>
		<script src="/b.js" type="module"></script>
		<link rel="icon" sizes="32x32" href="/favicon.ico">
		<meta name="description" content="A real description">
		<meta name="og:title" content="Real title">
		<meta name="og:image" content="/social.png">
	</head><body></body></html>`);
	const metadata = mod.extractMetadata(html);
	assert.equal(metadata.title, "Real title");
	assert.equal(metadata.description, "A real description");
	assert.equal(metadata.imageHref, "/social.png");
	assert.equal(metadata.iconHref, "/favicon.ico");
});
