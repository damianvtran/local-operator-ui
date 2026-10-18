import { deletedTagNameReused } from "@features/chat/chat-tag-draft";
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
	const [name, setName] = useState("");
	const [renaming, setRenaming] = useState<string | null>(null);
	const [rename, setRename] = useState("");
	const [deleting, setDeleting] = useState<Pick<
		TagCategory,
		"id" | "name" | "conversations"
	> | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
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
		if (!value.trim()) return false;
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
	const apply = async () => {
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
					else if (deleting) {
						event.preventDefault();
						const id = deleting.id;
						setDeleting(null);
						focusRow(id);
					} else if (renaming) {
						event.preventDefault();
						const id = renaming;
						setRenaming(null);
						focusRow(id);
					}
				}}
			>
				<DialogHeader>
					<DialogTitle>{t("ui.chat.tags.manage_title")}</DialogTitle>
					<DialogDescription>
						{t("ui.chat.tags.manage_description")}
					</DialogDescription>
				</DialogHeader>
				<div className="min-h-0 space-y-3 overflow-y-auto">
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
								{draft.map((tag, index) => (
									<li
										key={tagKey(tag)}
										data-tag-id={tagKey(tag)}
										className="flex min-h-9 items-center gap-1 border-hairline border-b py-1"
									>
										{renaming === tagKey(tag) ? (
											<form
												className="flex min-w-0 flex-1 gap-1"
												onSubmit={(event) => {
													event.preventDefault();
													if (!uniqueName(rename, tagKey(tag))) return;
													const next = { ...tag, name: rename.trim() };
													setDraft(
														draft.map((item, at) =>
															at === index ? next : item,
														),
													);
													setRenaming(null);
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
														setRenaming(null);
														focusRow(tagKey(tag));
													}}
												>
													{t("ui.chat.tags.cancel")}
												</Button>
											</form>
										) : (
											<>
												<span
													className="min-w-0 flex-1 truncate text-body-sm"
													title={tag.name}
												>
													{tag.name}
												</span>
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={t("ui.chat.tags.move_up", {
														name: tag.name,
													})}
													disabled={pending || index === 0}
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
													disabled={pending || index === draft.length - 1}
													onClick={() => move(index, 1)}
												>
													<ChevronDown aria-hidden="true" />
												</Button>
												<Button
													variant="ghost"
													disabled={pending}
													onClick={() => {
														setRenaming(tagKey(tag));
														setRename(tag.name);
													}}
												>
													{t("ui.chat.tags.rename")}
												</Button>
												<Button
													variant="ghost"
													disabled={pending}
													onClick={() =>
														setDeleting({
															id: tagKey(tag),
															name: tag.name,
															conversations:
																categories.find(
																	(category) => category.id === tag.id,
																)?.conversations ?? 0,
														})
													}
												>
													{t("ui.chat.tags.delete")}
												</Button>
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
						className="flex gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							if (!uniqueName(name)) return;
							setDraft([...draft, { name: name.trim() }]);
							setName("");
							addInput.current?.focus();
						}}
					>
						<Input
							ref={addInput}
							className="min-w-0 flex-1"
							aria-label={t("ui.chat.tags.new_name")}
							placeholder={t("ui.chat.tags.new_name")}
							disabled={pending || loading || !!loadError}
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
						<Button
							type="submit"
							disabled={pending || loading || !!loadError || !name.trim()}
						>
							{t("ui.chat.tags.add")}
						</Button>
					</form>
					{error && (
						<div role="alert" className="text-body-sm text-danger">
							<p>{error}</p>
							{retry && (
								<Button disabled={pending} onClick={() => void apply()}>
									{t("ui.chat.tags.retry")}
								</Button>
							)}
						</div>
					)}
				</div>
				<DialogFooter>
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
