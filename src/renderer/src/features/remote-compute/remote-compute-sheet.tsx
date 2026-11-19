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
import { type FC, Fragment, useEffect, useRef, useState } from "react";
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
 * A TIER THAT CANNOT BE BOUGHT SPEAKS IN ONE VOICE (design round 1, D4). Its title
 * used to be `ink-disabled` - measured 2.08:1, the ink `PickerRow` already rejected
 * for a word "whose whole job is to be read", which `Dedicated` has here, because
 * the design keeps it on screen precisely so a capability the product has does not
 * vanish - while its note took the ENABLED roles and read louder than the live
 * tier's own note. So: titles at `ink-muted`, notes at `ink-dim`, and the reason
 * riding the shape line instead of arriving as a fourth fact under it.
 *
 * NO SELECTION GROUND AND NO CHECK (design round 1, D10). While `Dedicated` cannot
 * be bought, `Cloud run` is the only option, and both marks asserted a choice nobody
 * made on a row that is not a control. The group says which tier a run uses in words
 * instead (`tierNotice`); when a second tier ships this becomes a real radio group.
 */
const TierRow: FC<{ row: RemoteTierRow }> = ({ row }) => (
	<div
		data-radient-tier={row.tier}
		data-disabled={row.disabled ? "" : undefined}
		className={cn(
			"flex flex-col gap-0.5 px-2.5 py-1.5",
			row.disabled && "cursor-not-allowed",
		)}
	>
		<span className="flex flex-wrap items-baseline gap-x-1.5">
			<span
				className={cn(
					"text-body-sm",
					row.disabled ? "text-ink-muted" : "text-ink",
				)}
			>
				{row.title}
			</span>
			{/* One shape fact, never a price: the list is a choice, not a datasheet. */}
			<span aria-hidden="true" className="text-ink-dim">
				·
			</span>
			<span className="text-meta text-ink-dim">{row.note}</span>
			{/*
			 * THE REASON TRAVELS WITH ITS DASH (design round 2, D5). Wrapped apart, the em
			 * dash could be the last glyph of one line and its sentence the first of the
			 * next, which reads as a dangling mark rather than as an introduction. One
			 * `nowrap` run keeps the pair together across a wrap.
			 */}
			{row.why ? (
				<span className="flex items-baseline gap-x-1.5 whitespace-nowrap">
					<span aria-hidden="true" className="text-ink-dim">
						—
					</span>
					<span className="text-meta text-ink-dim">{row.why}</span>
				</span>
			) : null}
		</span>
	</div>
);

/**
 * `Spot`, under the tier it is an opt-in inside.
 *
 * A ROW OF THE LIST, NOT A SECOND LINE OF ITS PARENT (design round 2, D5). Nested in
 * `TierRow` it sat 5px under `Dedicated`'s wrapped line, tighter than the paragraph
 * under the list and a fraction of the 25px that separates the two tiers - so it read
 * as the tail of Dedicated's sentence rather than as the third entry of a list. As the
 * list's own child it takes the list's own gap, which is the thing D5 asked for, and
 * the hairline indent is what still says it belongs to `Dedicated` rather than beside
 * it. No reason of its own: the parent already says `coming soon` (design round 1,
 * D4).
 */
