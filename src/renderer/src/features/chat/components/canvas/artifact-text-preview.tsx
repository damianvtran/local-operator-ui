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
 */
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
	>({ status: "loading" });
	useEffect(() => {
		if (!artifact || tooLarge) return;
		let live = true;
		void fetchAttachmentBlob(
			{ sessionId: artifact.sessionId, childId: artifact.childId ?? null },
			artifact.digest,
		)
			.then(async (blob) => {
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

	if (tooLarge)
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
			className={cn("relative h-full grow overflow-auto text-mono")}
			data-artifact-readonly="true"
		>
			<CodeMirror
				value={state.text}
				height="100%"
				theme="none"
				editable={false}
				readOnly
				extensions={extensions}
			/>
		</div>
	);
};

export const ArtifactTextPreview = memo(ArtifactTextPreviewComponent);
