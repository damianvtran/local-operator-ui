/**
 * The linked sessions' to-dos, aggregated into rows.
 *
 * WHAT THE WIRE GIVES: each linked session's composed view carries a to-do
 * SUMMARY (`{open, total}`) or `null` when no snapshot was ever persisted.
 * `null` is UNKNOWN and is never summed as a zero (`project-model.ts` states
 * the rule; this section is its reader), so the aggregate names only what it
 * could see and each row keeps its own count, which is the coverage.
 *
 * READ-ONLY ON PURPOSE: to-dos are the sessions' own record of their work, and
 * this surface has no write path for them. The rows exist so the project view
 * answers "what is still open here" without opening four conversations.
 */

import type { FC } from "react";
import type { DesktopLinkedSession } from "../../../../../shared/desktop-control-contract";
import {
	sessionLabel,
	todosAggregate,
	todosCountLabel,
} from "../project-model";

export type ProjectTodosProps = {
	links: DesktopLinkedSession[];
};

export const ProjectTodos: FC<ProjectTodosProps> = ({ links }) => {
	const aggregate = todosAggregate(links);
	const rows = links.filter((link) => link.todos !== null);
	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-baseline justify-between gap-3">
				<h2 className="text-title text-ink">To-dos</h2>
				{aggregate && (
					<span className="text-meta text-ink-muted tabular-nums">
						{todosCountLabel(aggregate)}
					</span>
				)}
			</div>

			{rows.length === 0 ? (
				<p className="text-body-sm text-ink-muted">
					No to-do snapshots from the linked sessions yet. A session publishes
					its list as it works, and it appears here once it has.
				</p>
			) : (
				/* Borderless rows, the chat page's chrome: hairlines, no group box. */
				<ul className="flex flex-col divide-y divide-hairline">
					{rows.map((link) => (
						<li
							key={link.session_id}
							className="flex items-center gap-3 rounded-sm px-2 py-2"
						>
							<span
								className={
									link.title
										? "min-w-0 flex-1 truncate text-body-sm text-ink"
										: "min-w-0 flex-1 truncate font-mono text-mono-sm text-ink-muted"
								}
							>
								{sessionLabel(link)}
							</span>
							{link.todos && (
								<span className="shrink-0 text-meta text-ink-muted tabular-nums">
									{todosCountLabel(link.todos)}
								</span>
							)}
						</li>
					))}
				</ul>
			)}
		</section>
	);
};
