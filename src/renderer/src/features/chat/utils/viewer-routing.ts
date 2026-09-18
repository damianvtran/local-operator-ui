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
	 * Plain text is the app's own editor's business, and this branch is what
	 * makes that true.
	 *
	 * It used to fall through: `isCanvasSupported` answers from CodeMirror's
	 * language map (`config/canvas-supported-extensions.ts`), which carries no
	 * `.txt`, `.log` or `.text`, so a text file reached the final `null` and was
	 * handed to the OS (TextEdit) -- a session's scratch `.txt` note opened as a
	 * stranger's document instead of in the app's own editor. `textExtensions` is
	 * `file-kind.ts`'s own set, which is already what `fileKind` reports as
	 * `"text"` and what the prose scanner admits, so the extension list stays
	 * in one place. Placed above the `type` fallback because the PATH is the
	 * stronger evidence of format when the two disagree.
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
