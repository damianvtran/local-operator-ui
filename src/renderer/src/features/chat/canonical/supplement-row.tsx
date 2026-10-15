/**
 * The block under a final answer: the file callouts, the components, and the
 * one-line states (turn-supplements memo §2.8, lane U-b).
 *
 * NO HEADER, LABEL OR TITLE — on purpose (the 2026-10-10 amendment): the block
 * starts directly with its content and position alone carries its relationship
 * to the answer above; spacing does the seam. Files first, then components
 * (memo §0), with compact actionable file rows even in a small files-only finish:
 * an inert count sentence must not be the only route to a refused preview.
 *
 * THE STATE LINE is the image-gen card's state machine in miniature: the same
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
 * changed; the refusal is composed by `backendLoadErrorMessage`, never a raw
 * HTTP string (the round-1 U2 finding: a bare `Not Found` is not a sentence a
 * user may be shown).
 *
 * THE CONDENSED FORM (round-1 D1/U3/R2, implemented here): while the block's
 * own turn renders condensed — one closed bar over its run; the flag arrives
 * from the transcript's collapse plan, never re-derived here — the block is ONE
 * line and nothing else. No file rows and no `[data-supplement-slot]`/iframe:
 * absent, not hidden, so no document fetch either. The line is passive (the
 * turn's own bar is the expansion); the settled arms carry counts per the
 * design's copy table and the not-settled arms keep the state line and their
 * actions exactly as the expanded form wires them.
 *
 * THE DISCLOSURES (round-1 D3/U5/U7): both are the app's one disclosure idiom
 * (`Disclosure` — chevron, `ink-dim` mark, one ink for both siblings), both are
 * toggles (`N more files` ⇄ `Show fewer`), and the expanded files tail renders
 * as the compact row grammar (glyph + name + menu), never bare paths.
 *
 * THE WARNINGS ABOUT VARYING FORMS: the ≤2-file summary, the counts prefix and
 * the condensed line's clauses all come from `supplement-model`'s own copy
 * functions, so the row and the model cannot summarize one set two ways.
 */

import { backendLoadErrorMessage } from "@shared/api/local-operator/backend-error";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Tooltip,
} from "@shared/components/ui";
import { Disclosure } from "@shared/components/ui/disclosure";
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
import { memo, useCallback, useEffect, useRef, useState } from "react";
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
	type SupplementRecord,
	condensedBlockLine,
	condensedCountPrefix,
	diagnosticDisplay,
	displayText,
	failureExplanation,
	fileRowParts,
	frameBudgetPx,
	moreText,
	planComponentMounts,
	showAllText,
	supplementDisposition,
} from "./supplement-model";
import { useSupplementDocument } from "./use-supplement-document";

/** The type glyph for one callout row, from the shared file classifier. */
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
 *
 * `actionPath` is the REAL path every action uses, carried separately from the
 * displayed `label`/`suffix`: the display is `displayText`-stripped and may
 * collapse path===name to no suffix at all, and an action must never be handed
 * the display spelling (the pre-refactor component handed its action legs the
 * same string it displayed, so a root-level file whose name equals its path
 * acted on the empty suffix).
 */
