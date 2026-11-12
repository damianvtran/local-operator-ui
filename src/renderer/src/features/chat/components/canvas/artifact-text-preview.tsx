import {
	RemoteFetchPendingError,
	fetchRemoteFileBlob,
} from "@features/chat/canonical/remote-file-transfer";
import { remoteUnreachableText } from "@features/chat/canonical/remote-files";
import {
	ATTACHMENT_RETRY_DELAYS_MS,
	AttachmentGoneError,
	AttachmentOwnerUnreachableError,
	fetchAttachmentBlob,
} from "@features/chat/canonical/use-attachment-url";
import type { CanvasDocument } from "@features/chat/types/canvas";
import { MAX_EAGER_READ_BYTES } from "@features/chat/utils/viewer-routing";
import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { getCodeMirrorTheme } from "@shared/themes/code-mirror-theme";
import { useAppearanceIsDark } from "@shared/themes/use-resolved-appearance";
import { loadLanguageExtensions } from "@shared/utils/load-language-extensions";
import CodeMirror from "@uiw/react-codemirror";
import { type FC, memo, useEffect, useMemo, useState } from "react";
import { FileViewerState } from "./file-viewer-state";

/**
 * A text-kind session artifact, shown READ-ONLY from the attachment store.
 *
 * WHY THIS EXISTS (PR #1452, UX R2 U12 / QA R4 Q1). A text attachment the
 * canvas cannot open from a file - one the backend refuses to copy out
 * (`materialisable: false`: an `.env`, a key) or one on an older backend with
 * no materialise route - opens by DIGEST. Only the media viewers knew how to
 * resolve a digest, so a text one fell through to `CodeEditor` with empty
 * content: the person was shown their `.env` as an empty file, could type into
 * it, and a save wrote a file literally named `artifact:<digest>` into the
 * app's cwd. The stored bytes are what the person sent and the daemon already
 * serves them (`GET .../attachments/<digest>`); showing them here is NOT the
 * copy-out the backend refused, because nothing reaches the disk or the OS.
 *
 * THE CONSTRAINTS that shape it, each one load-bearing:
 * - NO BUFFER. It never calls `adoptBuffer`: the buffer owner's commit port
 *   writes the text into the canvas store, which is persisted to localStorage,
 *   and a secret's bytes must not land there. Read-only is structural (no
 *   save path is wired), not only a CodeMirror flag; `saveBuffer` refuses an
 *   `artifact:` path as a second line of defence.
 * - The bytes live in component state only, fetched when the tab mounts.
 * - Above `MAX_EAGER_READ_BYTES` it states "too large" without fetching, the
 *   same ceiling the path-backed press applies to an eager text read.
 * - Bytes that are not UTF-8 text (a NUL byte, an invalid sequence) are not
 *   painted as mojibake: the viewer says the file could not be read.
 * - IT SAYS IT IS READ-ONLY (design R3 D14 / UX R3 U15). On the editor's own
 *   surface, with nothing else to tell them apart, typing that does nothing
 *   read as a broken editor. One muted caption sits in the slot the editable
 *   file's "Modified …" row occupies (so the two views keep one rhythm), in the
 *   Library read-only preview's classes and with no rule or fill (the
 *   borderless-chrome rules), and the active-line band - CodeMirror's "your
 *   cursor is here" cue - is off.
 *
 * A PEER-held text file (`document.remote`, no digest) opens here too (UX
 * round 1, U1-3): in the live editor its edits could never reach the owner and
 * the save failed silently. Its bytes come over the content route on mount,
 * its caption names the device, and nothing reaches the disk or the store -
 * which also retires the local-disk freshness strip that read "No longer on
 * disk" about a file that was never on this one (QA Q1-3).
 */
/** Nothing that implies an insertion point in a view that takes none (D14). */
const NO_INSERTION_CUES = {
	highlightActiveLine: false,
	highlightActiveLineGutter: false,
} as const;

