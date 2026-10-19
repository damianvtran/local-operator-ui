import { draftPrimary } from "@features/chat/chat-tag-groups";
import {
	TAG_REGISTRY_LIMIT,
	TAG_SELECTION_LIMIT,
	hasTagName,
	tagNameIssue,
	togglePickerTag,
} from "@features/chat/chat-tag-picker";
import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
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
import {
	type CanonicalSessionRow,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import {
	isTagsConflict,
	useSessionTagsStore,
} from "@shared/store/session-tags-store";
import { showSuccessToast } from "@shared/utils/toast-manager";
import { useEffect, useRef, useState } from "react";
import { ManageTagsDialog } from "./manage-tags-dialog";
import { TagPickerCombobox } from "./tag-picker-combobox";

/** Mount per invocation: assignment is buffered until Apply; registry creation is
 * intentionally a separate durable operation, not an accidental side effect of Cancel.
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
	const {
		categories,
		loading,
		error: loadError,
		fetchCategories,
		replaceCategories,
		assignSessionTags,
	} = useSessionTagsStore();
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
	const [ids, setIds] = useState(() => row.tags?.map((tag) => tag.id) ?? []);
	const [primary, setPrimary] = useState(row.primary ?? null);
	const [query, setQuery] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const [listOpen, setListOpen] = useState(true);
	const [notice, setNotice] = useState("");
	const [conflicted, setConflicted] = useState(false);
	const [pending, setPending] = useState(false);
	const restoreInput = useRef(false);
	useEffect(() => {
		if (!pending && restoreInput.current) {
			restoreInput.current = false;
			input.current?.focus();
		}
	}, [pending]);
	const [error, setError] = useState<string | null>(null);
	const [retry, setRetry] = useState<"apply" | "create" | null>(null);
	// Deleted categories cannot be resubmitted from a stale draft. Preserve the
	// original assignment order so removing the primary previews server fallback.
	const selected = ids.filter((id) => categories.some((tag) => tag.id === id));
	const effectivePrimary = draftPrimary(selected, primary);
	useEffect(() => {
		if (loading || loadError) return;
		const surviving = ids.filter((id) =>
			categories.some((tag) => tag.id === id),
		);
		if (surviving.length === ids.length) return;
		// Keep the surviving assignment order, but never silently resubmit IDs
		// removed by another client while this draft was open.
		setIds(surviving);
		setPrimary((held) => draftPrimary(surviving, held));
		setError(t("ui.chat.tags.registry_changed"));
		setRetry(null);
	}, [categories, ids, loading, loadError]);
	const apply = async () => {
		if (pending || conflicted) return;
		setPending(true);
		setError(null);
		setRetry("apply");
		try {
			await assignSessionTags(
				row.session_id,
				selected,
				effectivePrimary,
				row.tags_revision ?? null,
			);
			const saved = useCanonicalSessionsStore
				.getState()
				.sessions.find((entry) => entry.session_id === row.session_id);
			const savedPrimary = saved ? saved.primary : effectivePrimary;
			const primaryTag = (saved?.tags ?? categories).find(
				(tag) => tag.id === savedPrimary,
			);
			showSuccessToast(
				primaryTag
					? t("ui.chat.tags.updated_grouped", { tag: primaryTag.name })
					: t("ui.chat.tags.updated_untagged"),
			);
			onClose();
		} catch (error) {
			if (error instanceof DesktopControlError && error.status === 422)
				await fetchCategories();
			if (isTagsConflict(error)) {
				setConflicted(true);
				setRetry(null);
			}
			if (
				error instanceof DesktopControlError &&
				error.code === "session_is_remote"
			) {
				setConflicted(true);
				setRetry(null);
				setError(t("ui.chat.tags.remote"));
				return;
			}
			setError(
				t(
					isTagsConflict(error)
						? "ui.chat.tags.changed_elsewhere"
						: "ui.chat.tags.save_failed",
				),
			);
		} finally {
			setPending(false);
		}
	};
	const toggle = (id: string) => {
		const next = togglePickerTag(selected, id);
		const fallback = draftPrimary(next, primary);
		setIds(next);
		setPrimary(fallback);
		setNotice(
			t("ui.chat.tags.selection_status", {
				count: String(next.length),
				name:
					categories.find((tag) => tag.id === fallback)?.name ??
					t("ui.chat.tags.untagged"),
			}),
		);
	};
	const issue = tagNameIssue(query);
	const createIssue =
		selected.length >= TAG_SELECTION_LIMIT
			? t("ui.chat.tags.selection_limit")
			: categories.length >= TAG_REGISTRY_LIMIT
				? t("ui.chat.tags.registry_limit")
				: issue === "reserved"
					? t("ui.chat.tags.name_reserved")
					: issue === "long"
						? t("ui.chat.tags.name_long")
						: hasTagName(categories, query)
							? t("ui.chat.tags.duplicate_name", { name: query.trim() })
							: null;
	const create = async () => {
		if (pending || createIssue || issue || loading || loadError) return;
		const name = query.trim();
		setPending(true);
		setError(null);
		setRetry("create");
		try {
			// A timeout/duplicate may have committed remotely. Refresh BEFORE every
			// attempt, not after submitting a stale full-registry replacement again.
			await fetchCategories();
			const fresh = useSessionTagsStore.getState();
			if (fresh.error) throw new Error();
			if (hasTagName(fresh.categories, name)) {
				setError(t("ui.chat.tags.duplicate_name", { name }));
				setRetry(null);
				return;
			}
			if (fresh.categories.length >= TAG_REGISTRY_LIMIT) {
				setError(t("ui.chat.tags.registry_limit"));
				setRetry(null);
				return;
			}
			await replaceCategories([
				...fresh.categories.map((tag) => ({ id: tag.id, name: tag.name })),
				{ name },
			]);
			const created = useSessionTagsStore
				.getState()
				.categories.find((tag) => tag.name === name);
			if (created) {
				const next = [...selected, created.id];
				setIds(next);
				setPrimary((held) => held ?? created.id);
				setNotice(t("ui.chat.tags.created_name", { name: created.name }));
			}
			setQuery("");
			input.current?.focus();
		} catch {
			setError(t("ui.chat.tags.create_failed"));
		} finally {
			restoreInput.current = true;
			setPending(false);
		}
	};
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
									disabled={pending}
									onClick={() => {
										setPending(true);
										setError(null);
										void onMove(tag.id)
											.then(onClose)
											.catch((error: unknown) => {
												setError(
													t(
														isTagsConflict(error)
															? "ui.chat.tags.changed_elsewhere"
															: "ui.chat.tags.move_failed",
													),
												);
											})
											.finally(() => setPending(false));
									}}
								>
									{tag.name}
								</Button>
							))
						)}
					</div>
					{error && (
						<p role="alert" className="text-danger">
							{error}
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
						if (event.isComposing) {
							event.preventDefault();
							return;
						}
						if (pending) event.preventDefault();
						else if (listOpen) {
							event.preventDefault();
							setListOpen(false);
						}
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
						<p className="text-body-sm text-ink-muted">
							{t("ui.chat.tags.picker_description")}
						</p>
						<TagPickerCombobox
							categories={categories}
							selected={selected}
							primary={effectivePrimary}
							query={query}
							setQuery={setQuery}
							listOpen={listOpen}
							setListOpen={setListOpen}
							disabled={pending}
							unready={loading || loadError !== null}
							input={input}
							toggle={toggle}
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
						{selected.length >= 2 ? (
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
											onChange={() => {
												setPrimary(id);
												setNotice(
													t("ui.chat.tags.selection_status", {
														count: String(selected.length),
														name:
															categories.find((tag) => tag.id === id)?.name ??
															"",
													}),
												);
											}}
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
						)}
						<div className="flex flex-wrap gap-2">
							<Button
								variant="ghost"
								disabled={pending || !selected.length}
								onClick={() => {
									setIds([]);
									setPrimary(null);
									setNotice(t("ui.chat.tags.removed_all"));
								}}
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
						{pending && retry === "create" && (
							<output>{t("ui.chat.tags.create_pending")}</output>
						)}
						{error && (
							<div role="alert" className="text-body-sm text-danger">
								<p>{error}</p>
								{retry && (
									<Button
										disabled={pending}
										onClick={() =>
											void (retry === "create" ? create() : apply())
										}
									>
										{t("ui.chat.tags.retry")}
									</Button>
								)}
							</div>
						)}
						<output aria-live="polite" className="sr-only">
							{notice}
						</output>
					</div>
					<DialogFooter data-tag-dialog-footer className="shrink-0">
						<Button variant="ghost" disabled={pending} onClick={onClose}>
							{t("ui.chat.tags.cancel")}
						</Button>
						<Button
							disabled={pending || loading || loadError !== null || conflicted}
							onClick={() => void apply()}
						>
							{pending && retry === "apply"
								? t("ui.chat.tags.applying")
								: t("ui.chat.tags.apply")}
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
