import type { CanvasDocumentType } from "@features/chat/types/canvas";
import {
	audioExtensions,
	imageExtensions,
	pdfExtensions,
	textExtensions,
	videoExtensions,
} from "@features/chat/utils/file-kind";
import { isCanvasSupported } from "@features/chat/utils/is-canvas-supported";
import { isHtmlFile } from "@features/chat/utils/is-html-file";
import { isMarkdownFile } from "@features/chat/utils/is-markdown-file";
import { isSpreadsheetFile } from "@features/chat/utils/is-spreadsheet-file";

/**
 * Where a clicked file opens, decided once.
 *
 * `handleFileClick` used to ask two questions in two different orders —
 * `isCanvasSupported(title) || isSpreadsheetFile(title)` at one call site and
 * again at another — and both asked `title` rather than `path`, so a file whose
 * *name* happened to end in `.md` routed by the name while the panel's type
 * came from the path. One predicate, asked once, with the answer naming the
 * surface rather than merely whether the canvas would open it.
 *
 * `null` is not a failure: it is the instruction to hand the file to the OS,
 * which is the documented downgrade for a type the app has no viewer for.
 */
export type ViewerKind =
	| "markdown"
	| "html"
	| "spreadsheet"
	| "pdf"
	| "image"
	| "audio"
	| "video"
	| "code"
	| null;

/**
 * The ceiling on the bytes a press reads INTO the canvas document.
 *
 * One mebibyte, and the number is about the store rather than about reading:
 * `canvas-store` persists its documents to `localStorage` with no `partialize`,
 * so a document's `content` is a persisted string, base64 inflates it by about a
 * third, and the whole app shares a quota of roughly 5 MB.
 *
 * It lives HERE, beside `READ_ENCODING`, because it is a property of that table:
 * the eagerly-read kinds (`utf-8`/`base64`) are the ones a press reads itself, so
 * they are the only ones a ceiling can apply to, and the kinds that read their own
 * bytes (`bytes`/`range`: pdf, image, audio, video) are never capped. The two
 * readers are the press (`open-in-canvas.ts`, which REFUSES above it) and the link
 * toolbar (`link-actions.ts`, which must not offer a destination the press will not
 * reach); one exported number is what keeps those two answers from drifting apart.
 */
export const MAX_EAGER_READ_BYTES = 1024 * 1024;

/**
 * How the bytes reach the viewer, per kind.
 *
 * One map rather than a predicate per caller, because the two consumers ask the
 * same question from different ends: the click handler needs the encoding for
 * the kinds it reads eagerly (`utf-8`/`base64` into `content`, which is what the
 * editors and the spreadsheet grid already consumed), and the viewers need to
 * know which kinds read their own bytes.
 *
 * - `bytes` — the viewer calls `read-file-bytes` over IPC and holds an object
 *   URL (`use-file-blob-url.ts`). This is why a PDF's 40 MB never becomes a
 *   base64 string, never inflates by a third, and never lands in `localStorage`.
 * - `range` — video stays on the backend's static route. A video wants Range
 *   requests and partial reads, which Starlette's `FileResponse` implements and
 *   a blob URL does not: a blob would pull the whole file through structured
 *   clone. Images and audio take `bytes` instead, because the panel must keep
 *   working with the backend stopped.
 */
export const READ_ENCODING: Record<
	Exclude<ViewerKind, null>,
	"utf-8" | "base64" | "bytes" | "range"
> = {
	markdown: "utf-8",
	html: "utf-8",
	spreadsheet: "base64",
	code: "utf-8",
	pdf: "bytes",
	image: "bytes",
	audio: "bytes",
	video: "range",
};

const endsWithAny = (path: string, list: readonly string[]): boolean => {
	const lower = path.toLowerCase();
	return list.some((ext) => lower.endsWith(`.${ext}`));
};

/**
 * The extension set a document's own `type` stands in for, so a document built
 * from a data URI (no path extension) still routes.
 */
const TYPE_KINDS: Partial<Record<CanvasDocumentType, ViewerKind>> = {
	image: "image",
	video: "video",
	audio: "audio",
	pdf: "pdf",
	markdown: "markdown",
	html: "html",
	spreadsheet: "spreadsheet",
	code: "code",
	text: "code",
};

/**
 * Which surface opens `path`, or `null` for "hand it to the OS".
 *
 * Order is by specificity: the formats with a bespoke viewer first, then the
 * code editor, which is the "any other UTF-8-decodable file" branch.
 */
export function viewerFor(path: string, type?: CanvasDocumentType): ViewerKind {
	if (isMarkdownFile(path)) return "markdown";
	if (isHtmlFile(path)) return "html";
	if (isSpreadsheetFile(path)) return "spreadsheet";
	if (endsWithAny(path, pdfExtensions)) return "pdf";
	if (endsWithAny(path, imageExtensions)) return "image";
	if (endsWithAny(path, audioExtensions)) return "audio";
	if (endsWithAny(path, videoExtensions)) return "video";
	/*
	 * Text this app already classifies as `"text"` gets a viewer, which is what
	 * keeps the routing table self-consistent: `fileKind` answers `"text"` for
	 * `.txt`, `.log` and `.text`, a tile shows that type, and this function
	 * answered `null` — the documented "hand it to the OS" — for the same
	 * extension whenever the call carried no type at all.
	 *
	 * It is a GUARD rather than a fix to what a user sees, and that is worth
	 * stating because the shape invites the opposite reading. Both of this app's
	 * call sites pass the document's type (`canvas-file-viewer.tsx`'s click and
	 * `canvas-content.tsx`'s render), and a document's type is derived from its
	 * own path (`canvas-document.ts` → `getFileTypeFromPath` → `fileKind`), so for
	 * these extensions the type IS `"text"` and the `TYPE_KINDS` fallback below
	 * already answered `"code"`. Measured on the base commit before this branch:
	 * `viewerFor(path, "text")` was `code`, and the base app opened a `.txt` tile
	 * in its own editor with no OS handoff at all (QA round 1, PR #336). What the
	 * branch decides is the TYPE-LESS call, which is the shape this function's own
	 * contract — and its tests — are written in.
	 *
	 * `textExtensions` is `file-kind.ts`'s own set rather than a fourth copy of
	 * the extensions. It sits ABOVE the `type` fallback, so a document whose type
	 * disagrees with its path now routes by the PATH — deliberate, and pinned by a
	 * test: the path is the stronger evidence of the format, and in every
	 * production construction the type is derived from that same path.
	 */
	if (endsWithAny(path, textExtensions)) return "code";
	if (type && TYPE_KINDS[type]) return TYPE_KINDS[type] ?? null;
	// The CodeMirror language set is the widest "we can show this as text"
	// statement the app owns (162 extensions, including `.sql` and `.toml` that
	// `file-kind.ts` does not list), so it is the last gate before giving up.
	if (isCanvasSupported(path)) return "code";
	// A data URI has no extension to read, so anything reaching this point is
	// text as far as we can tell: `CodeEditor` shows the URI, which is the only
	// honest thing to do with bytes we cannot classify.
	if (path.startsWith("data:")) return "code";
	// Unknown extension: not our file. `handleFileClick` hands it to the OS,
	// which is the documented downgrade and the only path that never lies about
	// supporting the format.
	return null;
}
