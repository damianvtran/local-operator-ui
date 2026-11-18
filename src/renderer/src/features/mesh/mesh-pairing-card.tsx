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
 * - A HOST THAT CANNOT ATTEST SAYS SO AND DISABLES EVERYTHING. `can_answer_here`
 *   false with `answer_unavailable` set (not macOS, or the listener did not bind)
 *   means every answer would be refused 403: the card still shows the code (the
 *   OTHER device may well be able to answer) and names the terminal fallback,
 *   with the input and both buttons disabled rather than offered and refused.
 *
 * Register: the tray's borderless list (hairlines, no box), its type scale and
 * its tokens only - see the tray's own header and AGENTS.md "Design and branding".
 */

import { Button, Skeleton } from "@shared/components/ui";
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
 * code shown on the other device as its argument, which the copy above says.
 */
const FALLBACK_COMMAND = {
	inviter: "lop network confirm", // i18n: ignore a command line, not interface copy
	joiner: "lop network join --confirm", // i18n: ignore a command line, not interface copy
} as const;

/** The six-digit field: the phone popup's edit model, on this card's state. */
export const MeshPairingCodeInput: FC<{
	id: string;
	digits: string;
	onDigits: (digits: string) => void;
	disabled: boolean;
	invalid: boolean;
	describedBy?: string;
}> = ({ id, digits, onDigits, disabled, invalid, describedBy }) => {
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
	return (
		<input
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
			className="h-9 w-36 rounded-sm border border-control bg-surface px-3 text-center font-mono text-ink tracking-widest [font-size:1.125rem] disabled:text-ink-dim"
			data-testid="mesh-pairing-code-input"
		/>
	);
};

export interface MeshPairingCardProps {
	row: MeshPairingRow;
	nowSeconds: number;
	/** The answer in flight for THIS card, if any. */
	pending: "admit" | "decline" | null;
	/** The last refusal for THIS card, if any. */
	refusal: PairingRefusal | null;
	/** Bumped on every refusal so a repeat of the same one still clears the field. */
	refusalSerial?: number;
	onAnswer: (ask: PairingAnswerAsk) => void;
}

export const MeshPairingCard: FC<MeshPairingCardProps> = ({
	row,
	nowSeconds,
	pending,
	refusal,
	refusalSerial = 0,
	onAnswer,
}) => {
	// Always starts EMPTY: there is deliberately no prop that could seed it.
	const [digits, setDigits] = useState("");
	const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
	const inputId = useId();
	const hintId = useId();
	const errorId = useId();
	const mode = pairingCardMode(row);
	const terminal = pairingNeedsTerminal(row);
	const busy = pending !== null;
	const seconds = pairingSecondsLeft(row, nowSeconds);
	const lapsed = seconds <= 0;
	const offers = pairingOffersView(row);

	// A wrong code clears the field so the next attempt starts from the other
	// screen, never from what was typed last. A new stage (a new nonce) does too.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the serial and nonce ARE the triggers
	useEffect(() => {
		if (refusal?.kind === "mismatch") setDigits("");
	}, [refusalSerial, refusal?.kind]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the nonce IS the trigger
	useEffect(() => {
		setDigits("");
	}, [row.nonce]);

	const canType = mode === "type_code" && row.canAnswerHere && !lapsed;
	const canAdmit = canType && digits.length === 6 && !busy;
	// Decline needs the same attestation (core binds `decline` too) and the same
	// answerable stage: core refuses either decision on the inviter's stage 1
	// (`pairing_not_ready`) and on a joiner that already matched, so the controls
	// exist only on a `type_code` card and are disabled where the host cannot answer.
	const canDecline = row.canAnswerHere && !lapsed && !busy;
	const describedBy = [hintId, refusal ? errorId : null]
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
							describedBy={describedBy}
						/>
					</div>
				)}
			</div>

			<p id={hintId} className="text-meta text-ink-muted">
				{mode === "show_code"
					? t("ui.mesh.pairing.waiting.joiner_types", { peer: row.peerName })
					: mode === "waiting_other"
						? t("ui.mesh.pairing.waiting.other", { peer: row.peerName })
						: t("ui.mesh.pairing.code.type_hint", { peer: row.peerName })}
			</p>

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
						{offers.items.map((item) => {
							const kept = item.share && !removed.has(item.key);
							return (
								<li
									key={item.key}
									className="flex items-center gap-2 text-body-sm"
								>
									{offers.editable && item.share ? (
										<label className="flex items-center gap-2 text-ink">
											<input
												type="checkbox"
												checked={kept}
												disabled={!canType || busy}
												onChange={(event) => {
													const next = new Set(removed);
													if (event.target.checked) next.delete(item.key);
													else next.add(item.key);
													setRemoved(next);
												}}
											/>
											<bdi>{item.label}</bdi>
										</label>
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

			{mode === "type_code" && row.side === "inviter" && !terminal && (
				<p
					className="text-meta text-ink-dim"
					data-testid="mesh-pairing-attempts"
				>
					{t("ui.mesh.pairing.attempts_left", { count: row.attemptsLeft })}
				</p>
			)}

			{refusal && (
				<p
					id={errorId}
					role="alert"
					className="text-body-sm text-danger"
					data-testid="mesh-pairing-error"
				>
					{pairingRefusalSentence(refusal, row)}
				</p>
			)}

			{terminal && (
				<div
					className="flex flex-col gap-1"
					data-testid="mesh-pairing-terminal-fallback"
				>
					<p className="text-meta text-ink-muted">
						{row.answerUnavailable === "unsupported_host"
							? t("ui.mesh.pairing.unavailable.host")
							: t("ui.mesh.pairing.unavailable.no_attestation")}
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
							? t("ui.mesh.pairing.action.confirming")
							: row.side === "inviter"
								? t("ui.mesh.pairing.action.admit")
								: t("ui.mesh.pairing.action.confirm")}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						disabled={!canDecline}
						onClick={() => onAnswer({ row, decision: "decline", code: "" })}
						data-testid="mesh-pairing-decline"
					>
						{pending === "decline"
							? t("ui.mesh.pairing.action.declining")
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
	pending: { id: string; decision: "admit" | "decline" } | null;
	refusal: { id: string; refusal: PairingRefusal; serial: number } | null;
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
							refusal={refusal?.id === row.id ? refusal.refusal : null}
							refusalSerial={refusal?.id === row.id ? refusal.serial : 0}
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
