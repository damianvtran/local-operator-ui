/**
 * The profile-save card: one signed proposal, stated in the app's own words.
 *
 * WHY A COMPONENT RATHER THAN MORE MARKUP INSIDE THE APPROVAL CARD: the same
 * statement has to appear where the answer is a signature (the approvals rail)
 * and, later, where the same record is a saved change and the action is a revert
 * (a conversation). The card owns what a reader must be able to see: which
 * profile, which fields, from what value to what value, and what the record's
 * state actually is. The verbs are the host's, passed in as `actions`.
 *
 * WHAT THIS COMPONENT MAY NEVER DO. It never derives a value the wire did not
 * carry: a missing authored column reads `Not set` in one column and absent in
 * the other, and the rows come from the disclosure's own images
 * (`profileFieldRows`) - never from a diff this app computed. It never draws a
 * press it cannot honour: the revert control renders disabled with its reason
 * unless a VERIFIED descriptor and a live `available` status reached it - the
 * kill-switch for an older backend or an action this runtime never bound.
 *
 * FIELD NAMES ARE THE WIRE'S OWN SPELLING, in the machine face. They are keys the
 * backend authors (`model`, `instructions`, `members`), not copy this build
 * translates: a translated field name would be a second name for the same column,
 * and a reader comparing the card with the record would have to map between them.
 *
 * IT IS BUILT FROM ROLES, NEVER COLOURS (docs/branding.md): `text-ink`,
 * `text-ink-muted`, `text-ink-dim`, `bg-sunken`, `border-hairline`.
 */

import { Button } from "@shared/components/ui/button";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import type { ReactNode } from "react";
import { useId } from "react";
import { t } from "../../../../i18n/messages";
import {
	type ProfileCardView,
	type ProfileFieldView,
	profileKindLabel,
	profileOperationLabel,
} from "./mesh-profile-approval";

function fieldValue(
	value: ProfileFieldView,
	column: "before" | "after",
): string {
	const cell = column === "before" ? value.before : value.after;
	if (cell.presence === "set") return cell.text;
	if (cell.presence === "unset")
		return t("ui.mesh.mesh_approvals.profile_cleared");
	return t("ui.mesh.mesh_approvals.profile_not_set");
}

export interface ProfileConsentCardProps {
	view: ProfileCardView;
	/**
	 * The host's verbs - Approve/Deny in the approvals rail. Absent renders the
	 * card with no control row, which is the read-only shape a settled record gets.
	 */
	actions?: ReactNode;
	/**
	 * The revert's deciding control, wired by the host that owns the approval-answer
	 * channel. Absent means the control still renders - disabled, with its reason -
	 * because a missing verb is not a quiet way to drop a state the reader has to
	 * be able to see.
	 */
	onRevert?: () => void;
	className?: string;
}

