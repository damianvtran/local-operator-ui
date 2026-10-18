/**
 * The session inventory's wire and renderer adapter (#2393 DESKTOP_API contract).
 * This is not another path scanner: capable backends decide membership, identity,
 * highlights and child containment. Unknown/remote rows must never be resolved
 * against this machine's cwd. Keep the wire facts next to their CanvasDocument
 * projection so every action uses the same owner, especially child attachments.
 */
import type { CanvasDocument, CanvasDocumentType } from "../types/canvas";
import { canvasDocumentForPath } from "../utils/canvas-document";

export type SessionFile = {
	id: string;
	ref:
		| { type: "path"; path: string }
		| { type: "artifact"; digest: string; content_type: string };
	name: string;
	kind: string;
	size_bytes: number | null;
	created_at: number | null;
	modified_at: number | null;
	width?: number | null;
	height?: number | null;
	duration_s?: number | null;
	origin: string;
	highlighted: boolean;
	highlight_why: string | null;
	first_seq: number;
	last_seq: number;
	/** Child sequence numbers are independent; this is the family chronology. */
	first_ts: number;
	last_ts: number;
	exists: boolean | null;
	session: {
		id: string;
		role: "self" | "subagent";
		child_id: string | null;
		label: string | null;
	};
};
export type FilesSort =
	| "recent"
	| "name"
	| "kind"
	| "modified"
	| "created"
	| "size";
export type SessionFilesPage = {
	state: "ready" | "building" | "unsupported";
	revision: number;
	total: number;
	counts: Record<string, number>;
	rows: SessionFile[];
	next_cursor: string | null;
	cursor_reset: boolean;
	stat_complete: boolean;
	scan: { covered_bytes: number; total_bytes: number };
};

const KIND: Record<string, CanvasDocumentType> = {
	csv: "spreadsheet",
	json: "code",
	image: "image",
	video: "video",
	audio: "audio",
	pdf: "pdf",
	markdown: "markdown",
	html: "html",
	text: "text",
	code: "code",
	document: "document",
	spreadsheet: "spreadsheet",
	presentation: "presentation",
	archive: "archive",
};

export function indexedDocument(
	row: SessionFile,
	parentSessionId: string,
): CanvasDocument {
	const type = KIND[row.kind] ?? "other";
	const metadata = {
		id: row.id,
		title: row.name,
		type,
		content: "",
		availability: row.exists === false ? ("missing" as const) : undefined,
		sizeBytes: row.size_bytes ?? undefined,
		lastAgentModified:
			row.modified_at === null ? undefined : row.modified_at * 1000,
	};
	if (row.ref.type === "path")
		return canvasDocumentForPath(row.ref.path, metadata);
	return {
		...metadata,
		// Transcript and index opens address one content identity, not two tabs.
		// Retain the service handle separately for path materialisation only.
		id: `artifact:${row.ref.digest}`,
		indexedFileId: row.id,
		path: `artifact:${row.ref.digest}`,
		artifact: {
			digest: row.ref.digest,
			/*
			 * Three media kinds now (sound phase): a sound keeps the digest, the
			 * content type and the duration the same way a clip does, and the row's
			 * seat picks its player off this kind rather than off the MIME - the
			 * wire's `kind` is the harness's own classification and is the one
			 * spelling both the Files list and the transcript agree on.
			 */
			kind:
				row.kind === "video"
					? "video"
					: row.kind === "image"
						? "image"
						: row.kind === "audio"
							? "audio"
							: "file",
			// Child bytes are served through the parent's children route, not through
			// a guessed child session on this device. Preserve its owner explicitly.
			sessionId: parentSessionId,
			childId: row.session.child_id,
			contentType: row.ref.content_type,
			name: row.name,
			sizeBytes: row.size_bytes ?? undefined,
			width: row.width ?? undefined,
			height: row.height ?? undefined,
			durationS: row.duration_s ?? undefined,
		},
	};
}

/** A new revision invalidates every previous page, even if it repeats IDs. */
export function mergeFilesPage(
	previous: SessionFile[],
	page: SessionFilesPage,
	revision: number | null,
): SessionFile[] {
	const base =
		page.cursor_reset || (revision !== null && revision !== page.revision)
			? []
			: previous;
	const result = new Map(base.map((row) => [row.id, row]));
	for (const row of page.rows) result.set(row.id, row);
	return [...result.values()];
}
