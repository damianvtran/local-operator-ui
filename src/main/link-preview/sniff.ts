/**
 * What the bytes are, decided from the bytes.
 *
 * THE INVARIANT THIS FILE EXISTS FOR. A server's `Content-Type` is a claim, not a
 * fact: a hostile page can answer `text/html` with a PDF, and - the case that
 * matters more here - a `.png` URL can answer `image/png` with an HTML document
 * that the renderer would then have to trust as an image. So the SNIFF RESULT, not
 * the header, decides what this module parses and what it caches: HTML is parsed
 * only if the bytes sniff as HTML, and an image artifact is written only if its
 * bytes sniff as one of the five raster formats below. The header is never
 * consulted for that decision, and `image/svg+xml` is not in the accepted set at
 * all - an SVG is a document with a script-capable parser behind it, not a picture.
 *
 * Everything here inspects a bounded prefix. No decoder runs, nothing is
 * expanded, and a body that is not one of these shapes is simply `null`.
 */

export type SniffedKind = "html" | "png" | "jpeg" | "gif" | "webp" | "ico";

/** How much of a body the sniff looks at. HTML can start with a comment, a BOM,
 * whitespace and a doctype; 512 bytes is far more than that needs and is a
 * constant, so a body's size never changes this module's cost. */
const SNIFF_WINDOW = 512;

/** At most this many leading comments are skipped before the first tag. A page
 * that opens with an unbounded run of comments is not sniffed as HTML. */
const MAX_LEADING_COMMENTS = 8;

/** One character of HTML whitespace, tested per byte while skipping a prologue. */
const WHITESPACE = /\s/;

function startsWith(bytes: Uint8Array, offset: number, text: string): boolean {
	if (bytes.length < offset + text.length) return false;
	for (let index = 0; index < text.length; index += 1) {
		if (bytes[offset + index] !== text.charCodeAt(index)) return false;
	}
	return true;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
	let out = "";
	const end = Math.min(bytes.length, offset + length);
	for (let index = offset; index < end; index += 1) {
		out += String.fromCharCode(bytes[index] as number);
	}
	return out;
}

const HTML_LEADING_TAGS = [
	"<!doctype html",
	"<html",
	"<head",
	"<body",
	"<meta",
	"<title",
	"<link",
	"<script",
	"<style",
	"<div",
	"<p>",
	"<p ",
	"<h1",
	"<section",
	"<article",
	"<main",
	"<table",
	"<span",
	"<a ",
	"<!--",
] as const;

/** Whether the leading bytes look like an HTML document rather than text or a
 * binary file that happens to start with `<`. */
function sniffsAsHtml(bytes: Uint8Array): boolean {
	const window = asciiAt(bytes, 0, SNIFF_WINDOW).toLowerCase();
	let index = 0;
	// A UTF-8 BOM, then any run of whitespace.
	if (window.startsWith("\ufeff")) index = 1;
	while (index < window.length && WHITESPACE.test(window[index] as string))
		index += 1;
	const head = window.slice(index);
	if (!head.startsWith("<")) return false;
	// Skip leading comments, a page may put a generator banner above the doctype.
	let rest = head;
	for (let skipped = 0; skipped < MAX_LEADING_COMMENTS; skipped += 1) {
		if (!rest.startsWith("<!--")) break;
		const close = rest.indexOf("-->");
		if (close === -1) return false;
		rest = rest.slice(close + 3).trimStart();
	}
	return HTML_LEADING_TAGS.some((tag) => rest.startsWith(tag));
}

/**
 * Classify a body by its magic bytes.
 *
 * `null` means "none of the shapes this module handles": for a page that is a
 * refusal (`not-html`), for an image artifact it is a refusal too - the bytes are
 * not written to the cache and the card shows no picture.
 */
export function sniffBytes(bytes: Uint8Array): SniffedKind | null {
	if (bytes.length === 0) return null;
	if (startsWith(bytes, 0, "\x89PNG\r\n\x1a\n")) {
		return "png";
	}
	if (startsWith(bytes, 0, "\xff\xd8\xff")) return "jpeg";
	if (startsWith(bytes, 0, "GIF87a") || startsWith(bytes, 0, "GIF89a"))
		return "gif";
	if (startsWith(bytes, 0, "RIFF") && startsWith(bytes, 8, "WEBP"))
		return "webp";
	// ICO: 00 00 01 00. The cursor variant (00 00 02 00) is a different format
	// and is deliberately not accepted - a favicon is not a cursor.
	if (
		bytes.length >= 6 &&
		bytes[0] === 0x00 &&
		bytes[1] === 0x00 &&
		bytes[2] === 0x01 &&
		bytes[3] === 0x00
	) {
		return "ico";
	}
	if (sniffsAsHtml(bytes)) return "html";
	return null;
}

/** The mime type a sniffed kind is cached and served under. Derived from the
 * sniff, never from the server's header, so the two can never disagree. */
export function mimeForKind(kind: Exclude<SniffedKind, "html">): string {
	switch (kind) {
		case "png":
			return "image/png";
		case "jpeg":
			return "image/jpeg";
		case "gif":
			return "image/gif";
		case "webp":
			return "image/webp";
		case "ico":
			return "image/x-icon";
	}
}

/** The file extension an artifact is stored under. The extension is a function
 * of the sniffed kind, so a cache file's name says what its bytes are and never
 * what the server claimed. */
export function extensionForKind(kind: Exclude<SniffedKind, "html">): string {
	switch (kind) {
		case "png":
			return "png";
		case "jpeg":
			return "jpg";
		case "gif":
			return "gif";
		case "webp":
			return "webp";
		case "ico":
			return "ico";
	}
}

/** Whether an image artifact may be cached at all: the five raster formats the
 * product accepts. SVG is absent on purpose (see the file header). */
export function isAcceptedImageKind(
	kind: SniffedKind | null,
): kind is Exclude<SniffedKind, "html"> {
	return kind !== null && kind !== "html";
}
