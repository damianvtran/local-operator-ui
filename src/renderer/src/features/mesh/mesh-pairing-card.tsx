/**
 * The mesh pairing cards in the Mesh approvals tray (`features.mesh_pairing`).
 *
 * The model, the ceremony and the security argument live in `mesh-pairings.ts`;
 * this file is the drawing. Three rules it holds that a refactor must not lose:
 *
 * - THE LOCAL CODE AND THE INPUT ARE TWO SEPARATE THINGS, labelled by direction.
 *   "Show this code on <peer>" sits over this device's own digits; "Type the code
 *   shown on <peer>" sits over an EMPTY field. The field is never pre-filled -
 *   not from the row, not from the last attempt (a wrong code clears it) - so an
 *   approval is always six keystrokes the person made while reading the other
 *   screen.
 * - ADMIT IS DISABLED UNTIL SIX DIGITS ARE TYPED, and Enter in the field never
 *   submits: there is no form, the same rule the phone pairing popup keeps
 *   (`pairing-popup.tsx`), so a stray Enter cannot answer for the person.
 * - A HOST THAT CANNOT ATTEST SAYS SO AND DISABLES EVERYTHING, UP FRONT. Core's
 *   `answer_unavailable` (not macOS, or the listener did not bind) and main's own
 *   static eligibility (`pairings.eligibility`: an unpackaged/dev build, a debug
 *   or driver launch - design D1 / UX U1) both mean every answer would be refused
 *   403: the card still shows the code (the OTHER device may well be able to
 *   answer), names the terminal fallback, and disables the input and both buttons
 *   - with the shared `Input`'s disabled paint, so it LOOKS disabled - rather than
 *   taking six digits and refusing them. The "type the six digits" hint is not
 *   drawn there, nor on an expired card.
 *
 * Register: the tray's borderless list (hairlines, no box), its type scale and
 * its tokens only - see the tray's own header and AGENTS.md "Design and branding".
 */

import { Button, Checkbox, Input, Skeleton } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { Link2 } from "lucide-react";
import {
	type FC,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	applyCodeEdit,
	caretBeforeRefusedEdit,
	caretForDigitIndex,
	deleteAcrossGroupSpace,
	formatTypedCode,
	groupPairingCode,
	sasAriaDigits,
} from "../phone-pairing/pairing-model";
import {
	type MeshPairingRow,
	type PairingAnswerAsk,
	type PairingEligibility,
	type PairingOutcome,
	type PairingRefusal,
	pairingCardMode,
	pairingNeedsTerminal,
	pairingOffersView,
	pairingOutcomeSentence,
	pairingRefusalSentence,
	pairingSecondsLeft,
	pairingShares,
	pairingTimeLeft,
	pairingTitle,
} from "./mesh-pairings";

/*
 * Digits read left to right in every interface language (the phone popup's
 * rule, D11): set in markup, never with bidi controls in a catalogue.
 */
const CODE_LTR = {
	dir: "ltr" as const,
	style: { unicodeBidi: "isolate" as const },
};

/**
 * The terminal fallback a host that cannot attest names (design §3.6: the CLI
 * stays, unchanged). Commands, not copy: never translated. The joiner's takes the
 * code shown on the other device as its argument, so it is printed WITH the
 * `<code>` placeholder the copy above explains (UX review U2: without it the line
 * failed as printed); the placeholder is never filled from the row, for the same
 * reason the input never is.
 */
const FALLBACK_COMMAND = {
	inviter: "lop network confirm", // i18n: ignore a command line, not interface copy
	joiner: "lop network join --confirm <code>", // i18n: ignore a command line and its CLI placeholder, not interface copy
} as const;

