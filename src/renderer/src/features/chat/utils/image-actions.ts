import { blobAt } from "@shared/lib/blob-url-cache";
import { isArtifactPath } from "./artifact-identity";
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
 *   | artifact       | Show in canvas (when provided), Save as..., Copy image (pictures |
 *   |                | only)                                                            |
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
export type ImageSourceKind =
	| "path"
	| "data"
	| "blob"
	| "http"
	| "artifact"
	| "other";

export const classifyImageSource = (source: string): ImageSourceKind => {
	/*
	 * `artifact:<digest>` is a session artifact's identity (`artifact-identity.ts`):
	 * generated media with bytes in the attachment store and no path anywhere. It
	 * is checked FIRST and by its exact shape, so it can neither fall through to
	 * `other` (and be mistaken for a relative path by `classifyAttachmentSource`)
	 * nor be offered the file-shaped actions that need a disk path.
	 */
	if (isArtifactPath(source)) return "artifact";
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
	| "expand-image"
	| "open-file"
	| "show-in-canvas"
	| "save-as"
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
	canExpand?: boolean;
	/** Explicit materialising path resolver present on Finder, never inferred from a digest. */
	artifactPathActions?: boolean;
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
	/**
	 * What the bytes are, for the `artifact` kind only: a video has a player and
	 * a download but no clipboard form, so `Copy image` is withheld from it - and
	 * a SOUND is the same case (a player, a download, no clipboard form), so the
	 * two non-picture kinds share the arm. Absent means a picture, which is every
	 * other kind's only possibility.
	 */
	mediaKind?: "image" | "video" | "audio";
};

