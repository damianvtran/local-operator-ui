/**
 * The in-app reader for a project attachment.
 *
 * WHY A DIALOG AND NOT THE OS/CANVAS. The project surface deliberately has no
 * canvas pane (see `project-updates.tsx`'s header: a project is a record, not a
 * transcript with a workspace beside it), so the two doors the rest of the app
 * has — "open in canvas" and "open in the OS app" — are not one affordance with
 * two labels here. A markdown note is the thing the agent WROTE, and handing it
 * to TextEdit loses the app's own `.lo-markdown` treatment and takes the reader
 * out of the feed to read a two-line status note. So the in-app reader IS the
 * project surface's preview: a full-height dialog reading the stored file
 * through the same IPC bridge every viewer uses (`window.api.readFile`), with
 * markdown rendered by `ProjectMarkdown` (the project's own renderer) and plain
 * text (JSON, logs) shown in a `<pre>`.
 *
 * PDFs, spreadsheets and binary documents keep the established fallback: they
 * open in the OS application, because the project surface has no renderer for
 * them and a dialog that cannot draw a PDF is a promise the surface cannot keep.
 * The caller decides which door applies (`project-update-assets.tsx`); this
 * component only draws the readable ones.
 *
 * FAILURE IS THE FILE'S OWN SENTENCE, not a silent blank body: a stored copy is
 * a path on disk, so "it moved or was deleted" is the honest reading, and a
 * browser dev build has no bridge at all — a different fact, said differently.
 */

import { isMarkdownFile } from "@features/chat/utils/is-markdown-file";
import { Dialog, DialogContent, DialogTitle } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import type { FC } from "react";
import { useEffect, useState } from "react";
import type { DesktopProjectAttachment } from "../../../../../shared/desktop-control-contract";
import { ProjectMarkdown } from "../project-markdown";

type PreviewState =
	| { status: "loading" }
	| { status: "ready"; text: string }
	| { status: "error"; message: string };

export type ProjectFilePreviewDialogProps = {
	open: boolean;
	attachment: DesktopProjectAttachment | null;
	onClose: () => void;
};

/** The filename a header falls back to when the writer named nothing. */
const PATH_SEPARATOR_REGEX = /[/\\]/;
const fileName = (attachment: DesktopProjectAttachment): string => {
	if (attachment.name) return attachment.name;
	const parts = attachment.path.split(PATH_SEPARATOR_REGEX);
	return parts[parts.length - 1] || attachment.path;
};

/**
 * The same height budget the shared lightbox uses (`100vh - 104px`): the
 * dialog is the surface, so it takes the screen's height minus the two lanes a
 * modal needs — the close button's ring at the top and the frame's own margin
 * at the bottom. A feed entry is read at full height because a long markdown
 * note is the attachment, not a footnote to one.
 */
const DIALOG_BOX =
	"h-[min(90vh,calc(100vh-104px))] w-[min(760px,calc(100vw-104px))] max-w-none gap-0 p-0";

export const ProjectFilePreviewDialog: FC<ProjectFilePreviewDialogProps> = ({
	open,
	attachment,
	onClose,
}) => {
	useI18nLocale();
	const [state, setState] = useState<PreviewState>({ status: "loading" });
	const path = attachment?.path ?? null;
	const markdown = attachment
		? isMarkdownFile(attachment.name || attachment.path)
		: false;

	useEffect(() => {
		if (!open || path === null) return;
		let live = true;
		setState({ status: "loading" });

		const readFile = window.api?.readFile;
		if (typeof readFile !== "function") {
			setState({
				status: "error",
				message: t("ui.projects.project_updates.preview_unavailable"),
			});
			return;
		}

		void (async () => {
			try {
				const result = await readFile(path);
				if (!live) return;
				if (!result.success) {
					setState({
						status: "error",
						message:
							result.error instanceof Error
								? result.error.message
								: String(result.error),
					});
					return;
				}
				setState({ status: "ready", text: result.data });
			} catch (error) {
				if (!live) return;
				setState({
					status: "error",
					message: error instanceof Error ? error.message : String(error),
				});
			}
		})();

		return () => {
			live = false;
		};
	}, [open, path]);

	const name = attachment ? fileName(attachment) : "";

	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent className={DIALOG_BOX}>
				<div className="shrink-0 border-hairline border-b px-4 py-3 pr-12">
					<DialogTitle className="truncate text-title" title={path ?? ""}>
						{name}
					</DialogTitle>
				</div>
				<div
					className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
					data-project-file-preview=""
				>
					{state.status === "loading" ? (
						<p className="text-body-sm text-ink-muted">
							{t("ui.projects.project_updates.preview_loading")}
						</p>
					) : state.status === "error" ? (
						<p className="text-body-sm text-ink-muted">
							{t("ui.projects.project_updates.preview_failed", {
								name: String(name),
								detail: state.message,
							})}
						</p>
					) : markdown ? (
						<ProjectMarkdown>{state.text}</ProjectMarkdown>
					) : (
						<pre className="whitespace-pre-wrap font-mono text-ink text-mono-sm">
							{state.text}
						</pre>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
};

ProjectFilePreviewDialog.displayName = "ProjectFilePreviewDialog";
