/**
 * The block under a final answer: the file callouts, the components, and the
 * one-line states (turn-supplements memo §2.8, lane U-b).
 *
 * NO HEADER, LABEL OR TITLE — on purpose (the 2026-10-10 amendment): the block
 * starts directly with its content and position alone carries its relationship
 * to the answer above; spacing does the seam. Files first, then components
 * (memo §0), with compact actionable file rows even in a small files-only finish:
 * an inert count sentence must not be the only route to a refused preview — a
 * principle the condensed form below now carries too. Image-kind files render
 * as a thumbnail grid instead of rows (operator decision 2026-10-16); see
 * `supplement-image-grid.tsx` for that form's own why and bounds.
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
 * THE CONDENSED FORM (round-1 D1/U3/R2, reworked by the operator decision of
 * 2026-10-16): while the block's own turn renders condensed — one closed bar
 * over its run; the flag arrives from the transcript's collapse plan, never
 * re-derived here — the block shows THE SAME FILES SECTION as its expanded
 * self (the image grid, the rows, the `N more files` disclosure).
 * The explicit 2026-10-19 amendment (operator request from his own screenshot)
 * supersedes the 2026-10-16 ruling that a graphics-only condensed finish keeps
 * its plain count clause: the answer-local Show/Hide disclosure for graphics-only
 * and mixed file/graphics finishes now DEFAULTS TO OPEN, after the files section,
 * and its Hide control still folds it. Visible does not mean eager — the slot
 * still starts under the EXISTING viewport gate (`SupplementFrameSlot`'s `near`),
 * which gates the document fetch: an off-screen or far-away condensed turn
 * renders only the reserved slot box, mounts no iframe and issues no document
 * request until it is near (the gate is sticky once near, and an already-cached
 * document may paint there without a request). The old "ZERO fetches while
 * condensed" claim is therefore retired, not extended: a visible condensed
 * frame is gated exactly like an expanded one. The identity a Hide belongs to
 * is `(sessionId, anchor, job)`: a version bump of the same job keeps the Hide
 * (it is the same graphic to the reader), while a different job starts open.
 * A local Hide survives collapsing work again: that explicit request belongs to
 * this supplement identity, not to the work bar. A new identity resets to the
 * default (open), so a Hide set on one supplement is never resurrected for
 * another. Expanded work and local reveal share ONE body, never duplicate
 * attachments.
 * The not-settled arms keep the state line and their actions exactly
 * as the expanded form wires them, with the files section ABOVE the line once
 * files are known — which is why the old counts prefix (`2 files · Preparing
 * highlights…`) has no job left and is gone: the rows say it.
 *
 * THE DISCLOSURES (round-1 D3/U5/U7): both are the app's one disclosure idiom
 * (`Disclosure` — chevron, `ink-dim` mark, one ink for both siblings), both are
 * toggles (`N more files` ⇄ `Show fewer`), and the expanded files tail renders
 * as the compact row grammar (glyph + name + menu), never bare paths.
 *
 * THE WARNINGS ABOUT VARYING FORMS: the graphics count clause, the disclosure's
 * words and the size column all come from `supplement-model`'s own copy
 * functions, so the row and the model cannot paint one set two ways.
 */