const OPEN_FILE: ImageAction = { id: "open-file", label: "Open file" };
const SHOW_IN_CANVAS: ImageAction = {
	id: "show-in-canvas",
	label: "Show in canvas",
};
const SAVE_AS: ImageAction = { id: "save-as", label: "Save as\u2026" };
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
	{
		canShowInCanvas,
		source,
		mediaKind,
		artifactPathActions,
		canExpand,
	}: ImageActionsOptions,
): ImageAction[] {
	const canvas: ImageAction[] = [
		...(canShowInCanvas ? [SHOW_IN_CANVAS] : []),
		...(canExpand
			? [{ id: "expand-image" as const, label: "Expand image" }]
			: []),
	];
	switch (kind) {
		case "artifact":
			/*
			 * An artifact is bytes in the attachment store with no path, so the
			 * path-shaped entries (`Open file`, `Open folder`, `Copy file path`) are
			 * absent BY CONSTRUCTION, not hidden: there is nothing for them to act on
			 * until the file is materialised somewhere on disk. What the bytes DO
			 * support is offered: the canvas (the document carries the digest, which
			 * is the "attachment store's identity on the document" the `blob` case
			 * below said a durable canvas needs), a download through the platform's
			 * save dialog, and - for a picture - the clipboard.
			 */
			return [
				...canvas,
				...(artifactPathActions
					? [OPEN_FILE, OPEN_FOLDER, COPY_FILE_PATH]
					: []),
				SAVE_AS,
				...(mediaKind === "video" || mediaKind === "audio" ? [] : [COPY_IMAGE]),
			];
		case "path":
			return [
				...canvas,
				OPEN_FILE,
				OPEN_FOLDER,
				COPY_FILE_PATH,
				...(mediaKind === "video" || mediaKind === "audio" ? [] : [COPY_IMAGE]),
			];
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
			 *
			 * THE ONE EXCEPTION: a USER ATTACHMENT whose retained bytes the backend
			 * can copy out under a real name (`materialiseUserAttachment`). Its
			 * surface passes that resolver (`artifactPathActions`); the path entries
			 * then act on the copy and the canvas opens the copy - a real path, so
			 * the persisted tab survives a restart and the reason above holds.
			 */
			return artifactPathActions
				? [...canvas, OPEN_FILE, OPEN_FOLDER, COPY_FILE_PATH, COPY_IMAGE]
				: [COPY_IMAGE];
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
		/*
		 * THE SCHEME IS PART OF THE PREDICATE, and it is `http:` only. The CSP
		 * spells its loopback sources as `http://` with an explicit port; the
		 * `https://localhost:1111` spelling is a different origin that the policy
		 * does not admit, and a predicate one scheme wider than the policy offers
		 * a copy that always fails (agent review round 1, R2).
		 */
		const loopback =
			url.hostname === "localhost" || url.hostname === "127.0.0.1";
		return (
			url.protocol === "http:" &&
			loopback &&
			(url.port === "1111" || url.port === "8080")
		);
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
 * - `blob` reads the bytes the page itself built the URL from
 *   (`blob-url-cache.blobAt`) — the renderer's CSP admits `blob:` for `img-src`
 *   and NOT for `connect-src`, so `fetch(blobUrl)` is refused by the page's own
 *   policy before a request leaves (measured in the built app, QA round 1
 *   Q-1), and the fetch was never needed: the bytes are already in this
 *   document. A URL this document did not build has no bytes to hand over and
 *   says so rather than reaching for a fetch the policy refuses;
 * - `http` fetches the URL only where `httpImageFetchable` said the policy
 *   admits the origin, and answers a non-2xx with its status.
 *
 * Throws with a sentence a toast can carry; the caller decides how loud.
 */
export async function resolveCopyableImage(
	kind: ImageSourceKind,
	file: string,
	src?: string,
): Promise<Blob> {
	if (kind === "data") return blobFromDataUrl(file);
	if (kind === "blob") {
		const blob = blobAt(src ?? file);
		if (blob === null) {
			throw new Error("These image bytes are not available in this window");
		}
		return blob;
	}
	if (kind === "http") {
		const response = await fetch(src ?? file);
		if (!response.ok) {
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

/**
 * Whether a blob of this type has to be RE-ENCODED before the clipboard takes
 * it, i.e. whether it is anything but a PNG.
 *
 * THE RULE THIS ENCODES, measured in the built app (2026-10-11, the operator's
 * own report): Chromium's sanitized async clipboard write accepts exactly
 * `text/plain`, `text/html` and `image/png`. The menu used to pass the blob's
 * OWN type — `new ClipboardItem({ [blob.type || "image/png"]: blob })` — so
 * every non-PNG image in a conversation rejected with a DOMException ("Failed
 * to execute 'write' on 'Clipboard': Type image/jpeg not supported on write.")
 * that the catch turned into the same "Failed to copy image" toast the operator
 * saw six times, against PNGs that copied fine. The session that reported it
 * held 19 JPEGs.
 *
 * AN EDGE THE EXACT MATCH DECIDES, deliberately: a parameterized spelling
 * (`image/png;charset=utf-8`, reachable through an `http:` picture's response)
 * is not an exact match, so it takes the encode path. The write still succeeds
 * — the encoded entry is `image/png` — and only the byte-exact pass-through is
 * given up, which is the conservative side of the rule.
 *
 * PURE AND EXPORTED so the decision is testable without a DOM
 * (`scripts/image-actions.test.mjs`); `pngForClipboard` below is the one caller.
 */
export const needsPngEncode = (type: string): boolean =>
	type.trim().toLowerCase() !== "image/png";

/**
 * The bytes `Copy image` hands the clipboard: always a PNG, byte-exact when the
 * source already was one.
 *
 * WHY TRANSCODE AT ALL, and why the write cannot keep the blob's own MIME: see
 * `needsPngEncode` above — Chromium's sanitized write takes `image/png` and no
 * other image type. The PNG pass-through is deliberately BYTE-EXACT (no canvas
 * round trip): a re-encode of an already-writable picture could only lose
 * pixels, and the canvas route is the risky half.
 *
 * WHAT DECODES A NON-PNG, and why an `<img>` element rather than
 * `createImageBitmap`: the element decodes every format the transcript can
 * paint — including SVG and GIF, which `createImageBitmap` does not decode in
 * Chromium — and its `naturalWidth`/`naturalHeight` are the source's own size,
 * which the canvas is drawn at (`drawImage` at natural size, never a downscale).
 *
 * WHY THE CANVAS IS NOT TAINTED. An object URL mints a same-document resource,
 * so the canvas stays origin-clean and `toBlob` can read it back — the probe in
 * the built app validated this exact decode+canvas+toBlob path writing
 * successfully. (A URL this document did not create would taint it; that is one
 * more reason the bytes are taken from `resolveCopyableImage` rather than from
 * the picture's own URL.) The object URL is revoked in a `finally`, whoever
 * unwinds.
 *
 * THE LIMITS THAT ARE NOT SILENTLY WORKED AROUND, measured on this exact path
 * in the app's own Electron 44.3.0 (2026-10-12): a PER-SIDE maximum of 65,535
 * px and a TOTAL-AREA cap of 268,435,456 px² (2^28 — 16,384x16,384 encodes,
 * 16,385x16,384 answers null). Past either bound the context still comes back
 * but drawing is silently ignored (a red fill reads back as transparent) and
 * `toBlob` answers null, which is the throw below: the picture is REFUSED
 * rather than downscaled, because a clipboard entry that quietly shrank the
 * picture the user asked to copy would be the worse failure. The zero-size
 * guard is the same shape one step smaller: no bytes is not a picture, and a
 * write of one would reject with a DOMException instead of a sentence.
 *
 * Throws with a sentence the caller CAN surface; the menu's own catch logs it
 * and shows its fixed "Failed to copy image" copy today, so the user sees the
 * generic sentence while the specific one reaches the log.
 */
export async function pngForClipboard(blob: Blob): Promise<Blob> {
	if (blob.size === 0) throw new Error("This image has no bytes to copy");
	if (!needsPngEncode(blob.type)) return blob;
	const url = URL.createObjectURL(blob);
	try {
		const image = await decodeImage(url);
		if (image.naturalWidth === 0 || image.naturalHeight === 0) {
			throw new Error("This image could not be decoded for the clipboard");
		}
		const canvas = document.createElement("canvas");
		canvas.width = image.naturalWidth;
		canvas.height = image.naturalHeight;
		const context = canvas.getContext("2d");
		if (context === null) {
			throw new Error(
				"This window cannot re-encode the image for the clipboard",
			);
		}
		context.drawImage(image, 0, 0);
		const png = await new Promise<Blob | null>((resolve) => {
			canvas.toBlob(resolve, "image/png");
		});
		if (png === null) {
			throw new Error("This image could not be re-encoded for the clipboard");
		}
		return png;
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** Decode an object URL into a loaded `<img>` element, or reject with a message. */
function decodeImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () =>
			reject(new Error("This image could not be decoded for the clipboard"));
		image.src = url;
	});
}

/** See `downloadBlob`: how long the object URL outlives the click. */
const DOWNLOAD_REVOKE_DELAY_MS = 60_000;

/**
 * Hand bytes to the platform's save dialog.
 *
 * A `blob:` anchor with `download` is the one route the app's download guard
 * admits (`downloadVerdict`: only the app's own `blob:` exports from a trusted
 * document may write a file), and Electron answers it with the native save
 * dialog, so the user picks the destination and the app never names a path. The
 * mermaid diagram export uses the same anchor; it is not timing evidence for a
 * large generated clip.
 *
 * A zero-delay revoke left no margin for Chromium to consume a large blob
 * (review R1-3). Keep the handle alive for 60 seconds instead. This is a bounded
 * safety margin, not a claim about the native dialog's timing: OS save completion
 * is not observed here, and memory is bounded to one temporary blob per save.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = fileName;
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
	window.setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_REVOKE_DELAY_MS);
}
