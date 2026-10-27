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
import { buildFileRows, sizeLabel } from "./file-rows";
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
	let document: CanvasDocument;
	if (item.availability === "gone" || (!item.digest && !item.data)) {
		document = canvasDocumentForPath(item.path ?? name, {
			...base,
			availability: item.availability === "gone" ? "missing" : undefined,
		});
	} else if (
		item.path &&
		(item.availability === "present" || item.availability === "unknown") &&
		(item.kind === "document" || !item.digest)
	) {
		document = canvasDocumentForPath(item.path, base);
	} else if (item.digest) {
		document = canvasDocumentForArtifact({
			digest: item.digest,
			kind: item.kind === "image" ? "image" : "file",
			sessionId,
			contentType: item.mimeType,
			name,
			...(item.bytes !== null ? { sizeBytes: item.bytes } : {}),
		});
		// The digest names the bytes; the NAME's extension is what routes the
		// row to its kind group and its viewer (a PDF opens as a PDF once the
		// retained copy is materialised).
		document.title = name;
		if (item.kind === "document") document.type = getFileTypeFromPath(name);
	} else {
		// A live picture whose bytes are still inline: the data URI IS the file.
		document = canvasDocumentForPath(
			`data:${item.mimeType};base64,${item.data}`,
			{ ...base, type: "image" },
		);
	}
	// One row per attachment even when two share a path or a digest: the id is
	// the attachment's own key, never the file's.
	return { ...document, id: `${ATTACHMENT_ID_PREFIX}${item.key}` };
}

/**
 * The meta line: what is left of the file, else its size and when it was sent.
 * Two block-free strings rather than a concatenated sentence (`" · "` is
 * English punctuation; the ICU message owns the separator per locale).
 */
export function attachmentNote(item: UserAttachment): string {
	if (item.availability === "retained")
		return t("ui.canvas.files.attachmentRetained");
	if (item.availability === "gone") return t("ui.canvas.files.attachmentGone");
	const when = item.ts
		? formatDate(item.ts, { month: "short", day: "numeric" })
		: "";
	const size = sizeLabel(item.bytes ?? undefined);
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
