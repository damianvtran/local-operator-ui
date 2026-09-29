/**
 * The detail page's properties block: the planning dates, the estimate, the
 * tags and when the record last moved.
 *
 * A SPEC SHEET, not a paragraph — each fact on its own labelled row, because
 * the values are scanned rather than read. Absent facts are OMITTED rather
 * than printed as dashes: `null` means UNKNOWN throughout this wire (never a
 * default), and a row reading "Estimate —" teaches the reader nothing the
 * missing row does not.
 *
 * THE UPDATED-AT IS TWO READINGS OF ONE FACT: the relative phrase is what a
 * reader scans ("2h ago"), and the absolute instant is the `title` — the same
 * split the transcripts use for their timestamps, so a hover answers "when
 * exactly" without a second row of chrome.
 */

import { Badge } from "@shared/components/ui";
import type { FC, ReactNode } from "react";
import type { DesktopProjectView } from "../../../../../shared/desktop-control-contract";
import {
	estimateLabel,
	formatProjectDay,
	progressAge,
	progressAgePhrase,
} from "../project-model";

export type ProjectPropertiesProps = {
	project: DesktopProjectView;
	nowMs: number;
};

type Row = { label: string; value: ReactNode };

export const ProjectProperties: FC<ProjectPropertiesProps> = ({
	project,
	nowMs,
}) => {
	const locale =
		typeof navigator === "undefined" ? undefined : navigator.language;
	const now = new Date(nowMs);
	const rows: Row[] = [];

	const start = formatProjectDay(project.start_date, locale, now);
	if (start) rows.push({ label: "Start", value: start });
	const target = formatProjectDay(project.target_date, locale, now);
	if (target) rows.push({ label: "Target", value: target });
	const completed = formatProjectDay(project.completed_at, locale, now);
	if (completed) rows.push({ label: "Completed", value: completed });

	const estimate = estimateLabel(project.estimate, project.estimate_unit);
	if (estimate) rows.push({ label: "Estimate", value: estimate });

	if (project.tags.length > 0) {
		rows.push({
			label: "Tags",
			value: (
				<span className="flex flex-wrap items-center gap-1.5">
					{project.tags.map((tag) => (
						<Badge key={tag} variant="outline">
							{tag}
						</Badge>
					))}
				</span>
			),
		});
	}

	if (project.updated_at > 0) {
		const age = progressAgePhrase(progressAge(project.updated_at, nowMs));
		const absolute = new Date(project.updated_at * 1000).toLocaleString(locale);
		rows.push({
			label: "Updated",
			value: (
				<time
					dateTime={new Date(project.updated_at * 1000).toISOString()}
					title={absolute}
				>
					{age}
				</time>
			),
		});
	}

	return (
		<section className="flex flex-col gap-3">
			<h2 className="text-title text-ink">Properties</h2>
			{rows.length === 0 ? (
				<p className="text-body-sm text-ink-muted">
					No dates, estimate or tags yet.
				</p>
			) : (
				<dl className="flex flex-col gap-2">
					{rows.map((row) => (
						<div key={row.label} className="flex items-baseline gap-3">
							<dt className="w-24 shrink-0 text-body-sm text-ink-muted">
								{row.label}
							</dt>
							<dd className="min-w-0 text-body-sm text-ink">{row.value}</dd>
						</div>
					))}
				</dl>
			)}
		</section>
	);
};
