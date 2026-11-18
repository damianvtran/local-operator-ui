/**
 * The second level: where the tier is chosen, with the binding on the same screen.
 *
 * WHY THE TIER IS NOT IN THE DROPDOWN (design §2.4). A dropdown row is a
 * destination, and the tier is a property of the RUN. Two top-level rows would say
 * there are two destinations, and they would double every state above them - signed
 * out, capacity unavailable, a run in flight - into pairs that say the same thing
 * twice. This level is also the last screen before a run is bought, so it is the one
 * place the network binding and the prompt both fit.
 *
 * WHAT IT SHOWS, AND WHAT IT DELIBERATELY DOES NOT:
 *
 * - the NETWORK, always, and only pre-selected when there is exactly one. Two
 *   networks and nobody's choice means the tier rows stand down with `choose a
 *   network` on them: a surface that hid which mesh a run joins would be hiding the
 *   one decision this screen exists for.
 * - `Cloud run` (the on-demand choice, and the only one v1 sells) and `Dedicated`
 *   with `Spot` under it, both disabled with `coming soon`. The route refuses that
 *   token, so a drawn-but-enabled row would be a control that cannot work.
 * - the prompt as a ONE-LINE SUMMARY and the conversation's own directory. The
 *   summary is recognition, not editing: what runs is the composer's text, read at
 *   submit, so a truncation here can never change the run.
 * - NO PRICE AND NO CAP. `pricing` is `null` on the wire today, so any figure here
 *   would be a constant that drifts from the deployment's configuration; and no cap
 *   or deadline is sent, so printing either would state a boundary the request does
 *   not carry. The hold the server computes is on the RUN CARD, once it exists.
 *
 * THE BINDING IS RECORDED, NOT ENFORCED, and the sheet says exactly that. In this
 * version the binding is a fact the run carries for later enforcement; no sentence
 * here may promise segmentation.
 */

import {
	Button,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Separator,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import {
	RADIENT_BILLING_URL,
	openConsolePage,
} from "@shared/utils/radient-account-copy";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { type FC, useEffect, useRef, useState } from "react";
import { useNow } from "./remote-compute-clock";
import {
	type RemoteSheetModel,
	type RemoteTierRow,
	remoteRemedy,
	remoteRemedyLabel,
	remoteRetrySeconds,
	remoteSheetModel,
} from "./remote-compute-model";
import {
	RemoteRefusal,
	remoteComputeKeys,
	useRemoteRunStart,
} from "./remote-compute-store";
import type { RemoteComputeRead, RemoteRun } from "./remote-compute-types";
import { RemoteSignIn } from "./remote-sign-in";

/**
 * One tier, as a row.
 *
 * NOT A RADIO: in this version exactly one tier can run, so a control that looks
 * selectable would offer a choice that does not exist. The check marks the one that
 * will run, and the disabled row states why it cannot. When a second tier ships, this
 * becomes a real radio group and the copy does not change.
 */
const TierRow: FC<{ row: RemoteTierRow }> = ({ row }) => (
	<div
		data-radient-tier={row.tier}
		data-disabled={row.disabled ? "" : undefined}
		className={cn(
			"flex items-start gap-2 rounded-sm px-2.5 py-2",
			row.disabled ? "cursor-not-allowed" : "bg-row-selected",
		)}
	>
		<span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
			{row.disabled ? null : (
				<Check aria-hidden="true" className="size-3.5 text-ink" />
			)}
		</span>
		<span className="flex min-w-0 flex-1 flex-col gap-0.5">
			<span
				className={cn(
					"truncate text-body-sm",
					row.disabled ? "text-ink-disabled" : "text-ink",
				)}
			>
				{row.title}
			</span>
			{/* One shape fact, never a price: the list is a choice, not a datasheet. */}
			<span className="text-meta text-ink-dim">{row.note}</span>
			{row.why ? (
				<span className="text-meta text-ink-dim">{row.why}</span>
			) : null}
			{row.spot ? (
				/*
				 * THE OPT-IN NESTED UNDER ITS PARENT, indented by a hairline so it reads as a
				 * variant of the row above rather than a third destination. Disabled with the
				 * same reason: the parent cannot be bought yet, so neither can its
				 * interruption-tolerant half.
				 */
				<span
					data-radient-tier-spot=""
					className="mt-1 flex flex-col gap-0.5 border-s border-hairline ps-2"
				>
					<span className="text-body-sm text-ink-disabled">
						{row.spot.title}
					</span>
					<span className="text-meta text-ink-dim">{row.spot.note}</span>
					<span className="text-meta text-ink-dim">{row.spot.why}</span>
				</span>
			) : null}
		</span>
	</div>
);

/** `Network`, then the one line that is a statement rather than a chooser. */
const NetworkLine: FC<{
	model: RemoteSheetModel;
	onChoose: (networkId: string) => void;
	choosing: boolean;
}> = ({ model, onChoose, choosing }) => (
	<div className="flex flex-col gap-1.5">
		<div className="flex items-baseline gap-2">
			<span className="text-meta text-ink-dim">
				{t("ui.chat.remote_compute.sheet.network.label")}
			</span>
			<span className="min-w-0 flex-1 truncate text-body-sm text-ink">
				{model.network.label}
			</span>
			{model.network.options.length > 1 ? (
				<Button
					variant="linkQuiet"
					size="sm"
					onClick={() => onChoose("")}
					aria-expanded={choosing}
				>
					{t("ui.chat.remote_compute.sheet.network.change")}
				</Button>
			) : null}
		</div>
		{choosing || model.network.chosen === null ? (
			<div
				data-radient-network-options=""
				className="flex flex-col gap-1 ps-0.5"
			>
				{model.network.options.map((option) => (
					<button
						key={option.network_id}
						type="button"
						data-network-option={option.network_id}
						data-selected={
							model.network.chosen?.network_id === option.network_id
								? ""
								: undefined
						}
						onClick={() => onChoose(option.network_id)}
						className={cn(
							"flex items-center gap-2 rounded-xs px-1.5 py-1 text-start text-body-sm text-ink-muted",
							"hover:bg-row-hover hover:text-ink",
						)}
					>
						<span className="min-w-0 flex-1 truncate">
							{option.name || option.network_id}
						</span>
						<span className="text-meta text-ink-dim">{option.role}</span>
					</button>
				))}
			</div>
		) : null}
		{/* Recorded, not enforced. One sentence, and it never claims protection. */}
		<p className="text-meta text-ink-dim">{model.network.note}</p>
	</div>
);

export type RemoteComputeSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	read: RemoteComputeRead;
	/** The conversation's composer text, as typed. */
	prompt: string;
	/** The directory this conversation would run in. */
	directory: string;
	onSubmitted: (run: RemoteRun) => void;
	/**
	 * The drill-down to every run the server holds, or `undefined` when the caller has
	 * none to offer. It sits in the sheet because the picker's row may not grow a
	 * second item: one row per state is the design's own rule (§2.3), and the sheet is
	 * already where a user goes one level deeper.
	 */
	onViewRuns?: () => void;
};

