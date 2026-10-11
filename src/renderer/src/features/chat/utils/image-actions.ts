import { mimeTypeForPath } from "./file-kind";

/**
 * Which actions a picture can honestly offer, and how its bytes resolve.
 *
 * WHY THIS MODULE EXISTS. Every picture in a conversation used to hide the same
 * file menu behind the same guard — `isLocalFile` in `image-attachment.tsx`,
 * which refuses `data:`, `blob:` and `http` — and that guard was right about the
 * actions it knew: a `blob:` handle is not a path, and offering "Open folder" on
 * one revealed the parent of a string nothing can resolve (the defect that got
 * the blob half added to the guard). What the guard produced was the gap this
 * feature closes: the pictures with NO disk path — everything the canonical
 * transcript renders, every agent-generated image, every durable screenshot —
 * had no actions at all, and the kinds that did work for (`data:` in the canvas
 * branch below) never got the chance.
 *
 * So the kinds and their honest action sets are declared ONCE, as data, in the
 * shape `link-actions.ts`'s toolbar model established: the menu component, the
 * surfaces that decide whether a trigger is warranted, and the tests that pin
 * the matrix all read the same table, and a kind added later cannot grow a
 * second opinion about itself in a component.
 *
 * The action set per kind is the FEATURE, so it is stated here rather than left
 * to the component's branches:
 *
 *   | kind           | actions                                                          |
 *   | -------------- | ---------------------------------------------------------------- |
 *   | path           | Show in canvas (when provided), Open file, Open folder,          |
 *   |                | Copy file path, Copy image                                       |
 *   | data           | Show in canvas (when provided), Copy image                       |
 *   | blob           | Copy image                                                       |
 *   | http(s)        | Copy image (only where the fetch can land), Copy image URL,      |
 *   |                | Open in browser                                                  |
 *   | other          | none — no trigger is rendered                                    |
 *
 * Two of those rows are decisions rather than descriptions and are argued where
 * they are returned (`imageActions`).
 */

/**
 * What a picture's source string IS, from the string alone.
 *
 * `path` is the two shapes the app's file bridge resolves without a cwd guess —
 * an absolute path or a `~`-relative one — plus the `file://` spelling of a
 * path. A relative token is `other` and deliberately NOT a path: a markdown
 * image's `./shot.png` resolves against the PAGE's origin, which names no file
 * this app can act on, and the linkifier refuses relative tokens for the same
 * reason (no cwd to guess).
 */
export type ImageSourceKind = "path" | "data" | "blob" | "http" | "other";

export const classifyImageSource = (source: string): ImageSourceKind => {
	if (source.startsWith("data:")) return "data";
	if (source.startsWith("blob:")) return "blob";
	if (source.startsWith("http://") || source.startsWith("https://")) {
		return "http";
	}
	if (source.startsWith("file://")) return "path";
	if (source.startsWith("/") || source.startsWith("~")) return "path";
	return "other";
};

/**
 * The ATTACHMENT spelling of the same question, and it is deliberately more
 * permissive than `classifyImageSource`: a conversation attachment carried a
 * path verbatim from whatever produced it, and the guard this replaces showed
 * the file menu for every spelling that was not a URL. So a token that is not
 * URL-shaped is handed to the bridge as a path — `openFile` has always resolved
 * one against main's cwd (`resolveUserPath`), relative spellings included.
 *
 * Markdown images use `classifyImageSource` instead, as their ADMISSION: a
 * relative `src` there is not a file reference this app may guess at, so it
 * gets no trigger rather than a menu of actions aimed at a guess.
 */
export const classifyAttachmentSource = (source: string): ImageSourceKind => {
	const kind = classifyImageSource(source);
	return kind === "other" ? "path" : kind;
};

/** One entry of the menu, by stable id (the component maps id -> icon). */
export type ImageActionId =
	| "open-file"
	| "show-in-canvas"
	| "open-folder"
	| "copy-file-path"
	| "copy-image"
	| "copy-image-url"
	| "open-in-browser";

export type ImageAction = {
	id: ImageActionId;
	label: string;
};

