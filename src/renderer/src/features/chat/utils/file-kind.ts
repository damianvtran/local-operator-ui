import type { CanvasDocumentType } from "@features/chat/types/canvas";

/**
 * The one place a file extension is classified.
 *
 * There were three, and they disagreed. `canvas-file-viewer.tsx:53-95` kept a
 * private image list (`.tiff .ico .heic .heif .avif .jfif .pjpeg .pjp`) and a
 * private video list; `utils/file-types.ts` kept a different image list that
 * stopped at `.svg` and a different video list that stopped at `.mkv`; and
 * `utils/is-spreadsheet-file.ts` and `utils/is-markdown-file.ts` each spelled
 * their own set again. The visible cost was a HEIC tile: the grid's `isImage`
 * said yes and painted a thumbnail, while `getFileTypeFromPath` said "other",
 * so the SAME file was an image to the tile and an unknown to the panel that
 * decided whether it could be opened. Every list here is a superset of both
 * spellings, so the two answers cannot disagree again.
 *
 * The lists are exported because a second consumer needs them as data rather
 * than as a predicate: `canonical/mentioned-files.ts` decides whether a bare
 * path found in prose is a file the app knows how to handle, and the honest way
 * to ask that question is "is its extension in the set we classify", not a
 * fourth copy of the extensions.
 */

/** Image extensions, unioned across the grid and the type classifier. */
export const imageExtensions = [
	"jpg",
	"jpeg",
	"png",
	"gif",
	"webp",
	"bmp",
	"svg",
	"tiff",
	"tif",
	"ico",
	"heic",
	"heif",
	"avif",
	"jfif",
	"pjpeg",
	"pjp",
] as const;

/** Video extensions. `.m4v .3gp .3g2` were in the grid's list only. */
export const videoExtensions = [
	"mp4",
	"webm",
	"ogg",
	"mov",
	"avi",
	"wmv",
	"flv",
	"mkv",
	"m4v",
	"3gp",
	"3g2",
] as const;

/** Audio extensions. */
export const audioExtensions = [
	"mp3",
	"wav",
	"aac",
	"flac",
	"m4a",
	"oga",
] as const;

/** Spreadsheet extensions, including `.tsv`, which only `file-types` had. */
export const spreadsheetExtensions = [
	"xls",
	"xlsx",
	"ods",
	"csv",
	"tsv",
] as const;

/** Word-processor documents — the ones the app hands to the OS. */
export const documentExtensions = [
	"doc",
	"docx",
	"odt",
	"rtf",
	"pages",
] as const;

/** Slide decks. */
export const presentationExtensions = ["ppt", "pptx", "odp", "key"] as const;

/** Archives: listed so a `.zip` is a known file, never opened in-app. */
export const archiveExtensions = ["zip", "tar", "gz", "rar", "7z"] as const;

/**
 * Extensions the canvas opens in `CodeEditor`.
 *
 * Not the same thing as `isCanvasSupported`, which is a 162-entry set of
 * CodeMirror language ids (`config/canvas-supported-extensions.ts`) — this list
 * is the small set `getFileTypeFromPath` reports as `"code"`, and the two are
 * consulted together by `viewer-routing.ts` so the wider set still wins.
 */
export const codeExtensions = [
	"js",
	"mjs",
	"cjs",
	"ts",
	"tsx",
	"jsx",
	"py",
	"java",
	"c",
	"h",
	"cpp",
	"cs",
	"go",
	"rb",
	"php",
	"sh",
	"bash",
	"zsh",
	"fish",
	"css",
	"scss",
	"less",
	"json",
	"jsonc",
	"xml",
	"yaml",
	"yml",
	"toml",
	"sql",
	"rs",
	"swift",
	"kt",
	"lua",
	"pl",
	"r",
	"dart",
	"scala",
	"clj",
	"ex",
	"exs",
	"vue",
	"svelte",
	"astro",
	"gradle",
	"ini",
	"cfg",
	"conf",
	"env",
] as const;

/** Plain-text extensions. `.txt` and `.log` are the ones the app refused before. */
export const textExtensions = ["txt", "log", "text"] as const;

/** Markdown extensions — the union of `is-markdown-file.ts` and `file-types.ts`. */
export const markdownExtensions = [
	"md",
	"markdown",
	"mdown",
	"mdx",
	"mkd",
	"mkdn",
] as const;

/** Hypertext extensions. */
export const htmlExtensions = ["html", "htm", "xhtml"] as const;

/** The one extension with a viewer of its own that is not a text format. */
export const pdfExtensions = ["pdf"] as const;

const toSet = (list: readonly string[]): ReadonlySet<string> =>
	new Set(list.map((ext) => ext.toLowerCase()));

