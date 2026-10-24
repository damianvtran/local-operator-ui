/**
 * The preview dock: metadata, actions, the per-kind viewer and the composer.
 *
 * WIDTH AND PLACEMENT ARE THE PAGE'S; this component owns the inside. On wide
 * windows it is the right-hand dock; below `lg` the page mounts the same tree
 * inside a Sheet, so there is one preview implementation rather than a dock and
 * a separate mobile screen that drift (`design § 6.1`: narrow widths collapse
 * the preview into the selected route).
 *
 * METADATA IS OPTIMISTIC THROUGH THE MUTATION, NOT THROUGH LOCAL STATE: the
 * field shows what the user typed while the write is in flight, and a refusal
 * re-reads the row (`useUpdateLibraryAsset`'s onError). That is the contract's
 * own rule - user edits are optimistic but re-read after a refusal.
 *
 * TAGS ARE A SEPARATE VOCABULARY. `TagsInputChips` edits NAMES; the assign route
 * takes tag IDS, so a name the vocabulary does not hold is created first. That
 * keeps a typed tag and the rail's counts in one registry.
 */

import {
	InlineEditText,
	InlineTagEditor,
} from "@shared/components/common/inline-edit";
import { Badge, Button, Tooltip } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import {
	ChevronDown,
	ChevronLeft,
	Download,
	ExternalLink,
	FolderOpen,
	Heart,
	Lock,
	LockOpen,
	Maximize2,
	X,
} from "lucide-react";
import type { FC } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DesktopLibraryAsset } from "../../../../../shared/desktop-control-contract";
import {
	isPathBacked,
	useLibraryFileWatch,
} from "../hooks/use-library-file-watch";
import {
	useAssignLibraryTags,
	useLibraryTagMutations,
	useLibraryTags,
	useUnlinkAssetChat,
	useUpdateLibraryAsset,
} from "../hooks/use-library-queries";
import { saveAssetCopy } from "../library-download";
import {
	assetDisplayName,
	formatBytes,
	originGroupLabelKey,
	relativeTime,
} from "../library-model";
import { LibraryAssetMenu } from "./library-asset-menu";
import { LibraryComposer } from "./library-composer";
import { KindGlyph } from "./library-glyph";
import { LibraryTrajectory } from "./library-trajectory";
import { LibraryViewer } from "./library-viewers";

export type LibraryPreviewFocus = "metadata" | "tags";

type LibraryPreviewProps = {
	asset: DesktopLibraryAsset;
	nowMs: number;
	onClose: () => void;
	onOpenConversation: (sessionId: string) => void;
	onFilterSession: (sessionId: string) => void;
	onAsk: () => void;
	onToggleFavorite: () => void;
	/** Bumped by the card menu's "Ask about this asset". */
	composerFocusSignal: number;
	/** A requested field focus, with the counter that makes a repeat fire. */
	focusRequest: { field: LibraryPreviewFocus; signal: number } | null;
	/** Standalone selected-route mode: a Back control replaces the dock's X. */
	standalone?: boolean;
	/** Open the same preview as a full-workspace document view. */
	onExpand?: () => void;
	/**
	 * The listing's image and video rows, in display order, so the media viewer's
	 * full-screen lightbox can offer its siblings. The page owns the listing; the
	 * preview only passes it through.
	 */
	mediaSiblings?: readonly DesktopLibraryAsset[];
};

/** The ordered tags an asset's names map to, creating unknown names first. */
function useCommitTags(asset: DesktopLibraryAsset) {
	const vocabulary = useLibraryTags(true);
	const create = useLibraryTagMutations().create;
	const assign = useAssignLibraryTags();
	const [saving, setSaving] = useState(false);

	const commit = async (names: string[]) => {
		setSaving(true);
		try {
			const known = new Map(
				[...(vocabulary.data ?? []), ...asset.tags].map((tag) => [
					tag.name.toLowerCase(),
					tag.id,
				]),
			);
			const ids: string[] = [];
			for (const raw of names) {
				const name = raw.trim().toLowerCase();
				if (!name) continue;
				let id = known.get(name);
				if (!id) {
					const created = await create.mutateAsync({ name });
					id = created.id;
					known.set(name, id);
				}
				if (!ids.includes(id)) ids.push(id);
			}
			await assign.mutateAsync({ id: asset.id, tags: ids });
		} catch (error) {
			showErrorToast(
				error instanceof Error && error.message
					? error.message
					: t("ui.library.preview.tags_not_saved"),
			);
		} finally {
			setSaving(false);
		}
	};

	return { commit, saving };
}

