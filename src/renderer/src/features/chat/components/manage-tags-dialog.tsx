import { userFacingMessage } from "@shared/api/local-operator/desktop-api";
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
import { useRef, useState } from "react";
import type {
	DesiredTag,
	TagCategory,
} from "../../../../../shared/desktop-contract";

/** Registry operations are durable immediately; Done only closes the manager.
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
	const [name, setName] = useState("");
	const [renaming, setRenaming] = useState<string | null>(null);
	const [rename, setRename] = useState("");
	const [deleting, setDeleting] = useState<TagCategory | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [retry, setRetry] = useState<(() => void) | null>(null);
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
	const save = async (desired: DesiredTag[], after: () => void) => {
		setPending(true);
		setError(null);
		setRetry(() => () => void save(desired, after));
		try {
			await replaceCategories(desired);
			after();
		} catch (cause) {
			setError(
				userFacingMessage(cause, "Could not save tags. Retry your change."),
			);
		} finally {
			setPending(false);
		}
	};
	const desired = categories.map(({ id, name: tagName }) => ({
		id,
		name: tagName,
	}));
	const move = (index: number, delta: number) => {
		const next = [...desired];
		[next[index], next[index + delta]] = [next[index + delta], next[index]];
		const id = categories[index].id;
		void save(next, () => focusRow(id));
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
					<DialogTitle>{t("ui.chat.tags.manage")}</DialogTitle>
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
							{categories.length === 0 && (
								<p className="text-body-sm text-ink-muted">
									{t("ui.chat.tags.empty")}
								</p>
							)}
							<ol>
								{categories.map((tag, index) => (
									<li
										key={tag.id}
										data-tag-id={tag.id}
										className="flex min-h-9 items-center gap-1 border-hairline border-b py-1"
									>
										{renaming === tag.id ? (
											<form
												className="flex min-w-0 flex-1 gap-1"
												onSubmit={(event) => {
													event.preventDefault();
													void save(
														desired.map((item) =>
															item.id === tag.id
																? { ...item, name: rename.trim() }
																: item,
														),
														() => {
															setRenaming(null);
															focusRow(tag.id);
														},
													);
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
														focusRow(tag.id);
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
													disabled={pending || index === categories.length - 1}
													onClick={() => move(index, 1)}
												>
													<ChevronDown aria-hidden="true" />
												</Button>
												<Button
													variant="ghost"
													disabled={pending}
													onClick={() => {
														setRenaming(tag.id);
														setRename(tag.name);
													}}
												>
													{t("ui.chat.tags.rename")}
												</Button>
												<Button
													variant="ghost"
													disabled={pending}
													onClick={() => setDeleting(tag)}
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
										const index = categories.findIndex(
											(tag) => tag.id === deleting.id,
										);
										const focus =
											categories[index + 1]?.id ?? categories[index - 1]?.id;
										void save(
											desired.filter((tag) => tag.id !== deleting.id),
											() => {
												setDeleting(null);
												focusRow(focus);
											},
										);
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
							void save([...desired, { name: name.trim() }], () => {
								setName("");
								addInput.current?.focus();
							});
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
							<Button disabled={pending} onClick={() => retry?.()}>
								{t("ui.chat.tags.retry")}
							</Button>
						</div>
					)}
				</div>
				<DialogFooter>
					<Button disabled={pending} onClick={onClose}>
						{t("ui.chat.tags.done")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
