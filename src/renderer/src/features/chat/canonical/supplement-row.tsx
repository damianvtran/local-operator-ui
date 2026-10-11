/**
 * The block under a final answer: the file callouts, the components, and the
 * one-line states (turn-supplements memo §2.8, lane U-b).
 *
 * NO HEADER, LABEL OR TITLE — on purpose (the 2026-10-10 amendment): the block
 * starts directly with its content and position alone carries its relationship
 * to the answer above; spacing does the seam. Files first, then components
 * (memo §0), and a files-only finish with ≤ 2 files is ONE line — the contents
 * themselves, never the bare word "Highlights".
 *
 * The state line is the image-gen card's state machine in miniature: the same
 * frozen vocabulary, the same copy bytes as the TUI (`Preparing highlights…`,
 * `Highlights cancelled`, `Couldn't prepare highlights`), and the same
 * "absent handler = absent control" rule the card states — the action pair is
 * wired only where there is a session to address, which is also how a story
 * demonstrates the affordances with stubs.
 *
 * THE ACTION PAIR (memo §2.8): `Adjust…` and `Cancel` are drawn TOGETHER or
 * not at all — never one hover-only while the other persists — and both are
 * wired to the desktop supplement ops. A press that cannot reach a backend
 * route surfaces the app's ordinary refusal rather than pretending the job
 * changed.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Tooltip,
} from "@shared/components/ui";
import { showErrorToast } from "@shared/utils/toast-manager";
import {
	ClipboardCopy,
	Ellipsis,
	File as FileIcon,
	FileImage,
	FileSpreadsheet,
	FileText,
	FolderOpen,
	LayoutGrid,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { CanvasPane } from "../utils/canvas-pane";
import { useCanvasPane } from "../utils/canvas-pane";
import { fileKind } from "../utils/file-kind";
import { openLocalTarget, revealLocalTarget } from "../utils/link-open";
import { opensInCanvas } from "../utils/open-in-canvas";
import { SupplementFrame } from "./supplement-frame";
import {
	COPY_ADJUST,
	COPY_CANCEL,
	COPY_CANCELLED,
	COPY_FAILED,
	COPY_PREPARING,
	COPY_RETRY,
	STEER_TEXT_MAX_CHARS,
	type SupplementComponent,
	type SupplementFile,
	type SupplementRecord,
	displayText,
	fileRowParts,
	filesSummaryLine,
	frameBudgetPx,
	moreText,
	planComponentMounts,
	supplementDisposition,
} from "./supplement-model";
import { useSupplementDocument } from "./use-supplement-document";

/** The type glyph for a callout row, from the same classifier the file rows use. */
function FileGlyph({ path }: { path: string }) {
	const kind = fileKind(path);
	switch (kind) {
		case "image":
			return <FileImage aria-hidden="true" className="size-3.5 shrink-0" />;
		case "spreadsheet":
			return (
				<FileSpreadsheet aria-hidden="true" className="size-3.5 shrink-0" />
			);
		case "markdown":
		case "text":
		case "document":
			return <FileText aria-hidden="true" className="size-3.5 shrink-0" />;
		default:
			return <FileIcon aria-hidden="true" className="size-3.5 shrink-0" />;
	}
}

/**
 * One callout row: the file's NAME is the content, and everything else lives in
 * one right-hand slot or behind the row's own menu — the canvas/reveal/OS-open
 * trio the design asks for, riding the app's existing file plumbing (the pane
 * handle and the IPC open/reveal doors) rather than a second implementation.
 */