export const LibraryPreview: FC<LibraryPreviewProps> = ({
	asset,
	nowMs,
	onClose,
	onOpenConversation,
	onFilterSession,
	onAsk,
	onToggleFavorite,
	composerFocusSignal,
	focusRequest,
	standalone = false,
	onExpand,
	mediaSiblings,
}) => {
	useI18nLocale();
	const update = useUpdateLibraryAsset();
	const { commit, saving: tagsSaving } = useCommitTags(asset);
	const rootRef = useRef<HTMLDivElement>(null);
	const nameRef = useRef<HTMLDivElement>(null);
	const tagsRef = useRef<HTMLDivElement>(null);
	/*
	 * EDIT COMMANDS ARE SIGNALS, not node queries. The card menu and the page's
	 * focus request used to reach into the metadata field's DOM and click its
	 * first button; the inline editor has no such button in its read state, and
	 * a primitive should expose the gesture it supports rather than have callers
	 * reconstruct it from its markup. Each counter opens the field whose value it
	 * belongs to.
	 */
	const [nameEditSignal, setNameEditSignal] = useState(0);
	const [tagEditSignal, setTagEditSignal] = useState(0);
	/* A tag command that must reveal the row before opening it is carried here
	 * for one commit; `requestTagEdit` below records why the bump cannot batch
	 * with the reveal. */
	const [pendingTagEdit, setPendingTagEdit] = useState(false);
	/*
	 * A COMMAND BELONGS TO THE ASSET IT WAS ISSUED ON (agent review round 2,
	 * M2). The editors are keyed by asset id, so a switch remounts them; a
	 * counter left at its last value would travel into the new mount, and the
	 * primitive had no way to tell that stale number from a command meant for
	 * the asset now selected - it opened the new asset's editor with nobody
	 * having asked, and the next keystroke would have renamed the wrong row.
	 *
	 * THE RESET HAPPENS DURING RENDER, NOT IN AN EFFECT, and the difference is
	 * load-bearing: a card's menu runs `onEditMetadata`/`onEditTags`, which
	 * navigate to that card AND bump the page's focus request in the SAME
	 * commit. An effect would clear the counters after that commit and swallow
	 * the command it carried; adjusting the state here restarts the render
	 * before anything mounts, so the new asset's editors see a zero baseline and
	 * the command effect below is free to bump it for the asset it named.
	 */
	const [signalAssetId, setSignalAssetId] = useState(asset.id);
	if (signalAssetId !== asset.id) {
		setSignalAssetId(asset.id);
		setNameEditSignal(0);
		setTagEditSignal(0);
		setPendingTagEdit(false);
	}
	/*
	 * SHORT PREVIEWS COMPACT THE METADATA (design spec §2): below 700px of
	 * preview height the description and tag editor collapse behind Details, so
	 * the viewer keeps a usable slide/document area instead of being squeezed
	 * between a full metadata block and the composer's reserved footer. Height,
	 * not viewport, is the fact: the dock and the full-view route have different
	 * budgets at the same window size.
	 */
	const [compact, setCompact] = useState(false);
	const [detailsOpen, setDetailsOpen] = useState(false);
	/*
	 * THE CONVERSATION THE PANEL IS SHOWING, keyed by ASSET for the same reason
	 * the composer's recovery map is: this preview is not remounted on a selection
	 * change, so a single id would paint A's trajectory over B. The linked row's
	 * own id wins when it is present (`asset.chat.session_id`); this map carries
	 * the id from the moment a send creates it until the asset query has re-read
	 * the row — and keeps it when the link write failed, because the message
	 * landed either way.
	 */
	const [liveSessions, setLiveSessions] = useState<Record<string, string>>({});
	/*
	 * COLLAPSE IS PER ASSET AND PER MOUNT, deliberately: it is a reading
	 * preference for the asset on screen, not a durable setting, and a remount
	 * (dock to expanded view) is a fresh look at the same asset.
	 *
	 * BELOW 700px OF PANEL HEIGHT IT DEFAULTS TO COLLAPSED. The same measurement
	 * that compacts the metadata (`compact`) is the guard the bounded trajectory
	 * needs: a 38% well with a 10rem floor plus the composer is more than a short
	 * panel has, and the viewer — the asset the reader came for — is the flex
	 * child that would be squeezed to zero. Collapsed, the header still names the
	 * conversation and the chevron still opens it, so the choice is one press away
	 * rather than unavailable. An explicit press wins over the default.
	 */
	const [collapsedTrajectories, setCollapsedTrajectories] = useState<
		Record<string, boolean>
	>({});
	/*
	 * THE SETTLE'S OWN CLOCK. The watch hook re-probes on this; the trajectory
	 * bumps it when a streaming turn finishes, which is when the agent's write to
	 * the file it was asked about has most likely just happened.
	 */
	const [refreshTick, setRefreshTick] = useState(0);
	/* The trajectory's live turn reading, handed to the composer so a mid-turn
	 * send steers; keyed by session id, which is the identity both sides share. */
	const [streamingBySession, setStreamingBySession] = useState<
		Record<string, boolean>
	>({});
	const file = useLibraryFileWatch(asset, refreshTick);
	const unlink = useUnlinkAssetChat();
	const chatSessionId =
		asset.chat?.session_id ?? liveSessions[asset.id] ?? null;
	const trajectoryCollapsed = collapsedTrajectories[asset.id] ?? compact;
	useLayoutEffect(() => {
		const node = rootRef.current;
		if (!node) return;
		const measure = () => setCompact(node.getBoundingClientRect().height < 700);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	const names = useMemo(() => asset.tags.map((tag) => tag.name), [asset.tags]);
	/* The row exists exactly when it is rendered: a compact preview keeps it
	 * behind Details (see the layout effect above). */
	const tagRowMounted = !compact || detailsOpen;

	/*
	 * A TAG COMMAND WAITS FOR THE ROW IT TARGETS (agent review round 3, R3-1).
	 * A compact preview mounts the tag row only while Details is open. Bumping
	 * the counter in the same update that reveals Details mounts the row with
	 * the already-bumped value - and the primitive reads a value present at
	 * mount as its baseline (a signal is a change, not a mount value: review
	 * round 2, M2), so `startAdding` never runs. The command therefore only
	 * records the intent; the effect below performs the bump after the commit
	 * that mounts the row.
	 *
	 * THE PENDING FLAG IS USED EVEN WHEN THE ROW IS MOUNTED, because a preview
	 * can MOUNT with the command already set (a card's menu navigates to that
	 * asset and bumps the page's focus request in one commit). On that first
	 * render the compact measurement has not run: the initial `compact: false`
	 * paints the row that is about to be hidden, so a "the row exists" test
	 * there takes the direct path and reproduces the batching bug on the next
	 * render. Waiting one commit costs a render and holds in every order.
	 */
	const requestTagEdit = () => {
		setPendingTagEdit(true);
		setDetailsOpen(true);
	};

	useEffect(() => {
		if (!pendingTagEdit) return;
		if (!tagRowMounted) return;
		const row = tagsRef.current;
		if (!row) return;
		setPendingTagEdit(false);
		row.scrollIntoView({ block: "center" });
		setTagEditSignal((signal) => signal + 1);
	}, [pendingTagEdit, tagRowMounted]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the signal is a trigger, not a read.
	useEffect(() => {
		if (!focusRequest) return;
		if (focusRequest.field === "tags") {
			/* A short preview keeps the tag row behind Details: an edit command
			 * must reveal the field it is about, not aim at an unmounted node. */
			requestTagEdit();
		} else {
			nameRef.current?.scrollIntoView({ block: "center" });
			setNameEditSignal((signal) => signal + 1);
		}
	}, [focusRequest?.signal]);

	const saveField = async (fields: {
		name?: string;
		description?: string;
	}) => {
		try {
			await update.mutateAsync({ id: asset.id, fields });
		} catch (error) {
			showErrorToast(
				error instanceof Error && error.message
					? error.message
					: t("ui.library.preview.not_saved"),
			);
			throw error;
		}
	};

	/*
	 * ONE DOOR PER WRITE. The favourite press goes through the page's
	 * `onToggleFavorite`, the same callback the card menu uses, so the
	 * double-press guard and the one mutation live in one place - a second
	 * `update.mutateAsync` here (which is how this button originally worked) made
	 * a press that bypassed the guard and wrote twice when the row had already
	 * been painted optimistically. `locked` has no card-menu twin, so it keeps
	 * the local mutation above.
	 */
	const toggleLocked = async () => {
		try {
			await update.mutateAsync({
				id: asset.id,
				fields: { locked: !asset.locked },
			});
		} catch (error) {
			showErrorToast(
				error instanceof Error && error.message
					? error.message
					: t("ui.library.preview.not_saved"),
			);
		}
	};

	const openExternal = () => {
		if (asset.ref.type === "path" && asset.ref.path) {
			window.api.openFile(asset.ref.path);
			return;
		}
		void saveAssetCopy(asset).catch(() =>
			showErrorToast(t("ui.library.menu.save_failed")),
		);
	};

	return (
		<div
			ref={rootRef}
			className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-surface"
			data-library-preview={asset.id}
			data-library-compact={compact ? "" : undefined}
			data-glass-region="pane"
		>
			<header className="flex shrink-0 flex-col gap-2 px-4 pt-3 pb-2">
				{standalone && (
					<Button
						variant="ghost"
						size="sm"
						className="self-start"
						onClick={onClose}
					>
						<ChevronLeft aria-hidden="true" />
						{t("ui.library.page.back")}
					</Button>
				)}
				{/*
				 * THE HEADER IS ONE LINE: kind glyph, name, actions, vertically
				 * centred. The glyph used to carry a top margin to sit beside a
				 * labelled form field; with the label gone there is nothing to align
				 * it to but the name's own line, so the row centres instead of
				 * offsetting one child.
				 */}
				<div className="flex items-center gap-2">
					<KindGlyph kind={asset.kind} size={18} className="text-ink-dim" />
					<div ref={nameRef} className="min-w-0 flex-1">
						{/*
						 * KEYED BY ASSET, NOT BY POSITION (agent review round 1, M2). The
						 * editor owns an open phase and a draft; an asset switch must
						 * unmount it rather than let asset A's half-typed name render over
						 * B, where the next Enter or blur would write A's text onto B. The
						 * three editors below share the rule. The PREVIEW itself is not
						 * keyed: the composer keeps a pending link per asset and a switch
						 * back must restore it (`scripts/library-page.cases.mjs`, "an
						 * accepted send survives a link failure"), which a full remount
						 * would discard.
						 */}
						<InlineEditText
							key={`${asset.id}:name`}
							value={assetDisplayName(asset)}
							onSave={(value) => saveField({ name: value })}
							label={t("ui.library.preview.name")}
							textClassName="text-heading font-medium"
							field="name"
							startSignal={nameEditSignal}
							className="min-w-0"
						/>
					</div>
					<div className="flex shrink-0 items-center gap-1">
						<Tooltip
							content={
								asset.favorite
									? t("ui.library.menu.unfavorite")
									: t("ui.library.menu.favorite")
							}
						>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-pressed={asset.favorite}
								aria-label={
									asset.favorite
										? t("ui.library.menu.unfavorite")
										: t("ui.library.menu.favorite")
								}
								onClick={onToggleFavorite}
							>
								<Heart
									aria-hidden="true"
									className={
										asset.favorite ? "fill-current text-accent" : undefined
									}
								/>
							</Button>
						</Tooltip>
						<Tooltip
							content={
								asset.locked
									? t("ui.library.preview.unlock")
									: t("ui.library.preview.lock")
							}
						>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-pressed={asset.locked}
								aria-label={
									asset.locked
										? t("ui.library.preview.unlock")
										: t("ui.library.preview.lock")
								}
								onClick={() => void toggleLocked()}
							>
								{asset.locked ? (
									<Lock aria-hidden="true" className="text-accent" />
								) : (
									<LockOpen aria-hidden="true" />
								)}
							</Button>
						</Tooltip>
						{onExpand && (
							<Tooltip content={t("ui.library.preview.expand")}>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={t("ui.library.preview.expand")}
									onClick={onExpand}
								>
									<Maximize2 aria-hidden="true" />
								</Button>
							</Tooltip>
						)}
						<LibraryAssetMenu
							asset={asset}
							onAsk={onAsk}
							onEditMetadata={() => setNameEditSignal((signal) => signal + 1)}
							onEditTags={requestTagEdit}
							onToggleFavorite={onToggleFavorite}
							onOpenConversation={onOpenConversation}
							onFilterSession={onFilterSession}
						/>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t("ui.library.preview.close")}
							onClick={onClose}
						>
							<X aria-hidden="true" />
						</Button>
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-2 text-meta text-ink-muted">
					<Badge variant="neutral">{asset.kind}</Badge>
					<Badge variant="neutral">
						{t(originGroupLabelKey(asset.origin_group))}
					</Badge>
					{/*
					 * THE SIZE IS THE FILE'S, NOT THE INDEX'S, WHEN THE TWO DISAGREE. The
					 * listing row is a snapshot; a path-backed asset can have been rewritten
					 * since, and a preview painting the new bytes over the old size is a quiet
					 * correction. `data-library-file-live` marks the reading as the live
					 * file's (the cases assert it), so the difference is visible rather than
					 * silent. Digest-only assets have no path to watch and keep the row's
					 * figure.
					 */}
					{isPathBacked(asset) &&
					file.mtimeMs !== null &&
					Math.floor(file.mtimeMs / 1000) !== Math.floor(asset.modified_at) ? (
						<span data-library-file-live="">
							{formatBytes(file.sizeBytes ?? asset.size_bytes)}
						</span>
					) : (
						<span>{formatBytes(asset.size_bytes)}</span>
					)}
					{asset.width && asset.height ? (
						<span>
							{asset.width}×{asset.height}
						</span>
					) : null}
					{asset.organized ? (
						<span>
							{t("ui.library.preview.organized_by", {
								by: asset.organized.by ?? "librarian",
								at: relativeTime(asset.organized.at, nowMs),
							})}
						</span>
					) : (
						<span>{t("ui.library.preview.unorganized")}</span>
					)}
					{!asset.exists ? (
						<Badge variant="warning">
							{t("ui.library.preview.missing_file")}
						</Badge>
					) : null}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button variant="secondary" size="sm" onClick={openExternal}>
						<ExternalLink aria-hidden="true" />
						{t("ui.library.preview.open")}
					</Button>
					{asset.ref.type === "path" && asset.ref.path ? (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								if (asset.ref.path) window.api.showItemInFolder(asset.ref.path);
							}}
						>
							<FolderOpen aria-hidden="true" />
							{t("ui.library.preview.reveal")}
						</Button>
					) : null}
					<Button
						variant="ghost"
						size="sm"
						onClick={() =>
							void saveAssetCopy(asset)
								.then(() => showSuccessToast(t("ui.library.menu.saved_a_copy")))
								.catch(() => showErrorToast(t("ui.library.menu.save_failed")))
						}
					>
						<Download aria-hidden="true" />
						{t("ui.library.preview.download")}
					</Button>
					{asset.occurrences[0] ? (
						<Button
							variant="link"
							size="sm"
							className="h-auto max-w-full min-w-0 justify-start whitespace-normal text-start"
							title={`${t("ui.library.preview.from_conversation", {
								title:
									asset.occurrences[0].session_title ||
									asset.occurrences[0].session_id,
							})}`}
							onClick={() =>
								onOpenConversation(asset.occurrences[0].session_id)
							}
						>
							<span className="line-clamp-2 break-words">
								{t("ui.library.preview.from_conversation", {
									title:
										asset.occurrences[0].session_title ||
										asset.occurrences[0].session_id,
								})}
							</span>
						</Button>
					) : null}
				</div>
				{compact && (
					<Button
						variant="ghost"
						size="sm"
						className="self-start"
						aria-expanded={detailsOpen}
						onClick={() => setDetailsOpen((open) => !open)}
					>
						<ChevronDown
							aria-hidden="true"
							className={cn(
								"transition-transform duration-fast",
								detailsOpen && "rotate-180",
							)}
						/>
						{t("ui.library.preview.details")}
					</Button>
				)}
				{(!compact || detailsOpen) && (
					<>
						<InlineEditText
							key={`${asset.id}:description`}
							value={asset.description}
							onSave={(value) => saveField({ description: value })}
							label={t("ui.library.preview.description")}
							placeholder={t("ui.library.preview.add_description")}
							multiline
							rows={3}
							allowEmpty
							textClassName="text-body-sm"
							field="description"
						/>
						<div ref={tagsRef} className="min-w-0">
							<InlineTagEditor
								key={`${asset.id}:tags`}
								value={names}
								onChange={(next) => void commit(next)}
								label={t("ui.library.preview.tags")}
								addLabel={t("ui.library.preview.add_tag")}
								saving={tagsSaving}
								startSignal={tagEditSignal}
							/>
						</div>
					</>
				)}
			</header>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-sunken">
				<LibraryViewer
					asset={asset}
					dense={compact}
					expanded={standalone}
					revision={file.revision}
					mtimeMs={file.mtimeMs}
					mediaSiblings={mediaSiblings}
				/>
			</div>
			{/*
			 * THE TRAJECTORY, BETWEEN THE VIEWER AND THE COMPOSER (operator). It is
			 * mounted when the asset has a linked conversation OR a send created one
			 * this mount; otherwise it renders nothing and the composer sits at the
			 * foot alone. Bounded by its own `basis`/`max-h` so it can never squeeze
			 * the viewer out of usable height, and grounded in `sunken` with the
			 * viewer and composer — one continuous region, never a rule between them.
			 */}
			{chatSessionId && (
				<LibraryTrajectory
					sessionId={chatSessionId}
					/*
					 * A session created by a send has no row title yet; the id is the
					 * honest name until the link write's refetch arrives, and the
					 * header swaps to the real title in that same update.
					 */
					title={asset.chat?.title ?? chatSessionId}
					collapsed={trajectoryCollapsed}
					onToggleCollapsed={() =>
						setCollapsedTrajectories((previous) => ({
							...previous,
							[asset.id]: !trajectoryCollapsed,
						}))
					}
					onOpenChat={() => onOpenConversation(chatSessionId)}
					onUnlink={() => {
						/*
						 * The mutation only clears the asset's link; the LIFTED id that
						 * mounted this panel lives in `liveSessions`, so it has to go too
						 * or the trajectory outlives the association it was showing.
						 */
						setLiveSessions((previous) => {
							const next = { ...previous };
							delete next[asset.id];
							return next;
						});
						unlink.mutate({ id: asset.id });
					}}
					onTurnSettled={() => setRefreshTick((value) => value + 1)}
					onStreamingChange={(streaming) =>
						setStreamingBySession((previous) => ({
							...previous,
							[chatSessionId]: streaming,
						}))
					}
				/>
			)}
			<div className="shrink-0">
				<LibraryComposer
					asset={asset}
					focusSignal={composerFocusSignal}
					showLinkedRow={!chatSessionId}
					onOpenChat={onOpenConversation}
					refreshSignal={refreshTick}
					streaming={chatSessionId ? streamingBySession[chatSessionId] : false}
					onSessionChange={(assetId, sessionId) =>
						setLiveSessions((previous) => ({
							...previous,
							[assetId]: sessionId,
						}))
					}
				/>
			</div>
		</div>
	);
};
