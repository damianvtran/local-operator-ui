import { t } from "@shared/i18n";
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
 * ATTACHMENTS render through `ProjectUpdateAssets`: one grid per entry of the
 * SAME attachment components chat uses — `ImageAttachment` thumbnails, video
 * tiles, the canonical `SoundPlayer`, and the shared file tile — with the
 * shared `ImageLightbox` as the one gallery for that entry's pictures and
 * clips. The grid owns laziness (`useEverInView` gates every byte read), so a
 * long history opens without reading its evidence up front; the reader of the
 * components themselves lives in `project-update-assets.tsx`.
 */

import { useI18nLocale } from "@shared/i18n/use-locale";
import type { FC } from "react";
import { Fragment } from "react";
import type { DesktopProjectUpdate } from "../../../../../shared/desktop-control-contract";
import { ProjectMarkdown } from "../project-markdown";
import {
	groupUpdatesByDay,
	updateMetaTokens,
	updatesCountLabel,
} from "../project-model";
import { ProjectUpdateAssets } from "./project-update-assets";

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
				<ProjectUpdateAssets attachments={update.attachments} />
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
				<h2 className="text-title text-ink">
					{t("ui.projects.project_updates.updates")}
				</h2>
				{count && <span className="text-meta text-ink-muted">{count}</span>}
			</div>

			{updates.length === 0 ? (
				<p className="text-body-sm text-ink-muted">
					{t(
						"ui.projects.project_updates.no_updates_yet_progress_reported_by_you_or_by_the_sessions_workin",
					)}
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
