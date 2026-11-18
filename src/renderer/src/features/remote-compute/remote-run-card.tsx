/**
 * The run card: what one submitted run is doing, under the conversation it came from.
 *
 * WHY IT EXISTS AT ALL. A remote run spends money and time while the user is doing
 * something else, and the picker is closed by then. So the facts a run owns - its
 * status, its elapsed time, the amount it holds, the network it is recorded against -
 * live on a card in the pane that started it, where `Cancel` and `Forget` are one
 * press away.
 *
 * THE THREE CLAIMS THE CARD IS BUILT TO GET RIGHT:
 *
 * - THE HOLD IS NOT A PRICE. `hold_usd` is the committed maximum while the run is
 *   unsettled; `charged_usd` is what it settled at. The card prints whichever the
 *   server states and never both, and it prints nothing when the server states
 *   neither - `$0.00` for an unreported hold would be a number nobody made.
 * - THE BINDING IS RECORDED, NOT ENFORCED (see `remoteRunCardModel`). The line names
 *   the network the run carries, and says nothing about isolation.
 * - A RUN THAT STOPS BEING UPDATED SAYS SO. Polling stops on the first settled
 *   status and, independently, once the run's own deadline is more than
 *   `REMOTE_RUN_POLL_GRACE_MS` past - and a card whose read has stopped is a card
 *   that states the last read rather than spinning.
 *
 * LOGS AND RESULTS are drawn only when the answering server has the routes
 * (`useRemoteArtifactsOffer`): their payload lands in a follow-up release, and a
 * control that 404s is worse than one that is not there yet.
 */

import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Cloud } from "lucide-react";
import { type FC, useState } from "react";
import { useRemoteArtifactsOffer } from "./remote-compute-artifacts";
import { useNow } from "./remote-compute-clock";
import { remoteRunCardModel } from "./remote-compute-model";
import {
	RemoteRefusal,
	useRemoteComputeRead,
	useRemoteRun,
	useRemoteRunCancel,
	useRemoteRunDelete,
} from "./remote-compute-store";
import { remoteRunPhase } from "./remote-compute-types";
import { useRemoteRunPins } from "./remote-run-pins";

/** The ink a phase's status word takes: quiet while live, quieter once settled. */
const PHASE_INK: Record<"live" | "settled" | "failed", string> = {
	live: "text-ink",
	settled: "text-ink-muted",
	failed: "text-warning",
};

export type RemoteRunCardProps = {
	runId: string;
	/** The network the run is recorded against, named by the caller's own read. */
	networkName: (networkId: string | null) => string | null;
	/** Forgets the card after the run itself is deleted. */
	onForgotten: (runId: string) => void;
};

