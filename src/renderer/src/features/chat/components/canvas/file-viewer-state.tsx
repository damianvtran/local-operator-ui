import { Button, Tooltip } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { FileUp } from "lucide-react";
import type { FC, ReactNode } from "react";
/**
 * What a file viewer shows when it has no picture to show.
 *
 * One component rather than four copies, because the four viewers differ only
 * in how they paint a file and agree entirely on how they fail: a quiet centred
 * line, and — where an action would resolve the state — the action that does.
 * The states it exists for are the ones a viewer gets wrong by improvising:
 *
 * - **too large** is not an error to apologise for. The file is fine; the
 *   preview is what cannot hold it, so the state offers the app that can (the
 *   OS), which is the documented downgrade for anything we cannot render.
 * - **not found** is a fact the user may already know (they deleted it) and may
 *   not (the agent wrote into a temp directory). It names the path either way.
 * - **loading** is silent rather than a spinner wherever the wait is a local
 *   blob, which resolves in a frame or two — a spinner that appears for 30ms is
 *   a flash, not information.
 */

type FileViewerStateProps = {
	/** One sentence at heading weight: what is true, not what is missing. */
	title: string;
	/** The path or the reason, monospace because it is machine voice. */
	detail?: string | null;
	/** A spinner-free loading line. */
	quiet?: boolean;
	children?: ReactNode;
};

export const FileViewerState: FC<FileViewerStateProps> = ({
	title,
	detail,
	quiet = false,
	children,
}) => (
	/* The state is the pane's own body, so it wears the PANE's ground
	   (`canvas/index.tsx`) — the drawer's rung — rather than the conversation's
	   `canvas`: it was the ambient body the pane's root was, one layer down. */
	<div
		data-glass-region="pane-leaf"
		className={cn(
			"flex h-full flex-col items-center justify-center gap-2 bg-elevated p-6 text-center",
		)}
	>
		<p
			className={cn(quiet ? "text-body-sm text-ink-dim" : "text-body text-ink")}
		>
			{title}
		</p>
		{detail ? (
			<p className={cn("max-w-96 break-all text-mono-sm text-ink-dim")}>
				{detail}
			</p>
		) : null}
		{children ? (
			<div className={cn("mt-2 flex items-center gap-2")}>{children}</div>
		) : null}
	</div>
);

/**
 * The action every viewer's dead end offers: hand the file to the OS.
 *
 * `window.api.openFile` is the same call the Files grid's fallback uses, so a
 * file that cannot be previewed is opened the same way wherever it is clicked.
 */
export const OpenInOsButton: FC<{ path: string; label?: string }> = ({
	path,
	label = t("ui.canvas.file_viewer_state.open_in_default_app"),
}) => {
	useI18nLocale();
	return (
		<Button
			variant="secondary"
			size="sm"
			onClick={() => window.api.openFile(path)}
		>
			{label}
		</Button>
	);
};

/**
 * The one chrome bar the four media viewers share.
 *
 * They used to disagree — PDF and video carried a name bar with an action,
 * audio carried a name bar without one, and the image viewer had no bar at all,
 * so the picture began directly under the tab strip and there was no in-app way
 * to hand it to another application. Four viewers with three shapes reads as
 * unfinished, and branding.md asks for one idiom app-wide. So: a bar on
 * `surface` closed by a `hairline` rule, and the same `Open in default app`
 * action on all four.
 *
 * ## Why the bar no longer prints the file's name
 *
 * It used to, and the name was the THIRD copy of it on screen: the document's
 * tab reads `q1-invoice-review.pdf`, and in the live app the window title read it
 * too, so the most-seen 32 px of the panel stated a fact the strip directly above
 * it had already stated, in the same face, size and ink, 32 px higher (design
 * round 1, D3). Every viewer renders inside the document view, so the tab is
 * always there; the bar's real job is the action, and the name is not a
 * differentiator between two media surfaces — it is the same string twice.
 *
 * The path is still a prop because the action needs it, and it is optional
 * because a `data:` document has no file to hand anywhere; the action renders
 * only when there is something to open. `px-6` is the Files head's own inset, so
 * the panel's left and right content edges are one line across its Files tab and
 * its document tab (D6). A themed bar over a platform viewer is the boundary
 * branding.md draws for content the app does not own: our chrome, then the
 * document — and for the PDF viewer that boundary is wider than it looks, see
 * `pdf-preview`'s note on the platform's own field.
 */
export const ViewerChrome: FC<{
	path?: string | null;
	/**
	 * Extra controls, before the open action: the image viewer mounts its
	 * actions menu here (`image-preview.tsx`), so the menu sits beside the
	 * existing control rather than replacing it — the bar stays ONE idiom across
	 * the four media viewers, and a viewer with no children renders exactly what
	 * it rendered before.
	 */
	children?: ReactNode;
}> = ({ path, children }) => {
	useI18nLocale();
	const openable =
		typeof path === "string" && path.length > 0 && !path.startsWith("data:");
	return (
		<div
			/* A BAND, not an opaque bar (review round 1, F3 / QA Q2): this is the top
			 * chrome of the image, video, audio and PDF viewers, and an opaque
			 * `bg-surface` here was the remaining opaque island the surface pass set
			 * out to remove - live reading `rgb(43,39,33)` with no alpha. The band
			 * treatment is the same one the document freshness bar and sticky headers
			 * wear: the field overlay on glass, the flat role off it. */
			data-glass-plane="band"
			className={cn(
				"flex min-h-8 shrink-0 items-center justify-end gap-2",
				"border-hairline border-b bg-surface px-6 py-1.5",
			)}
		>
			{children}
			{openable && (
				<Tooltip content={t("ui.canvas.file_viewer_state.open_in_default_app")}>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.canvas.file_viewer_state.open_in_default_app")}
						onClick={() => window.api.openFile(path)}
					>
						<FileUp aria-hidden="true" />
					</Button>
				</Tooltip>
			)}
		</div>
	);
};