import { backendLoadErrorMessage } from "@shared/api/local-operator/backend-error";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { Disclosure } from "@shared/components/ui/disclosure";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { showErrorToast } from "@shared/utils/toast-manager";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	AUDIO_UNAVAILABLE_COPY,
	BrokenAttachment,
} from "../components/message-item/attachment-frame";
import type { CanvasPane } from "../utils/canvas-pane";
import { useCanvasPane } from "../utils/canvas-pane";
import { fileKind } from "../utils/file-kind";
import { SoundPlayer } from "./sound-player";
import {
	FileActionsMenu,
	FileGlyph,
	useFileTargets,
} from "./supplement-file-actions";
import { SupplementFrame } from "./supplement-frame";
import { SupplementImageGrid } from "./supplement-image-grid";
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
	type SupplementSound,
	causePhrase,
	diagnosticDisplay,
	displayText,
	failureExplanation,
	fileRowParts,
	frameBudgetPx,
	graphicRevealText,
	moreText,
	planComponentMounts,
	showAllText,
	supplementDisposition,
} from "./supplement-model";
import { useAttachmentSource } from "./use-attachment-url";
import { useSupplementDocument } from "./use-supplement-document";
import { useWaveform } from "./use-waveform";

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
 *
 * The plumbing itself is `supplement-file-actions.tsx`'s, shared with the image
 * grid's tiles so one file's actions cannot become two implementations.
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
	const { press } = useFileTargets(actionPath, cwd, pane);
	return (
		<div className="group flex w-full items-center gap-2 text-meta">
			<FileGlyph path={actionPath} />
			<button
				type="button"
				className="min-w-0 flex-1 truncate text-start text-ink hover:text-ink-dim"
				data-supplement-file=""
				title={actionPath}
				onClick={() => {
					void press();
				}}
			>
				{displayText(label)}
				{suffix && suffix !== label && (
					<span className="ms-2 text-ink-muted">{displayText(suffix)}</span>
				)}
			</button>
			{size && <span className="shrink-0 text-ink-dim">{size}</span>}
			<FileActionsMenu
				actionPath={actionPath}
				label={label}
				cwd={cwd}
				pane={pane}
			/>
		</div>
	);
});

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
/**
 * One generated sound's row: its title (when the producer stated one) over the
 * shared compact player.
 *
 * THE PLAYER IS DIGEST-SCOPED, exactly as every other seat: the bytes resolve
 * through `useAttachmentSource` with `{ sessionId, childId: null }` — the
 * supplement block belongs to the conversation it anchors, and the harness
 * references the sound by attachment digest, which is the identity the resolver
 * and the engine both key on. The peaks come from the same sidecar route the
 * transcript reads (`useWaveform`): a session without it draws the flat
 * scrubber rather than a fabricated shape.
 */
