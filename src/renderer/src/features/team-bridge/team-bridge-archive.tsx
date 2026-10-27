import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { Input } from "@shared/components/ui/input";
import { formatDateTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { Archive, Hash } from "lucide-react";
import type { FC } from "react";
import { Fragment, useEffect, useId, useState } from "react";
import type { TeamBridgeConversation } from "../../../../shared/team-bridge-contract";
import { canManageArchivedConversation } from "./team-bridge-model";

/**
 * ARCHIVE -> VIEW ARCHIVED -> PERMANENT DELETE: the surfaces that are not the
 * rail or the header menu (docs/TEAM-BRIDGE-CONVERSATIONS.md §8.1).
 *
 * Everything here is presentation. Who may act is the server's `can_administer`
 * (see `canArchiveConversation`), what happens on confirm is the container's, and
 * the destructive confirm below is the one place the UI adds friction of its own:
 * deleting a channel is unrecoverable, so the person types its name.
 */

/** "Oct 26, 2026, 4:10 PM" in the reader's locale; empty when the server sent no usable date. */
export function archivedWhen(
	iso: string | null | undefined,
	locale: string,
): string | null {
	if (!iso) return null;
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return null;
	return formatDateTime(
		at,
		{ dateStyle: "medium", timeStyle: "short" },
		locale,
	);
}

/**
 * A character no translation contains, handed to the message in place of the name so the
 * rendered sentence can be split around it. Private-use, never typed, never localized.
 */
const NAME_SLOT = "\uE000";

/** The channel name as the person reads it in the rail (without a leading #). */
export function archiveChannelName(
	conversation: Pick<TeamBridgeConversation, "name">,
): string {
	return conversation.name?.trim() || t("ui.teamBridge.list.untitled");
}

/**
 * Confirm ARCHIVING. States the consequence the operator asked for: members keep
 * read access and nobody can post. Reversible, so the confirm is the primary
 * button rather than a danger one; a destructive style on a reversible act would
 * teach people to ignore the style on the irreversible one below.
 *
 * There is no pending or error state HERE: the archive is optimistic, so confirming
 * closes the dialog at once and the row is already gone. A refusal restores the row
 * and the page says so under the header (`ui.teamBridge.archive.confirm.error`).
 */
export const TeamBridgeArchiveDialog: FC<{
	open: boolean;
	name: string;
	onConfirm: () => void;
	onClose: () => void;
}> = ({ open, name, onConfirm, onClose }) => {
	useI18nLocale();
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent className="gap-4">
				<DialogTitle>
					{t("ui.teamBridge.archive.confirm.title", { name })}
				</DialogTitle>
				<DialogDescription className="text-[13px] text-ink-muted">
					{t("ui.teamBridge.archive.confirm.body")}
				</DialogDescription>
				<DialogFooter>
					<Button type="button" variant="ghost" onClick={onClose}>
						{t("ui.teamBridge.create.cancel")}
					</Button>
					<Button type="button" variant="primary" onClick={onConfirm}>
						{t("ui.teamBridge.archive.confirm.confirm")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

/**
 * Confirm PERMANENT DELETION: names what is erased, says it cannot be undone, and
 * keeps the button disabled until the channel's exact name is typed.
 *
 * WHY TYPE THE NAME. A click-through "Are you sure?" is muscle memory; typing the
 * name forces the person to read which channel they are about to destroy, and
 * stops a stray Enter from deleting the wrong one. The comparison is exact after
 * trimming (a channel name is a slug, so there is no case or locale folding to
 * argue about), and a leading # is accepted because that is how the name is shown
 * everywhere else in the app.
 *
 * NOT CLOSABLE WHILE PENDING. Escape and the corner button are held while the
 * delete is in flight (`closeDisabled`): the write is not optimistic, so closing
 * would leave the person not knowing whether it happened.
 */
export const TeamBridgeDeleteDialog: FC<{
	open: boolean;
	name: string;
	pending?: boolean;
	/**
	 * `error`: the delete did not go through. `gone`: the server answered its opaque
	 * "not found", which means EITHER the channel is already gone OR the caller may no
	 * longer delete it; the two are indistinguishable from here, so the sentence says
	 * neither "deleted" nor "refused" (review round 1, U2).
	 */
	error?: "error" | "gone" | null;
	onConfirm: () => void;
	onClose: () => void;
}> = ({ open, name, pending = false, error = null, onConfirm, onClose }) => {
	useI18nLocale();
	const fieldId = useId();
	const [typed, setTyped] = useState("");
	/* Every open starts empty: a half-typed name must not survive a cancel. */
	useEffect(() => {
		if (open) setTyped("");
	}, [open]);
	const matches = typed.trim().replace(/^#/, "") === name;
	const confirmLabelParts = t("ui.teamBridge.archive.delete.confirm_label", {
		name: NAME_SLOT,
	}).split(NAME_SLOT);
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next && !pending) onClose();
			}}
		>
			<DialogContent className="gap-4" closeDisabled={pending}>
				<DialogTitle>
					{t("ui.teamBridge.archive.delete.title", { name })}
				</DialogTitle>
				<DialogDescription className="text-[13px] text-ink-muted">
					{t("ui.teamBridge.archive.delete.body")}
				</DialogDescription>
				<label
					htmlFor={fieldId}
					className="flex flex-col gap-1 text-[13px] text-ink-muted"
				>
					{/* DESIGN ROUND 1, D4: the name is the thing being typed, so it is its own
					    selectable, heavier span that breaks anywhere (`break-all`) and cannot
					    be mistaken for the label's wording when a long name wraps. The existing
					    sentence is split AT the placeholder rather than rebuilt from two keys,
					    so every locale keeps its own word order. */}
					{confirmLabelParts.map((part, index) => (
						<Fragment key={`${index}:${part}`}>
							{index > 0 && (
								<span className="select-all break-all font-medium text-ink">
									{name}
								</span>
							)}
							{part}
						</Fragment>
					))}
					<Input
						id={fieldId}
						value={typed}
						onChange={(event) => setTyped(event.target.value)}
						autoComplete="off"
						autoCapitalize="off"
						spellCheck={false}
						autoFocus
					/>
				</label>
				{error && (
					<p role="alert" className="text-[13px] text-danger">
						{error === "gone"
							? t("ui.teamBridge.archive.delete.not_found")
							: t("ui.teamBridge.archive.delete.error")}
					</p>
				)}
				<DialogFooter>
					<Button
						type="button"
						variant="ghost"
						disabled={pending}
						onClick={onClose}
					>
						{t("ui.teamBridge.create.cancel")}
					</Button>
					<Button
						type="button"
						variant="danger"
						disabled={!matches || pending}
						onClick={onConfirm}
					>
						{t("ui.teamBridge.archive.delete.confirm")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

/**
 * The read-only banner over an archived channel: who archived it and when, with
 * Unarchive and Delete permanently for the person the server says may act.
 *
 * The sentence degrades with what the server knows (archiver + date, date only,
 * neither) instead of printing a blank. With `canManage` false (a plain member)
 * the banner states the fact and offers nothing, rather than a button that would
 * be refused.
 */
export const TeamBridgeArchivedBanner: FC<{
	conversation: TeamBridgeConversation;
	canManage: boolean;
	unarchiving?: boolean;
	error?: boolean;
	onUnarchive: () => void;
	onDelete: () => void;
}> = ({
	conversation,
	canManage,
	unarchiving = false,
	error = false,
	onUnarchive,
	onDelete,
}) => {
	const locale = useI18nLocale();
	const when = conversation.archived_at
		? archivedWhen(conversation.archived_at, locale)
		: null;
	const who = conversation.archived_by_label ?? null;
	const sentence =
		who && when
			? t("ui.teamBridge.archive.banner.by_on", { name: who, date: when })
			: when
				? t("ui.teamBridge.archive.banner.on", { date: when })
				: t("ui.teamBridge.archive.banner.plain");
	return (
		<output className="mx-4 mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-elevated px-3 py-2">
			<Archive size={15} aria-hidden="true" className="shrink-0 text-ink-dim" />
			<p className="min-w-0 flex-1 text-[13px] text-ink-muted">
				{sentence}
				{error && (
					<span role="alert" className="ms-2 text-danger">
						{t("ui.teamBridge.archive.banner.unarchive_error")}
					</span>
				)}
			</p>
			{canManage && (
				<div className="flex shrink-0 items-center gap-1">
					<Button
						type="button"
						size="sm"
						variant="ghost"
						disabled={unarchiving}
						onClick={onUnarchive}
					>
						{t("ui.teamBridge.archive.banner.unarchive")}
					</Button>
					<Button
						type="button"
						size="sm"
						variant="danger"
						disabled={unarchiving}
						onClick={onDelete}
					>
						{t("ui.teamBridge.archive.banner.delete")}
					</Button>
				</div>
			)}
		</output>
	);
};

/**
 * THE "ARCHIVED CHANNELS" VIEW, and why it is this and not a Browse-channels page.
 *
 * Slack answers "where did that channel go" with a channel browser that has an
 * Active/Archived filter, because Slack has thousands of channels to browse. This
 * app has no channel browser: the sidebar already lists every channel a reader is
 * in, and discoverable ones appear as previews. Building one to hold a single
 * filter would add a whole navigation destination for a rare admin task. So the
 * entry is the OTHER Slack-shaped option: an "Archived channels" item in the
 * Channels section's header menu, where a person looks for channel-level
 * housekeeping. It opens the pane the way Drafts and Scheduled do (a destination
 * that REPLACES the thread pane, same borderless chrome, no new primitive). A row
 * opens the channel read-only with its banner, which is where Unarchive and Delete
 * permanently belong: next to the name being destroyed.
 */
export const TeamBridgeArchivedChannelsView: FC<{
	state: "loading" | "error" | "ready";
	conversations: readonly TeamBridgeConversation[];
	organizationName?: (conversation: TeamBridgeConversation) => string | null;
	onOpen: (conversation: TeamBridgeConversation) => void;
	onRetry?: () => void;
	/** More archived pages exist; "Load more" appends the next (review round 1, U4). */
	hasMore?: boolean;
	loadingMore?: boolean;
	loadMoreFailed?: boolean;
	onLoadMore?: () => void;
}> = ({
	state,
	conversations,
	organizationName,
	onOpen,
	onRetry,
	hasMore = false,
	loadingMore = false,
	loadMoreFailed = false,
	onLoadMore,
}) => {
	const locale = useI18nLocale();
	return (
		<section
			aria-label={t("ui.teamBridge.archive.section.archived")}
			className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-5"
		>
			<h2 className="font-medium text-lg text-ink">
				{t("ui.teamBridge.archive.section.archived")}
			</h2>
			{state === "loading" ? (
				<div className="py-2">
					<Spinner size="sm" label={t("ui.teamBridge.archive.list.loading")} />
				</div>
			) : state === "error" ? (
				<div className="flex flex-col items-start gap-2">
					<p className="text-[13px] text-ink-muted">
						{t("ui.teamBridge.archive.list.error")}
					</p>
					{onRetry && (
						<Button size="sm" variant="ghost" onClick={onRetry}>
							{t("ui.teamBridge.list.retry")}
						</Button>
					)}
				</div>
			) : conversations.length === 0 ? (
				<p className="text-ink-muted">
					{t("ui.teamBridge.archive.list.empty")}
				</p>
			) : (
				<ul className="flex flex-col">
					{conversations.map((conversation) => {
						const when = conversation.archived_at
							? archivedWhen(conversation.archived_at, locale)
							: null;
						const who = conversation.archived_by_label ?? null;
						const meta =
							who && when
								? t("ui.teamBridge.archive.list.meta_by_on", {
										name: who,
										date: when,
									})
								: when
									? t("ui.teamBridge.archive.list.meta_on", { date: when })
									: null;
						const org = organizationName?.(conversation) ?? null;
						return (
							<li key={conversation.id}>
								<button
									type="button"
									onClick={() => onOpen(conversation)}
									data-conversation-id={conversation.id}
									className="flex min-h-[38px] w-full items-center gap-2 rounded-md px-2 py-1 text-start text-[13px] text-ink-muted transition-colors duration-fast ease-out-quart hover:bg-row-hover hover:text-ink"
								>
									<Hash size={15} aria-hidden="true" className="shrink-0" />
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="truncate">
											{archiveChannelName(conversation)}
										</span>
										{(meta || org) && (
											<span className="truncate text-meta-sm text-ink-dim">
												{[org, meta].filter(Boolean).join(" · ")}
											</span>
										)}
									</span>
								</button>
							</li>
						);
					})}
				</ul>
			)}
			{state === "ready" && (hasMore || loadMoreFailed) && onLoadMore && (
				<div className="flex flex-col items-start gap-1 pt-1">
					{loadMoreFailed && (
						<p role="alert" className="text-[12px] text-danger">
							{t("ui.teamBridge.archive.list.load_more_error")}
						</p>
					)}
					<Button
						size="sm"
						variant="ghost"
						disabled={loadingMore}
						onClick={onLoadMore}
					>
						{loadingMore
							? t("ui.teamBridge.archive.list.loading")
							: t("ui.teamBridge.archive.list.load_more")}
					</Button>
				</div>
			)}
		</section>
	);
};

export { canManageArchivedConversation };
