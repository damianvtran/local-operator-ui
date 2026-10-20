import { deletedTagNameReused } from "@features/chat/chat-tag-draft";
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

/** Registry changes stay local until one desired-state Apply. Cancel cannot
 * mutate shared categories, assignments or the picker draft that opened this dialog.
 * Explicit ID-bearing replacements preserve assignments and their primary tag.
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
	const [draft, setDraft] = useState<DesiredTag[]>(() =>
		categories.map(({ id, name }) => ({ id, name })),
	);
	const [initialized, setInitialized] = useState(
		!loading && loadError === null,
	);
	useEffect(() => {
		if (!initialized && !loading && loadError === null) {
			setDraft(categories.map(({ id, name }) => ({ id, name })));
			setInitialized(true);
		}
	}, [categories, initialized, loading, loadError]);
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
	const [retry, setRetry] = useState(false);
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
	const tagKey = (tag: DesiredTag) => tag.id ?? `new:${tag.name}`;
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
			draft.some(
				(tag) =>
					tagKey(tag) !== except &&
					tag.name.toLocaleLowerCase() === value.trim().toLocaleLowerCase(),
			)
		) {
			setError(t("ui.chat.tags.duplicate_name", { name: value.trim() }));
			setRetry(false);
			return false;
		}
		setError(null);
		return true;
	};
	const beginDelete = async (tag: DesiredTag) => {
		setEditError(false);
		// Counts are authoritative only after a fresh read. This does not merge
		// external catalogue edits into our draft or perform a deletion.
		if (tag.id) {
			await fetchCategories();
			const fresh = useSessionTagsStore.getState();
			const current = fresh.categories.find((item) => item.id === tag.id);
			if (fresh.error || !current) {
				setError(
					t(
						fresh.error
							? "ui.chat.tags.load_failed"
							: "ui.chat.tags.registry_changed",
					),
				);
				setRetry(false);
				return;
			}
			setDeleting({
				id: tag.id,
				name: tag.name,
				conversations: current.conversations,
			});
		} else setDeleting({ id: tagKey(tag), name: tag.name, conversations: 0 });
	};
	const apply = async () => {
		if (pending) return;
		setEditError(false);
		const reused = deletedTagNameReused(categories, draft);
		if (reused !== null) {
			setError(t("ui.chat.tags.apply_deletion_first", { name: reused }));
			setRetry(false);
			return;
		}
		setPending(true);
		setError(null);
		setRetry(true);
		try {
			await replaceCategories(draft);
			onClose();
		} catch {
			setError(t("ui.chat.tags.save_failed"));
		} finally {
			setPending(false);
		}
	};
	const move = (index: number, delta: number) => {
		if (query.trim() || pending) return;
		const next = [...draft];
		[next[index], next[index + delta]] = [next[index + delta], next[index]];
		setDraft(next);
		focusRow(tagKey(draft[index]));
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
				}}
			>
				<DialogHeader className="shrink-0">
					<DialogTitle>{t("ui.chat.tags.manage_title")}</DialogTitle>
					<DialogDescription>
						{t("ui.chat.tags.manage_description")}
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
							{retry && (
								<Button disabled={pending} onClick={() => void apply()}>
									{t("ui.chat.tags.retry")}
								</Button>
							)}
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
								count: String(draft.length),
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
							{draft.length === 0 && (
								<p className="text-body-sm text-ink-muted">
									{t("ui.chat.tags.empty")}
								</p>
							)}
							<ol>
								{draft
									.map((tag, index) => ({ tag, index }))
									.filter(
										({ tag }) =>
											matchingTags([tag], query).length ||
											renaming === tagKey(tag),
									)
									.map(({ tag, index }) => (
										<li
											key={tagKey(tag)}
											data-tag-id={tagKey(tag)}
											className="@container flex min-h-9 min-w-0 flex-col gap-1 border-hairline border-b py-2"
										>
											{renaming === tagKey(tag) ? (
												<form
													className="flex w-full min-w-0 flex-wrap gap-1"
													onSubmit={(event) => {
														event.preventDefault();
														if (!uniqueName(rename, tagKey(tag))) return;
														const next = { ...tag, name: rename.trim() };
														setDraft(
															draft.map((item, at) =>
																at === index ? next : item,
															),
														);
														setError(null);
														setRenaming(null);
														setQuery("");
														setNotice(
															t("ui.chat.tags.renamed_name", {
																name: next.name,
															}),
														);
														focusRow(tagKey(next));
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
															focusRow(tagKey(tag));
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
																count:
																	categories.find((item) => item.id === tag.id)
																		?.conversations ?? 0,
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
																onClick={() => move(index, -1)}
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
																	index === draft.length - 1
																}
																onClick={() => move(index, 1)}
															>
																<ChevronDown aria-hidden="true" />
															</Button>
															<Button
																variant="ghost"
																disabled={pending}
																onClick={() => {
																	setError(null);
																	setRenaming(tagKey(tag));
																	setRename(tag.name);
																}}
															>
																{t("ui.chat.tags.rename")}
															</Button>
															<Button
																variant="ghost"
																disabled={pending}
																onClick={() => void beginDelete(tag)}
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
									onClick={() => {
										const index = draft.findIndex(
											(tag) => tagKey(tag) === deleting.id,
										);
										const next = draft.filter(
											(tag) => tagKey(tag) !== deleting.id,
										);
										const focus = next[index] ?? next[index - 1];
										setDraft(next);
										setDeleting(null);
										focusRow(focus ? tagKey(focus) : undefined);
									}}
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
							if (draft.length >= TAG_REGISTRY_LIMIT || !uniqueName(name))
								return;
							setDraft([...draft, { name: name.trim() }]);
							setNotice(t("ui.chat.tags.staged_added", { name: name.trim() }));
							setName("");
							addInput.current?.focus();
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
								draft.length >= TAG_REGISTRY_LIMIT
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
					{draft.length >= TAG_REGISTRY_LIMIT && (
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
						{t("ui.chat.tags.cancel")}
					</Button>
					<Button
						disabled={
							pending ||
							loading ||
							loadError !== null ||
							!initialized ||
							renaming !== null ||
							deleting !== null
						}
						onClick={() => void apply()}
					>
						{pending ? t("ui.chat.tags.applying") : t("ui.chat.tags.apply")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
