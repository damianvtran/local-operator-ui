/**
 * The person's attachments as Files-view items (the pinned Attachments section).
 *
 * One `FinderItem` per attachment so the section reuses every Finder mechanism
 * the agent's files already have - virtualised bands, the Images tile grid,
 * keyboard walk, search/filter, the lightbox gallery and the shared action
 * menus - instead of a second list implementation beside it.
 *
 * WHICH DOCUMENT AN ATTACHMENT BECOMES decides which existing path its actions
 * ride, and that is the whole design of this module:
 *
 * - still at its ORIGIN (`present` with a path): a path document over the
 *   origin. Open/reveal/copy act on the real file, as for any agent file.
 * - origin gone but the store KEPT a copy (`retained`), or a picture with a
 *   digest: an artifact document over the digest. The thumbnail and lightbox
 *   paint by digest; open/reveal/copy-path resolve through `materialise`, which
 *   for an attachment copies the retained bytes out under the real name (the
 *   backend's `.../user-attachments/{digest}/materialise`). A non-media
 *   artifact opens in the canvas through that same copy (`canvas-file-viewer`'s
 *   existing artifact branch).
 * - BOTH gone (`gone`): a path document marked missing, so the row says so and
 *   the menu keeps only "Copy file path" - the record of where it was. A gone
 *   picture with no origin has nothing to act on, so it carries no menu.
 * - not yet answered (`unknown`, a live send before the re-read): drawn as a
 *   normal row, never as missing; a live picture paints from its inline bytes.
 */
import { t } from "@shared/i18n";
import { formatDate } from "../../../../../../i18n/format";
import type { UserAttachment } from "../../canonical/user-attachments";
import type { CanvasDocument } from "../../types/canvas";
import {
	canvasDocumentForArtifact,
	canvasDocumentForPath,
} from "../../utils/canvas-document";
import { getFileTypeFromPath } from "../../utils/file-types";
import { attachmentSizeLabel } from "../attachment-file-card";
import { buildFileRows } from "./file-rows";
import type { FinderItem } from "./finder-layout";

/** The id prefix that keeps an attachment's row distinct from an agent row of the same file. */
export const ATTACHMENT_ID_PREFIX = "attachment:";

function nameOf(item: UserAttachment): string {
	if (item.filename) return item.filename;
	return item.kind === "image"
		? t("ui.canvas.files.attachmentImage")
		: t("ui.chat.attachments.file_unnamed");
}

function documentFor(item: UserAttachment, sessionId: string): CanvasDocument {
	const name = nameOf(item);
	const base = {
		title: name,
		sizeBytes: item.bytes ?? undefined,
		lastAgentModified: item.ts || undefined,
	};
	/*
	 * A row the backend refuses to copy out (`materialisable: false`: a key, an
	 * `.env`) must not hand its ORIGIN path to the path actions either - Open
	 * file / Open folder / Copy file path on `~/.ssh/id_rsa` is the same reach
	 * the copy was refused for. So it never takes the path arm: with retained
	 * bytes it is a digest document (no path entries exist for one without a
	 * materialiser), and once gone it carries only its name, which the menu
	 * treats as "nothing to act on".
	 */
	/*
	 * A row not judged YET (`"pending"`, QA R6 Q3: the inventory is loading or
	 * failed, or a just-sent file awaits the re-read) is handled exactly like a
	 * refused one until the verdict lands: it could be the key.
	 */
	const refused =
		item.materialisable === false || item.materialisable === "pending";
	let document: CanvasDocument;
	if (item.availability === "gone" || (!item.digest && !item.data)) {
		document = canvasDocumentForPath((refused ? null : item.path) ?? name, {
			...base,
			/*
			 * A refused row with no stored bytes (`attachment: null`, review R4-U1)
			 * carries only its bare NAME, which the path actions would hand to the
			 * OS as a cwd-relative path. "missing" is the existing "nothing to act
			 * on" state, so it gets that too.
			 */
			availability:
				item.availability === "gone" || refused ? "missing" : undefined,
		});
	} else if (
		item.path &&
		!refused &&
		(item.availability === "present" || item.availability === "unknown") &&
		(item.kind === "document" || !item.digest)
	) {
		document = canvasDocumentForPath(item.path, base);
	} else if (item.digest) {
		document = canvasDocumentForArtifact({
			digest: item.digest,
			/*
			 * A picture sent as a FILE (`key-screenshot.png` dragged in) is still a
			 * picture. Only a refused or moved one reaches this arm, and kind `file`
			 * dropped it out of the tile grid into a glyph row while the same block,
			 * allowed, stayed a thumbnail (design R2 D11). The bytes route serves it
			 * (only materialise is refused), so it paints by digest like any tile.
			 */
			kind:
				item.kind === "image" || getFileTypeFromPath(name) === "image"
					? "image"
					: "file",
			sessionId,
			contentType: item.mimeType,
			name,
			...(item.bytes !== null ? { sizeBytes: item.bytes } : {}),
		});
		if (item.kind === "image" && !item.filename && document.artifact) {
			document.artifact = {
				...document.artifact,
				digest: item.digest,
				name: t("ui.canvas.files.attachmentImage"),
			};
		}
		// The digest names the bytes; the NAME's extension is what routes the
		// row to its kind group and its viewer (a PDF opens as a PDF once the
		// retained copy is materialised).
		document.title = name;
		if (item.kind === "document") document.type = getFileTypeFromPath(name);
	} else {
		// A pasted picture keeps the person's own name, never a hash or an English default:
		// this is the arm a just-sent screenshot takes before its bytes are stored (design D3).
		document = canvasDocumentForPath(
			`data:${item.mimeType};base64,${item.data}`,
			{
				...base,
				type: "image",
				title: name,
			},
		);
	}
	// One row per attachment even when two share a path or a digest: the id is
	// the attachment's own key, never the file's.
	return {
		...document,
		id: `${ATTACHMENT_ID_PREFIX}${item.key}`,
	};
}