export function ProfileConsentCard({
	view,
	actions,
	onRevert,
	className,
}: ProfileConsentCardProps) {
	useI18nLocale();
	const headId = useId();
	const changesId = useId();
	const revertNoteId = useId();
	const revert = view.revert ?? null;
	const revertDisabled = !revert || !revert.enabled || !onRevert;
	/*
	 * A DISABLED CONTROL ALWAYS SAYS WHY (design D1 / UX U3). Two ways it used to go
	 * silent: a descriptor with no dispatch handler (enabled state, no verb), and the
	 * unavailable arm whose reason lived on a view that was never rendered. The
	 * reason is real text tied by `aria-describedby`, never a `title` and never ink
	 * alone; when no specific reason is known, the card says THAT rather than
	 * leaving the space blank.
	 */
	const revertReason = !revert
		? null
		: (revert.note ??
			(onRevert === undefined
				? t("ui.mesh.mesh_approvals.profile_revert_no_handler")
				: revertDisabled
					? t("ui.mesh.mesh_approvals.profile_revert_reason_unknown")
					: null));
	return (
		<section
			className={cn(
				"flex flex-col gap-3 rounded-md bg-sunken p-3 text-body-sm text-ink",
				className,
			)}
			aria-labelledby={headId}
			data-tour-tag="profile-consent-card"
			data-profile-state={view.state}
			data-profile-revert={revert?.state ?? "absent"}
		>
			<header className="flex flex-col gap-1">
				<span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-dim">
					{view.kind && <span>{profileKindLabel(view.kind)}</span>}
					{view.operation && (
						<span data-tour-tag="profile-consent-operation">
							{profileOperationLabel(view.operation)}
						</span>
					)}
					{view.scope === "global" && (
						<span>{t("ui.mesh.mesh_approvals.profile_scope_global")}</span>
					)}
				</span>
				<h3
					id={headId}
					className="font-mono text-body-sm text-ink [overflow-wrap:anywhere]"
					data-tour-tag="profile-consent-name"
				>
					{view.name}
				</h3>
				{view.stateNote && (
					<p className="text-meta text-ink-muted">{view.stateNote}</p>
				)}
			</header>

			{/*
			 * THE DIFF IS THE CARD'S BODY, not a disclosure: the values that will be
			 * signed are the reason this card exists, and hiding them would let a reader
			 * sign a list of field names. A long value wraps; nothing is ellipsised,
			 * because a truncated diff is one the reader cannot review.
			 */}
			<div className="flex flex-col gap-1.5">
				<h4 id={changesId} className="text-meta text-ink-muted">
					{t("ui.mesh.mesh_approvals.profile_changes")}
				</h4>
				{view.fields.length > 0 ? (
					<table
						className="w-full border-collapse text-left text-meta"
						aria-labelledby={changesId}
						data-tour-tag="profile-consent-diff"
					>
						<thead>
							<tr className="text-ink-dim">
								<th scope="col" className="py-1 pr-2 font-normal">
									{t("ui.mesh.mesh_approvals.profile_field")}
								</th>
								<th scope="col" className="py-1 pr-2 font-normal">
									{t("ui.mesh.mesh_approvals.profile_column_before")}
								</th>
								<th scope="col" className="py-1 font-normal">
									{t("ui.mesh.mesh_approvals.profile_column_after")}
								</th>
							</tr>
						</thead>
						<tbody>
							{view.fields.map((field) => (
								<tr
									key={field.field}
									className="border-hairline border-t align-top"
									data-profile-field={field.field}
								>
									<th
										scope="row"
										className="py-1 pr-2 font-mono font-normal text-ink-muted"
									>
										{field.field}
									</th>
									<td className="py-1 pr-2 text-ink-dim [overflow-wrap:anywhere]">
										{fieldValue(field, "before")}
									</td>
									<td className="py-1 text-ink [overflow-wrap:anywhere]">
										{fieldValue(field, "after")}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				) : view.diffLines.length > 0 ? (
					/*
					 * THE BACKEND'S OWN LINES, VERBATIM (parent correction to I1). A
					 * receipt carries `fields` and `diff`, and `diff` is where a POLICY
					 * change is stated in words: class, effort, tools and delegate live
					 * inside the `tags` image, so a permission-relevant change would
					 * otherwise read as a bare "tags changed". These lines are rendered as
					 * the backend authored them; this card never parses tag strings to
					 * describe a policy change itself.
					 */
					<ul
						className="flex flex-col gap-1 text-meta text-ink [overflow-wrap:anywhere]"
						data-tour-tag="profile-consent-diff-lines"
					>
						{view.diffLines.map((line) => (
							<li key={line}>{line}</li>
						))}
					</ul>
				) : view.changedFieldNames.length > 0 ? (
					<p
						className="font-mono text-meta text-ink [overflow-wrap:anywhere]"
						data-tour-tag="profile-consent-changed-fields"
					>
						{view.changedFieldNames.join(", ")}
					</p>
				) : (
					/*
					 * TWO EMPTY CASES, TWO SENTENCES (i18n audit I1). "Nothing changed" is
					 * a claim about a diff we hold; a payload that carried no images and no
					 * lines at all gets the honest fallback instead.
					 */
					<p
						className="text-meta text-ink-dim"
						data-tour-tag={
							view.changesIncluded
								? "profile-consent-no-changes"
								: "profile-consent-changes-not-included"
						}
					>
						{view.changesIncluded
							? t("ui.mesh.mesh_approvals.profile_changes_none")
							: t("ui.mesh.mesh_approvals.profile_changes_not_in_receipt")}
					</p>
				)}
			</div>

			{/*
			 * THE REASON A CARD CANNOT BE SIGNED HERE is stated where the reader would
			 * look for the verb: an opaque card that offered nothing and explained
			 * nothing is the shape these approval surfaces exist to avoid.
			 */}
			{view.unavailableReason && (
				<p
					className="text-meta text-ink-muted [overflow-wrap:anywhere]"
					data-tour-tag="profile-consent-unavailable"
				>
					{view.unavailableReason}
				</p>
			)}

			<div className="flex flex-wrap items-center gap-2">
				{actions}
				{/*
				 * ONE-CLICK REVERT, and every honest shape it has. A native `button` so
				 * keyboard and pointer reach it the same way; the disabled state carries
				 * its reason through `aria-describedby` rather than a `title`, because a
				 * tooltip is not reachable from a disabled control.
				 */}
				{revert && (
					<span className="inline-flex items-center gap-2">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={revertDisabled}
							aria-describedby={revertReason ? revertNoteId : undefined}
							onClick={onRevert}
							data-tour-tag="profile-consent-revert"
						>
							{revert.label}
						</Button>
						{revertReason && (
							<span
								id={revertNoteId}
								className="text-meta text-ink-dim [overflow-wrap:anywhere]"
								data-tour-tag="profile-consent-revert-note"
							>
								{revertReason}
							</span>
						)}
					</span>
				)}
			</div>
		</section>
	);
}
