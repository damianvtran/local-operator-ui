/*
 * IS THIS PASTE'S TEXT JUST THE NAMES OF THE FILES IT CARRIES? (issue #1573)
 *
 * WHY THIS EXISTS. A file copied in Finder reaches Chromium's `paste` as file
 * item(s) AND a `text/plain` flavour that spells the file name(s) - one per line
 * for a multi-file copy. The composers attach the files, but a paste handler that
 * leaves the event alone lets the browser ALSO insert that text, so the prompt
 * gained "word.txt" beside the chip that already says it. The Team Bridge
 * handlers had the opposite blind spot: they kept the default whenever ANY
 * `text/plain` was present, reading every such paste as prose.
 *
 * THE CONSTRAINT, and why it is not "files present => drop the text". A paste can
 * genuinely carry prose and a file together (a rich copy from a page or a chat
 * app), and that prose is the reader's; discarding it would be a new data loss.
 * So the text is suppressed only when it says NOTHING beyond the files - every
 * non-empty line is one of the pasted files' names, given bare, as a path, or as
 * a `file://` URL (the `text/uri-list` spelling some sources put on the plain
 * flavour). Anything else, including a name with extra words around it, is kept.
 *
 * WHERE THE TEXT COMES FROM (QA round 1, Q1). On macOS a paste whose pasteboard
 * holds a file reaches the event as `types: ["Files"]` with `getData("text/plain")
 * === ""` - yet Chromium's default insert still types the pasteboard's plain
 * string. So the event's own `text/plain` is the first source when it is there,
 * and otherwise the pasteboard is read out of band, SYNCHRONOUSLY, through the
 * preload's `readPasteTextSync` (main's `clipboard.readText()`): the decision has
 * to be made before the handler returns, and deciding synchronously is what lets
 * the prose case keep the browser's own insert - and with it the field's undo.
 *
 * Shared by the chat composer (`MessageInput`, which the mini composer, project
 * quick-send and config composer also mount) and both Team Bridge paste
 * handlers, so the three cannot drift apart on what counts as "only the names".
 */

const LINE_BREAK = /\r\n|\r|\n/;
const PATH_SEPARATOR = /[\\/]/;
const FILE_URL = /^file:\/\//i;
/*
 * Only a line that LOOKS like a whole absolute path is reduced to its last
 * segment: `/...`, `~/...`, `C:\...` / `C:/...`, or a UNC `\\host\...`. A
 * relative-looking slash is prose ("see notes/shot.png"), and reducing it would
 * drop words the operator meant to paste (review round 1, R1).
 */
const ABSOLUTE_PATH = /^(?:\/|~\/|[A-Za-z]:[\\/]|\\\\)/;

/** The names of the files a clipboard payload carries, in clipboard order. */
export function clipboardFileNames(
	data: Pick<DataTransfer, "items" | "files"> | null | undefined,
): string[] {
	if (!data) return [];
	const names: string[] = [];
	// `items` before `files`, as `imageFiles` reads them: a browser paste can
	// expose a file only as an item, and reading both would double-count.
	if (data.items && data.items.length > 0) {
		for (const item of Array.from(data.items)) {
			if (item.kind !== "file") continue;
			const file = item.getAsFile();
			if (file?.name) names.push(file.name);
		}
		return names;
	}
	for (const file of Array.from(data.files ?? []))
		if (file.name) names.push(file.name);
	return names;
}

/**
 * The file name a line spells: the last segment of a `file://` URL (decoded) or
 * of an absolute path, else the line itself. NFC-normalized, because a
 * percent-encoded macOS URL is often NFD while `File.name` is NFC (review round
 * 1, R2).
 */
function lineBaseName(line: string): string {
	let value = line;
	if (FILE_URL.test(value)) {
		try {
			value = decodeURIComponent(new URL(value).pathname);
		} catch {
			// A malformed URL names no file; leave it as text so it is kept.
			return line.normalize("NFC");
		}
	} else if (!ABSOLUTE_PATH.test(value)) {
		return value.normalize("NFC");
	}
	const segments = value.split(PATH_SEPARATOR).filter(Boolean);
	return (segments.at(-1) ?? value).normalize("NFC");
}

/**
 * True when `text` is non-empty and every non-empty line of it is the name of
 * one of `fileNames` - the shape a Finder file copy puts on `text/plain`. Only
 * then may a paste handler that has taken the files cancel the browser's insert.
 */
export function pastedTextIsOnlyFileNames(
	text: string,
	fileNames: readonly string[],
): boolean {
	if (fileNames.length === 0) return false;
	const lines = text
		.split(LINE_BREAK)
		.map((line) => line.trim())
		.filter((line) => line !== "");
	if (lines.length === 0) return false;
	const names = new Set(fileNames.map((name) => name.normalize("NFC")));
	return lines.every((line) => names.has(lineBaseName(line)));
}

/** The preload seam `pasteInsertsOnlyFileNames` reads the pasteboard through. */
function readPasteTextSync(): string {
	if (typeof window === "undefined") return "";
	return window.api?.readPasteTextSync?.() ?? "";
}

/**
 * Whether a paste that carries files should have the browser's text insert
 * cancelled: yes when the text it would insert is empty or nothing but the
 * pasted files' names. The text is the event's `text/plain` when present, else
 * the pasteboard's plain string read synchronously (see the module comment) -
 * read ONLY here, inside a paste that carries files and no `text/plain`, so an
 * ordinary text paste never crosses to main. No preload (a plain browser, a
 * test without the seam) reads as `""`, i.e. cancel: the rule the Team Bridge
 * handlers always applied to a files-only payload.
 */
export function pasteInsertsOnlyFileNames(
	data: Pick<DataTransfer, "types" | "getData" | "items" | "files"> | null,
	readText: () => string = readPasteTextSync,
): boolean {
	if (!data) return false;
	const names = clipboardFileNames(data);
	if (names.length === 0) return false;
	const eventText = Array.from(data.types ?? []).includes("text/plain")
		? data.getData("text/plain")
		: "";
	const text = eventText !== "" ? eventText : readText();
	if (text.trim() === "") return true;
	return pastedTextIsOnlyFileNames(text, names);
}
