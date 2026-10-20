import {
	TAG_REGISTRY_LIMIT,
	matchingTags,
	tagNameIssue,
} from "@features/chat/chat-tag-picker";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useSessionTagsStore } from "@shared/store/session-tags-store";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
	DesiredTag,
	TagCategory,
} from "../../../../../shared/desktop-contract";

/** Every action writes the registry immediately; there is no staged draft for
 * Escape, Close or a later action to discard. A failed write leaves the last
 * committed registry untouched and the editor open, so the user's next press is
 * the retry. Explicit ID-bearing replacements preserve assignments and their
 * primary tag.
 */
export function ManageTagsDialog({
	onClose,
	returnFocus,
}: { onClose: () => void; returnFocus: () => void }) {
	useI18nLocale();
	const {
		categories,
		loading,
		error: loadError,
		fetchCategories,
		replaceCategories,
	} = useSessionTagsStore();
	const [query, setQuery] = useState("");
	const [notice, setNotice] = useState("");
	const [name, setName] = useState("");
	const [renaming, setRenaming] = useState<string | null>(null);
	const [rename, setRename] = useState("");
	const [deleting, setDeleting] = useState<Pick<
		TagCategory,
		"id" | "name" | "conversations"
	> | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [editError, setEditError] = useState(false);
	const body = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!error) return;
		if (!editError && body.current) body.current.scrollTop = 0;
		else if (editError)
			document.activeElement
				?.closest("form")
				?.scrollIntoView({ block: "nearest" });
	}, [error, editError]);
	const root = useRef<HTMLDivElement>(null);
	const addInput = useRef<HTMLInputElement>(null);
	const focusRow = (id?: string) => {
		requestAnimationFrame(() => {
			const target = id
				? root.current?.querySelector<HTMLButtonElement>(
						`[data-tag-id="${CSS.escape(id)}"] button:not(:disabled)`,
					)
				: null;
			(target ?? addInput.current)?.focus();
		});
	};
	const uniqueName = (value: string, except?: string) => {
		const issue = tagNameIssue(value);
		setEditError(true);
		if (issue) {
			if (issue !== "blank")
				setError(
					t(
						issue === "reserved"
							? "ui.chat.tags.name_reserved"
							: "ui.chat.tags.name_long",
					),
				);
			return false;
		}
		if (
			categories.some(
				(tag) =>
					tag.id !== except &&
					tag.name.toLocaleLowerCase() === value.trim().toLocaleLowerCase(),
			)
		) {
			setError(t("ui.chat.tags.duplicate_name", { name: value.trim() }));
			return false;
		}
		setError(null);
		return true;
	};
	const desired = (tags: readonly TagCategory[]): DesiredTag[] =>
		tags.map(({ id, name: label }) => ({ id, name: label }));
	const write = async (tags: readonly DesiredTag[]): Promise<boolean> => {
		if (pending) return false;
		setPending(true);
		setError(null);
		try {
			await replaceCategories([...tags]);
			return true;
		} catch {
			setError(t("ui.chat.tags.save_failed"));
			return false;
		} finally {
			setPending(false);
		}
	};
	const beginDelete = (tag: TagCategory) => {
		setEditError(false);
		// Read the store, not a render snapshot: the confirmation must name the
		// tag's current assignment count, and a tag removed elsewhere must not be
		// re-submitted from this stale row.
		const current = useSessionTagsStore
			.getState()
			.categories.find((item) => item.id === tag.id);
		if (!current) {
			setError(t("ui.chat.tags.registry_changed"));
			return;
		}
		setDeleting({
			id: current.id,
			name: current.name,
			conversations: current.conversations,
		});
	};
	const add = async () => {
		if (pending || categories.length >= TAG_REGISTRY_LIMIT || !uniqueName(name))
			return;
		const label = name.trim();
		if (!(await write([...desired(categories), { name: label }]))) return;
		setName("");
		setNotice(t("ui.chat.tags.created_name", { name: label }));
		addInput.current?.focus();
	};
	const renameTag = async (tag: TagCategory) => {
		if (pending || !uniqueName(rename, tag.id)) return;
		const label = rename.trim();
		if (
			!(await write(
				desired(categories).map((item) =>
					item.id === tag.id ? { ...item, name: label } : item,
				),
			))
		)
			return;
		setRenaming(null);
		setQuery("");
		setError(null);
		setNotice(t("ui.chat.tags.renamed_name", { name: label }));
		focusRow(tag.id);
	};
	const move = async (tag: TagCategory, delta: number) => {
		if (query.trim() || pending) return;
		const index = categories.findIndex((item) => item.id === tag.id);
		const target = index + delta;
		if (index < 0 || target < 0 || target >= categories.length) return;
		const next = [...categories];
		[next[index], next[target]] = [next[target], next[index]];
		// The reordered array is the commit: order is what the registry stores,
		// so it must persist on the move itself, not on a later Apply.
		if (await write(desired(next))) focusRow(tag.id);
	};
	const remove = async () => {
		if (!deleting || pending) return;
		const index = categories.findIndex((item) => item.id === deleting.id);
		const next = categories.filter((item) => item.id !== deleting.id);
		const focus = next[index] ?? next[index - 1];
		// The per-action confirmation is the destructive guard; once answered,
		// the deletion is the action and writes immediately.
		if (!(await write(desired(next)))) return;
		setDeleting(null);
		setNotice(t("ui.chat.tag_dialogs.deleted_name", { name: deleting.name }));
		focusRow(focus?.id);
	};
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<DialogContent
				ref={root}
				className="flex h-[min(560px,calc(100dvh-32px))] w-[min(420px,calc(100vw-32px))] flex-col max-[359px]:p-4"
				closeDisabled={pending}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					returnFocus();
				}}
				onInteractOutside={(event) => {
					if (pending) event.preventDefault();
				}}
				onEscapeKeyDown={(event) => {
					if (pending || event.isComposing || event.keyCode === 229)
						event.preventDefault();
					else if (deleting) {
						event.preventDefault();
						const id = deleting.id;
						setDeleting(null);
						focusRow(id);
					} else if (renaming) {
						event.preventDefault();
						const id = renaming;
						setError(null);
						setRenaming(null);
						focusRow(id);
					}
					// Otherwise Escape closes. Nothing was staged, so nothing reverts.
				}}
			>
				<DialogHeader className="shrink-0">
					<DialogTitle>{t("ui.chat.tags.manage_title")}</DialogTitle>
					<DialogDescription>
						{t("ui.chat.tag_dialogs.manage_description")}
					</DialogDescription>
				</DialogHeader>
				<div
					ref={body}
					data-tag-dialog-body
					className="min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto p-1"
				>
					{error && !editError && (
						<div role="alert" className="text-body-sm text-danger">
							<p>{error}</p>
						</div>
					)}
					<div className="sticky top-0 z-10 space-y-2 bg-elevated pb-2">
						<Input
							type="search"
							aria-label={t("ui.chat.tags.search")}
							placeholder={t("ui.chat.tags.search")}
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							disabled={pending}
						/>
						<p className="text-meta text-ink-muted">
							{t("ui.chat.tags.registry_count", {
								count: String(categories.length),
							})}
						</p>
						{query.trim() && (
							<p className="text-meta text-ink-muted">
								{t("ui.chat.tags.reorder_filtered")}
							</p>
						)}
					</div>
					<output aria-live="polite" className="sr-only">
						{notice}
					</output>
					{loading ? (
						<output>{t("ui.chat.tags.loading")}</output>
					) : loadError ? (
						<div role="alert">
							<p>{loadError}</p>
							<Button onClick={() => void fetchCategories()}>
								{t("ui.chat.tags.retry")}
							</Button>
						</div>
					) : (
						<>
							{categories.length === 0 && (
								<p className="text-body-sm text-ink-muted">
									{t("ui.chat.tags.empty")}
								</p>
							)}
							<ol>
								{categories
									.map((tag, index) => ({ tag, index }))
									.filter(
										({ tag }) =>
											matchingTags([tag], query).length || renaming === tag.id,
									)
									.map(({ tag, index }) => (
										<li
											key={tag.id}
											data-tag-id={tag.id}
											className="@container flex min-h-9 min-w-0 flex-col gap-1 border-hairline border-b py-2"
										>
											{renaming === tag.id ? (
												<form
													className="flex w-full min-w-0 flex-wrap gap-1"
													onSubmit={(event) => {
														event.preventDefault();
														void renameTag(tag);
													}}
												>
													<Input
														autoFocus
														className="min-w-0"
														aria-label={t("ui.chat.tags.rename_label", {
															name: tag.name,
														})}
														value={rename}
														onChange={(event) => setRename(event.target.value)}
														disabled={pending}
													/>
													<Button
														type="submit"
														disabled={pending || !rename.trim()}
													>
														{t("ui.chat.tags.save")}
													</Button>
													<Button
														variant="ghost"
														disabled={pending}
														onClick={() => {
															setError(null);
															setRenaming(null);
															focusRow(tag.id);
														}}
													>
														{t("ui.chat.tags.cancel")}
													</Button>
													{editError && error && (
														<p
															role="alert"
															className="basis-full text-body-sm text-danger"
														>
															{error}
														</p>
													)}
												</form>
											) : (
												<>
													<span
														className="w-full min-w-0 break-words text-body-sm"
														title={tag.name}
													>
														{tag.name}
													</span>
													{/* Metadata must keep an intrinsic line at narrow dialog widths;
													 * the action cluster moves together below it, never squeezing
													 * a usage label into a one-word/number sliver. */}
													<div className="grid w-full min-w-0 grid-cols-1 items-center gap-1 @min-[300px]:grid-cols-[minmax(0,1fr)_auto]">
														<p className="min-w-0 flex-1 text-meta text-ink-muted">
															{t("ui.chat.tags.tag_usage", {
																count: tag.conversations,
															})}
														</p>
														<div className="flex min-w-0 flex-wrap items-center gap-1">
															<Button
																variant="ghost"
																size="icon-sm"
																aria-label={t("ui.chat.tags.move_up", {
																	name: tag.name,
																})}
																disabled={
																	pending || !!query.trim() || index === 0
																}
																onClick={() => void move(tag, -1)}
															>
																<ChevronUp aria-hidden="true" />
															</Button>
															<Button
																variant="ghost"
																size="icon-sm"
																aria-label={t("ui.chat.tags.move_down", {
																	name: tag.name,
																})}
																disabled={
																	pending ||
																	!!query.trim() ||
																	index === categories.length - 1
																}
																onClick={() => void move(tag, 1)}
															>
																<ChevronDown aria-hidden="true" />
															</Button>
															<Button
																variant="ghost"
																disabled={pending}
																onClick={() => {
																	setError(null);
																	setRenaming(tag.id);
																	setRename(tag.name);
																}}
															>
																{t("ui.chat.tags.rename")}
															</Button>
															<Button
																variant="ghost"
																disabled={pending}
																onClick={() => beginDelete(tag)}
															>
																{t("ui.chat.tags.delete")}
															</Button>
														</div>
													</div>
												</>
											)}
										</li>
									))}
							</ol>
						</>
					)}
					{deleting && (
						<section
							aria-label={t("ui.chat.tags.delete_title", {
								name: deleting.name,
							})}
							className="space-y-2 rounded-md border border-control p-3"
						>
							<h3 className="break-words font-medium">
								{t("ui.chat.tags.delete_title", { name: deleting.name })}
							</h3>
							<p className="text-body-sm text-ink-muted">
								{t("ui.chat.tags.delete_description", {
									count: deleting.conversations,
								})}
							</p>
							<div className="flex justify-end gap-2">
								<Button
									autoFocus
									variant="ghost"
									disabled={pending}
									onClick={() => {
										const id = deleting.id;
										setDeleting(null);
										focusRow(id);
									}}
								>
									{t("ui.chat.tags.cancel")}
								</Button>
								<Button
									variant="danger"
									disabled={pending}
									onClick={() => void remove()}
								>
									{t("ui.chat.tags.delete_tag")}
								</Button>
							</div>
						</section>
					)}
					<form
						className="flex min-w-0 flex-wrap gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							void add();
						}}
					>
						<Input
							ref={addInput}
							className="min-w-0 flex-1 basis-0"
							aria-label={t("ui.chat.tags.new_name")}
							placeholder={t("ui.chat.tags.new_name")}
							disabled={pending || loading || !!loadError}
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
						<Button
							type="submit"
							disabled={
								pending ||
								loading ||
								!!loadError ||
								!!tagNameIssue(name) ||
								categories.length >= TAG_REGISTRY_LIMIT
							}
						>
							{t("ui.chat.tags.add")}
						</Button>
						{editError && error && renaming === null && (
							<p role="alert" className="basis-full text-body-sm text-danger">
								{error}
							</p>
						)}
					</form>
					{categories.length >= TAG_REGISTRY_LIMIT && (
						<p className="text-meta text-ink-muted">
							{t("ui.chat.tags.registry_limit")}
						</p>
					)}
					{tagNameIssue(name) === "long" && (
						<p className="text-meta text-ink-muted">
							{t("ui.chat.tags.name_long")}
						</p>
					)}
					{tagNameIssue(name) === "reserved" && (
						<p className="text-meta text-ink-muted">
							{t("ui.chat.tags.name_reserved")}
						</p>
					)}
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
	);
}
