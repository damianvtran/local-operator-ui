import type { CanvasDocument } from "@features/chat/types/canvas";
import {
	canvasDocumentForPath,
	stripFileUrl,
} from "@features/chat/utils/canvas-document";
import { getFileTypeFromPath } from "@features/chat/utils/file-types";
import { READ_ENCODING, viewerFor } from "@features/chat/utils/viewer-routing";
import { desktopRequest } from "@shared/api/local-operator/desktop-api";
import { useCanvasStore } from "@shared/store/canvas-store";
import { showErrorToast } from "@shared/utils/toast-manager";
import type { FC } from "react";
import { memo, useCallback, useMemo } from "react";
import { t } from "../../../../../../i18n";
import { indexedDocument } from "../../canonical/session-files";
import type { MentionScanHandle } from "../../canonical/use-mentioned-files";
import type { useSessionFiles } from "../../canonical/use-session-files";
import { materialiseUserAttachment } from "../../canonical/use-user-attachments";
import type { UserAttachmentsState } from "../../canonical/use-user-attachments";
import {
	attachmentDigests,
	canMaterialiseAttachment,
} from "../../canonical/user-attachments";
import {
	ATTACHMENT_ID_PREFIX,
	attachmentFinderItems,
	withoutAttached,
} from "./attachment-items";
import { buildFileRows } from "./file-rows";
import { FinderFilesView } from "./finder-files-view";
import type { FinderItem } from "./finder-layout";

type CanvasFileViewerProps = {
	sessionId?: string;
	cwd?: string;
	index: ReturnType<typeof useSessionFiles>;
	conversationId: string;
	// Callback to switch view in parent component
	onSwitchToDocumentView: (documentId: string) => void;
	/**
	 * The completeness state of the scan that produced this list, plus the action
	 * that fetches the messages it has not read yet.
	 *
	 * Optional because the panel is also rendered from Storybook fixtures and from
	 * a draft with no session, where there is no transcript to page and therefore
	 * nothing to say.
	 */
	scan?: MentionScanHandle | null;
	/** The person's attachments (the pinned section); see `useUserAttachments`. */
	attachments?: UserAttachmentsState | null;
};

const defaultFiles: CanvasDocument[] = [];

