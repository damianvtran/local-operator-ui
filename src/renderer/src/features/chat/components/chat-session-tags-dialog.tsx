import { draftPrimary } from "@features/chat/chat-tag-groups";
import { userFacingMessage } from "@shared/api/local-operator/desktop-api";
import {
	Button,
	Checkbox,
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
import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import { useSessionTagsStore } from "@shared/store/session-tags-store";
import { useState } from "react";

/** Mount per invocation: assignment is buffered until Apply; registry creation is
 * intentionally a separate durable operation, not an accidental side effect of Cancel.
 */
export function ChatSessionTagsDialog({
	row,
	onClose,
	returnFocus,
}: {
	row: CanonicalSessionRow;
	onClose: () => void;
	returnFocus: () => void;
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
	const [ids, setIds] = useState(() => row.tags?.map((tag) => tag.id) ?? []);
	const [primary, setPrimary] = useState(row.primary ?? null);
	const [query, setQuery] = useState("");
	const [creating, setCreating] = useState(false);
	const [name, setName] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [retry, setRetry] = useState<"apply" | "create" | null>(null);
	// Deleted categories cannot be resubmitted from a stale draft. Preserve the
	// original assignment order so removing the primary previews server fallback.
	const selected = ids.filter((id) => categories.some((tag) => tag.id === id));
	const effectivePrimary = draftPrimary(selected, primary);
	const apply = async () => {
		setPending(true);
		setError(null);
		setRetry("apply");
		try {
			await assignSessionTags(row.session_id, selected, effectivePrimary);
			onClose();
		} catch (cause) {
			setError(
				userFacingMessage(cause, "Could not save tags. Retry your change."),
			);
		} finally {
			setPending(false);
		}
	};
	const create = async () => {
		if (!name.trim()) return;
		setPending(true);
		setError(null);
		setRetry("create");
		try {
			await replaceCategories([
				...categories.map((tag) => ({ id: tag.id, name: tag.name })),
				{ name: name.trim() },
			]);
			const created = useSessionTagsStore
				.getState()
				.categories.find((tag) => tag.name === name.trim());
			if (created) {
				setIds((held) =>
					held.includes(created.id) ? held : [...held, created.id],
				);
				setPrimary((held) => held ?? created.id);
			}
			setCreating(false);
			setName("");
		} catch (cause) {
			setError(
				userFacingMessage(cause, "Could not save tags. Retry your change."),
			);
		} finally {
			setPending(false);
		}
	};
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
					<DialogTitle className="break-words pr-6">
						{t("ui.chat.tags.picker_title", {
							title: row.title || row.session_id,
						})}
					</DialogTitle>
					<DialogDescription>
						{t("ui.chat.tags.picker_description")}
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
							{categories.length > 8 && (
								<Input
									aria-label={t("ui.chat.tags.search")}
									placeholder={t("ui.chat.tags.search")}
									value={query}
									onChange={(event) => setQuery(event.target.value)}
								/>
							)}
							{categories.length === 0 && (
								<p className="text-body-sm text-ink-muted">
									{t("ui.chat.tags.empty")}
								</p>
							)}
							<div>
								{categories
									.filter((tag) =>
										tag.name
											.toLocaleLowerCase()
											.includes(query.toLocaleLowerCase()),
									)
									.map((tag) => (
										<label
											key={tag.id}
											htmlFor={`session-tag-${tag.id}`}
											className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-1 text-body-sm hover:bg-row-hover"
										>
											<Checkbox
												id={`session-tag-${tag.id}`}
												disabled={pending}
												checked={selected.includes(tag.id)}
												onCheckedChange={(checked) => {
													const next = checked
														? [...selected, tag.id]
														: selected.filter((id) => id !== tag.id);
													setIds(next);
													setPrimary(draftPrimary(next, effectivePrimary));
												}}
											/>
											<span className="min-w-0 break-words">{tag.name}</span>
										</label>
									))}
							</div>
							{query &&
								!categories.some((tag) =>
									tag.name
										.toLocaleLowerCase()
										.includes(query.toLocaleLowerCase()),
								) && <p>{t("ui.chat.tags.no_matches")}</p>}
							{selected.length >= 2 ? (
								<fieldset className="min-w-0 border-hairline border-t pt-2">
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
												disabled={pending}
												checked={effectivePrimary === id}
												onChange={() => setPrimary(id)}
											/>
											<span className="min-w-0 break-words">
												{categories.find((tag) => tag.id === id)?.name}
											</span>
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
						</>
					)}
					<div className="flex gap-2">
						<Button
							variant="ghost"
							disabled={pending || !selected.length}
							onClick={() => {
								setIds([]);
								setPrimary(null);
							}}
						>
							{t("ui.chat.tags.clear")}
						</Button>
						<Button
							variant="ghost"
							disabled={pending || loading || !!loadError}
							onClick={() => setCreating(true)}
						>
							{t("ui.chat.tags.new")}
						</Button>
					</div>
					{creating && (
						<form
							className="flex gap-2"
							onSubmit={(event) => {
								event.preventDefault();
								void create();
							}}
						>
							<Input
								autoFocus
								aria-label={t("ui.chat.tags.new_name")}
								value={name}
								onChange={(event) => setName(event.target.value)}
								disabled={pending}
							/>
							<Button type="submit" disabled={pending || !name.trim()}>
								{t("ui.chat.tags.add")}
							</Button>
						</form>
					)}
					{error && (
						<div role="alert" className="text-body-sm text-danger">
							<p>{error}</p>
							<Button
								disabled={pending}
								onClick={() => void (retry === "create" ? create() : apply())}
							>
								{t("ui.chat.tags.retry")}
							</Button>
						</div>
					)}
				</div>
				<DialogFooter className="flex-row justify-end">
					<Button variant="ghost" disabled={pending} onClick={onClose}>
						{t("ui.chat.tags.cancel")}
					</Button>
					<Button
						disabled={pending || loading || !!loadError}
						onClick={() => void apply()}
					>
						{pending ? t("ui.chat.tags.applying") : t("ui.chat.tags.apply")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