const IMAGE = toSet(imageExtensions);
const VIDEO = toSet(videoExtensions);
const AUDIO = toSet(audioExtensions);
const SPREADSHEET = toSet(spreadsheetExtensions);
const DOCUMENT = toSet(documentExtensions);
const PRESENTATION = toSet(presentationExtensions);
const ARCHIVE = toSet(archiveExtensions);
const CODE = toSet(codeExtensions);
const TEXT = toSet(textExtensions);
const MARKDOWN = toSet(markdownExtensions);
const HTML = toSet(htmlExtensions);
const PDF = toSet(pdfExtensions);

/**
 * A file's extension in lower case, or `null` when it has none.
 *
 * A leading dot is not an extension: `.env` and `.gitignore` are dotfiles, not
 * files whose extension is "env"/"gitignore". `getFileTypeFromPath` could not
 * tell them apart — `split(".").pop()` on `/Users/x/.env` returns "env" — and
 * that is exactly the kind of typo a path scanner then reports as a file.
 * Multiple dots are fine: only the last segment counts, and a trailing dot
 * yields `null` rather than an empty string.
 */
export function extensionOf(path: string): string | null {
	const lastSeparator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	const name = path.slice(lastSeparator + 1);
	const dot = name.lastIndexOf(".");
	// `dot <= 0` covers both "no dot" and "the dot is the first character"
	// (a dotfile), and "name." (a trailing dot) leaves an empty extension.
	if (dot <= 0 || dot === name.length - 1) return null;
	return name.slice(dot + 1).toLowerCase();
}

/**
 * Every extension this app classifies, as one set.
 *
 * Built from the lists above rather than typed out again, so a new format is
 * added in one place and the prose scanner in `mentioned-files.ts` gains it for
 * free. `getFileTypeFromPath` is deliberately NOT the source: it returns
 * `"other"` for an unknown extension, which cannot be told apart from a real
 * `"other"` classification without reading its body.
 */
export const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set([
	...IMAGE,
	...VIDEO,
	...AUDIO,
	...SPREADSHEET,
	...DOCUMENT,
	...PRESENTATION,
	...ARCHIVE,
	...CODE,
	...TEXT,
	...MARKDOWN,
	...HTML,
	...PDF,
]);

/**
 * Classify a path by its extension, ignoring any data URI.
 *
 * The single implementation behind `getFileTypeFromPath`. Order matters only
 * where a list overlaps, and none of them do any more.
 */
export function fileKind(path: string): CanvasDocumentType {
	const ext = extensionOf(path);
	if (!ext) return "other";

	if (IMAGE.has(ext)) return "image";
	if (VIDEO.has(ext)) return "video";
	if (AUDIO.has(ext)) return "audio";
	if (PDF.has(ext)) return "pdf";
	if (MARKDOWN.has(ext)) return "markdown";
	if (HTML.has(ext)) return "html";
	if (SPREADSHEET.has(ext)) return "spreadsheet";
	if (DOCUMENT.has(ext)) return "document";
	if (PRESENTATION.has(ext)) return "presentation";
	if (ARCHIVE.has(ext)) return "archive";
	if (TEXT.has(ext)) return "text";
	if (CODE.has(ext)) return "code";

	return "other";
}

/**
 * The MIME type a local file's bytes should carry once they are a `Blob`.
 *
 * Not cosmetic. A blob with no type is what makes Chromium offer a PDF as a
 * download instead of rendering it: the frame's document is chosen from the
 * response's content type, and a `Blob` created without one presents
 * `application/octet-stream`. `static.ts` on the backend carries the same table
 * for the media routes; this is its renderer-side counterpart for the bytes the
 * viewers read over IPC, and it covers only the types those viewers handle.
 */
export function mimeTypeForPath(path: string): string {
	const extension = extensionOf(path);
	if (!extension) return "application/octet-stream";

	switch (extension) {
		case "pdf":
			return "application/pdf";
		case "png":
			return "image/png";
		case "jpg":
		case "jpeg":
		case "jfif":
		case "pjpeg":
		case "pjp":
			return "image/jpeg";
		case "gif":
			return "image/gif";
		case "webp":
			return "image/webp";
		case "bmp":
			return "image/bmp";
		case "svg":
			return "image/svg+xml";
		case "tiff":
		case "tif":
			return "image/tiff";
		case "ico":
			return "image/x-icon";
		case "avif":
			return "image/avif";
		case "heic":
		case "heif":
			return "image/heic";
		case "mp3":
			return "audio/mpeg";
		case "wav":
			return "audio/wav";
		case "aac":
			return "audio/aac";
		case "flac":
			return "audio/flac";
		case "m4a":
			return "audio/mp4";
		case "ogg":
		case "oga":
			return "audio/ogg";
		case "mp4":
		case "m4v":
			return "video/mp4";
		case "webm":
			return "video/webm";
		case "mov":
			return "video/quicktime";
		case "mkv":
			return "video/x-matroska";
		case "avi":
			return "video/x-msvideo";
		default:
			return "application/octet-stream";
	}
}
