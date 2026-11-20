/**
 * The clipped-row marker and its full-output viewer.
 *
 * A row the core clipped to its read's budget (`truncated` on a history entry,
 * core `docs/DESKTOP_API.md` "Clipped rows") is painted as its preview plus this
 * line beneath it: "Output truncated — showing X of Y" and an "Open full output"
 * action. The action opens a dialog that fetches the full row in ranges
 * (`clipped-row-model.ts` owns the procedure) with determinate progress and a
 * Cancel that aborts the read and drops what was collected.
 *
 * THE STATES, and why each is its own copy rather than a disabled button:
 * - `ref: null`: the row cannot be expanded on THIS device (a peer's row clipped
 *   by its owner). The line says so and offers no action; a button that can only
 *   fail is a dead button.
 * - `omitted`: a non-message row (a checkpoint, a supplement) whose payload was
 *   withheld whole. Its preview would be an empty block, so `ClippedRowPlaceholder`
 *   stands in for the row's body instead.
 * - final: the contract's 404 -> re-mint -> retry-once path failed. The preview
 *   is all there is, so the line drops the action for the rest of this mount.
 * - failed: anything else (transport, timeout, a malformed range) is retryable
 *   from the dialog.
 *
 * WHY A DIALOG and not inline expansion: the full row can be tens of MB, and
 * the transcript is one long virtual-free scroller; painting it in place would
 * bury the reader's position and keep the text alive for the life of the view.
 * The dialog holds it only while open.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Progress,
} from "@shared/components/ui";
import { formatBytes, t } from "@shared/i18n";
import {
	type FC,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	DesktopClippedRow,
	DesktopHistoryPage,
	DesktopHistoryRowRange,
} from "../../../../../shared/desktop-session-contract";
import {
	type ClippedRowProgress,
	type ClippedRowRequest,
	clippedRowDisplayText,
	fetchClippedRow,
} from "./clipped-row-model";
import { messageText } from "./transcript-reducer";

/** The app's request path; tests inject their own through `request`. */
export function desktopClippedRowRequest(sessionId: string): ClippedRowRequest {
	return {
		range: ({ ref, offset, limit }) =>
			desktopResult<DesktopHistoryRowRange>({
				op: "sessions.historyRow",
				sessionId,
				ref,
				offset,
				limit,
			}),
		remint: (rowId) =>
			desktopResult<DesktopHistoryPage>({
				op: "sessions.historyRowRef",
				sessionId,
				rowId,
			}),
	};
}

type ViewerState =
	| { kind: "loading"; progress: ClippedRowProgress }
	| { kind: "complete"; text: string }
	| { kind: "failed" };

export type ClippedRowMarkerProps = {
	rowId: string;
	marker: DesktopClippedRow;
	/**
	 * The parent conversation the row belongs to, or null when the row cannot be
	 * fetched from here (no scope, a contained child's transcript): both read
	 * as "cannot expand on this device", same as `ref: null`.
	 */
	sessionId: string | null;
	/** Injected in tests; defaults to the desktop request path. */
	request?: ClippedRowRequest;
};

export const ClippedRowMarker: FC<ClippedRowMarkerProps> = ({
	rowId,
	marker,
	sessionId,
	request,
}) => {
	const [open, setOpen] = useState(false);
	const [final, setFinal] = useState(false);
	const expandable = marker.ref !== null && sessionId !== null && !final;
	const total = formatBytes(marker.bytes_total);
	// Stable across re-renders: the viewer's read restarts when its request
	// changes, and the transcript repaints per token.
	const resolved = useMemo(
		() =>
			request ??
			(sessionId === null ? null : desktopClippedRowRequest(sessionId)),
		[request, sessionId],
	);
	return (
		<div
			data-clipped-row={rowId}
			data-clipped-state={
				final ? "final" : expandable ? "expandable" : "cannot-expand"
			}
			className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-muted"
		>
			<span>
				{expandable || final
					? t("ui.chat.clipped_row.marker", {
							shown: formatBytes(marker.shown_bytes),
							total,
						})
					: t("ui.chat.clipped_row.cannot_expand")}
			</span>
			{final ? <span>{t("ui.chat.clipped_row.final")}</span> : null}
			{expandable ? (
				<Button
					variant="link"
					size="sm"
					data-clipped-open=""
					onClick={() => setOpen(true)}
				>
					{t("ui.chat.clipped_row.open")}
				</Button>
			) : null}
			{open && resolved !== null ? (
				<ClippedRowViewer
					rowId={rowId}
					marker={marker}
					request={resolved}
					onClose={() => setOpen(false)}
					onFinal={() => {
						setFinal(true);
						setOpen(false);
					}}
				/>
			) : null}
		</div>
	);
};