export type ImageActionsOptions = {
	/**
	 * Whether a canvas is in reach for THIS picture — a pane (or an equivalent
	 * handle) plus a conversation for the document to belong to. False where the
	 * surface has none, and false for the kinds whose bytes cannot make a
	 * document at all (see `blob` below).
	 */
	canShowInCanvas: boolean;
	/**
	 * The source string itself, for the one row whose answer depends on it: an
	 * `http(s)` picture's bytes are only fetchable from the origins the page's
	 * own CSP admits (`httpImageFetchable`).
	 */
	source: string;
};

const OPEN_FILE: ImageAction = { id: "open-file", label: "Open file" };
const SHOW_IN_CANVAS: ImageAction = {
	id: "show-in-canvas",
	label: "Show in canvas",
};
const OPEN_FOLDER: ImageAction = { id: "open-folder", label: "Open folder" };
const COPY_FILE_PATH: ImageAction = {
	id: "copy-file-path",
	label: "Copy file path",
};
const COPY_IMAGE: ImageAction = { id: "copy-image", label: "Copy image" };
const COPY_IMAGE_URL: ImageAction = {
	id: "copy-image-url",
	label: "Copy image URL",
};
const OPEN_IN_BROWSER: ImageAction = {
	id: "open-in-browser",
	label: "Open in browser",
};

/**
 * The entries this kind gets, in menu order.
 *
 * The labels of the shared-looking entries are the existing ones on purpose:
 * `Open file` / `Open folder` / `Copy file path` / `Show in canvas` are what
 * `file-actions-menu.tsx` already says on the surfaces this replaces nothing on,
 * and two spellings of one action is the defect the repo's own § 9 opens with.
 */
export function imageActions(
	kind: ImageSourceKind,
	{ canShowInCanvas, source }: ImageActionsOptions,
): ImageAction[] {
	const canvas = canShowInCanvas ? [SHOW_IN_CANVAS] : [];
	switch (kind) {
		case "path":
			return [...canvas, OPEN_FILE, OPEN_FOLDER, COPY_FILE_PATH, COPY_IMAGE];
		case "data":
			/*
			 * A `data:` URI carries its bytes in the string, and the canvas already
			 * has a branch that holds one (`image-attachment.tsx`'s
			 * `handleShowInCanvas`), so the canvas entry is kept where a caller
			 * provides the handle. `Copy image` is the new member.
			 */
			return [...canvas, COPY_IMAGE];
		case "blob":
			/*
			 * NO canvas entry, and that is a decision rather than an omission. A
			 * `blob:` handle is session-only while canvas documents persist to
			 * `localStorage` (`canvas-store.ts` has no `partialize`), so a document
			 * keyed by a blob URL paints the viewer's "could not be shown" state
			 * after every restart — the dead tab the canvas's own refusals exist to
			 * prevent, one restart away rather than one click away. The bytes ARE
			 * resolvable now, so `Copy image` is the honest member of the set; a
			 * durable canvas for digest-backed pictures is a follow-up that needs
			 * the attachment store's identity on the document, not a path this menu
			 * may fake.
			 */
			return [COPY_IMAGE];
		case "http":
			/*
			 * The copy-bytes entry is offered only where the page's own policy lets
			 * the bytes be fetched at all (see `httpImageFetchable`) — a fetch the CSP
			 * refuses throws and has no sentence to show. `Copy image URL` is a fact
			 * about the string. `Open in browser` is offered unconditionally, the
			 * same shape the link toolbar ships for a URL target: the external door
			 * (`src/main/window-guards.ts`) refuses loopback and private hosts WITH a
			 * sentence the press renders, so a refusal there is reported rather than
			 * silently dead — which is the one case the label still reads correctly.
			 */
			return [
				...(httpImageFetchable(source) ? [COPY_IMAGE] : []),
				COPY_IMAGE_URL,
				OPEN_IN_BROWSER,
			];
		case "other":
			return [];
	}
}

/**
 * Whether a trigger is warranted at all. The empty set renders no control, so
 * a surface asks this before it builds a wrapper — the same question in the
 * same place as the matrix.
 */
export const hasImageActions = (
	kind: ImageSourceKind,
	options: ImageActionsOptions,
): boolean => imageActions(kind, options).length > 0;