/** The six-digit field: the phone popup's edit model, on this card's state. */
export const MeshPairingCodeInput: FC<{
	id: string;
	digits: string;
	onDigits: (digits: string) => void;
	disabled: boolean;
	invalid: boolean;
	describedBy?: string;
	/** Bumped to put focus back in the field (a wrong code, UX review U3). */
	focusSerial?: number;
}> = ({
	id,
	digits,
	onDigits,
	disabled,
	invalid,
	describedBy,
	focusSerial = 0,
}) => {
	const inputRef = useRef<HTMLInputElement>(null);
	const pendingCaret = useRef<number | null>(null);
	const setCode = (next: { digits: string; caretDigit: number }) => {
		pendingCaret.current = next.caretDigit;
		onDigits(next.digits);
	};
	// The controlled re-render rewrites the value and the browser drops the caret
	// at the end; put it back where the edit happened, before paint.
	useLayoutEffect(() => {
		const input = inputRef.current;
		const caret = pendingCaret.current;
		pendingCaret.current = null;
		if (caret === null || !input || document.activeElement !== input) return;
		const offset = caretForDigitIndex(caret);
		input.setSelectionRange(offset, offset);
	});
	// After a wrong code the field was cleared; the next six digits go straight in,
	// as in the phone popup, instead of focus falling to the page body.
	useEffect(() => {
		if (focusSerial > 0) inputRef.current?.focus();
	}, [focusSerial]);
	return (
		<Input
			ref={inputRef}
			id={id}
			{...CODE_LTR}
			inputMode="numeric"
			autoComplete="off"
			spellCheck={false}
			value={formatTypedCode(digits)}
			aria-describedby={describedBy}
			aria-invalid={invalid ? true : undefined}
			onChange={(event) => {
				const edit = applyCodeEdit(
					event.target.value,
					event.target.selectionStart,
				);
				if (edit) {
					setCode(edit);
					return;
				}
				// More than six digits is refused whole, never clipped (the popup's
				// UX round 2, U7: restore the value with the caret where it was).
				const input = event.currentTarget;
				const caret = caretBeforeRefusedEdit(
					input.value,
					input.selectionStart,
					digits,
				);
				input.value = formatTypedCode(digits);
				input.setSelectionRange(caret, caret);
			}}
			onKeyDown={(event) => {
				// Enter never approves: there is no form, and nothing above may submit.
				if (event.key === "Enter") {
					event.preventDefault();
					return;
				}
				if (event.key !== "Backspace" && event.key !== "Delete") return;
				const input = event.currentTarget;
				const edit = deleteAcrossGroupSpace(
					digits,
					event.key,
					input.selectionStart ?? 0,
					input.selectionEnd ?? 0,
				);
				if (!edit) return;
				event.preventDefault();
				setCode(edit);
			}}
			disabled={disabled}
			// The shared field's border, invalid (`aria-invalid` → danger, design D3)
			// and disabled paint (design D1); only width and the code's type here.
			inputSize="lg"
			className="w-36 text-center font-mono tracking-widest [font-size:1.125rem]"
			data-testid="mesh-pairing-code-input"
		/>
	);
};

/** See `MeshPairingCardProps.pendingPhase`. */
export type PairingPendingPhase = "confirming" | "answering";

export interface MeshPairingCardProps {
	row: MeshPairingRow;
	nowSeconds: number;
	/** The answer in flight for THIS card, if any. */
	pending: "admit" | "decline" | null;
	/**
	 * Where that answer is: `confirming` while main's native sheet still asks,
	 * `answering` once the person approved it (UX review round 3, U-R3-2). Only
	 * `answering` may say "Checking…"/"Declining…": during the sheet the card
	 * must not claim the act the person has not confirmed yet.
	 */
	pendingPhase?: PairingPendingPhase;
	/** The last refusal for THIS card, if any. */
	refusal: PairingRefusal | null;
	/** Bumped on every refusal so a repeat of the same one still clears the field. */
	refusalSerial?: number;
	/**
	 * Main's static eligibility (`pairings.eligibility`), or `null` while unknown:
	 * answerable, and main still refuses at the click. Main answers that read
	 * without asking core, so it lands before the card list it gates.
	 */
	eligibility?: PairingEligibility | null;
	/**
	 * Main has not answered the eligibility read YET (QA round 2, Q2): the card is
	 * not answerable until it does, so an ineligible build never offers a live
	 * field for its first frame. A FAILED read is not pending: see `eligibility`.
	 */
	eligibilityPending?: boolean;
	onAnswer: (ask: PairingAnswerAsk) => void;
}