/**
 * Stands in for an `omitted` row's body: the core withheld the payload whole,
 * so painting the record would draw an empty block. The marker beneath it
 * still offers the full row when it has a ref.
 */
export const ClippedRowPlaceholder: FC<ClippedRowMarkerProps> = (props) => (
	<div
		data-clipped-placeholder={props.rowId}
		className="rounded-sm border border-hairline border-dashed px-3 py-2"
	>
		<p className="text-body-sm text-ink-dim">
			{t("ui.chat.clipped_row.omitted", {
				total: formatBytes(props.marker.bytes_total),
			})}
		</p>
		<ClippedRowMarker {...props} />
	</div>
);

const ClippedRowViewer: FC<{
	rowId: string;
	marker: DesktopClippedRow;
	request: ClippedRowRequest;
	onClose: () => void;
	onFinal: () => void;
}> = ({ rowId, marker: openedWith, request, onClose, onFinal }) => {
	/*
	 * The marker as it was when the reader pressed Open. A re-read of the page
	 * rebuilds the record (and this object) without changing the row; keying
	 * the read on the object would restart a 13-range fetch on every repaint.
	 */
	const markerRef = useRef(openedWith);
	const marker = markerRef.current;
	const [state, setState] = useState<ViewerState>({
		kind: "loading",
		progress: { received: 0, total: marker.bytes_total },
	});
	const [attempt, setAttempt] = useState(0);
	const controller = useRef<AbortController | null>(null);
	const finalRef = useRef(onFinal);
	finalRef.current = onFinal;

	useEffect(() => {
		// `attempt` re-runs the read on Retry; it is read so the linter sees why.
		void attempt;
		const abort = new AbortController();
		controller.current = abort;
		setState({
			kind: "loading",
			progress: { received: 0, total: marker.bytes_total },
		});
		void fetchClippedRow({
			rowId,
			marker,
			request,
			signal: abort.signal,
			onProgress: (progress) => {
				if (!abort.signal.aborted) setState({ kind: "loading", progress });
			},
		}).then((outcome) => {
			if (abort.signal.aborted) return;
			if (outcome.kind === "complete")
				setState({
					kind: "complete",
					text: clippedRowDisplayText(outcome.text, messageText),
				});
			else if (outcome.kind === "final") finalRef.current();
			else if (outcome.kind === "failed") setState({ kind: "failed" });
		});
		// Unmount (Cancel, Close, Escape, the row leaving the view) aborts the read
		// and lets the collected bytes go with the closure.
		return () => abort.abort();
	}, [rowId, marker, request, attempt]);

	const cancel = useCallback(() => {
		controller.current?.abort();
		onClose();
	}, [onClose]);

	return (
		<Dialog open onOpenChange={(next) => (next ? undefined : cancel())}>
			<DialogContent className="flex max-h-[80vh] max-w-3xl flex-col">
				<DialogHeader>
					<DialogTitle>{t("ui.chat.clipped_row.viewer.title")}</DialogTitle>
					<DialogDescription>
						{t("ui.chat.clipped_row.viewer.size", {
							total: formatBytes(marker.bytes_total),
						})}
					</DialogDescription>
				</DialogHeader>
				{state.kind === "loading" ? (
					<div data-clipped-viewer="loading" className="flex flex-col gap-2">
						<Progress
							aria-label={t("ui.chat.clipped_row.viewer.progress_label")}
							value={state.progress.received}
							max={Math.max(1, state.progress.total)}
						/>
						<p className="text-meta text-ink-muted" aria-live="polite">
							{t("ui.chat.clipped_row.viewer.loading", {
								received: formatBytes(state.progress.received),
								total: formatBytes(state.progress.total),
							})}
						</p>
					</div>
				) : state.kind === "failed" ? (
					<p data-clipped-viewer="failed" className="text-body-sm text-ink">
						{t("ui.chat.clipped_row.viewer.error")}
					</p>
				) : (
					<pre
						data-clipped-viewer="complete"
						className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-sunken p-3 font-mono text-body-sm text-ink"
					>
						{state.text}
					</pre>
				)}
				<DialogFooter>
					{state.kind === "loading" ? (
						<Button data-clipped-cancel="" onClick={cancel}>
							{t("ui.chat.clipped_row.viewer.cancel")}
						</Button>
					) : (
						<>
							{state.kind === "failed" ? (
								<Button
									variant="primary"
									data-clipped-retry=""
									onClick={() => setAttempt((n) => n + 1)}
								>
									{t("ui.chat.clipped_row.viewer.retry")}
								</Button>
							) : null}
							<Button data-clipped-close="" onClick={onClose}>
								{t("ui.chat.clipped_row.viewer.close")}
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
