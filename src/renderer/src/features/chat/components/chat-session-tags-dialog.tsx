import { nextPickerEscapeAction } from "@features/chat/chat-tag-escape";
import {
	TAG_REGISTRY_LIMIT,
	TAG_SELECTION_LIMIT,
	hasTagName,
	tagNameIssue,
} from "@features/chat/chat-tag-picker";
import { useChatTagAssignment } from "@features/chat/use-chat-tag-assignment";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import {
	isTagsConflict,
	useSessionTagsStore,
} from "@shared/store/session-tags-store";
import { showSuccessToast } from "@shared/utils/toast-manager";
import { useEffect, useRef, useState } from "react";
import { ManageTagsDialog } from "./manage-tags-dialog";
import { TagPickerCombobox } from "./tag-picker-combobox";

/** Mount per invocation. Every toggle, clear and tag creation writes the
 * assignment immediately: there is no Apply, so closing the dialog or pressing
 * Escape cannot discard a change that was already shown as made. A failed write
 * restores the previous selection and says so; the next press is the retry.
 */
export function ChatSessionTagsDialog({
	row,
	onClose,
	returnFocus,
	onMove,
}: {
	row: CanonicalSessionRow;
	onClose: () => void;
	returnFocus: () => void;
	onMove?: (target: string) => Promise<void>;
}) {
	useI18nLocale();
	const [managing, setManaging] = useState(false);
	const pickerBody = useRef<HTMLDivElement>(null);
	const heading = useRef<HTMLHeadingElement>(null);
	const manageButton = useRef<HTMLButtonElement>(null);
	const savedScroll = useRef(0);
	const returningFromManage = useRef(false);
	const returnToPicker = () =>
		queueMicrotask(() => {
			// Radix removes the closing FocusScope from its stack after the autofocus
			// callback returns. Restore in the following microtask, not on animation
			// frames (which an inactive browser can suspend).
			const invoker = manageButton.current;
			if (!invoker?.isConnected) return;
			invoker.focus({ preventScroll: true });
			if (pickerBody.current)
				pickerBody.current.scrollTop = savedScroll.current;
		});
	const {
		categories,
		loading,
		loadError,
		fetchCategories,
		selected,
		primary: effectivePrimary,
		pending,
		error,
		notice,
		toggle,
		setPrimaryTag,
		clear,
		createAndAssign,
	} = useChatTagAssignment({
		sessionId: row.session_id,
		tags: row.tags,
		primary: row.primary ?? null,
		revision: row.tags_revision ?? null,
	});
	const [movePending, setMovePending] = useState(false);
	const [moveError, setMoveError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const [listOpen, setListOpen] = useState(true);
	const restoreInput = useRef(false);
	useEffect(() => {
		if (!pending && restoreInput.current) {
			restoreInput.current = false;
			input.current?.focus();
		}
	}, [pending]);
	useEffect(() => {
		if (error && pickerBody.current) pickerBody.current.scrollTop = 0;
	}, [error]);
	const saved = (fallback: string | null) => {
		// Resolve against the store, never this render's closure: create writes the
		// registry and assigns in one interaction, so a freshly created tag exists
		// only after the await and a captured category list would name the wrong
		// group ("Shown under Untagged" for the tag just created as primary).
		const tag = useSessionTagsStore
			.getState()
			.categories.find((entry) => entry.id === fallback);
		showSuccessToast(
			tag
				? t("ui.chat.tags.updated_grouped", { tag: tag.name })
				: t("ui.chat.tags.updated_untagged"),
		);
	};
	const toggleAndConfirm = async (id: string) => {
		const result = await toggle(id);
		if (result.ok) saved(result.primary);
	};
	const clearAndConfirm = async () => {
		const result = await clear();
		if (result.ok) saved(null);
	};
	const setPrimaryAndConfirm = async (id: string) => {
		const result = await setPrimaryTag(id);
		if (result.ok) saved(id);
	};
	const create = async () => {
		if (pending || createIssue || issue || loading || loadError) return;
		const name = query.trim();
		const result = await createAndAssign(name);
		// Only an accepted registry write clears the field: a failed create keeps the
		// typed name so it can be corrected instead of retyped.
		if (!result) return;
		setQuery("");
		restoreInput.current = true;
		input.current?.focus();
		if (result.assigned) saved(result.primary);
	};
	const issue = tagNameIssue(query);
	const createIssue =
		categories.length >= TAG_REGISTRY_LIMIT
			? t("ui.chat.tags.registry_limit")
			: selected.length >= TAG_SELECTION_LIMIT
				? t("ui.chat.tags.selection_limit")
				: issue === "reserved"
					? t("ui.chat.tags.name_reserved")
					: issue === "long"
						? t("ui.chat.tags.name_long")
						: hasTagName(categories, query)
							? t("ui.chat.tags.duplicate_name", { name: query.trim() })
							: null;

	if (onMove)
		return (
			<Dialog
				open
				onOpenChange={(open) => {
					if (!open && !pending) onClose();
				}}
			>
				<DialogContent
					className="flex max-h-[calc(100dvh-32px)] w-[min(420px,calc(100vw-32px))] flex-col"
					closeDisabled={pending}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						returnFocus();
					}}
					onInteractOutside={(event) => {
						if (pending) event.preventDefault();
					}}
					onEscapeKeyDown={(event) => {
						if (pending) event.preventDefault();
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{t("ui.chat.tags.move_title", {
								title: row.title || row.session_id,
							})}
						</DialogTitle>
						<DialogDescription>
							{t("ui.chat.tags.move_description")}
						</DialogDescription>
					</DialogHeader>
					{/* Focus outlines need their own gutter inside this clip, like the row menu. */}
					<div className="min-h-0 overflow-y-auto p-1">
						{loading ? (
							<output>{t("ui.chat.tags.loading")}</output>
						) : loadError ? (
							<div role="alert">
								<p>{t("ui.chat.tags.load_failed")}</p>
								<Button onClick={() => void fetchCategories()}>
									{t("ui.chat.tags.retry")}
								</Button>
							</div>
						) : (
							[
								...categories.map((tag) => ({ id: tag.id, name: tag.name })),
								{ id: "untagged", name: t("ui.chat.tags.untagged") },
							].map((tag) => (
								<Button
									key={tag.id}
									variant="ghost"
									className="min-h-8 w-full justify-start whitespace-normal break-words text-left"
									disabled={movePending}
									onClick={() => {
										setMovePending(true);
										setMoveError(null);
										void onMove(tag.id)
											.then(onClose)
											.catch((error: unknown) => {
												setMoveError(
													t(
														isTagsConflict(error)
															? "ui.chat.tags.changed_elsewhere"
															: "ui.chat.tags.move_failed",
													),
												);
											})
											.finally(() => setMovePending(false));
									}}
								>
									{tag.name}
								</Button>
							))
						)}
					</div>
					{moveError && (
						<p role="alert" className="text-danger">
							{moveError}
						</p>
					)}
					<DialogFooter>
						<Button variant="ghost" disabled={pending} onClick={onClose}>
							{t("ui.chat.tags.cancel")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		);
	return (
		<>
			<Dialog
				open={!managing}
				onOpenChange={(open) => {
					if (!open && !pending && !managing) onClose();
				}}
			>
				<DialogContent
					className="flex h-[min(560px,calc(100dvh-32px))] w-[min(420px,calc(100vw-32px))] flex-col max-[359px]:p-4"
					closeDisabled={pending}
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						if (returningFromManage.current) returnToPicker();
						else input.current?.focus();
					}}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						if (!managing) returnFocus();
					}}
					onInteractOutside={(event) => {
						if (pending) event.preventDefault();
					}}
					onEscapeKeyDown={(event) => {
						if (event.isComposing || event.keyCode === 229) {
							event.preventDefault();
							return;
						}
						const action = nextPickerEscapeAction({ pending, listOpen });
						if (action === "ignore") event.preventDefault();
						else if (action === "collapse") {
							event.preventDefault();
							setListOpen(false);
						}
						// "close" leaves the event unprevented: the dialog layer owns
						// dismissal, and Escape still writes nothing.
					}}
				>
					<DialogHeader className="shrink-0">
						<DialogTitle ref={heading}>{t("ui.chat.tags.label")}</DialogTitle>
						<DialogDescription
							className="line-clamp-2 break-words"
							title={row.title || row.session_id}
						>
							{row.title || row.session_id}
						</DialogDescription>
					</DialogHeader>
					<div
						ref={pickerBody}
						data-tag-dialog-body
						className="min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto p-1"
						aria-busy={loading || pending}
					>
						{pending && <output>{t("ui.chat.tags.create_pending")}</output>}
						{error && (
							<div role="alert" className="text-body-sm text-danger">
								<p>{error}</p>
							</div>
						)}
						<p className="text-body-sm text-ink-muted">
							{t("ui.chat.tag_dialogs.picker_description")}
						</p>
						<TagPickerCombobox
							categories={categories}
							fallbackNames={row.tags ?? []}
							selected={selected}
							primary={effectivePrimary}
							query={query}
							setQuery={setQuery}
							listOpen={listOpen}
							setListOpen={setListOpen}
							disabled={pending}
							unready={loading || loadError !== null}
							input={input}
							toggle={(id) => void toggleAndConfirm(id)}
							create={() => void create()}
							createIssue={createIssue}
						/>
						{loading && <output>{t("ui.chat.tags.loading")}</output>}
						{loadError && (
							<div role="alert">
								<p>{t("ui.chat.tags.load_failed")}</p>
								<Button onClick={() => void fetchCategories()}>
									{t("ui.chat.tags.retry")}
								</Button>
							</div>
						)}
						{!loading &&
							!loadError &&
							(selected.length >= 2 ? (
								<fieldset className="min-w-0 space-y-1 border-t border-hairline pt-2">
									<legend className="text-meta text-ink-muted">
										{t("ui.chat.tags.group_under")}
									</legend>
									{selected.map((id) => (
										<label
											key={id}
											className="flex min-h-8 items-center gap-2 text-body-sm"
										>
											<input
												type="radio"
												className="accent-accent"
												name="primary-tag"
												disabled={pending || loading || !!loadError}
												checked={effectivePrimary === id}
												onChange={() => void setPrimaryAndConfirm(id)}
											/>
											<bdi className="min-w-0 break-words">
												{categories.find((tag) => tag.id === id)?.name}
											</bdi>
										</label>
									))}
								</fieldset>
							) : (
								<p className="text-meta text-ink-muted">
									{selected.length ? (
										<>
											{t("ui.chat.tags.primary")}:{" "}
											{
												categories.find((tag) => tag.id === effectivePrimary)
													?.name
											}
										</>
									) : (
										t("ui.chat.tags.untagged")
									)}
								</p>
							))}
						<div className="flex flex-wrap gap-2">
							<Button
								variant="ghost"
								disabled={pending || loading || !!loadError || !selected.length}
								onClick={() => void clearAndConfirm()}
							>
								{t("ui.chat.tags.clear")}
							</Button>
							<Button
								ref={manageButton}
								variant="ghost"
								disabled={pending || loading || !!loadError}
								onClick={() => {
									savedScroll.current = pickerBody.current?.scrollTop ?? 0;
									returningFromManage.current = false;
									setManaging(true);
								}}
							>
								{t("ui.chat.tags.manage")}
							</Button>
						</div>
						<output aria-live="polite" className="sr-only">
							{notice}
						</output>
					</div>
					<DialogFooter
						data-tag-dialog-footer
						className="shrink-0 flex-row justify-end max-[359px]:flex-col-reverse"
					>
						<Button variant="ghost" disabled={pending} onClick={onClose}>
							{t("ui.chat.tag_dialogs.close")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			{managing && (
				<ManageTagsDialog
					onClose={() => {
						returningFromManage.current = true;
						setManaging(false);
					}}
					returnFocus={returnToPicker}
				/>
			)}
		</>
	);
}
