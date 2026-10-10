/**
 * The detail page's updates feed: the project's append-only history, newest
 * first, day-grouped, each entry with its author, stamps, markdown body and
 * attachments.
 *
 * WHAT THE FEED IS FOR. The progress snippet is one paragraph; an agent
 * reporting over days writes a LOG, and the operator reading it wants the
 * history rather than the latest line. The wire carries the full bounded log
 * (the store keeps the newest 500 entries, oldest evicted) on `projects.get`,
 * newest LAST — this module reverses it for display and never re-sorts by
 * anything but the log's own order, because a history rendered in a different
 * order than it was written is a different history.
 *
 * DAY GROUPING IS LOCAL, STAMPS ARE ABSOLUTE AND RELATIVE: the group heading
 * is the reader's own calendar day (`Today`, `Yesterday`, `Sep 20` —
 * `project-model.ts` owns those rules), each entry keeps its clock time, and
 * the age token beside it is for scanning. Two readings, one fact — the
 * transcript's own timestamp convention.
 *
 * ATTACHMENTS. Images render through the SAME frame and viewer every other
 * picture in this app uses (`AttachmentFrame`/`ImageAttachment` — expansion,
 * the moved/deleted sentence, the file-actions menu), reading bytes over IPC
 * from the stored copy's path (`useFileBlobUrl`, shared with the canvas
 * viewers). Data attachments render as the file-row idiom this app already
 * has — name, size, a glyph that is identification rather than a second
 * action — with `FileActionsMenu` carrying Open/Reveal/Copy. The whole card's
 * name is ALSO a button that opens the file in the OS, because a card whose
 * only affordance is a menu reads as decoration.
 */

import { mimeTypeForPath } from "@features/chat/utils/file-kind";
import { FileActionsMenu } from "@shared/components/common/file-actions-menu";
import { useFileBlobUrl } from "@shared/hooks/use-file-blob-url";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { File } from "lucide-react";
import type { FC } from "react";
import { Fragment } from "react";
import type {
	DesktopProjectAttachment,
	DesktopProjectUpdate,
} from "../../../../../shared/desktop-control-contract";
import {
	AttachmentFrame,
	BrokenAttachment,
} from "../../chat/components/message-item/attachment-frame";
import { ImageAttachment } from "../../chat/components/message-item/image-attachment";
import { ProjectMarkdown } from "../project-markdown";
import {
	attachmentSizeText,
	groupUpdatesByDay,
	updateMetaTokens,
	updatesCountLabel,
} from "../project-model";

/** The filename a card falls back to when the writer named nothing. */
const PATH_SEPARATOR_REGEX = /[/\\]/;
function attachmentName(attachment: DesktopProjectAttachment): string {
	if (attachment.name) return attachment.name;
	const parts = attachment.path.split(PATH_SEPARATOR_REGEX);
	return parts[parts.length - 1] || "Attachment";
}

const UpdateDataAttachment: FC<{ attachment: DesktopProjectAttachment }> = ({
	attachment,
}) => {
	const name = attachmentName(attachment);
	const size = attachmentSizeText(attachment.bytes);
	return (
		<div className="flex w-fit max-w-full items-center gap-2.5 rounded-sm border border-hairline bg-surface px-3 py-2">
			<button
				type="button"
				className="flex min-w-0 items-center gap-2.5 text-left"
				onClick={() => {
					void window.api?.openFile(attachment.path);
				}}
				title={`Open ${name}`}
			>
				<File className="size-4 shrink-0 text-ink-dim" aria-hidden={true} />
				<span className="truncate text-body-sm text-ink">{name}</span>
			</button>
			{size && (
				<span className="shrink-0 text-meta text-ink-muted tabular-nums">
					{size}
				</span>
			)}
			{/*
			 * ALWAYS VISIBLE, unlike the transcript card's hover reveal: a feed
			 * entry can carry several attachments, this surface has no scroll
			 * budget to save, and a control that exists only under the pointer is
			 * the affordance nobody finds.
			 */}
			<FileActionsMenu
				filePath={attachment.path}
				aria-label={`File actions for ${name}`}
			/>
		</div>
	);
};