/**
 * Which copy is left, or "" while the origin file is still in place. Kept
 * apart from `attachmentNote` so a renderer can tell a one-run status sentence
 * from the size/date pair, which must be two directional runs (an Urdu date
 * isolated together with "286 KB" resolves LTR and reads mirrored).
 */
export function attachmentStatus(item: UserAttachment): string {
	if (item.availability === "retained")
		return t("ui.canvas.files.attachmentRetained");
	/*
	 * A REFUSED row with no saved copy is inert (`gone`, U16) even while its
	 * original is still on disk, or when it never had one on disk (an inline
	 * paste) - and "Moved or deleted" was then a false fact (QA R6 Q5). Why it
	 * is inert is the refusal, so the note says that, in the sentence the
	 * tooltip, the focus line and Shift+F10 already use (no new copy). Only a
	 * refused row whose origin the backend saw missing keeps the gone sentence.
	 */
	if (
		item.availability === "gone" &&
		item.materialisable === false &&
		item.originExists !== false
	)
		return t("ui.canvas.files.attachmentRefused");
	if (item.availability === "gone") return t("ui.canvas.files.attachmentGone");
	return "";
}

/**
 * A canvas attachment row's tooltip, one whole message per line: identity,
 * then the status sentence, then - on a refused row - why it has no actions
 * (UX R2 U13). Separate lines, never a sentence joined in code, so each locale
 * keeps its own punctuation.
 *
 * The refusal line is skipped when the status line already IS that sentence
 * (review R7-2 / QA R7 Q7): a refused row with no saved copy takes the refusal
 * as its status (QA R6 Q5), and the tooltip said it twice.
 */
export function attachmentTooltipText(
	identity: string,
	status: string | null | undefined,
	refused: boolean,
): string {
	const lines = [identity];
	if (status) lines.push(status);
	const reason = t("ui.canvas.files.attachmentRefused");
	if (refused && status !== reason) lines.push(reason);
	return lines.join("\n");
}

/**
 * The meta line: what is left of the file, else its size and when it was sent.
 * Two block-free strings rather than a concatenated sentence (`" · "` is
 * English punctuation; the ICU message owns the separator per locale).
 */
export function attachmentNote(item: UserAttachment): string {
	const status = attachmentStatus(item);
	if (status) return status;
	const when = item.ts
		? formatDate(item.ts, { month: "short", day: "numeric" })
		: "";
	const size = attachmentSizeLabel(item.bytes);
	if (size && when) return t("ui.canvas.files.attachmentMeta", { size, when });
	return size ?? when;
}

export function attachmentFinderItems(
	items: readonly UserAttachment[],
	sessionId: string,
): FinderItem[] {
	const documents = items.map((item) => documentFor(item, sessionId));
	return buildFileRows(documents).map((row, index) => {
		const item = items[index];
		return {
			row: {
				...row,
				// A row the store still holds is not "missing" even though its origin
				// moved: the note says which copy is left, and the actions use it.
				missing: item.availability === "gone",
			},
			highlighted: false,
			why: "",
			created: item.ts ? item.ts / 1000 : null,
			modified: item.ts ? item.ts / 1000 : null,
			mentioned: item.ts,
			attachment: {
				key: item.key,
				digest:
					item.digest && item.availability !== "gone" ? item.digest : null,
				note: attachmentNote(item),
				status: attachmentStatus(item),
				/*
				 * A tile's caption is ~130-170 px wide, and the retained sentence cut
				 * to "Moved or deleted · s…" there, losing the half that matters
				 * (design R2 D10). Tiles say the card's own "Saved copy" instead; the
				 * full sentence stays in the tile's tooltip. Only retained pictures
				 * stay tiles (gone ones drop to rows), so that is the only case.
				 */
				tileStatus:
					item.availability === "retained"
						? t("ui.chat.attachments.saved_copy_label")
						: attachmentStatus(item),
				size: attachmentSizeLabel(item.bytes) ?? "",
				when: item.ts
					? formatDate(item.ts, { month: "short", day: "numeric" })
					: "",
				materialisable: item.materialisable,
			},
		};
	});
}

/**
 * Agent-file items minus the ones the person attached.
 *
 * The session-file ledger admits a user-row block that carries an artifact
 * `kind` (a kind-carrying pasted image) as a "mentioned" file, so the same
 * digest can arrive from BOTH sources. Attachments owns what the person
 * attached: the agent list drops its copy, and the counts below count each
 * digest once.
 */
export function withoutAttached<T>(
	items: readonly T[],
	digestOf: (item: T) => string | null | undefined,
	owned: ReadonlySet<string>,
): T[] {
	if (!owned.size) return [...items];
	return items.filter((item) => {
		const digest = digestOf(item);
		return !digest || !owned.has(digest);
	});
}

/**
 * The one Files count: agent files (less the digests Attachments owns) plus
 * the attachments. Used by the Files segment, the toolbar and the rail so the
 * three cannot disagree.
 */
export function combinedFileCount(
	agentTotal: number,
	agentDigests: Iterable<string | null | undefined>,
	attachments: { items: readonly { digest: string | null }[] },
): number {
	const owned = new Set(
		attachments.items
			.map((item) => item.digest)
			.filter((digest): digest is string => digest !== null),
	);
	let duplicates = 0;
	for (const digest of agentDigests)
		if (digest && owned.has(digest)) duplicates++;
	return Math.max(0, agentTotal - duplicates) + attachments.items.length;
}