export const RemoteRunCard: FC<RemoteRunCardProps> = ({
	runId,
	networkName,
	onForgotten,
}) => {
	useI18nLocale();
	const now = useNow(1_000);
	const query = useRemoteRun(runId, now);
	const cancel = useRemoteRunCancel();
	const remove = useRemoteRunDelete();
	const [failure, setFailure] = useState<string | null>(null);
	const run = query.data;
	/*
	 * THE ARTIFACT PROBE IS ASKED BEFORE ANY RETURN, because hook order is a contract:
	 * the early return below is the first read of a freshly created run, and a hook
	 * that only ran once a row existed would change the hook count mid-life of the
	 * component. `enabled` is the phase the LAST read stated, which is exactly the
	 * condition the route set can answer for.
	 */
	const artifacts = useRemoteArtifactsOffer(
		runId,
		run != null && remoteRunPhase(run.status) !== "in-flight",
	);
	if (!run) {
		/*
		 * NO ROW YET IS NOT A FAILURE: the first read of a run this window just
		 * created is in flight for a moment. A card that drew "unavailable" in that
		 * beat would report a problem on every submission.
		 */
		return query.isError ? (
			<output
				data-remote-run-card="unavailable"
				className="flex items-center gap-2 rounded-lg bg-sunken px-3 py-2 text-body-sm text-ink-muted"
			>
				<span className="min-w-0 flex-1">
					{t("ui.chat.remote_compute.card.unavailable")}
				</span>
				<Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
					{t("ui.chat.remote_compute.remedy.refresh")}
				</Button>
			</output>
		) : null;
	}
	const model = remoteRunCardModel(run, {
		now,
		networkName: networkName(run.network_id),
	});
	const phase = remoteRunPhase(run.status);
	const ink =
		phase === "in-flight"
			? PHASE_INK.live
			: phase === "failed"
				? PHASE_INK.failed
				: PHASE_INK.settled;
	return (
		<output
			data-remote-run-card={phase}
			data-remote-run={run.id}
			/*
			 * `aria-live="polite"` because this IS the report of something the user
			 * asked for and it changes on its own: the status word is the only part a
			 * screen reader needs announced, and `polite` keeps it from interrupting.
			 */
			aria-live="polite"
			className="flex flex-col gap-2 rounded-lg bg-sunken px-3 py-2.5"
		>
			<div className="flex items-center gap-2">
				<Cloud aria-hidden="true" className="size-3.5 shrink-0 text-ink-dim" />
				<span className="min-w-0 flex-1 truncate text-body-sm text-ink">
					{model.title}
				</span>
				<span
					data-remote-run-status={run.status}
					className={cn(
						"shrink-0 text-meta",
						ink,
						// An unrecognised status is machine voice: mono, so it reads as the
						// server's token rather than as a sentence this app wrote.
						!model.statusKnown && "font-mono",
					)}
				>
					{model.status}
				</span>
			</div>
			<div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-meta text-ink-dim">
				{/*
				 * ONE FACT PER SPAN, A MIDDOT BETWEEN THEM - the same separator the picker's
				 * aggregate uses, so two lines of this family read as one voice. Painted as
				 * its own span rather than baked into the strings so a translated sentence
				 * can never end up with two separators or none.
				 */}
				{(
					[
						model.elapsed
							? {
									key: "elapsed",
									node: <span data-remote-run-elapsed="">{model.elapsed}</span>,
								}
							: null,
						model.amount
							? {
									key: "amount",
									node: (
										<span data-remote-run-amount={model.amount.kind}>
											{model.amount.text}
										</span>
									),
								}
							: null,
						{
							key: "binding",
							node: (
								<span data-remote-run-binding="" className="min-w-0 truncate">
									{model.binding}
								</span>
							),
						},
					] as const
				)
					.filter((fact) => fact !== null)
					.map((fact, index) => (
						<span key={fact.key} className="flex items-center gap-1.5">
							{index > 0 ? (
								<span aria-hidden="true" className="text-ink-dim">
									·
								</span>
							) : null}
							{fact.node}
						</span>
					))}
			</div>
			{failure ? (
				<span data-remote-run-refusal="" className="text-meta text-warning">
					{failure}
				</span>
			) : null}
			<div className="flex flex-wrap items-center gap-1">
				{model.actions.cancel ? (
					<Button
						variant="ghost"
						size="sm"
						data-remote-run-cancel=""
						disabled={cancel.isPending}
						onClick={() => {
							setFailure(null);
							cancel.mutate(run.id, {
								onError: (error) =>
									setFailure(
										error instanceof RemoteRefusal
											? error.message
											: t("ui.chat.remote_compute.card.cancel_failed"),
									),
							});
						}}
					>
						{t("ui.chat.remote_compute.card.cancel")}
					</Button>
				) : null}
				{model.actions.delete ? (
					<Button
						variant="ghost"
						size="sm"
						data-remote-run-forget=""
						disabled={remove.isPending}
						onClick={() => {
							setFailure(null);
							remove.mutate(run.id, {
								onSuccess: () => onForgotten(run.id),
								onError: (error) =>
									setFailure(
										error instanceof RemoteRefusal
											? error.message
											: t("ui.chat.remote_compute.card.forget_failed"),
									),
							});
						}}
					>
						{t("ui.chat.remote_compute.card.forget")}
					</Button>
				) : null}
				{artifacts === "offered" ? (
					<>
						<Button
							variant="ghost"
							size="sm"
							data-remote-run-logs=""
							disabled
							title={t("ui.chat.remote_compute.card.artifacts_soon")}
						>
							{t("ui.chat.remote_compute.card.logs")}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							data-remote-run-results=""
							disabled
							title={t("ui.chat.remote_compute.card.artifacts_soon")}
						>
							{t("ui.chat.remote_compute.card.results")}
						</Button>
					</>
				) : null}
			</div>
		</output>
	);
};

/**
 * Every run this conversation started, above its transcript.
 *
 * ONE COMPONENT, ONE ROW EACH, and no empty state: a conversation that started no run
 * draws nothing at all. That is the difference between this and the runs list - the
 * list exists to be opened, so its emptiness is worth a sentence; this is a report
 * about this pane's own requests, and a report of nothing is nothing.
 *
 * THE PANE'S ASSOCIATION IS THIS WINDOW'S (`remote-run-pins.ts`), so a reload empties
 * this row without emptying the runs: the card is a convenience over a fact the runs
 * list still carries.
 */
export const RemoteRunCards: FC<{
	/** The pane's identity: the session id, or a draft's key. */
	paneKey: string;
}> = ({ paneKey }) => {
	const runIds = useRemoteRunPins((state) => state.pins[paneKey]);
	const forget = useRemoteRunPins((state) => state.forget);
	/*
	 * THE NAMES COME FROM THE CAPABILITY READ, at its catalogue cadence and on the
	 * SHARED key: a card beside an open picker shares one entry, and the card only
	 * needs the names for runs that carry a network id. Asked before the early return
	 * because hook order is a contract, and gated on the row existing so a conversation
	 * with no runs costs nothing.
	 */
	const read = useRemoteComputeRead((runIds?.length ?? 0) > 0);
	const networkName = (networkId: string | null): string | null => {
		if (!networkId) return null;
		return (
			read.data?.networks.find((row) => row.network_id === networkId)?.name ??
			null
		);
	};
	if (!runIds || runIds.length === 0) return null;
	return (
		<div data-remote-run-cards="" className="flex flex-col gap-2 px-4 pt-2">
			{runIds.map((runId) => (
				<RemoteRunCard
					key={runId}
					runId={runId}
					networkName={networkName}
					onForgotten={(id) => forget(paneKey, id)}
				/>
			))}
		</div>
	);
};