export const RemoteComputeSheet: FC<RemoteComputeSheetProps> = ({
	open,
	onOpenChange,
	read,
	prompt,
	directory,
	onSubmitted,
	onViewRuns,
}) => {
	useI18nLocale();
	const [chosenNetworkId, setChosenNetworkId] = useState<string | null>(null);
	const [choosing, setChoosing] = useState(false);
	/**
	 * THE IDEMPOTENCY KEY IS MINTED ON THE FIRST PRESS AND RESENT ON EVERY RETRY.
	 *
	 * A start whose response was lost may have created a run, so a retry must carry the
	 * SAME key for the route to replay the recorded outcome instead of starting a second
	 * run. Minting on every press would turn one intent into two purchases; minting on
	 * open would keep a key across two genuinely different intents (a refused start, a
	 * network changed, a second press), which is the opposite mistake.
	 */
	const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
	const [refusedAt, setRefusedAt] = useState<number | null>(null);
	/** A sign-in this sheet started, from the refusal's own remedy. */
	const [signingIn, setSigningIn] = useState(false);
	const start = useRemoteRunStart();
	const queryClient = useQueryClient();
	const now = useNow(1_000);
	/*
	 * A FRESH SHEET IS A FRESH INTENT, and the reset is EDGE-TRIGGERED on `open`.
	 * Depending on `start` would re-run it on every mutation state change and mint a
	 * new idempotency key while the first press was still in flight - turning one
	 * purchase into two. `reset` is react-query's own stable reference.
	 */
	const reset = start.reset;
	const wasOpen = useRef(false);
	useEffect(() => {
		if (open && !wasOpen.current) {
			setChosenNetworkId(null);
			setChoosing(false);
			setRefusedAt(null);
			setSigningIn(false);
			setIdempotencyKey(null);
			reset();
		}
		wasOpen.current = open;
	}, [open, reset]);
	const model = remoteSheetModel({
		value: read,
		prompt,
		directory,
		chosenNetworkId,
	});
	const refusal = start.error instanceof RemoteRefusal ? start.error : null;
	const remedy = refusal ? remoteRemedy(refusal.code) : "none";
	const retrySeconds = refusal
		? remoteRetrySeconds({ retryAfterMs: refusal.retryAfterMs })
		: null;
	const waiting =
		retrySeconds !== null && refusedAt !== null
			? Math.max(0, retrySeconds - Math.floor((now - refusedAt) / 1000))
			: null;
	const submit = () => {
		const network = model.network.chosen;
		if (!network || !model.submit.enabled) return;
		const key = idempotencyKey ?? crypto.randomUUID();
		if (idempotencyKey === null) setIdempotencyKey(key);
		start.mutate(
			{
				directory,
				prompt,
				networkId: network.network_id,
				idempotencyKey: key,
			},
			{
				onSuccess: (run) => {
					onSubmitted(run);
					onOpenChange(false);
				},
				onError: () => setRefusedAt(Date.now()),
			},
		);
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				data-radient-sheet=""
				/*
				 * THE SHEET TAKES THE FOCUS ITSELF, not its first control. Radix focuses
				 * the first focusable element, which here is the tertiary `View runs` -
				 * so the dialog opened with a focus ring on the quietest thing on it, and
				 * the one action nobody should trigger by accident (Start run, which
				 * spends money) is a Tab away rather than the default. Preventing the
				 * auto-focus leaves the caret on the dialog's own scroll container, where
				 * Escape and the Tab order both keep working.
				 */
				onOpenAutoFocus={(event) => event.preventDefault()}
				className="w-[27rem] max-w-[calc(100vw-2rem)] gap-4 p-5"
			>
				<DialogHeader>
					<DialogTitle>{model.heading}</DialogTitle>
				</DialogHeader>
				<NetworkLine
					model={model}
					onChoose={(networkId) => {
						if (!networkId) {
							setChoosing(true);
							return;
						}
						setChosenNetworkId(networkId);
						setChoosing(false);
					}}
					choosing={choosing}
				/>
				<Separator />
				<div className="flex flex-col gap-1" data-radient-tiers="">
					<span className="px-0.5 text-meta text-ink-dim">
						{t("ui.chat.remote_compute.sheet.tier.group_label")}
					</span>
					{model.tiers.map((row) => (
						<TierRow key={row.tier} row={row} />
					))}
				</div>
				<Separator />
				<div className="flex flex-col gap-2">
					<div className="flex flex-col gap-0.5">
						<span className="text-meta text-ink-dim">{model.prompt.label}</span>
						{model.prompt.summary ? (
							<span className="text-body-sm text-ink">
								{model.prompt.summary}
							</span>
						) : null}
						{model.prompt.why ? (
							<span className="text-meta text-ink-dim">{model.prompt.why}</span>
						) : null}
					</div>
					<div className="flex flex-col gap-0.5">
						<span className="text-meta text-ink-dim">
							{model.directory.label}
						</span>
						{/* A path is machine voice: mono, and LTR inside an RTL paragraph. */}
						<span className="truncate text-mono-sm text-ink-muted" dir="ltr">
							{model.directory.path}
						</span>
					</div>
				</div>
				{refusal ? (
					<div
						data-radient-refusal={refusal.code}
						className="flex flex-col gap-1 rounded-sm bg-warning-wash px-2.5 py-2"
					>
						<span className="text-body-sm text-ink">{refusal.message}</span>
						{remedy === "sign-in" ? (
							<Button
								variant="tonal"
								size="sm"
								className="self-start"
								data-radient-sign-in=""
								onClick={() => setSigningIn(true)}
							>
								{remoteRemedyLabel("sign-in", null)}
							</Button>
						) : remedy === "add-credits" ? (
							<Button
								variant="tonal"
								size="sm"
								className="self-start"
								onClick={() => openConsolePage(RADIENT_BILLING_URL)}
							>
								{remoteRemedyLabel("add-credits", null)}
							</Button>
						) : remedy === "retry" || remedy === "refresh" ? (
							<Button
								variant="tonal"
								size="sm"
								className="self-start"
								disabled={waiting !== null && waiting > 0}
								onClick={submit}
							>
								{remoteRemedyLabel(remedy, waiting ?? retrySeconds)}
							</Button>
						) : remedy === "push-branch" ? (
							/*
							 * PUSHING IS NOT THIS APP'S GESTURE. The remedy names the act (the run
							 * would start on a commit no remote has), and the button copies
							 * nothing and runs nothing: a shell command in a dialog is the class
							 * of advice this product refuses to give.
							 */
							<span className="text-meta text-ink-dim">
								{t("ui.chat.remote_compute.remedy.push_branch_help")}
							</span>
						) : null}
					</div>
				) : null}
				<DialogFooter className="gap-2 sm:justify-end">
					{onViewRuns ? (
						<Button
							variant="linkQuiet"
							size="sm"
							data-radient-view-runs=""
							className="me-auto"
							onClick={() => {
								onOpenChange(false);
								onViewRuns();
							}}
						>
							{t("ui.chat.remote_compute.sheet.view_runs")}
						</Button>
					) : null}
					<Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
						{t("ui.chat.remote_compute.sheet.close")}
					</Button>
					<Button
						variant="primary"
						size="md"
						data-radient-submit=""
						disabled={!model.submit.enabled || start.isPending}
						title={model.submit.why ?? undefined}
						onClick={submit}
					>
						{start.isPending
							? t("ui.chat.remote_compute.sheet.submitting")
							: model.submit.label}
					</Button>
				</DialogFooter>
				{/* The stand-down reason, in the sheet's own body rather than a tooltip: a
				 * disabled control that says nothing is a control a user presses twice. */}
				{model.submit.why ? (
					<span className="text-meta text-ink-dim">{model.submit.why}</span>
				) : null}
				{signingIn ? (
					<RemoteSignIn
						onSettled={() => {
							setSigningIn(false);
							void queryClient.invalidateQueries({
								queryKey: remoteComputeKeys.read,
							});
						}}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
};
