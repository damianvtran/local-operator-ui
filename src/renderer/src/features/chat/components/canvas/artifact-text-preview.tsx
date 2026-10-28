import {
	AttachmentGoneError,
	fetchAttachmentBlob,
} from "@features/chat/canonical/use-attachment-url";
import type { CanvasDocument } from "@features/chat/types/canvas";
import { MAX_EAGER_READ_BYTES } from "@features/chat/utils/viewer-routing";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { getTheme } from "@shared/themes";
import { getCodeMirrorTheme } from "@shared/themes/code-mirror-theme";
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
 */
/** Nothing that implies an insertion point in a view that takes none (D14). */
const NO_INSERTION_CUES = {
	highlightActiveLine: false,
	highlightActiveLineGutter: false,
} as const;

const ArtifactTextPreviewComponent: FC<{ document: CanvasDocument }> = ({
	document,
}) => {
	useI18nLocale();
	const artifact = document.artifact;
	const tooLarge =
		typeof document.sizeBytes === "number" &&
		document.sizeBytes > MAX_EAGER_READ_BYTES;
	const [state, setState] = useState<
		| { status: "loading" }
		| { status: "ready"; text: string }
		| { status: "gone" }
		| { status: "unreadable" }
		| { status: "tooLarge" }
	>({ status: "loading" });
	useEffect(() => {
		if (!artifact || tooLarge) return;
		/* A new digest on a live instance never shows the previous file's text
		   while it loads (review R5-3; the canvas also remounts per tab). */
		setState({ status: "loading" });
		let live = true;
		void fetchAttachmentBlob(
			{ sessionId: artifact.sessionId, childId: artifact.childId ?? null },
			artifact.digest,
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
					status: error instanceof AttachmentGoneError ? "gone" : "unreadable",
				});
			});
		return () => {
			live = false;
		};
	}, [artifact, tooLarge]);
	/* The editor's own theme resolution (`code-editor.tsx`), so a read-only
	   attachment and an editable file read as the same surface. */
	const isDark = useUiPreferencesStore(
		(preferences) =>
			getTheme(preferences.themeName).theme.palette.mode === "dark",
	);
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
		return <FileViewerState quiet title={t("ui.common.viewer.opening")} />;
	if (state.status !== "ready")
		return (
			<FileViewerState
				title={
					state.status === "gone"
						? t("ui.canvas.files.gone")
						: t("ui.canvas.files.unreadable")
				}
				detail={document.title}
			/>
		);
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
				{t("ui.canvas.files.attachmentReadOnly")}
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
