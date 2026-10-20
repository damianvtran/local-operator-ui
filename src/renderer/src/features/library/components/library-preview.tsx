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
	Lock,
	LockOpen,
	Maximize2,
	Star,
	X,
} from "lucide-react";
import type { FC } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DesktopLibraryAsset } from "../../../../../shared/desktop-control-contract";
import {
	useAssignLibraryTags,
	useLibraryTagMutations,
	useLibraryTags,
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

	// biome-ignore lint/correctness/useExhaustiveDependencies: the signal is a trigger, not a read.
	useEffect(() => {
		if (!focusRequest) return;
		if (focusRequest.field === "tags") {
			/* A short preview keeps the tag row behind Details: an edit command
			 * must reveal the field it is about, not aim at an unmounted node. */
			setDetailsOpen(true);
			tagsRef.current?.scrollIntoView({ block: "center" });
			setTagEditSignal((signal) => signal + 1);
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

	const toggleFlag = async (field: "favorite" | "locked") => {
		try {
			await update.mutateAsync({
				id: asset.id,
				fields: { [field]: !asset[field] },
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
			className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface"
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
						<InlineEditText
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
								onClick={() => void toggleFlag("favorite")}
							>
								<Star
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
								onClick={() => void toggleFlag("locked")}
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
							onEditTags={() => {
								setDetailsOpen(true);
								tagsRef.current?.scrollIntoView({ block: "center" });
								setTagEditSignal((signal) => signal + 1);
							}}
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
					<span>{formatBytes(asset.size_bytes)}</span>
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
							className="h-auto max-w-full min-w-0 justify-start whitespace-normal text-left"
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
					mediaSiblings={mediaSiblings}
				/>
			</div>
			<div className="shrink-0">
				<LibraryComposer
					asset={asset}
					focusSignal={composerFocusSignal}
					compact={compact}
				/>
			</div>
		</div>
	);
};