const ArtifactTextPreviewComponent: FC<{
	document: CanvasDocument;
	/** The 504 backoff schedule for a remote read; a parameter for tests. */
	retryDelays?: readonly number[];
}> = ({ document, retryDelays = ATTACHMENT_RETRY_DELAYS_MS }) => {
	useI18nLocale();
	const artifact = document.artifact;
	const remote = document.remote ?? null;
	const tooLarge =
		typeof document.sizeBytes === "number" &&
		document.sizeBytes > MAX_EAGER_READ_BYTES;
	const [state, setState] = useState<
		| { status: "loading" }
		| { status: "ready"; text: string }
		| { status: "gone" }
		| { status: "unreadable" }
		| { status: "unreachable" }
		| { status: "pending" }
		| { status: "tooLarge" }
	>({ status: "loading" });
	// Bumped by Retry: the effect below reads again.
	const [attempt, setAttempt] = useState(0);
	// Re-read when the row's coordinates change, not on every document object.
	const remoteKey = remote ? `${remote.sessionId}/${remote.fileId}` : null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: `remoteKey` stands for the row's coordinates; a new `document` object for the same row must not re-fetch.
	useEffect(() => {
		if ((!artifact && !remote) || tooLarge) return;
		/* A new digest on a live instance never shows the previous file's text
		   while it loads (review R5-3; the canvas also remounts per tab). */
		setState({ status: "loading" });
		let live = true;
		const signal = { aborted: false };
		void (
			artifact
				? fetchAttachmentBlob(
						{
							sessionId: artifact.sessionId,
							childId: artifact.childId ?? null,
						},
						artifact.digest,
					)
				: /* The transcript tiles' backoff on a 504 (UX round 2, U2-1). */
					fetchRemoteFileBlob(document, { delays: retryDelays, signal })
		)
			.then(async (blob) => {
				/* The size gate above needs a listed size; a document without one
				   is held to the same ceiling once the body arrives (review R5-4). */
				if (blob.size > MAX_EAGER_READ_BYTES) {
					if (live) setState({ status: "tooLarge" });
					return;
				}
				const bytes = new Uint8Array(await blob.arrayBuffer());
				if (!live) return;
				if (bytes.includes(0)) return setState({ status: "unreadable" });
				try {
					const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
					setState({ status: "ready", text });
				} catch {
					setState({ status: "unreadable" });
				}
			})
			.catch((error: unknown) => {
				if (!live) return;
				setState({
					status:
						error instanceof AttachmentGoneError
							? "gone"
							: error instanceof RemoteFetchPendingError
								? "pending"
								: error instanceof AttachmentOwnerUnreachableError
									? "unreachable"
									: "unreadable",
				});
			});
		return () => {
			live = false;
			signal.aborted = true;
		};
	}, [artifact, tooLarge, remoteKey, attempt]);
	/* The editor's own theme resolution (`code-editor.tsx`), so a read-only
	   attachment and an editable file read as the same surface. */
	const isDark = useAppearanceIsDark();
	const extensions = useMemo(() => {
		const language = loadLanguageExtensions(document.title);
		return [getCodeMirrorTheme(isDark), ...(language ? [language] : [])];
	}, [document.title, isDark]);

	if (tooLarge || state.status === "tooLarge")
		return (
			<FileViewerState
				title={t("ui.canvas.files.tooLarge")}
				detail={document.title}
			/>
		);
	if (state.status === "loading")
		return (
			<FileViewerState
				quiet
				title={
					/* Every remote read is a fetch from the owner: name it (D1-3, U2-1). */
					remote && !artifact
						? t("ui.canvas.files.remoteFetching", {
								device: remote.deviceName,
							})
						: t("ui.common.viewer.opening")
				}
			/>
		);
	if (state.status !== "ready") {
		const retryable =
			remote !== null &&
			(state.status === "unreachable" || state.status === "pending");
		return (
			<FileViewerState
				title={
					state.status === "gone"
						? t("ui.canvas.files.gone")
						: state.status === "pending" && remote
							? /* The owner answered and is still sending: not "offline". */
								t("ui.canvas.files.remoteDownloadPending", {
									device:
										remote.deviceName ||
										t("ui.canvas.files.remoteDeviceFallback"),
								})
							: state.status === "unreachable" && remote
								? remoteUnreachableText(remote.deviceName)
								: t("ui.canvas.files.unreadable")
				}
				detail={document.title}
			>
				{retryable ? (
					<Button
						variant="secondary"
						size="sm"
						data-remote-text-retry=""
						onClick={() => setAttempt((value) => value + 1)}
					>
						{t("ui.canvas.files.retry")}
					</Button>
				) : null}
			</FileViewerState>
		);
	}
	return (
		<div
			className={cn("flex h-full min-h-0 grow flex-col")}
			data-artifact-readonly="true"
		>
			<p
				className={cn(
					/*
					 * `ps-2.5`, not `px-2`: the editable view's "Modified …" stamp sits
					 * inside the band's `px-2` plus its region's `p-0.5`, and switching
					 * between the two tabs nudged the line 2 px (design R4 D19).
					 */
					"flex h-8 shrink-0 items-center truncate ps-2.5 pe-2 text-meta text-ink-muted",
				)}
			>
				{remote
					? t("ui.canvas.files.remoteReadOnly", { device: remote.deviceName })
					: t("ui.canvas.files.attachmentReadOnly")}
			</p>
			<div className={cn("relative min-h-0 grow overflow-auto text-mono")}>
				<CodeMirror
					value={state.text}
					height="100%"
					theme="none"
					editable={false}
					readOnly
					basicSetup={NO_INSERTION_CUES}
					extensions={extensions}
				/>
			</div>
		</div>
	);
};

export const ArtifactTextPreview = memo(ArtifactTextPreviewComponent);
