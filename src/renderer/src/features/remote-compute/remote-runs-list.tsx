/**
 * Every run the server holds, in the one list shape this app already uses.
 *
 * WHERE IT LIVES AND WHY. The picker's Radient row is the only Radient surface in
 * the app, and it states the aggregate rather than a list (design §2.3 is one row,
 * not a header and a row). So the list is the second level's sibling: a dialog
 * opened from the sheet's own footer, following the row-and-state conventions the
 * projects list uses (`project-list.tsx`) rather than inventing a second list
 * idiom - one row per run, one fact per line, a reason where a row cannot be acted
 * on, and the same empty/loading/error vocabulary.
 *
 * WHAT IT ADDS TO THE CARD. A card belongs to the conversation that started its
 * run; a run started from the shell, or from a conversation this window is not
 * showing, has no card here. This list is the surface for those rows, including
 * the server's own `record` rows when the account is signed out - which is why
 * `server` is drawn when it is not `ok`: "these are this device's last known rows"
 * and "these are the provider's" are different claims.
 *
 * IT POLLS AT THE CATALOGUE CADENCE, not the card's five seconds: the list is not
 * the surface a user watches a single run on, and thirty seconds is the app's own
 * listing clock. Nothing here is per-run, so opening the list costs one read.
 */

import {
	Button,
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	Separator,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { type FC, useState } from "react";
import { useNow } from "./remote-compute-clock";
import { remoteRunCardModel } from "./remote-compute-model";
import {
	RemoteRefusal,
	useRemoteRunCancel,
	useRemoteRuns,
} from "./remote-compute-store";
import { type RemoteRun, remoteRunPhase } from "./remote-compute-types";

/**
 * One fact after the status, with the middot the card paints before its own.
 *
 * ONLY FOR THE FACTS THAT FOLLOW ANOTHER (design round 2, D7): the status is the
 * line's first word and needs no mark, and the card's rule is the same one - a
 * separator before everything but the first.
 */
const Fact: FC<{ text: string; ink?: string; tabular?: boolean }> = ({
	text,
	ink = "text-ink-dim",
	tabular = false,
}) => (
	<span className="flex items-baseline gap-1.5">
		<span aria-hidden="true" className="text-ink-dim">
			·
		</span>
		<span className={cn(ink, tabular && "tabular-nums")}>{text}</span>
	</span>
);

const phaseInk = (run: RemoteRun): string => {
	switch (remoteRunPhase(run.status)) {
		case "failed":
			// `danger`, the role a failed state takes elsewhere in this app: `warning`
			// is already the wash on the "these rows are last known" banner (design D8).
			return "text-danger";
		case "in-flight":
			return "text-ink";
		default:
			return "text-ink-muted";
	}
};

export type RemoteRunsDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	enabled: boolean;
	/** The name a run's recorded network id is shown by, from the capability read. */
	networkName: (networkId: string | null) => string | null;
};