const SpotRow: FC<{ spot: { title: string; note: string } }> = ({ spot }) => (
	<span
		data-radient-tier-spot=""
		className="ms-2.5 flex flex-wrap items-baseline gap-x-1.5 border-s border-hairline py-1.5 ps-2 pe-2.5"
	>
		<span className="text-body-sm text-ink-muted">{spot.title}</span>
		<span aria-hidden="true" className="text-ink-dim">
			·
		</span>
		<span className="text-meta text-ink-dim">{spot.note}</span>
	</span>
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
			{/*
			 * `Change` ONLY ONCE THERE IS SOMETHING TO CHANGE FROM (design round 1, D7):
			 * it used to sit beside "Choose a network", i.e. beside the state that has no
			 * value to change. The chooser itself is open in that state anyway, and this
			 * control only re-opens it.
			 */}
			{model.network.chosen !== null && model.network.options.length > 1 ? (
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
							/*
							 * A RESTING GROUND, because these are the only PRESSABLE rows on the sheet
							 * (design round 2, D4). With no mark at rest they were the same shape as the
							 * inert tier rows directly below them - muted text, a right-hand meta column,
							 * nothing else - so inside one dialog the decision and the statement looked
							 * alike. A border is not available to them: a bordered control nested in a
							 * floating surface is a regression by construction, so the mark is the recessed
							 * `surface` step every other control in a dialog wears.
							 */
							"bg-surface hover:bg-row-hover hover:text-ink",
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
		{/*
		 * RECORDED, NOT ENFORCED - AND THE QUALIFICATION IS ITS OWN LINE, A STEP LOUDER
		 * (design round 1, D3). The clause that stops a reader believing in isolation
		 * was the trailing half of the quietest line on a screen that spends money, the
		 * same role and size as the labels around it; it is now `text-body-sm` at
		 * `ink-muted`, and the sentence that carries it is split so the qualification
		 * does not ride behind a network name. It never claims protection.
		 */}
		<p className="text-body-sm text-ink-muted">{model.network.note}</p>
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
	 * WHERE THE FOCUS GOES, AND WHERE IT COMES BACK TO (UX round 2, U6/U9).
	 *
	 * `onOpenAutoFocus` is preventDefault-ed so Radix's first-focusable rule does not
	 * put the ring on the tertiary `View runs`, and NOTHING took the focus afterwards -
	 * the caret stayed on the chip outside the dialog, so the trap never engaged, Tab
	 * walked the page Radix had already marked `aria-hidden`, and Escape reached the
	 * composer's own handler and did nothing. Measured on the built app: sixteen Tabs,
	 * not one of them inside the sheet. So the panel itself takes the focus (see
	 * `onOpenAutoFocus` below) - the shape `language-dialog.tsx` already uses.
	 *
	 * The opener is remembered here because this dialog has no `DialogTrigger`: the
	 * chip it was opened from belongs to the menu beside it, when the sheet opens the menu
	 * has shut, and Radix's own restore therefore has nothing to focus - Escape dropped
	 * the caret to `<body>`. `archive-conversation-dialog.tsx` is the file this shape is
	 * copied from, down to the disconnected check and the trigger fallback.
	 */
	const contentRef = useRef<HTMLDivElement>(null);
	const opener = useRef<HTMLElement | null>(null);
	/**
	 * THE FOCUS FRAME IS CANCELLED WITH THE MOUNT (agent review round 3, NIT-1). The
	 * frame below lands even when the dialog was closed in the same tick; the optional
	 * chain keeps that harmless, but the frame still runs a focus call on a node that
	 * is going away. One id and one cleanup is the whole fix.
	 */
	const focusFrame = useRef<number | null>(null);
	useEffect(
		() => () => {
			if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
		},
		[],
	);
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
	/*
	 * THE CLOCK ONLY TICKS WHILE SOMETHING READS IT (agent review round 2, MINOR-3).
	 * Both second levels are mounted for every conversation that has an identity, so
	 * `useNow(1_000)` here re-rendered a closed sheet - and rebuilt the whole sheet
	 * model - once a second on every open chat: `remote-compute-clock.ts` states the
	 * opposite as its reason for affording a second. The only countdown this clock
	 * feeds is the refusal's own `retry in N seconds`, and it is reset on open, so a
	 * minute's resolution while shut costs nothing a reader can see while still
	 * republishing the wall clock for the first frame after it opens.
	 */
	const now = useNow(open ? 1_000 : 60_000);
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
			opener.current =
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: null;
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
	/*
	 * THE KEY IS PER INTENT, NOT PER SHEET-OPEN (agent review round 1, M2). The route
	 * replays by key, so a key reused after the prompt, the directory or the network
	 * changed answered the FIRST run - bound to the old network and named for the old
	 * prompt - while the sheet showed the new ones. That is exactly the case the key
	 * exists for: a start that reached Radient whose answer was lost, edited before
	 * the retry. A bare re-press changes none of the three and keeps its key, which is
	 * the guarantee one purchase stays one purchase.
	 */
	const intent = `${prompt}\u0000${directory}\u0000${model.network.chosen?.network_id ?? ""}`;
	const intentRef = useRef(intent);
	useEffect(() => {
		if (intentRef.current === intent) return;
		intentRef.current = intent;
		setIdempotencyKey(null);
		setRefusedAt(null);
	}, [intent]);
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
				ref={contentRef}
				data-radient-sheet=""
				/*
				 * THE SHEET TAKES THE FOCUS ITSELF, not its first control. Radix focuses
				 * the first focusable element, which here is the tertiary `View runs` -
				 * so the dialog opened with a focus ring on the quietest thing on it, and
				 * the one action nobody should trigger by accident (Start run, which
				 * spends money) was a Tab away rather than the default. Suppressing the
				 * auto-focus and focusing the PANEL keeps that ring off every control and
				 * still puts the caret inside the trap, which is what makes Escape and the
				 * Tab cycle work at all (UX round 2, U6).
				 *
				 * `tabIndex={-1}` is what makes a `div` focusable at all, and the rAF is
				 * the part that matters: the FocusScope that installs the trap is not
				 * mounted at the instant this event fires, so a synchronous `focus()` lands
				 * before the trap exists and Radix then moves the focus back out.
				 */
				tabIndex={-1}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					focusFrame.current = requestAnimationFrame(() => {
						focusFrame.current = null;
						contentRef.current?.focus();
					});
				}}
				/*
				 * AND THE FOCUS GOES BACK TO THE DOOR (UX round 2, U9). Closed by `Close`
				 * the caret already returned to the chip; closed by Escape it fell to
				 * `<body>`, so the next Tab started at the top of the document. Both ways
				 * out are the same way out now: the element that opened the sheet, then
				 * the chip itself when that element has gone (the menu's row is unmounted by
				 * the select that opens this sheet, which is the usual case for the
				 * keyboard door).
				 */
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					const target = opener.current;
					opener.current = null;
					if (target?.isConnected) {
						target.focus();
						if (document.activeElement === target) return;
					}
					document.querySelector<HTMLElement>("[data-device-chip]")?.focus();
				}}
				/*
				 * A PANEL THAT FITS THE WINDOW, AND SCROLLS ITS OWN BODY (UX round 2, U10).
				 * At 420x400 the sheet measured 542px tall with `max-height: none`, anchored
				 * above the viewport: the title, the network and the tiers were off screen and
				 * nothing scrolled. The panel is capped to the window and the middle is the
				 * scroll container, so the header and the primary stay where they are whatever
				 * the height - a bottom-pinned primary is the one control a money surface may
				 * not scroll away. `dvh` rather than `vh` because the window's own chrome is
				 * inside the viewport here.
				 */
				className="max-h-[calc(100dvh-2rem)] w-[27rem] max-w-[calc(100vw-2rem)] gap-4 p-5 outline-none"
				/*
				 * THE ICON SAYS WHAT THE FOOTER'S `Close` DOES NOT (UX round 3, U11). The
				 * corner button is the trap's next stop after the footer one, and both were
				 * named `Close`, so a screen reader heard the word twice with nothing to tell
				 * them apart. `Dismiss` is the action it really is: leave without starting a run.
				 */
				closeLabel={t("ui.common.actions.dismiss")}
			>
				<DialogHeader>
					<DialogTitle>{model.heading}</DialogTitle>
				</DialogHeader>
				{/*
				 * THE SCROLL CONTAINER, so the header and the footer are the panel's own and
				 * everything between them moves (UX round 2, U10). `min-h-0` is what lets a
				 * flex child shrink below its content at all.
				 */}
				<div
					data-radient-sheet-body=""
					className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
				>
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
					{/*
					 * NO TRAILING PAD (design round 2, D8): `pb-1` without a matching top pad put
					 * the tier block 4px closer to the rule above it than to the one below, in a
					 * sheet whose other sections run 19-20px top and bottom. The gaps do the work.
					 */}
					<div className="flex flex-col gap-1" data-radient-tiers="">
						<span className="px-0.5 text-meta text-ink-dim">
							{t("ui.chat.remote_compute.sheet.tier.group_label")}
						</span>
						{model.tiers.map((row) => (
							<Fragment key={row.tier}>
								<TierRow row={row} />
								{row.spot ? <SpotRow spot={row.spot} /> : null}
							</Fragment>
						))}
						{/* Which tier a run will use, in words: see `TierRow` on the marks. */}
						{model.tierNotice ? (
							<span
								data-radient-tier-notice=""
								/*
								 * THE NOTICE TAKES THE ROWS' OWN VERTICAL PAD (design round 3, D10). Every
								 * tier row carries `py-1.5`, so two rows sit 12px apart ink to ink; the notice
								 * was the one child with no padding and showed the column's raw `gap-1`, 7px,
								 * which made the sentence naming the tier this run uses hug the disabled `Spot`
								 * row more tightly than any other pair in the block.
								 */
								className="px-0.5 py-1.5 text-meta text-ink-muted"
							>
								{model.tierNotice}
							</span>
						) : null}
					</div>
					<Separator />
					<div className="flex flex-col gap-2">
						<div className="flex flex-col gap-0.5">
							<span className="text-meta text-ink-dim">
								{model.prompt.label}
							</span>
							{/*
							 * AN EMPTY SLOT SAYS IT IS EMPTY (design round 2, D3). It used to collapse to
							 * zero height, so `Prompt` stacked 13px above `Directory` with nothing under
							 * it and nothing saying whether the value was missing or still loading - the
							 * only explanation sat under the buttons, past the reason it was read for.
							 * The model computes the sentence already (`prompt.empty`), at `ink-dim` so a
							 * placeholder never reads as the prompt itself.
							 */}
							{model.prompt.summary ? (
								<span className="text-body-sm text-ink">
									{model.prompt.summary}
								</span>
							) : model.prompt.empty ? (
								<span className="text-meta text-ink-dim">
									{model.prompt.empty}
								</span>
							) : null}
						</div>
						{/*
						 * NO DIRECTORY IS NO FIELD (design round 2, D3): a path this pane has not
						 * resolved yet has nothing to print, and a label over an empty slot was the
						 * second half of the same finding. The stand-down line under the primary is
						 * where "this conversation has no directory yet" belongs.
						 */}
						{model.directory.path ? (
							<div className="flex flex-col gap-0.5">
								<span className="text-meta text-ink-dim">
									{model.directory.label}
								</span>
								{/* A path is machine voice: mono, and LTR inside an RTL paragraph. */}
								<span
									className="truncate text-mono-sm text-ink-muted"
									dir="ltr"
								>
									{model.directory.path}
								</span>
							</div>
						) : null}
					</div>
				</div>
				{/*
				 * THE BODY'S SCROLL EDGE GETS A BOUNDARY (design round 3, D11). At 420x400 the
				 * body's cut falls INSIDE the `coming soon` line - roughly its lower half sliced
				 * off - with nothing between it and the primary 16px below, so "there is more
				 * above" reads as corruption rather than as a scroll. The sheet separates its
				 * other sections with `Separator`; the footer was the one boundary without one.
				 */}
				<Separator />
				{/*
				 * THE REFUSAL IS PINNED, NOT SCROLLED (agent review round 3, MAJOR-1). It used
				 * to be the scrolling body's last child, and at the window's own floor (600x500)
				 * the body always overflows, so a refused start changed nothing above the fold:
				 * the press on the one control that spends money read as an unresponsive
				 * button - the reading UX round 2's U8 was about, produced by the layout
				 * instead of the retry - and the remedy that goes with it (sign in, add
				 * credits, retry in N seconds) was the part that was off screen. Here it sits
				 * under the boundary, beside the primary it answers, and is on screen whenever
				 * it exists.
				 *
				 * `role="alert"` because it IS an answer to a press: mounted in the pinned
				 * region it announces itself, which the block never did even when visible.
				 */}
				{refusal ? (
					<div
						role="alert"
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
