import {
	TAG_REGISTRY_LIMIT,
	TAG_SELECTION_LIMIT,
} from "@features/chat/chat-tag-picker";
import { useChatTagAssignment } from "@features/chat/use-chat-tag-assignment";
import { registryNameIssue } from "@features/chat/use-chat-tag-registry";
import {
	Button,
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import { useRef, useState } from "react";
import { TagPickerCombobox } from "./tag-picker-combobox";

/**
 * The row's Tags popover (sidebar tags v3, D1): the one place a conversation's
 * tags are assigned from the sidebar, anchored to the row the user is already
 * on instead of a modal dialog over the list they are organising.
 *
 * WHY A POPOVER AND NOT A MENU SUBMENU: Radix menus answer every printable key
 * with typeahead, which moves focus off a text field inside them - the defect
 * `chat-header-identity-menu.tsx` already documented and fixed the same way.
 * So the body is the app's own combobox in a non-modal Popover.
 *
 * WHY A VIRTUAL ANCHOR: the row's button remounts when a write regroups the
 * row under another header, so an `asChild` anchor would detach mid-session.
 * `virtualRef` measures the row by its stable `data-session-row` id on every
 * position update, and falls back to the last known box while a remount is in
 * flight.
 *
 * WRITE MODEL (unchanged from the dialog it replaces): every toggle writes on
 * the press through `useChatTagAssignment`; there is no Apply, so dismissing
 * cannot discard anything. A write in flight keeps the popover open (Escape and
 * outside presses are swallowed) so a rollback is never hidden.
 */
export function ChatTagPopover({
	row,
	onClose,
	returnFocus,
	grouped,
	onShowGroups,
}: {
	row: CanonicalSessionRow;
	onClose: () => void;
	returnFocus: () => void;
	/** Whether the sidebar currently draws tag groups. */
	grouped: boolean;
	/** Turns grouping on from the popover's footer (the discoverability bridge). */
	onShowGroups: () => void;
}) {
	useI18nLocale();
	const {
		categories,
		loading,
		loadError,
		fetchCategories,
		selected,
		primary,
		pending,
		error,
		notice,
		toggle,
		showUnder,
		createAndAssign,
	} = useChatTagAssignment({
		sessionId: row.session_id,
		tags: row.tags,
		primary: row.primary ?? null,
		revision: row.tags_revision ?? null,
	});
	const [query, setQuery] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const restoreRowFocus = useRef(true);
	const lastBox = useRef<DOMRect>(new DOMRect());
	const anchor = useRef({
		getBoundingClientRect: () => {
			const node = document.querySelector<HTMLElement>(
				`[data-session-row="${CSS.escape(row.session_id)}"]`,
			);
			if (node) lastBox.current = node.getBoundingClientRect();
			return lastBox.current;
		},
	});
	const unready = loading || loadError !== null;
	const createIssue =
		categories.length >= TAG_REGISTRY_LIMIT
			? t("ui.chat.tags.registry_limit")
			: selected.length >= TAG_SELECTION_LIMIT
				? t("ui.chat.tags.selection_limit")
				: query.trim()
					? registryNameIssue(query)
					: null;
	const create = async () => {
		if (pending || createIssue || unready) return;
		const result = await createAndAssign(query.trim());
		// A refused registry write keeps the typed name so it can be corrected.
		if (!result) return;
		setQuery("");
		input.current?.focus({ preventScroll: true });
	};
	const shownUnder = categories.find((tag) => tag.id === primary)?.name;
	return (
		<Popover
			open
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<PopoverAnchor virtualRef={anchor} />
			<PopoverContent
				data-chat-tag-popover
				// biome-ignore lint/a11y/useSemanticElements: Radix owns positioning/focus as a div; region overrides its default dialog role for this non-modal picker.
				role="region"
				side="right"
				align="start"
				sideOffset={2}
				collisionPadding={8}
				aria-label={t("ui.chat.tags.label")}
				className="flex max-h-[min(360px,var(--radix-popover-content-available-height))] w-auto min-w-56 max-w-[280px] flex-col p-1"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					input.current?.focus({ preventScroll: true });
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					if (restoreRowFocus.current) returnFocus();
				}}
				onInteractOutside={(event) => {
					if (pending) event.preventDefault();
					// The user's next action dismisses this non-modal surface. Do not
					// pull focus back to the row over the control they just clicked.
					else restoreRowFocus.current = false;
				}}
				onEscapeKeyDown={(event) => {
					// Claim the press even when dismissing: the global interrupt-on-Escape
					// listener checks defaultPrevented in a microtask, and this Escape is
					// addressed to the picker, never to a running conversation.
					event.preventDefault();
					if (!event.isComposing && event.keyCode !== 229 && !pending)
						onClose();
				}}
				onKeyDown={(event) => {
					/*
					 * Escape must not reach the sidebar's own keyDown (which would move
					 * focus to the search field) or the interrupt-on-Escape hook: the
					 * press was addressed to this popover. Radix's dismiss layer has
					 * already seen it on the document by the time this bubbles.
					 */
					if (event.key === "Escape") event.stopPropagation();
					// Tab leaves a transient surface rather than looping in a focus trap.
					if (event.key === "Tab" && !pending) {
						event.preventDefault();
						onClose();
					}
				}}
			>
				<TagPickerCombobox
					categories={categories}
					selected={selected}
					primary={primary}
					query={query}
					setQuery={setQuery}
					disabled={pending}
					unready={unready}
					input={input}
					toggle={(id) => void toggle(id)}
					showUnder={(id) => void showUnder(id)}
					create={() => void create()}
					createIssue={createIssue}
				/>
				{loading ? (
					<output className="flex h-24 items-center px-2 text-body-sm text-ink-muted">
						{t("ui.chat.tags.loading")}
					</output>
				) : null}
				{loadError && (
					<div role="alert" className="space-y-1 px-2 py-2 text-body-sm">
						<p>{t("ui.chat.tags.load_failed")}</p>
						<Button
							variant="ghost"
							className="h-7 px-1 text-meta"
							onClick={() => void fetchCategories()}
						>
							{t("ui.chat.tags.retry")}
						</Button>
					</div>
				)}
				{error && (
					<p role="alert" className="px-2 py-1 text-meta text-danger">
						{error}
					</p>
				)}
				{!unready && selected.length >= TAG_SELECTION_LIMIT && (
					<p className="px-2 py-1 text-meta text-ink-muted">
						{t("ui.chat.tags.selection_limit")}
					</p>
				)}
				{!unready && (
					<div className="mt-1 flex min-h-7 items-center gap-2 border-hairline border-t px-2 pt-1 text-meta text-ink-dim">
						{grouped ? (
							<span className="min-w-0 flex-1 truncate">
								{shownUnder
									? t("ui.chat.tags.shown_under", { tag: shownUnder })
									: t("ui.chat.tags.shown_untagged")}
							</span>
						) : (
							<>
								<span className="min-w-0 flex-1">
									{t("ui.chat.tags.hidden")}
								</span>
								<Button
									variant="ghost"
									className="h-6 px-1 text-meta"
									onClick={onShowGroups}
								>
									{t("ui.chat.tags.show_groups")}
								</Button>
							</>
						)}
						<span>
							{t("ui.chat.tags.selection_count", {
								count: String(selected.length),
							})}
						</span>
					</div>
				)}
				<output aria-live="polite" className="sr-only">
					{notice}
				</output>
			</PopoverContent>
		</Popover>
	);
}