export const RemoteRunsDialog: FC<RemoteRunsDialogProps> = ({
	open,
	onOpenChange,
	enabled,
	networkName,
}) => {
	useI18nLocale();
	/* The clock only ticks while this panel is on screen; see `remote-compute-clock.ts`. */
	const now = useNow(open ? 10_000 : 60_000);
	const list = useRemoteRuns(open && enabled, { poll: open });
	const cancel = useRemoteRunCancel();
	const [failure, setFailure] = useState<string | null>(null);
	const runs = list.data?.runs ?? [];
	const server = list.data?.server ?? null;
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				data-radient-runs=""
				// The list is a place to read, not a form: taking the auto-focus off the
				// first control keeps a ring off `Close` in every frame and leaves the
				// caret on the dialog itself.
				onOpenAutoFocus={(event) => event.preventDefault()}
				/*
				 * THE CORNER IS `Dismiss`, ITS FOOTER IS `Close` (QA round 4, Q-4-1). This
				 * dialog is the sheet's sibling two controls away (`View runs` reaches it), and
				 * it had the exact pair U11 removed from the sheet: two stops named `Close` in
				 * one trap, nothing to tell them apart.
				 */
				closeLabel={t("ui.common.actions.dismiss")}
				/*
				 * AND THE PANEL DOES NOT PAINT ITS OWN EDGE (design round 1, D5).
				 * `html :focus-visible` draws a 2px accent stroke at 2px offset and its own
				 * rule 5 lets the outline reach `[data-lo-floating]`, so this dialog - the
				 * only one of the family that carries the attribute - framed itself in the
				 * accent while its sibling sheet and its own empty state drew nothing. A
				 * floating surface separates by ground and the one shadow; a 2px accent
				 * stroke on the panel is a border by construction. Child focus rings are
				 * untouched: this removes the PANEL-level one only.
				 */
				className="w-[30rem] gap-3 p-5 outline-none"
			>
				<DialogHeader>
					<DialogTitle>{t("ui.chat.remote_compute.runs.title")}</DialogTitle>
				</DialogHeader>
				{server && server !== "ok" ? (
					/*
					 * THE SERVER'S OWN VERDICT, drawn because the rows mean something
					 * different for each value: `signed-out` rows are this device's record,
					 * and `unavailable` rows are neither. Drawing either as "the provider's
					 * runs" would be the claim the field exists to prevent.
					 */
					<p
						data-radient-runs-server={server}
						className="rounded-sm bg-warning-wash px-2.5 py-1.5 text-meta text-ink"
					>
						{server === "signed-out"
							? t("ui.chat.remote_compute.runs.record_only")
							: server === "disabled"
								? t("ui.chat.remote_compute.runs.disabled")
								: t("ui.chat.remote_compute.runs.unavailable")}
					</p>
				) : null}
				{failure ? (
					<span className="text-meta text-warning">{failure}</span>
				) : null}
				{list.isLoading ? (
					<p className="text-body-sm text-ink-muted">
						{t("ui.chat.remote_compute.runs.loading")}
					</p>
				) : runs.length === 0 ? (
					<p data-radient-runs-empty="" className="text-body-sm text-ink-muted">
						{t("ui.chat.remote_compute.runs.empty")}
					</p>
				) : (
					<div className="flex max-h-80 flex-col overflow-y-auto">
						{runs.map((run, index) => {
							const model = remoteRunCardModel(run, {
								now,
								networkName: run.network_id
									? networkName(run.network_id)
									: null,
							});
							return (
								<div
									key={run.id}
									data-radient-run-row={remoteRunPhase(run.status)}
								>
									{index > 0 ? <Separator /> : null}
									<div className="flex items-center gap-2 py-2">
										<div className="flex min-w-0 flex-1 flex-col gap-0.5">
											<span className="truncate text-body-sm text-ink">
												{model.title}
											</span>
											<span className="flex flex-wrap items-baseline gap-x-1.5 text-meta text-ink-dim">
												<span className={cn(phaseInk(run))}>
													{model.status}
												</span>
												{/*
												 * THE SAME SEPARATOR THE CARD PAINTS (design round 2, D7). These are one
												 * model and one row family, and the card already marks its facts with a
												 * middot "so two lines of this family read as one voice"; the list separated
												 * them with 8px of whitespace instead, which made the same three facts look
												 * like two different notations on two surfaces a click apart.
												 */}
												{model.elapsed ? <Fact text={model.elapsed} /> : null}
												{/* One step louder than the clock it sits beside (design D3). */}
												{model.amount ? (
													<Fact
														text={model.amount.text}
														ink="text-ink-muted"
														tabular
													/>
												) : null}
											</span>
										</div>
										{model.actions.cancel ? (
											<Button
												variant="ghost"
												size="sm"
												disabled={cancel.isPending}
												onClick={() => {
													setFailure(null);
													cancel.mutate(run.id, {
														onError: (error) =>
															setFailure(
																error instanceof RemoteRefusal
																	? error.message
																	: t(
																			"ui.chat.remote_compute.card.cancel_failed",
																		),
															),
													});
												}}
											>
												{t("ui.chat.remote_compute.card.cancel")}
											</Button>
										) : null}
									</div>
								</div>
							);
						})}
					</div>
				)}
				<div className="flex justify-end">
					<Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
						{t("ui.chat.remote_compute.sheet.close")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
};