const UpdateImageAttachment: FC<{ attachment: DesktopProjectAttachment }> = ({
	attachment,
}) => {
	const name = attachmentName(attachment);
	const state = useFileBlobUrl(attachment.path, {
		mimeType: mimeTypeForPath(attachment.name || attachment.path),
		sizeBytes: attachment.bytes,
	});
	if (state.status === "ready") {
		return (
			<div className="inline-block max-w-full">
				<ImageAttachment
					file={attachment.path}
					src={state.url}
					label={name}
					conversationId=""
				/>
			</div>
		);
	}
	if (state.status === "loading") {
		// The reserved box, so the entry never reflows when the picture lands
		// (the frame's own design note).
		return (
			<AttachmentFrame>
				<span className="sr-only">Loading {name}</span>
			</AttachmentFrame>
		);
	}
	// A stored copy is a path on disk, so the moved/renamed/deleted sentence is
	// the honest one — the legacy caller's case, not the digest store's.
	return <BrokenAttachment name={name} />;
};

const UpdateAttachments: FC<{ attachments: DesktopProjectAttachment[] }> = ({
	attachments,
}) => (
	<div className="flex flex-wrap items-start gap-2">
		{attachments.map((attachment) =>
			attachment.kind === "image" ? (
				<UpdateImageAttachment
					key={`${attachment.path}:${attachment.added_at}`}
					attachment={attachment}
				/>
			) : (
				<UpdateDataAttachment
					key={`${attachment.path}:${attachment.added_at}`}
					attachment={attachment}
				/>
			),
		)}
	</div>
);

const UpdateEntry: FC<{ update: DesktopProjectUpdate; nowMs: number }> = ({
	update,
	nowMs,
}) => {
	const locale = useI18nLocale();
	const meta = updateMetaTokens(update, locale, nowMs);
	return (
		<article className="flex flex-col gap-2 rounded-sm px-2 py-3">
			{meta.length > 0 && (
				<p className="flex flex-wrap items-baseline gap-x-2 text-meta text-ink-muted">
					{meta.map((token, index) => (
						<Fragment key={token.key}>
							{index > 0 && <span aria-hidden="true">·</span>}
							<span>{token.text}</span>
						</Fragment>
					))}
				</p>
			)}
			{update.text && <ProjectMarkdown>{update.text}</ProjectMarkdown>}
			{update.attachments.length > 0 && (
				<UpdateAttachments attachments={update.attachments} />
			)}
		</article>
	);
};

export type ProjectUpdatesProps = {
	updates: DesktopProjectUpdate[];
	nowMs: number;
};

export const ProjectUpdates: FC<ProjectUpdatesProps> = ({ updates, nowMs }) => {
	const locale = useI18nLocale();
	const count = updatesCountLabel(updates.length);
	const groups = groupUpdatesByDay(updates, locale, new Date(nowMs));
	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-baseline justify-between gap-3">
				<h2 className="text-title text-ink">Updates</h2>
				{count && <span className="text-meta text-ink-muted">{count}</span>}
			</div>

			{updates.length === 0 ? (
				<p className="text-body-sm text-ink-muted">
					No updates yet. Progress reported by you or by the sessions working on
					this project is appended here.
				</p>
			) : (
				<div className="flex flex-col gap-4">
					{groups.map((group) => (
						<div key={group.key || "ungrouped"} className="flex flex-col gap-2">
							{group.label && (
								<h3 className="text-meta text-ink-muted">{group.label}</h3>
							)}
							{/* Borderless entries, the chat page's chrome: hairlines, no box. */}
							<div className="flex flex-col divide-y divide-hairline">
								{group.entries.map((update, index) => (
									<UpdateEntry
										key={`${update.at}:${update.by}:${index}`}
										update={update}
										nowMs={nowMs}
									/>
								))}
							</div>
						</div>
					))}
				</div>
			)}
		</section>
	);
};