const CanvasFileViewerComponent: FC<CanvasFileViewerProps> = ({
	conversationId,
	sessionId,
	cwd,
	index,
	onSwitchToDocumentView,
	scan = null,
	attachments = null,
}) => {
	// Get files from the canvas store for this conversation
	const fallbackFiles = useCanvasStore((state): CanvasDocument[] => {
		const conv = state.conversations[conversationId];
		return conv?.mentionedFiles ?? defaultFiles;
	});

	const files = useMemo(
		() =>
			index.mode === "index"
				? index.rows.map((row) => indexedDocument(row, sessionId ?? ""))
				: index.mode === "fallback"
					? fallbackFiles
					: defaultFiles,
		[index.mode, index.rows, fallbackFiles, sessionId],
	);

	// Canvas store actions
	const setFiles = useCanvasStore((s) => s.setFiles);
	const setOpenTabs = useCanvasStore((s) => s.setOpenTabs);
	const setSelectedTab = useCanvasStore((s) => s.setSelectedTab);
	const setViewMode = useCanvasStore((s) => s.setViewMode);

	const rows = useMemo(() => buildFileRows(files), [files]);

	const handleFileClick = useCallback(
		async (fileDoc: CanvasDocument) => {
			const title = fileDoc.title;
			/*
			 * The document view does not have its own file list, it has one `files`
			 * array and one set of tabs, and this is the only place that appends to
			 * both. Both branches below used to carry a copy of this block, which is
			 * how the data-URI branch and the path branch drifted apart.
			 */
			const openDocument = (document: CanvasDocument) => {
				const state = useCanvasStore.getState();
				const conversationCanvasState = state.conversations?.[conversationId];
				const filesInState = conversationCanvasState?.files ?? [];
				const openTabsInState = conversationCanvasState?.openTabs ?? [];

				const index = filesInState.findIndex(
					(entry) => entry.id === document.id,
				);
				// Replace rather than skip: the entry on screen may hold stale bytes
				// from an earlier read of the same file.
				const updatedFiles =
					index !== -1
						? [
								...filesInState.slice(0, index),
								document,
								...filesInState.slice(index + 1),
							]
						: [...filesInState, document];
				setFiles(conversationId, updatedFiles);

				const existsTab = openTabsInState.some((tab) => tab.id === document.id);
				const updatedTabs = existsTab
					? openTabsInState
					: [...openTabsInState, { id: document.id, title: document.title }];
				setOpenTabs(conversationId, updatedTabs);
				setSelectedTab(conversationId, document.id);
				setViewMode(conversationId, "documents");
				onSwitchToDocumentView(document.id);
			};

			const fallbackAction = (err?: string) => {
				if (err) console.error("Error processing file:", err);
				// Fallback to OS open for non-canvas supported files
				try {
					if (fileDoc.path.startsWith("data:")) {
						console.warn(
							"Opening data URI with OS default is not directly supported here.",
							`${fileDoc.path.substring(0, 50)}...`,
						);
					} else {
						window.api.openFile(fileDoc.path);
					}
				} catch (error) {
					console.error("Error opening file natively:", error);
				}
			};

			/*
			 * One predicate for "can this open in-app, and where". It replaces two
			 * clauses asked in two orders - `isCanvasSupported(title) ||
			 * isSpreadsheetFile(title)` at each call site - which both asked the
			 * TITLE rather than the path, so a file whose name merely ended in
			 * `.md` routed on the name while its type came from the path.
			 *
			 * `null` is not an error: it is the documented downgrade to the OS.
			 */
			const kind = viewerFor(fileDoc.path, fileDoc.type);

			/*
			 * A session artifact opens BY DIGEST, before anything that assumes a
			 * path. There is nothing to probe (a stat of `artifact:<digest>` can only
			 * answer "missing"), nothing to read over the file bridge, and no OS
			 * fallback to hand it to (the OS cannot open a store entry). The viewer
			 * resolves the bytes itself from `document.artifact`, the way the
			 * transcript's own pictures do, so the document carries no content and
			 * nothing here can put a payload (or a `blob:` URL) into the persisted
			 * store. The store entry is the same document the row holds, so the tab
			 * and the Files row stay one identity.
			 */
			if (fileDoc.artifact) {
				openDocument({ ...fileDoc, content: "" });
				return;
			}

			if (fileDoc.path.startsWith("data:")) {
				// A data URI's own text IS its content, so it needs no read: the
				// bytes are already in the string.
				if (kind === null) return fallbackAction();
				openDocument(
					canvasDocumentForPath(fileDoc.path, {
						title,
						content: fileDoc.path,
						type: getFileTypeFromPath(title),
					}),
				);
				return;
			}

			/*
			 * Availability BEFORE the kind test.
			 *
			 * The two checks were in the other order, and that turned a click on a
			 * missing file whose type has no viewer into nothing at all: `kind ===
			 * null` handed it to the OS first, so a missing row that said `Open
			 * in default app` to nobody swallowed the click. A click must always
			 * produce something - a viewer, the OS, or a sentence.
			 *
			 * The probe is unconditional now, where it used to run only for a row
			 * that already knew its file was gone, and the extra `stat` buys three
			 * facts the document it opens needs: the mtime its bytes are being read
			 * at (both the freshness baseline the canvas checks against later and
			 * the blob cache's key), the size the viewers state "too large" from,
			 * and `availability`. The document's own copy of those is a reading
			 * taken when the mention was scanned, and the interval between that and
			 * this click is exactly when an agent writes the file.
			 */
			const normalizedPath = stripFileUrl(fileDoc.path);
			/*
			 * The bridge is absent in a browser build, and a click must still open what
			 * it can there: no probe answer is "nothing is known", which leaves the
			 * document without a freshness baseline rather than failing the click. The
			 * same shape `use-mentioned-files` asks its own probes with.
			 */
			const probe =
				typeof window.api?.probeFiles === "function"
					? ((await window.api.probeFiles([normalizedPath]))[0] ?? null)
					: null;
			const onDisk = Boolean(probe?.exists && probe.isFile);
			/*
			 * A probe that could not answer is UNKNOWN, not gone (remediation round 1,
			 * R1-2; QA round 1, Q1): a deadline fault under load fires on files that
			 * are there, so refusing the click on one would report "File no longer
			 * exists" on the strength of a stat that never happened. Unknown falls
			 * through to the open attempt below, which fails on its own terms if the
			 * file really is unreadable. A `null` probe (no bridge) still refuses a
			 * known-missing row as before.
			 */
			if (
				fileDoc.availability === "missing" &&
				!onDisk &&
				probe?.error === undefined
			) {
				showErrorToast(
					t("ui.canvas.file_viewer.file_no_longer_exists_at", {
						value: probe?.resolved ?? normalizedPath,
					}),
					{
						// What to do next, not only what happened: the path alone leaves
						// the reader with a three-line wrap and nowhere to go.
						description: t(
							fileDoc.id.startsWith(ATTACHMENT_ID_PREFIX)
								? "ui.canvas.files.attachmentGoneRecovery"
								: "ui.canvas.file_viewer.copy_its_path_from_the_row_s_menu_to_look_for_it_or_check_whether_the_ag",
						),
					},
				);
				return;
			}

			if (kind === null) return fallbackAction();

			/*
			 * `lastAgentModified` and `sizeBytes` are threaded through both branches
			 * below, and each is the difference between a promise and a fact:
			 *
			 * - `lastAgentModified` is the blob cache's key (`file:<path>:<mtime>`).
			 *   Both builders used to omit it, so every viewer key was
			 *   `file:<path>:0` and a re-opened tile kept serving the bytes from before
			 *   the agent rewrote the file.
			 * - `sizeBytes` lets a viewer state "too large to preview" from the probe's
			 *   own answer, before an IPC read the main process is going to refuse
			 *   anyway.
			 */
			const carried = {
				title,
				type: getFileTypeFromPath(normalizedPath),
				lastAgentModified: probe?.mtimeMs ?? fileDoc.lastAgentModified,
				/*
				 * The freshness baseline: the mtime these bytes are being read at. Only
				 * ever a probe answer - never `fileDoc.lastAgentModified`, which is
				 * also set to `Date.now()` by the attachment path, and a baseline in
				 * the future is a file that never looks new.
				 */
				readMtimeMs: probe?.mtimeMs ?? undefined,
				availability: onDisk ? ("present" as const) : undefined,
				sizeBytes: probe?.sizeBytes ?? fileDoc.sizeBytes,
			};

			const encoding = READ_ENCODING[kind];
			if (encoding === "bytes" || encoding === "range") {
				/*
				 * The viewer reads its own bytes (`pdf-preview`, `image-preview`,
				 * `audio-preview`, `video-preview`). Reading them here would put a
				 * whole document into the store - which is persisted to
				 * localStorage - for a file the user may close without ever seeing.
				 */
				openDocument(canvasDocumentForPath(normalizedPath, carried));
				return;
			}

			try {
				const result = await window.api.readFile(normalizedPath, encoding);
				if (!result.success) {
					const errorMessage = result.error
						? result.error instanceof Error
							? result.error.message
							: String(result.error)
						: t("ui.canvas.file_viewer.unknown_error_reading_file");
					return fallbackAction(errorMessage);
				}
				openDocument(
					canvasDocumentForPath(normalizedPath, {
						...carried,
						content: result.data,
					}),
				);
			} catch (error: unknown) {
				const message =
					error instanceof Error
						? error.message
						: String(
								error ?? t("ui.canvas.file_viewer.unknown_error_reading_file"),
							);
				return fallbackAction(message);
			}
		},
		[
			conversationId,
			setFiles,
			setOpenTabs,
			setSelectedTab,
			setViewMode,
			onSwitchToDocumentView,
		],
	);

	const attachmentItems = useMemo(
		() => attachmentFinderItems(attachments?.items ?? [], sessionId ?? ""),
		[attachments?.items, sessionId],
	);
	/*
	 * Attachments OWN what the person attached: the ledger also admits a
	 * kind-carrying pasted image as a "mentioned" file, so its agent-row copy is
	 * dropped here by digest (filtered AFTER the row/index pairing below, which
	 * is positional).
	 */
	const ownedDigests = useMemo(
		() =>
			attachmentDigests({
				items: attachments?.items ?? [],
				complete: true,
				truncated: false,
			}),
		[attachments?.items],
	);
	const pairedItems: FinderItem[] = rows.map((row, position) => {
		const entry = index.mode === "index" ? index.rows[position] : undefined;
		return {
			row,
			highlighted: entry?.highlighted ?? false,
			why: entry?.highlight_why ?? "",
			created: entry?.created_at ?? null,
			modified:
				entry?.modified_at ??
				(row.document.lastAgentModified === undefined
					? null
					: row.document.lastAgentModified / 1000),
			mentioned: entry?.first_ts ?? entry?.first_seq ?? position,
		};
	});
	const finderItems = withoutAttached(
		pairedItems,
		(item) => item.row.artifact?.digest,
		ownedDigests,
	);
	/*
	 * The ONE capability bit every attachment action keys off
	 * (`session_attachments`, read by `useUserAttachments`), the same one the
	 * transcript's pictures and sent-file card gate on. Absent state (a story, a
	 * standalone render) is NOT capable: offering an action that 404s is the
	 * defect round 1's F1 and round 2's R2-1 named.
	 */
	const attachmentsCapable = attachments?.capable ?? false;
	/*
	 * Attachment rows the backend refused to copy out (`materialisable: false`,
	 * core PR #3042 QA round 3, Q1), by row id: the open and materialise doors
	 * below get the same per-row verdict the row's menu does.
	 */
	const refusedIds = useMemo(
		() =>
			new Set(
				attachmentItems
					.filter((item) => item.attachment?.materialisable === false)
					.map((item) => item.row.document.id),
			),
		[attachmentItems],
	);
	const canCopyOut = (document: CanvasDocument): boolean =>
		canMaterialiseAttachment(
			attachmentsCapable,
			refusedIds.has(document.id) ? false : null,
		);
	const materialise = async (document: CanvasDocument): Promise<string> => {
		/*
		 * A USER ATTACHMENT copies out through its own route: the file index does
		 * not list the person's inputs, so its row id would 404. One routing point
		 * here serves both the row's path actions and the canvas open below.
		 */
		if (document.id.startsWith(ATTACHMENT_ID_PREFIX) && document.artifact) {
			// Fail closed: no row offers this on an older backend (R2-1) or for a
			// refused row (Q1), and a caller that slips through must not reach a
			// route that cannot (or will not) answer.
			if (!canCopyOut(document))
				throw new Error("Backend cannot materialise this attachment");
			if (!sessionId) throw new Error("No session for the attachment");
			return materialiseUserAttachment(sessionId, document.artifact.digest);
		}
		if (!sessionId || index.mode !== "index")
			throw new Error("No indexed artifact owner");
		const response = await desktopRequest({
			op: "sessions.files.materialise",
			sessionId,
			fileId: document.indexedFileId ?? document.id,
		});
		const body = (response.body as { result?: { path?: string } }).result;
		if (response.status !== 200 || !body?.path)
			throw new Error(t("ui.canvas.files.saveError"));
		return body.path;
	};
	return (
		<FinderFilesView
			items={finderItems}
			conversationId={conversationId}
			index={index.mode === "fallback" ? { ...index, state: "ready" } : index}
			legacyScan={scan}
			cwd={index.state === "unsupported" ? undefined : cwd}
			materialise={materialise}
			attachments={{
				items: attachmentItems,
				complete: (attachments?.complete ?? true) && !attachments?.truncated,
				state: attachments?.state ?? "ready",
				capable: attachmentsCapable,
				retry: attachments?.retry ?? (() => {}),
			}}
			onOpen={(document) => {
				/*
				 * A refused row with no stored bytes has nothing the app may show:
				 * its document is the bare name, and a probe or a "no longer exists"
				 * toast pointing at a menu it does not have would both be wrong
				 * (review R4-U1). Its tooltip says why. A refused row WITH bytes
				 * opens them read-only by digest (`ArtifactTextPreview`, U12).
				 */
				if (refusedIds.has(document.id) && !document.artifact) return;
				if (
					document.artifact &&
					// An attachment on an older backend (R2-1), or one the backend
					// refused to copy out (Q1), opens by digest in the artifact-aware
					// viewer instead.
					(canCopyOut(document) ||
						!document.id.startsWith(ATTACHMENT_ID_PREFIX)) &&
					document.type !== "image" &&
					document.type !== "video" &&
					// Audio is digest-backed too: materialising here loses its shared
					// identity and waveform before the artifact-aware preview opens.
					document.type !== "audio"
				) {
					void materialise(document)
						.then((path) =>
							handleFileClick(
								canvasDocumentForPath(path, {
									title: document.title,
									type: document.type,
								}),
							),
						)
						.catch(() =>
							showErrorToast(
								t("ui.canvas.file_viewer.ui_canvas_files_saveerror"),
							),
						);
				} else void handleFileClick(document);
			}}
		/>
	);
};

export const CanvasFileViewer = memo(CanvasFileViewerComponent);