const SupplementFileLine = memo(function SupplementFileLine({
	actionPath,
	cwd,
	label,
	suffix,
	size,
	pane,
}: {
	actionPath: string;
	cwd?: string | null;
	label: string;
	suffix: string;
	size: string;
	pane: CanvasPane | null;
}) {
	const canOpenInCanvas = opened(pane, actionPath);
	const [copied, setCopied] = useState(false);
	/*
	 * Journal paths deliberately retain their portable spelling. Resolve only at
	 * the action boundary, using the session's cwd (never Electron's launch cwd).
	 * Every action consumes the same main-process identity seam, including the
	 * disclosure tail; a failed probe must not fall back to an unrooted path.
	 */
	const withTarget = async (action: (path: string) => unknown) => {
		try {
			const [file] = await window.api.probeFiles(
				[actionPath],
				cwd ?? undefined,
			);
			if (!file?.resolved.startsWith("/")) {
				throw new Error("File path has no session working directory");
			}
			await action(file.resolved);
		} catch {
			showErrorToast(
				"Couldn't resolve this file in the session working directory",
			);
		}
	};
	const press = () =>
		withTarget(async (path) => {
			if (canOpenInCanvas && pane && (await pane.openInCanvas(path))) return;
			await openLocalTarget(path);
		});
	return (
		<div className="group flex w-full items-center gap-2 text-meta">
			<FileGlyph path={actionPath} />
			<button
				type="button"
				className="min-w-0 flex-1 truncate text-left text-ink hover:text-ink-dim"
				data-supplement-file=""
				title={actionPath}
				onClick={() => {
					void press();
				}}
			>
				{displayText(label)}
				{suffix && suffix !== label && (
					<span className="ml-2 text-ink-muted">{displayText(suffix)}</span>
				)}
			</button>
			{size && <span className="shrink-0 text-ink-dim">{size}</span>}
			<DropdownMenu>
				<Tooltip content="File actions">
					<DropdownMenuTrigger asChild={true}>
						<button
							type="button"
							className="flex size-6 shrink-0 items-center justify-center text-ink-dim opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
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
								void withTarget((path) => pane?.openInCanvas(path));
							}}
						>
							<LayoutGrid aria-hidden="true" />
							<span>Open in canvas</span>
						</DropdownMenuItem>
					)}
					<DropdownMenuItem
						onSelect={() => {
							void withTarget(openLocalTarget);
						}}
					>
						<FileIcon aria-hidden="true" />
						<span>Open in default app</span>
					</DropdownMenuItem>
					<DropdownMenuItem
						onSelect={() => {
							void withTarget(revealLocalTarget);
						}}
					>
						<FolderOpen aria-hidden="true" />
						<span>Reveal in Finder</span>
					</DropdownMenuItem>
					<DropdownMenuItem
						onSelect={() => {
							void navigator.clipboard
								.writeText(actionPath)
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
 *
 * The frame reports its rendered height back on every change, by digest
 * (`onHeight`): that is the figure the aggregate budget accrues once a frame is
 * on screen (design D5 — hints are estimates and a document may overrun them).
 */
const SupplementFrameSlot = memo(function SupplementFrameSlot({
	component,
	sessionId,
	onRetry,
	onHeight,
}: {
	component: SupplementComponent;
	sessionId: string | null;
	onRetry?: () => void;
	onHeight?: (digest: string, height: number) => void;
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
	/*
	 * A STABLE reporter, so the frame's height effect fires on height changes
	 * rather than on every slot render: an inline closure here would hand the
	 * frame a new callback identity each time this row paints.
	 */
	const reportHeight = useCallback(
		(height: number) => {
			onHeight?.(component.attachment, height);
		},
		[onHeight, component.attachment],
	);
	return (
		<div ref={anchorRef} data-supplement-slot="">
			<SupplementFrame
				component={component}
				sessionId={sessionId}
				documentHtml={document.html}
				documentFailed={document.failed}
				onRetry={onRetry}
				onHeightChange={onHeight ? reportHeight : undefined}
			/>
		</div>
	);
});

export type SupplementRowProps = {
	record: SupplementRecord;
	/** The conversation's session, for the ops and the document route. */
	sessionId: string | null;
	/** Session path context, kept out of the portable journal record. */
	cwd?: string | null;
	/**
	 * Whether the row's own turn currently renders condensed (one closed bar
	 * over its run; `runIsCondensed`, computed by the transcript from its
	 * collapse plan — never re-derived here; design D1.1).
	 */
	condensed?: boolean;
};

export const SupplementRow = memo(function SupplementRow({
	record,
	sessionId,
	cwd,
	condensed = false,
}: SupplementRowProps) {
	const pane = useCanvasPane();
	const [expandedMore, setExpandedMore] = useState(false);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [showAll, setShowAll] = useState(false);
	const [adjusting, setAdjusting] = useState(false);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	/*
	 * The rendered heights of frames already on screen, by digest (design D5):
	 * written by the frames' own resize beats, read by the budget's accrual.
	 */
	const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(
		() => new Map(),
	);
	/*
	 * ONLY rendered heights arrive here (the frame reports after its first
	 * resize beat, never its reserved estimate): `planComponentMounts` holds the
	 * walk at any frame that has not reported, so a reserved value standing in
	 * for a measurement would defeat the accrual it exists for.
	 */
	/*
	 * The sticky auto-mount count: a frame that ever mounted stays mounted, so a
	 * later measurement that makes the accrual STOP fitting (a document that
	 * overran its hint) never unmounts it under the reader. The state only grows,
	 * and `Math.max` against the live suggestion means the suggestion's own
	 * growth (a smaller-than-hinted first frame freeing budget) mounts the next
	 * frame in the same commit.
	 */
	const [sticky, setSticky] = useState(0);

	const disposition = supplementDisposition(record, record.live);

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
			/*
			 * The refusal is composed, not echoed: a desktop 404 means the server
			 * predates the route (the supplement ops' companion core routes), and
			 * `backendLoadErrorMessage` turns that into the app's own sentence —
			 * the same vocabulary every other surface uses for it (round-1 U2:
			 * "Not Found" must never reach a toast).
			 */
			showErrorToast(
				backendLoadErrorMessage("Highlights could not be updated.", error),
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

	const noteHeight = useCallback((digest: string, height: number) => {
		setMeasured((prev) => {
			if (prev.get(digest) === height) return prev;
			const next = new Map(prev);
			next.set(digest, height);
			return next;
		});
	}, []);

	/*
	 * The aggregate frame budget (§2.8): frames mount automatically only within
	 * a cumulative min(480px, 40vh) of block height, accrued from each frame's
	 * RENDERED height — and a later frame waits until every earlier one has
	 * reported (design D5: the hint is an estimate a document may overrun, so
	 * hint-only accrual let two frames auto-mount at roughly twice the budget);
	 * the rest sit behind ONE disclosure that expands in place on an explicit
	 * action. The stickiness below is the other half — an already-mounted frame
	 * stays even when a late measurement says the accrual no longer fits.
	 */
	const budgetPx = frameBudgetPx(
		typeof window === "undefined" ? 900 : window.innerHeight,
	);
	const { visible } = planComponentMounts(components, budgetPx, measured);
	useEffect(() => {
		setSticky((count) => Math.max(count, visible.length));
	}, [visible.length]);
	const autoCount = Math.min(
		components.length,
		Math.max(sticky, visible.length),
	);
	/*
	 * The head mounts automatically; the tail is the disclosure's. Splitting
	 * ONCE here (rather than a `shown`/`hidden` pair) is deliberate: an earlier
	 * draft computed `shown = showAll ? components : …` beside a `hidden = the
	 * tail`, and the open state then rendered the tail twice — once through the
	 * head it had swallowed and once through the disclosure's children.
	 */
	const head = components.slice(0, autoCount);
	const tail = components.slice(autoCount);

	/*
	 * The one quiet line for the arms that carry one (§2.8's copy table). The
	 * shimmer is the image-gen card's own `animate-shimmer` treatment at the
	 * inline scale — the same motion vocabulary, the same reduced-motion
	 * behaviour, no new animation. `countsPrefix` is the condensed not-settled
	 * form's leading clause (`2 files · Preparing highlights…`), null everywhere
	 * else.
	 */
	const stateLine = (countsPrefix: string | null) =>
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
				{countsPrefix !== null && (
					<>
						<span className="text-ink-muted">{countsPrefix}</span>
						<span aria-hidden="true" className="text-ink-dim">
							·
						</span>
					</>
				)}
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

	if (disposition === "nothing") return null;

	/*
	 * THE CONDENSED FORM (design D1, exactly). One line and nothing else: no
	 * file rows, no `[data-supplement-slot]`/iframe — absent, not hidden, so no
	 * document fetch either. The line is passive: no chevron, no handler,
	 * `data-supplement-condensed` as its pin; the turn's own bar is the
	 * expansion and restores the full block.
	 */
	if (condensed) {
		if (disposition === "block") {
			const line = condensedBlockLine(record);
			if (line === null) return null;
			return (
				<div
					className="flex flex-col gap-2"
					data-supplement-record={record.anchor}
				>
					<div
						className="text-ink-muted text-meta"
						data-supplement-condensed=""
					>
						{line}
					</div>
				</div>
			);
		}
		return (
			<div
				className="flex flex-col gap-2"
				data-supplement-record={record.anchor}
			>
				{stateLine(condensedCountPrefix(record))}
				{adjustLine}
			</div>
		);
	}

	/*
	 * The files half first (memo §0). The small-set file actions apply when no
	 * COMPONENT rides the row and the whole known set is two files or fewer
	 * (the TUI's own rule, `total_files <= 2 and not components_present`), and
	 * it serves the preparing arm's callouts too — they are the same callouts
	 * a moment earlier. The names come from the model's own builder so the
	 * condensed line and this summary can never disagree.
	 */
	let filesSection: JSX.Element | null = null;
	if (files.length > 0 || moreCount > 0) {
		if (totalFiles <= 2 && components.length === 0 && moreCount === 0) {
			filesSection = (
				<div className="flex flex-col gap-1" data-supplement-files-summary="">
					{files.map((file) => {
						const { name, path, size } = fileRowParts(file);
						return (
							<SupplementFileLine
								key={file.path}
								actionPath={file.path}
								cwd={cwd}
								label={name || path}
								suffix={path}
								size={size}
								pane={pane}
							/>
						);
					})}
				</div>
			);
		} else {
			filesSection = (
				<div className="flex flex-col gap-1" data-supplement-files="">
					{files.map((file) => {
						const { name, path, size } = fileRowParts(file);
						return (
							<SupplementFileLine
								key={`${file.path}:${file.name}`}
								actionPath={file.path}
								cwd={cwd}
								label={name || path}
								suffix={path}
								size={size}
								pane={pane}
							/>
						);
					})}
					{moreCount > 0 && (
						/*
						 * ONE disclosure grammar for both siblings (D3): the app's
						 * Disclosure idiom — chevron in the rows' own meta ink, a
						 * colour step on hover — as a TOGGLE (`N more files` ⇄
						 * `Show fewer`; U5), its tail rendered as the compact row
						 * (glyph + name + menu; D3b) rather than bare paths. The
						 * `rowClassName` override is the dense-list case the
						 * primitive's own docs carve out: this block's pitch is
						 * tighter than the default 24px disclosure row.
						 */
						<Disclosure
							chevronClassName="text-ink-dim"
							open={expandedMore}
							onOpenChange={setExpandedMore}
							rowClassName="min-h-0 py-0"
							summary={
								<span data-supplement-more="">
									{expandedMore ? "Show fewer" : moreText(moreCount)}
								</span>
							}
						>
							{record.more.slice(0, 20).map((item) => (
								<SupplementFileLine
									key={item}
									actionPath={item}
									cwd={cwd}
									label={item}
									suffix=""
									size=""
									pane={pane}
								/>
							))}
						</Disclosure>
					)}
				</div>
			);
		}
	}

	return (
		<div className="flex flex-col gap-2" data-supplement-record={record.anchor}>
			{filesSection}
			{stateLine(null)}
			{record.detail?.includes("prepared:unsupported") && (
				<p className="text-meta text-ink-muted" data-supplement-refusal="">
					Inline preview unavailable. This HTML needs unsupported resources or
					document content. Open the file to view it.
				</p>
			)}
			{(disposition === "failed_retry" ||
				disposition === "files_failed_retry") && (
				<div
					className="flex flex-col gap-1 text-meta text-ink-muted"
					data-supplement-diagnostic=""
				>
					<p>{failureExplanation(record)}</p>
					{((record.attempts?.length ?? 0) > 0 ||
						(record.detail?.length ?? 0) > 0) && (
						<Disclosure
							open={detailsOpen}
							onOpenChange={setDetailsOpen}
							rowClassName="min-h-6 py-0"
							chevronClassName="text-ink-dim"
							summary="Details"
						>
							<div className="max-h-[min(320px,40vh)] overflow-auto break-words font-mono text-ink-dim">
								{record.model && <p>Model: {record.model}</p>}
								<p>Attempts: {record.attempts?.length ?? 0}</p>
								{record.detail?.map((line) => (
									<p key={line}>{diagnosticDisplay(line)}</p>
								))}
							</div>
						</Disclosure>
					)}
				</div>
			)}
			{adjustLine}
			{disposition === "block" && components.length > 0 && (
				<div className="flex flex-col gap-2" data-supplement-components="">
					{head.map((component) => (
						<SupplementFrameSlot
							key={component.attachment}
							component={component}
							sessionId={sessionId}
							onRetry={sessionId ? retry : undefined}
							onHeight={noteHeight}
						/>
					))}
					{tail.length > 0 && (
						/*
						 * The graphics sibling of the same disclosure grammar: a
						 * toggle (`Show all N graphics` ⇄ `Show fewer`), the hidden
						 * frames mounted only while it is open — an explicit
						 * action, which is the memo's own condition for mounting
						 * beyond the budget (§2.8).
						 */
						<Disclosure
							chevronClassName="text-ink-dim"
							open={showAll}
							onOpenChange={setShowAll}
							rowClassName="min-h-0 py-0"
							summary={
								<span data-supplement-show-all="">
									{showAll ? "Show fewer" : showAllText(tail.length)}
								</span>
							}
						>
							{tail.map((component) => (
								<SupplementFrameSlot
									key={component.attachment}
									component={component}
									sessionId={sessionId}
									onRetry={sessionId ? retry : undefined}
									onHeight={noteHeight}
								/>
							))}
						</Disclosure>
					)}
				</div>
			)}
		</div>
	);
});