const SupplementFileLine = memo(function SupplementFileLine({
	file,
	pane,
}: {
	file: SupplementFile;
	pane: CanvasPane | null;
}) {
	const { name, path, size } = fileRowParts(file);
	const label = name || path;
	const canOpenInCanvas = opened(pane, path);
	const [copied, setCopied] = useState(false);
	const press = async () => {
		if (canOpenInCanvas && pane && (await pane.openInCanvas(path))) return;
		await openLocalTarget(path);
	};
	return (
		<div className="group flex w-full items-center gap-2 text-meta">
			<FileGlyph path={path} />
			<button
				type="button"
				className="min-w-0 flex-1 truncate text-left text-ink hover:text-ink-dim"
				data-supplement-file=""
				title={path}
				onClick={() => {
					void press();
				}}
			>
				{displayText(label)}
				{path && path !== label && (
					<span className="ml-2 text-ink-muted">{displayText(path)}</span>
				)}
			</button>
			{size && <span className="shrink-0 text-ink-dim">{size}</span>}
			<DropdownMenu>
				<Tooltip content="File actions">
					<DropdownMenuTrigger asChild={true}>
						<button
							type="button"
							className="shrink-0 text-ink-dim opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
							aria-label={`Actions for ${label || "this file"}`}
						>
							<Ellipsis aria-hidden="true" className="size-3.5" />
						</button>
					</DropdownMenuTrigger>
				</Tooltip>
				<DropdownMenuContent align="end" className="min-w-45">
					{canOpenInCanvas && (
						<DropdownMenuItem
							onSelect={() => {
								void pane?.openInCanvas(path);
							}}
						>
							<LayoutGrid aria-hidden="true" />
							<span>Open in canvas</span>
						</DropdownMenuItem>
					)}
					<DropdownMenuItem
						onSelect={() => {
							void openLocalTarget(path);
						}}
					>
						<FileIcon aria-hidden="true" />
						<span>Open in default app</span>
					</DropdownMenuItem>
					<DropdownMenuItem
						onSelect={() => {
							void revealLocalTarget(path);
						}}
					>
						<FolderOpen aria-hidden="true" />
						<span>Reveal in Finder</span>
					</DropdownMenuItem>
					<DropdownMenuItem
						onSelect={() => {
							void navigator.clipboard
								.writeText(path)
								.then(() => setCopied(true))
								.catch(() => showErrorToast("Failed to copy file path"));
						}}
					>
						<ClipboardCopy aria-hidden="true" />
						<span>{copied ? "Copied" : "Copy file path"}</span>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
});

/** Whether this pane can show this path at all (the shared predicate). */
function opened(pane: CanvasPane | null, path: string): boolean {
	try {
		return opensInCanvas(pane, path);
	} catch {
		return false;
	}
}

/**
 * One component's slot: the lazy-mount gate (§2.11 — a frame mounts only when
 * its answer row is in the viewport), the document fetch, and then the frame
 * itself. The reserved box renders immediately so the block's height is stable
 * before the document resolves.
 */
const SupplementFrameSlot = memo(function SupplementFrameSlot({
	component,
	sessionId,
}: {
	component: SupplementComponent;
	sessionId: string | null;
}) {
	const anchorRef = useRef<HTMLDivElement | null>(null);
	const [near, setNear] = useState(false);
	useEffect(() => {
		const element = anchorRef.current;
		if (element === null) return;
		if (typeof IntersectionObserver === "undefined") {
			setNear(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) setNear(true);
				}
			},
			{ rootMargin: "200px 0px" },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const document = useSupplementDocument(sessionId, component.attachment, near);
	return (
		<div ref={anchorRef} data-supplement-slot="">
			<SupplementFrame
				component={component}
				documentHtml={document.html}
				documentFailed={document.failed}
			/>
		</div>
	);
});

export type SupplementRowProps = {
	record: SupplementRecord;
	/** The conversation's session, for the ops and the document route. */
	sessionId: string | null;
};

export const SupplementRow = memo(function SupplementRow({
	record,
	sessionId,
}: SupplementRowProps) {
	const pane = useCanvasPane();
	const [expandedMore, setExpandedMore] = useState(false);
	const [showAll, setShowAll] = useState(false);
	const [adjusting, setAdjusting] = useState(false);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);

	const disposition = supplementDisposition(record, record.live);
	if (disposition === "nothing") return null;

	const files = record.files;
	const moreCount = record.filesMore;
	const components = record.components;
	const totalFiles = files.length + moreCount;

	/** One desktop op, with the app's ordinary refusal surface on failure. */
	const sendOp = async (
		request:
			| { op: "supplements.cancel" | "supplements.restart" }
			| { op: "supplements.steer"; text: string },
	): Promise<void> => {
		if (!sessionId) return;
		setBusy(true);
		try {
			await desktopResult({
				...request,
				sessionId,
				job: record.job,
				anchor: record.anchor,
			});
		} catch (error) {
			showErrorToast(
				error instanceof Error && error.message
					? error.message
					: "Highlights could not be updated.",
			);
		} finally {
			setBusy(false);
		}
	};

	const cancel = () => {
		void sendOp({ op: "supplements.cancel" });
	};
	const retry = () => {
		void sendOp({ op: "supplements.restart" });
	};
	const steer = () => {
		const text = draft.trim();
		if (!text) return;
		setAdjusting(false);
		setDraft("");
		void sendOp({ op: "supplements.steer", text });
	};

	/*
	 * The files half first (memo §0). The ≤ 2 files one-liner applies when no
	 * COMPONENT rides the row and the whole known set is two files or fewer
	 * (the TUI's own rule, `total_files <= 2 and not components_present`), and
	 * it serves the preparing arm's callouts too — they are the same callouts
	 * a moment earlier.
	 */
	let filesSection: JSX.Element | null = null;
	if (files.length > 0 || moreCount > 0) {
		if (totalFiles <= 2 && components.length === 0) {
			const names: string[] = [];
			for (const file of files) {
				const { name, path } = fileRowParts(file);
				if (name || path) names.push(name || path);
			}
			if (moreCount > 0) {
				for (const item of record.more.slice(0, moreCount)) {
					const base = displayText(item).split("/").pop() ?? "";
					if (base) names.push(base);
				}
			}
			filesSection = (
				<div
					className="text-ink-muted text-meta"
					data-supplement-files-summary=""
				>
					{filesSummaryLine(names.filter(Boolean).slice(0, 2))}
				</div>
			);
		} else {
			filesSection = (
				<div className="flex flex-col gap-1" data-supplement-files="">
					{files.map((file) => (
						<SupplementFileLine
							key={`${file.path}:${file.name}`}
							file={file}
							pane={pane}
						/>
					))}
					{moreCount > 0 &&
						(expandedMore ? (
							record.more.slice(0, 20).map((item) => (
								<button
									key={item}
									type="button"
									className="truncate text-left text-ink-muted text-meta"
									data-supplement-more-path=""
									title={item}
									onClick={() => {
										void openLocalTarget(item);
									}}
								>
									{displayText(item)}
								</button>
							))
						) : (
							<button
								type="button"
								className="w-fit text-ink-dim text-meta"
								data-supplement-more=""
								onClick={() => setExpandedMore(true)}
							>
								{moreText(moreCount)}
							</button>
						))}
				</div>
			);
		}
	}

	/*
	 * The one quiet line for the arms that carry one (§2.8's copy table). The
	 * shimmer is the image-gen card's own `animate-shimmer` treatment at the
	 * inline scale — the same motion vocabulary, the same reduced-motion
	 * behaviour, no new animation.
	 */
	const stateLine =
		disposition === "preparing" ||
		disposition === "files_preparing" ||
		disposition === "cancelled_retry" ||
		disposition === "files_cancelled_retry" ||
		disposition === "failed_retry" ||
		disposition === "files_failed_retry" ? (
			<div
				className="flex flex-wrap items-center gap-2 text-meta"
				data-supplement-line=""
			>
				{(disposition === "preparing" || disposition === "files_preparing") && (
					<>
						<span
							aria-hidden="true"
							className="relative inline-block size-3 overflow-hidden rounded-full bg-sunken"
						>
							<span
								className={
									"absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-elevated to-transparent bg-[length:200%_100%] bg-[position:-200%_50%] bg-no-repeat"
								}
							/>
						</span>
						<span className="text-ink-muted">{COPY_PREPARING}</span>
					</>
				)}
				{(disposition === "cancelled_retry" ||
					disposition === "files_cancelled_retry") && (
					<span className="text-ink-muted">{COPY_CANCELLED}</span>
				)}
				{(disposition === "failed_retry" ||
					disposition === "files_failed_retry") && (
					<span className="text-ink-muted">{COPY_FAILED}</span>
				)}
				{/*
				 * The pair is drawn TOGETHER or not at all (D10). Both actions are
				 * wired only when there is a session to address — absent handler,
				 * absent control (the image-gen card's rule). A pointer surface has
				 * no 44 px target problem; the tap-target rule is a touch concern the
				 * app's mobile lane owns.
				 */}
				{(disposition === "preparing" || disposition === "files_preparing") &&
					sessionId && (
						<>
							<span aria-hidden="true" className="text-ink-dim">
								·
							</span>
							{!adjusting && (
								<button
									type="button"
									className="text-ink-dim"
									data-supplement-adjust=""
									onClick={() => setAdjusting(true)}
								>
									{COPY_ADJUST}
								</button>
							)}
							<button
								type="button"
								className="text-ink-dim disabled:text-ink-dim/60"
								data-supplement-cancel=""
								disabled={busy || record.state === "cancelling"}
								onClick={cancel}
							>
								{COPY_CANCEL}
							</button>
						</>
					)}
				{(disposition === "cancelled_retry" ||
					disposition === "files_cancelled_retry" ||
					disposition === "failed_retry" ||
					disposition === "files_failed_retry") &&
					sessionId && (
						<>
							<span aria-hidden="true" className="text-ink-dim">
								·
							</span>
							<button
								type="button"
								className="text-ink-dim"
								data-supplement-retry=""
								onClick={retry}
							>
								{COPY_RETRY}
							</button>
						</>
					)}
			</div>
		) : null;

	const adjustLine = adjusting ? (
		<div
			className="flex items-center gap-2 text-meta"
			data-supplement-adjust-form=""
		>
			<input
				// biome-ignore lint/a11y/noAutofocus: the field DOES NOT EXIST until an explicit `Adjust…` press opened it — focusing it is the whole meaning of that press, and there is no other content to steal focus from.
				autoFocus={true}
				className="min-w-0 flex-1 rounded-sm border border-control bg-canvas px-1.5 py-0.5 text-ink text-meta"
				maxLength={STEER_TEXT_MAX_CHARS}
				placeholder="Adjust the graphic…"
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") steer();
					if (event.key === "Escape") {
						setAdjusting(false);
						setDraft("");
					}
				}}
			/>
			<button
				type="button"
				className="text-ink-dim disabled:text-ink-dim/60"
				disabled={busy || !draft.trim()}
				onClick={steer}
			>
				Send
			</button>
		</div>
	) : null;

	/*
	 * The aggregate frame budget (§2.8): frames mount automatically only within
	 * a cumulative min(480px, 40vh) of block height; the rest sit behind ONE
	 * disclosure that expands in place on an explicit action.
	 */
	const budgetPx = frameBudgetPx(
		typeof window === "undefined" ? 900 : window.innerHeight,
	);
	const { visible, hidden } = planComponentMounts(components, budgetPx);
	const mounted = showAll ? components : visible;

	return (
		<div className="flex flex-col gap-2" data-supplement-record={record.anchor}>
			{filesSection}
			{stateLine}
			{adjustLine}
			{disposition === "block" && components.length > 0 && (
				<div className="flex flex-col gap-2" data-supplement-components="">
					{mounted.map((component) => (
						<SupplementFrameSlot
							key={component.attachment}
							component={component}
							sessionId={sessionId}
						/>
					))}
					{!showAll && hidden.length > 0 && (
						<button
							type="button"
							className="w-fit text-ink-muted text-meta"
							data-supplement-show-all=""
							onClick={() => setShowAll(true)}
						>
							{`Show all ${hidden.length} graphics`}
						</button>
					)}
				</div>
			)}
		</div>
	);
});