/**
 * Whether an `http(s)` picture's BYTES are fetchable from this renderer.
 *
 * The app's CSP (`src/renderer/index.html`) pins `connect-src` to its own
 * origins, the two loopback ports the backend answers on, and four named remote
 * origins (the API host and the analytics/auth hosts) - none of which serve
 * transcript pictures. So the predicate is "the origin is a loopback host on
 * one of the backend's two ports": every other origin keeps `Copy image URL`
 * and `Open in browser` (facts about the URL) without being offered a bytes
 * copy this page cannot perform.
 */
export function httpImageFetchable(source: string): boolean {
	try {
		const url = new URL(source);
		const loopback =
			url.hostname === "localhost" || url.hostname === "127.0.0.1";
		return loopback && (url.port === "1111" || url.port === "8080");
	} catch {
		return false;
	}
}

/** `file://` is a spelling of a path; the bridge and the OS doors speak bare. */
export const barePath = (source: string): string =>
	source.startsWith("file://") ? source.slice("file://".length) : source;

/**
 * Decode a `data:` URI's bytes without a fetch.
 *
 * A fetch of a `data:` URL is subject to `connect-src`, which does not name
 * `data:` — and this app's data URIs are generated in-document
 * (`data:${mime};base64,${payload}` in `use-attachment-url.ts`), so the payload
 * is right there and no network-shaped route is needed. Non-base64 payloads are
 * decoded as percent-encoded bytes, which is the other form the URI grammar
 * allows and the only one an image can honestly take.
 */
export function blobFromDataUrl(source: string): Blob {
	const comma = source.indexOf(",");
	if (comma === -1) throw new Error("Malformed data URL");
	const header = source.slice(5, comma);
	const payload = source.slice(comma + 1);
	const mimeType = header.split(";")[0] || "application/octet-stream";
	if (header.endsWith(";base64")) {
		const binary = atob(payload);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}
		return new Blob([bytes], { type: mimeType });
	}
	const text = decodeURIComponent(payload);
	const bytes = new Uint8Array(text.length);
	for (let index = 0; index < text.length; index += 1) {
		bytes[index] = text.charCodeAt(index);
	}
	return new Blob([bytes], { type: mimeType });
}

/**
 * The bytes `Copy image` puts on the clipboard, whatever the kind.
 *
 * Three routes, each for a reason the kind names:
 *
 * - `path` reads through the app's own bridge (`read-file-bytes`, the same door
 *   the viewers use), with the kind's MIME from the extension — the exact bytes
 *   on disk, capped at the bridge's 64 MiB ceiling;
 * - `data` decodes in memory (`blobFromDataUrl`) — no fetch, no CSP question;
 * - `blob` and `http` fetch the URL the picture is painted from. For `http` the
 *   call is only reachable where `httpImageFetchable` said the policy allows
 *   it; for `blob` the URL belongs to this document, which is the case the live
 *   evidence exercises end to end (the clipboard assertion in
 *   `docs/evidence/chat-image-actions/README.md`).
 *
 * Throws with a sentence a toast can carry; the caller decides how loud.
 */
export async function resolveCopyableImage(
	kind: ImageSourceKind,
	file: string,
	src?: string,
): Promise<Blob> {
	if (kind === "data") return blobFromDataUrl(file);
	if (kind === "blob" || kind === "http") {
		const response = await fetch(src ?? file);
		if (kind === "http" && !response.ok) {
			throw new Error(`The image server answered ${response.status}`);
		}
		return response.blob();
	}
	const read = window.api?.readFileBytes;
	if (typeof read !== "function") {
		throw new Error("This window cannot read local files");
	}
	const path = barePath(file);
	const result = await read(path);
	if (!result.success) {
		throw new Error(result.error ?? `Could not read ${path}`);
	}
	// The MIME is what the clipboard entry needs to be an IMAGE paste; the
	// extension is the same source the viewers take their type from
	// (`mimeTypeForPath`, `file-kind.ts`).
	return new Blob([result.data as BlobPart], {
		type: mimeTypeForPath(path),
	});
}