export const MeshPairingCard: FC<MeshPairingCardProps> = ({
	row,
	nowSeconds,
	pending,
	pendingPhase = "answering",
	refusal,
	refusalSerial = 0,
	eligibility = null,
	eligibilityPending = false,
	onAnswer,
}) => {
	// Always starts EMPTY: there is deliberately no prop that could seed it.
	const [digits, setDigits] = useState("");
	const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
	const inputId = useId();
	const hintId = useId();
	const errorId = useId();
	const offerId = useId();
	const mode = pairingCardMode(row);
	const appIneligible = eligibility?.eligible === false;
	// A "this build cannot" refusal is the same dead end, found at the click.
	const buildRefused = refusal?.kind === "build";
	const terminal = pairingNeedsTerminal(row) || appIneligible || buildRefused;
	// Core or main says this card already closed: nothing left to answer here.
	const closed = refusal?.kind === "closed";
	const answerable = !terminal && !closed && !eligibilityPending;
	const busy = pending !== null;
	const seconds = pairingSecondsLeft(row, nowSeconds);
	const lapsed = seconds <= 0;
	const offers = pairingOffersView(row);

	// A wrong code clears the field so the next attempt starts from the other
	// screen, never from what was typed last. A new stage (a new nonce) does too.
	// ...and puts focus back in the field for the retry (UX review U3).
	const [focusSerial, setFocusSerial] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the serial and nonce ARE the triggers
	useEffect(() => {
		if (refusal?.kind !== "mismatch") return;
		setDigits("");
		setFocusSerial((serial) => serial + 1);
	}, [refusalSerial, refusal?.kind]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the nonce IS the trigger
	useEffect(() => {
		setDigits("");
	}, [row.nonce]);

	const canType =
		mode === "type_code" && row.canAnswerHere && !lapsed && answerable;
	const canAdmit = canType && digits.length === 6 && !busy;
	// Decline needs the same attestation (core binds `decline` too) and the same
	// answerable stage: core refuses either decision on the inviter's stage 1
	// (`pairing_not_ready`) and on a joiner that already matched, so the controls
	// exist only on a `type_code` card and are disabled where the host cannot answer.
	const canDecline = row.canAnswerHere && !lapsed && !busy && answerable;

	/*
	 * FOCUS BACK TO THE BUTTON the refusal names (UX review U7). The button was
	 * disabled while the answer was in flight, so a keyboard user's focus fell to
	 * the page body; "press Admit again" (foreground, relay, changed) and a
	 * cancelled sheet put it back on that button once it is enabled again. The
	 * serial is consumed once, so a later re-enable never steals focus.
	 */
	const admitRef = useRef<HTMLButtonElement>(null);
	const declineRef = useRef<HTMLButtonElement>(null);
	const [actionFocus, setActionFocus] = useState<{
		serial: number;
		decline: boolean;
	} | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the serial and kind ARE the triggers
	useEffect(() => {
		if (
			refusal?.kind !== "foreground" &&
			refusal?.kind !== "devtools" &&
			refusal?.kind !== "sheet_open" &&
			refusal?.kind !== "relay" &&
			refusal?.kind !== "changed" &&
			refusal?.kind !== "cancelled"
		)
			return;
		setActionFocus({
			serial: refusalSerial,
			decline: refusal.action === "decline",
		});
	}, [refusalSerial, refusal?.kind]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the target button re-enables (it is disabled while the answer is in flight)
	useEffect(() => {
		if (!actionFocus) return;
		const target = actionFocus.decline ? declineRef : admitRef;
		if (!target.current || target.current.disabled) return;
		target.current.focus();
		setActionFocus(null);
	}, [actionFocus, canAdmit, canDecline]);
	/*
	 * A CLOSED card disables every control, so the button the person pressed
	 * can no longer hold focus and a keyboard user fell to the page body (UX
	 * review round 3, U-R3-3). Focus moves to the status line that says why
	 * (`tabIndex=-1`: reachable by script, never a tab stop).
	 */
	const errorRef = useRef<HTMLParagraphElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the serial and kind ARE the triggers
	useEffect(() => {
		if (refusal?.kind === "closed") errorRef.current?.focus();
	}, [refusalSerial, refusal?.kind]);
	/*
	 * The hint under the code. Expired: what to do next, by side (a joiner cannot
	 * start an invite - UX U5). A host that cannot answer: no "type the digits"
	 * line at all - the fallback block below says what to do instead (design D1).
	 */
	const hint = lapsed
		? row.side === "inviter"
			? t("ui.mesh.pairing.expired_hint.inviter")
			: t("ui.mesh.pairing.expired_hint.joiner", { peer: row.peerName })
		: mode === "show_code"
			? t("ui.mesh.pairing.waiting.joiner_types", { peer: row.peerName })
			: mode === "waiting_other"
				? t("ui.mesh.pairing.waiting.other", { peer: row.peerName })
				: terminal
					? null
					: t("ui.mesh.pairing.code.type_hint", { peer: row.peerName });
	// The build refusal is said once, as the fallback block's first line.
	// A cancelled sheet says nothing: the person chose it and nothing was sent.
	const errorShown =
		refusal !== null && !buildRefused && refusal.kind !== "cancelled";
	const describedBy = [hint ? hintId : null, errorShown ? errorId : null]
		.filter(Boolean)
		.join(" ");

	return (
		<li
			className="flex flex-col gap-3 py-3"
			data-tour-tag="mesh-pairing-card"
			data-pairing-id={row.id}
			data-pairing-mode={mode}
		>
			<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
				<Link2
					aria-hidden="true"
					className="size-4 shrink-0 self-center text-ink-muted"
				/>
				<h3 className="min-w-0 text-body-sm text-ink [overflow-wrap:anywhere]">
					<bdi>{pairingTitle(row)}</bdi>
				</h3>
				{row.role && (
					<span className="text-meta text-ink-dim">
						{t("ui.mesh.pairing.role", { role: row.role })}
					</span>
				)}
				<span
					className={cn(
						"text-meta tabular-nums",
						seconds < 60 ? "text-warning" : "text-ink-dim",
					)}
					data-testid="mesh-pairing-time-left"
				>
					{lapsed
						? t("ui.mesh.pairing.error.expired")
						: pairingTimeLeft(seconds)}
				</span>
			</div>

			<div className="flex flex-wrap items-start gap-x-8 gap-y-3">
				<div className="flex flex-col gap-1">
					<span className="text-meta text-ink-muted">
						<bdi>{t("ui.mesh.pairing.code.show", { peer: row.peerName })}</bdi>
					</span>
					<span
						{...CODE_LTR}
						role="img"
						aria-label={t("ui.mesh.pairing.code.aria", {
							digits: sasAriaDigits(row.code),
						})}
						className="font-mono text-ink tracking-widest [font-size:1.5rem] leading-9"
						data-testid="mesh-pairing-local-code"
					>
						{groupPairingCode(row.code)}
					</span>
				</div>
				{mode === "type_code" && (
					<div className="flex flex-col gap-1">
						<label htmlFor={inputId} className="text-meta text-ink-muted">
							<bdi>
								{t("ui.mesh.pairing.code.type_label", { peer: row.peerName })}
							</bdi>
						</label>
						<MeshPairingCodeInput
							id={inputId}
							digits={digits}
							onDigits={setDigits}
							disabled={!canType || busy}
							invalid={refusal?.kind === "mismatch"}
							describedBy={describedBy || undefined}
							focusSerial={focusSerial}
						/>
					</div>
				)}
			</div>

			{hint && (
				<p
					id={hintId}
					className="text-meta text-ink-muted"
					data-testid="mesh-pairing-hint"
				>
					{hint}
				</p>
			)}

			{offers.kind === "sentence" && (
				<p className="text-meta text-ink-muted">{offers.sentence}</p>
			)}
			{offers.kind === "list" && (
				<fieldset className="flex flex-col gap-1">
					<legend className="text-meta text-ink-muted">
						<bdi>
							{row.side === "inviter"
								? t("ui.mesh.pairing.offers.owner_listed", {
										peer: row.peerName,
									})
								: t("ui.mesh.pairing.offers.listed", { peer: row.peerName })}
						</bdi>
					</legend>
					<ul className="flex flex-col gap-1">
						{offers.items.map((item, index) => {
							const kept = item.share && !removed.has(item.key);
							const boxId = `${offerId}-${index}`;
							return (
								<li
									key={item.key}
									className="flex items-center gap-2 text-body-sm"
								>
									{offers.editable && item.share ? (
										<>
											{/* The shared Checkbox (design D2), not the browser's. */}
											<Checkbox
												id={boxId}
												checked={kept}
												disabled={!canType || busy}
												onCheckedChange={(checked) => {
													const next = new Set(removed);
													if (checked === true) next.delete(item.key);
													else next.add(item.key);
													setRemoved(next);
												}}
												data-testid="mesh-pairing-share"
											/>
											<label
												htmlFor={boxId}
												className={
													!canType || busy ? "text-ink-dim" : "text-ink"
												}
											>
												<bdi>{item.label}</bdi>
											</label>
										</>
									) : (
										<span className={kept ? "text-ink" : "text-ink-dim"}>
											<bdi>{item.label}</bdi>
										</span>
									)}
								</li>
							);
						})}
					</ul>
					{offers.editable && (
						<p className="text-meta text-ink-dim">
							{t("ui.mesh.pairing.offers.owner_reduce_only")}
						</p>
					)}
				</fieldset>
			)}

			{/* The mismatch sentence already names the attempts left; never twice. */}
			{mode === "type_code" &&
				row.side === "inviter" &&
				!terminal &&
				refusal?.kind !== "mismatch" && (
					<p
						className="text-meta text-ink-dim"
						data-testid="mesh-pairing-attempts"
					>
						{t("ui.mesh.pairing.attempts_left", { count: row.attemptsLeft })}
					</p>
				)}

			{refusal && errorShown && (
				<p
					id={errorId}
					ref={errorRef}
					tabIndex={closed ? -1 : undefined}
					// A closed card is news, not a failure: neutral ink, polite status.
					role={closed ? "status" : "alert"}
					className={cn(
						"text-body-sm",
						closed ? "text-ink-muted" : "text-danger",
					)}
					data-testid="mesh-pairing-error"
				>
					{pairingRefusalSentence(refusal, row)}
				</p>
			)}

			{/* An expired card has nothing left to answer, from here or a terminal. */}
			{terminal && !lapsed && (
				<div
					className="flex flex-col gap-1"
					data-testid="mesh-pairing-terminal-fallback"
				>
					<p
						className="text-meta text-ink-muted"
						// Said at the click (a build refusal): announce it like the error.
						role={buildRefused ? "alert" : undefined}
					>
						{row.answerUnavailable === "unsupported_host" ||
						eligibility?.reason === "not_macos"
							? t("ui.mesh.pairing.unavailable.host")
							: row.answerUnavailable === "no_app_attestation"
								? t("ui.mesh.pairing.unavailable.no_attestation")
								: t("ui.mesh.pairing.error.build")}
					</p>
					<p className="text-meta text-ink-muted">
						{t(
							row.side === "inviter"
								? "ui.mesh.pairing.unavailable.fallback_inviter"
								: "ui.mesh.pairing.unavailable.fallback_joiner",
							{ peer: row.peerName },
						)}
					</p>
					<code
						{...CODE_LTR}
						className="w-fit rounded-sm bg-sunken px-2 py-1 font-mono text-meta text-ink"
					>
						{FALLBACK_COMMAND[row.side]}
					</code>
				</div>
			)}

			{mode === "type_code" && (
				<div
					className="flex flex-wrap items-center gap-2"
					data-tour-tag="mesh-pairing-controls"
				>
					<Button
						ref={admitRef}
						variant="primary"
						size="sm"
						disabled={!canAdmit}
						aria-describedby={describedBy || undefined}
						onClick={() =>
							onAnswer({
								row,
								decision: "admit",
								code: digits,
								shares: pairingShares(row, removed),
							})
						}
						data-testid="mesh-pairing-admit"
					>
						{pending === "admit"
							? pendingPhase === "confirming"
								? t("ui.mesh.pairing.action.waiting_confirmation")
								: t("ui.mesh.pairing.action.confirming")
							: row.side === "inviter"
								? t("ui.mesh.pairing.action.admit")
								: t("ui.mesh.pairing.action.confirm")}
					</Button>
					<Button
						ref={declineRef}
						variant="ghost"
						size="sm"
						disabled={!canDecline}
						onClick={() => onAnswer({ row, decision: "decline", code: "" })}
						data-testid="mesh-pairing-decline"
					>
						{pending === "decline"
							? pendingPhase === "confirming"
								? t("ui.mesh.pairing.action.waiting_confirmation")
								: t("ui.mesh.pairing.action.declining")
							: t("ui.mesh.pairing.action.decline")}
					</Button>
				</div>
			)}
		</li>
	);
};

/** A card that just closed: one line, so the person learns how it ended. */
export const MeshPairingOutcomeRow: FC<{ outcome: PairingOutcome }> = ({
	outcome,
}) => (
	<li
		className="flex items-center gap-2 py-3"
		data-tour-tag="mesh-pairing-outcome"
		data-pairing-outcome={outcome.kind}
	>
		<Link2 aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
		<p
			className={cn(
				"min-w-0 text-body-sm [overflow-wrap:anywhere]",
				outcome.kind === "joined" || outcome.kind === "admitted"
					? "text-ink"
					: "text-ink-muted",
			)}
		>
			<bdi>{pairingOutcomeSentence(outcome)}</bdi>
		</p>
	</li>
);

export interface MeshPairingSectionProps {
	rows: readonly MeshPairingRow[];
	outcomes: readonly PairingOutcome[];
	/** The first read is in flight and the feed named an open card. */
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	nowSeconds: number;
	pending: {
		id: string;
		decision: "admit" | "decline";
		phase?: PairingPendingPhase;
	} | null;
	refusal: { id: string; refusal: PairingRefusal; serial: number } | null;
	/** Main's static eligibility; see `MeshPairingCardProps.eligibility`. */
	eligibility?: PairingEligibility | null;
	/** See `MeshPairingCardProps.eligibilityPending`. */
	eligibilityPending?: boolean;
	onAnswer: MeshPairingCardProps["onAnswer"];
}

/** The pairing block inside the tray; renders nothing when there is nothing to say. */
export const MeshPairingSection: FC<MeshPairingSectionProps> = ({
	rows,
	outcomes,
	loading,
	error,
	onRetry,
	nowSeconds,
	pending,
	refusal,
	eligibility = null,
	eligibilityPending = false,
	onAnswer,
}) => {
	if (rows.length === 0 && outcomes.length === 0 && !loading && !error)
		return null;
	return (
		<section
			className="flex flex-col gap-2"
			data-tour-tag="mesh-pairings"
			aria-label={t("ui.mesh.pairing.section")}
		>
			{error && (
				<div className="flex flex-wrap items-center gap-2">
					<p className="min-w-0 flex-1 text-meta text-ink-muted">{error}</p>
					<Button variant="secondary" size="sm" onClick={onRetry}>
						{t("ui.mesh.mesh_approvals_tray.ask_again")}
					</Button>
				</div>
			)}
			{loading && rows.length === 0 && (
				<div
					className="flex flex-col gap-2 py-3"
					aria-busy="true"
					data-testid="mesh-pairing-loading"
				>
					<span className="sr-only">{t("ui.mesh.pairing.loading")}</span>
					<Skeleton className="h-4 w-64" />
					<Skeleton className="h-9 w-40" />
				</div>
			)}
			{(rows.length > 0 || outcomes.length > 0) && (
				<ul className="flex flex-col divide-y divide-hairline">
					{rows.map((row) => (
						<MeshPairingCard
							key={row.id}
							row={row}
							nowSeconds={nowSeconds}
							pending={pending?.id === row.id ? pending.decision : null}
							pendingPhase={pending?.id === row.id ? pending.phase : undefined}
							refusal={refusal?.id === row.id ? refusal.refusal : null}
							refusalSerial={refusal?.id === row.id ? refusal.serial : 0}
							eligibility={eligibility}
							eligibilityPending={eligibilityPending}
							onAnswer={onAnswer}
						/>
					))}
					{outcomes.map((outcome) => (
						<MeshPairingOutcomeRow key={outcome.id} outcome={outcome} />
					))}
				</ul>
			)}
		</section>
	);
};