const SupplementSoundLine = memo(function SupplementSoundLine({
	sound,
	sessionId,
}: {
	sound: SupplementSound;
	sessionId: string | null;
}) {
	// One scope object per session, so the resolver's effect does not see a new
	// identity per render (it reads the ids, but the object is cheap to keep).
	const scope = useMemo(
		() => (sessionId ? { sessionId, childId: null } : null),
		[sessionId],
	);
	const source = useAttachmentSource(
		{
			data: null,
			attachment: sound.attachment,
			mimeType: sound.mime,
		},
		scope,
	);
	const peaks = useWaveform(sound.attachment, scope);
	const label = sound.title || "Generated sound";
	/*
	 * THE NAME DOES NOT WAIT FOR THE BYTES. A sound's title is known the moment
	 * the record arrives (it is the producer's own string), so it is drawn over
	 * whichever body state the resolver is in — a reserved row, the player, or
	 * the unavailable receipt. A title that appeared only after the fetch would
	 * leave the reader looking at an unnamed line and then watch it reflow.
	 */
	return (
		<div data-supplement-sound="" className="flex min-w-0 flex-col gap-0.5">
			{sound.title && (
				<span
					data-supplement-sound-title=""
					title={sound.title}
					className="truncate text-meta text-ink-muted"
				>
					{displayText(sound.title)}
				</span>
			)}
			{source.state === "missing" ? (
				<BrokenAttachment name={label} detail={AUDIO_UNAVAILABLE_COPY} />
			) : source.state === "resolving" ? (
				// A reserved line at the player's height (the same reason the two
				// media components reserve): the block must not jump when the bytes
				// land. The marker is what a static render can count per sound -
				// the player's own controls exist only once the resolver answered.
				<div
					data-supplement-sound-placeholder=""
					className="h-11"
					aria-hidden={true}
				/>
			) : (
				<SoundPlayer
					variant="compact"
					ownerId={`sound:${sound.attachment}`}
					src={source.url}
					label={label}
					peaks={peaks}
					durationHint={sound.durationS}
				/>
			)}
		</div>
	);
});

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
	useI18nLocale();
	const pane = useCanvasPane();
	const [expandedMore, setExpandedMore] = useState(false);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [showAll, setShowAll] = useState(false);
	/*
	 * Store the permission WITH its identity. The default is OPEN (operator
	 * request, 2026-10-19): the graphic is part of the answer, so a condensed
	 * turn shows it without a press. A replacement is reset before commit, not
	 * in an effect, so it starts at that default immediately and can never
	 * inherit a Hide set on the supplement it replaced; returning to an earlier
	 * identity starts open again rather than resurrecting its old Hide.
	 *
	 * The identity is `(sessionId, anchor, job)`, deliberately NOT the record
	 * version: a version bump of the same job is the same graphic to the reader,
	 * so a Hide they set must survive it. A different job is a different
	 * supplement and starts open.
	 *
	 * Starting open is not eager fetching: the document fetch still starts only
	 * behind `SupplementFrameSlot`'s viewport gate (the reserved box mounts, but
	 * nothing is requested until the slot is near).
	 */
	const identity = JSON.stringify([sessionId, record.anchor, record.job]);
	const [localGraphics, setLocalGraphics] = useState({ identity, open: true });
	const localGraphicsOpen =
		localGraphics.identity === identity && localGraphics.open;
	if (localGraphics.identity !== identity) {
		setLocalGraphics({ identity, open: true });
		setShowAll(false);
	}
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
	/*
	 * The failed line's typed cause phrase (operator ask 2026-10-17; core #2557
	 * licenses the variant and ONE word list — `CAUSE_PHRASES` is that list's
	 * desktop transcription). A row without a cause, or carrying a token this
	 * build does not know, paints the bare sentence exactly as before.
	 */
	const failedCause = causePhrase(record.cause);

	const files = record.files;
	const moreCount = record.filesMore;
	const components = record.components;
	/*
	 * The turn's generated sounds (sound phase): EMPTY on every row older than
	 * the wire change, and an empty list renders NOTHING at all - not a heading
	 * with nothing under it (the block's no-label rule and the brief's "never a
	 * stub" meet in the same place). The `?? []` is for the record shapes that
	 * predate the field: a reducer-built row always carries one, but a stale
	 * snapshot or a hand-built fixture must read as "no sounds", not crash.
	 */
	const sounds = record.sounds ?? [];
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
	 * behaviour, no new animation.
	 *
	 * NO FILE CLAUSE LIVES HERE since the 2026-10-16 rework: the files section
	 * is drawn whenever files are known (condensed included), so the old
	 * condensed counts prefix (`2 files · Preparing highlights…`) counted the
	 * same set a second time beside its own rows.
	 */
	const stateLine = () =>
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
					<span className="text-ink-muted">
						{COPY_FAILED}
						{failedCause ? ` — ${failedCause}` : ""}
					</span>
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
				placeholder={t("ui.chat.canonical.supplement.adjust_placeholder")}
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
				{t("ui.chat.canonical.supplement.send")}
			</button>
		</div>
	) : null;

	if (disposition === "nothing") return null;

	/*
	 * THE FILES SECTION, computed once and shared by BOTH forms (the operator
	 * decision of 2026-10-16): the condensed block shows the same files section
	 * as its expanded self — image-kind files as the thumbnail grid
	 * (`supplement-image-grid.tsx`), the rest as the compact row grammar, the
	 * `N more files` disclosure verbatim — so the two forms cannot drift apart.
	 * The files half comes first (memo §0), and the small-set arms apply when no
	 * COMPONENT rides the row and the whole known set is two files or fewer (the
	 * TUI's own rule, `total_files <= 2 and not components_present`); they serve
	 * the preparing arm's callouts too — they are the same callouts a moment
	 * earlier.
	 */
	let filesSection: JSX.Element | null = null;
	if (files.length > 0 || moreCount > 0) {
		const imageFiles: SupplementFile[] = [];
		const rowFiles: SupplementFile[] = [];
		for (const file of files) {
			if (fileKind(file.path) === "image") imageFiles.push(file);
			else rowFiles.push(file);
		}
		const summaryArm =
			totalFiles <= 2 && components.length === 0 && moreCount === 0;
		filesSection = (
			<div
				className="flex flex-col gap-1"
				data-supplement-files-summary={summaryArm ? "" : undefined}
				data-supplement-files={summaryArm ? undefined : ""}
			>
				{imageFiles.length > 0 && (
					/*
					 * The grid's own bottom step keeps the section's 4px row pitch from
					 * gluing pictures to the rows under them when a set is mixed.
					 */
					<SupplementImageGrid
						files={imageFiles}
						cwd={cwd}
						pane={pane}
						className={
							rowFiles.length > 0 || moreCount > 0 ? "mb-1" : undefined
						}
					/>
				)}
				{rowFiles.map((file) => {
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

	/*
	 * THE SOUNDS SECTION (sound phase): the same section grammar as the files
	 * above - a 4px-pitched column of rows - with the shared compact player as
	 * the row's content. It draws in the condensed form too, for the reason the
	 * files section does (the 2026-10-16 ruling: the block shows the media a
	 * reader can act on while the run is folded), and it draws AFTER the files
	 * because a sound's row is taller than a file row and the compact rows read
	 * first. No heading: the block's own rule is that position carries the
	 * relationship (the header comment above).
	 */
	const soundsSection =
		sounds.length > 0 ? (
			/*
			 * A COLLAGE, NOT A COLUMN. Fourteen sounds rendered as fourteen
			 * stacked rows is an unreadable wall that pushes the answer off the
			 * screen; the producer now sends every generated sound, so the layout
			 * has to bound its height without hiding any of them (no slice, no
			 * cap, no pagination - the brief's rule). `auto-fit` over a 15rem
			 * minimum makes the grid answer to the BLOCK's own width: a typical
			 * answer column fits two or three cells, a narrow pane one, and a
			 * single sound still fills the row (auto-fit collapses the empty
			 * tracks). The container is the same element in the expanded and
			 * condensed forms - collapsing changes frame mounting, never media.
			 */
			<div
				data-supplement-sounds=""
				className={
					sounds.length > 1
						? "grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-1"
						: "flex flex-col gap-1"
				}
			>
				{sounds.map((sound) => (
					<SupplementSoundLine
						key={sound.attachment}
						sound={sound}
						sessionId={sessionId}
					/>
				))}
			</div>
		) : null;

	/*
	 * Keep the answer's media in ONE durable strip, outside the graphics-only
	 * condensation below. Separate expanded/condensed returns previously used
	 * a files/components emptiness check that discarded a sound-only finish
	 * before reaching its player. The transcript already positions this row as
	 * a sibling of the trace; collapsing work must change only frame mounting,
	 * never the audio, image, or file callouts that make the answer actionable.
	 */
	const graphicsBody = (
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
	);

	return (
		<div
			className="flex flex-col gap-2"
			data-supplement-record={record.anchor}
			data-supplement-condensed={condensed ? "" : undefined}
		>
			{filesSection}
			{soundsSection}
			{stateLine()}

			{!condensed && record.detail?.includes("prepared:unsupported") && (
				<p className="text-meta text-ink-muted" data-supplement-refusal="">
					{t("ui.chat.canonical.supplement.preview_unavailable")}
				</p>
			)}
			{!condensed &&
				(disposition === "failed_retry" ||
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
									{record.model && (
										<p>
											{t("ui.chat.canonical.supplement.details.model", {
												name: record.model,
											})}
										</p>
									)}
									<p>
										{t("ui.chat.canonical.supplement.details.attempts", {
											count: record.attempts?.length ?? 0,
										})}
									</p>
									{record.detail?.map((line) => (
										<p key={line}>{diagnosticDisplay(line)}</p>
									))}
								</div>
							</Disclosure>
						)}
					</div>
				)}
			{(disposition === "preparing" || disposition === "files_preparing") &&
				adjustLine}
			{disposition === "block" &&
				components.length > 0 &&
				(condensed ? (
					<Disclosure
						open={localGraphicsOpen}
						onOpenChange={(open) => {
							// Closing revokes both grants: reopening must start at the
							// budgeted head, not resurrect an earlier overflow request.
							if (!open) setShowAll(false);
							setLocalGraphics({ identity, open });
						}}
						chevronClassName="text-ink-dim"
						rowClassName="min-h-0 py-0"
						summary={
							<span data-supplement-graphics-reveal="">
								{graphicRevealText(
									components.length,
									localGraphicsOpen,
									head.length,
								)}
							</span>
						}
					>
						{/*
						 * The shared Disclosure indents its disclosed body by one chevron
						 * column (`ml-5`). The graphic is answer content, not detail
						 * belonging to the Hide row, so this one body opts back out with
						 * the SAME spacing token: the frame keeps the answer paragraph's
						 * left edge and width in both forms, and expanding the work bar
						 * does not shift it. Local to this call site — the shared
						 * primitive's contract, and every other disclosure's indent, is
						 * unchanged.
						 */}
						<div className="-ml-5 w-[calc(100%+1.25rem)]">{graphicsBody}</div>
					</Disclosure>
				) : (
					graphicsBody
				))}
		</div>
	);
});
