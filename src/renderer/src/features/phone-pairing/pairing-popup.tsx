/**
 * THE PHONE PAIRING POPUP (pairing design v2 §4.2; local-operator #3949,
 * `features.phone_pairing`).
 *
 * A phone asks to pair; this card appears on ANY route (it is mounted at the app
 * shell, not inside the Mesh tray) with the name the phone sent and two buttons.
 * One deliberate press approves; the computer's own OS prompt is the proof.
 *
 * ## Rules this file exists to keep (security UX, non-negotiable)
 *
 * - NON-MODAL, AND NEVER APPROVED BY A STRAY ENTER. The card takes no focus when
 *   it appears (the composer keeps its caret), no button is default-focused,
 *   there is no `<form>` (so Enter in the code field submits nothing), and a
 *   keyboard activation of Approve counts only when the key went DOWN on Approve
 *   itself - an Enter held from elsewhere that lands focus here does nothing.
 *   A click, or Enter/Space pressed on the focused button, is the deliberate act.
 * - THE DIGITS ONLY IN CONFIRM MODE. A custom-route request is typed: the person
 *   copies the phone's code here, and this card never shows it (core sends no
 *   digits then, and the model drops any it would have).
 * - THE NAME IS THE ATTACKER'S. Plain text in a `<bdi>` (isolated, so it cannot
 *   reorder the sentence around it), clamped, with the full form on hover and
 *   behind "Show full name". Labelled as what the phone SENT, never as a fact.
 * - THE FEED DRIVES IT AWAY. Expired, withdrawn, or decided elsewhere: the host
 *   renders nothing. Only an outcome of the person's OWN press (paired, denied,
 *   three wrong codes, expired while they acted) stays up with a Close.
 *
 * `PairingPopupView` is the presentational card (stories and tests drive it with
 * props); `PhonePairingHost` wires it to the backend.
 */

import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { Smartphone } from "lucide-react";
import {
	type FC,
	type KeyboardEvent,
	type MouseEvent,
	forwardRef,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	type HostOs,
	type PairingCard,
	applyCodeEdit,
	caretBeforeRefusedEdit,
	caretForDigitIndex,
	deleteAcrossGroupSpace,
	formatCountdown,
	formatTypedCode,
	groupPairingCode,
	hostOs,
	livePairingCard,
	sasAriaDigits,
} from "./pairing-model";
import {
	useFeedPairRequest,
	useOperatorSetupRun,
	usePairingApprove,
	usePairingCards,
	usePairingDeny,
} from "./use-phone-pairing";

/** An outcome of the person's own press, kept up until they close it. */
export type PairingOutcome = "paired" | "denied" | "strikes" | "expired";

/** A refusal the card states inline, leaving the request open. */
export type PairingError =
	| { kind: "wrong_code"; triesLeft: number }
	| { kind: "invalid_code" }
	| { kind: "changed" }
	| { kind: "generic" };

export type PairingSetupOffer = {
	running: boolean;
	/** Core's own sentence for the last successful attempt, when it gave one. */
	message?: string | null;
	/**
	 * Why the last attempt failed, already in words (`role="alert"`): core's own
	 * sentence for a 409 host refusal, else the keyed generic line - never a raw
	 * transport or runtime `Error.message` (code review round 1, M2).
	 */
	failure?: string | null;
	onTurnOn: () => void;
};

export type PairingPopupViewProps = {
	card: PairingCard;
	/** Unix seconds; the host ticks it, stories pin it. */
	now: number;
	/** Which press is in flight, if any. */
	busy?: "approve" | "deny" | null;
	error?: PairingError | null;
	outcome?: PairingOutcome | null;
	/** Present only with `features.operator_setup`; shown when Approve cannot work. */
	setup?: PairingSetupOffer | null;
	onApprove: (code?: string) => void;
	onDeny: () => void;
	onRetry: () => void;
	onClose: () => void;
	/** The typed field's starting digits (stories only: the RTL frame needs a code in it). */
	initialCode?: string;
};

const PLATFORM_KEYS = {
	ios: "ui.phone_pairing.platform.ios",
	android: "ui.phone_pairing.platform.android",
	web: "ui.phone_pairing.platform.web",
} as const;

function platformLabel(platform: string): string {
	return t(
		PLATFORM_KEYS[platform as keyof typeof PLATFORM_KEYS] ??
			"ui.phone_pairing.platform.unknown",
	);
}

/**
 * Approve that only a deliberate act can press: a pointer click, or Enter/Space
 * whose keydown happened ON this button (a held key that arrived from elsewhere
 * after focus moved has `repeat` set or never went down here).
 */
const DeliberateApprove: FC<{
	label: string;
	disabled?: boolean;
	onApprove: () => void;
	testId: string;
}> = ({ label, disabled, onApprove, testId }) => {
	const keyArmed = useRef(false);
	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key === "Enter" || event.key === " ")
			keyArmed.current = !event.repeat;
	};
	const onClick = (event: MouseEvent<HTMLButtonElement>) => {
		// `detail === 0` is a keyboard (or programmatic) activation, not a pointer.
		const keyboard = event.detail === 0;
		const armed = keyArmed.current;
		keyArmed.current = false;
		if (keyboard && !armed) return;
		onApprove();
	};
	return (
		<Button
			type="button"
			variant="primary"
			size="md"
			disabled={disabled}
			onKeyDown={onKeyDown}
			onClick={onClick}
			data-testid={testId}
		>
			{label}
		</Button>
	);
};

/** The phone's name as untrusted text, clamped, with its full form on demand. */
const PhoneName: FC<{ card: PairingCard }> = ({ card }) => {
	const [expanded, setExpanded] = useState(false);
	const truncated = card.phoneNameFull !== card.phoneName;
	// Core clips the short form to 40 code points WITHOUT an ellipsis (code
	// review round 1, N1), so a 41-64 character name would look whole while a
	// "Show full name" toggle sat beside it. Mark the cut where core did not.
	const short =
		truncated && !card.phoneName.endsWith("…")
			? `${card.phoneName}…`
			: card.phoneName;
	return (
		<span className="min-w-0 break-words">
			{/*
			 * `<q>` draws the language's own quotation marks around what the phone
			 * SENT, and `<bdi>` isolates it so a right-to-left name cannot reorder
			 * the sentence around it.
			 */}
			<q>
				<bdi
					title={card.phoneNameFull}
					data-testid="pairing-phone-name"
					className="font-medium text-ink"
				>
					{expanded ? card.phoneNameFull : short}
				</bdi>
			</q>
			{truncated ? (
				<>
					{" "}
					<Button
						type="button"
						variant="link"
						size="sm"
						className="h-auto p-0 align-baseline"
						onClick={() => setExpanded((value) => !value)}
						aria-expanded={expanded}
						data-testid="pairing-name-toggle"
					>
						{expanded
							? t("ui.phone_pairing.popup.hide_full_name")
							: t("ui.phone_pairing.popup.show_full_name")}
					</Button>
				</>
			) : null}
		</span>
	);
};

/** "Name it sent: “…” · Phone type: iPhone" - the definitions every live and settled card shows. */
const PhoneDefinitions: FC<{ card: PairingCard }> = ({ card }) => (
	<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-meta text-ink-muted">
		<dt>{t("ui.phone_pairing.popup.name_label")}</dt>
		<dd className="min-w-0">
			<PhoneName card={card} />
		</dd>
		<dt>{t("ui.phone_pairing.popup.platform_label")}</dt>
		<dd data-testid="pairing-platform">{platformLabel(card.platform)}</dd>
	</dl>
);

function errorText(error: PairingError): string {
	switch (error.kind) {
		case "wrong_code":
			return t("ui.phone_pairing.popup.wrong_code", { count: error.triesLeft });
		case "invalid_code":
			return t("ui.phone_pairing.popup.invalid_code");
		case "changed":
			return t("ui.phone_pairing.popup.changed");
		default:
			return t("ui.phone_pairing.popup.error");
	}
}

const OUTCOME_KEYS = {
	paired: "ui.phone_pairing.popup.paired",
	denied: "ui.phone_pairing.popup.denied",
	strikes: "ui.phone_pairing.popup.strikes",
	expired: "ui.phone_pairing.popup.expired",
} as const;

/** What the card is showing: an outcome, an in-flight step, or the decision. */
function pairingProgress(
	card: PairingCard,
	busy: PairingPopupViewProps["busy"],
): "admin_prompt" | "signing" | "failed" | null {
	if (card.reason === "admin_prompt_open") return "admin_prompt";
	if (card.reason === "signing" || busy === "approve") return "signing";
	if (card.reason === "failed_retryable") return "failed";
	return null;
}

/**
 * The sentence the host's polite live region holds for this state (UX round 1,
 * U3). The card is non-modal and takes no focus when it appears - the composer
 * keeps its caret (spec §4.2) - so a screen-reader user typing elsewhere would
 * otherwise never learn a phone is asking until the request expired. The region
 * is mounted EMPTY before any card exists (a live region has to be in the tree
 * before its content changes, or assistive tech may not announce it), and its
 * text changes once per state: the title when a request arrives, then each
 * progress step and the outcome. Inline refusals are not repeated here: they
 * are `role="alert"` already, and saying them twice is noise.
 */
export function pairingAnnouncement(
	card: PairingCard | null,
	busy: PairingPopupViewProps["busy"],
	outcome: PairingOutcome | null,
	os: HostOs = hostOs(),
): string {
	if (!card) return "";
	if (outcome) return t(OUTCOME_KEYS[outcome]);
	switch (pairingProgress(card, busy)) {
		case "admin_prompt":
			return t("ui.phone_pairing.popup.admin_prompt", { os });
		case "signing":
			return t("ui.phone_pairing.popup.signing", { os });
		case "failed":
			return t("ui.phone_pairing.popup.failed");
		default:
			return t("ui.phone_pairing.popup.title");
	}
}

/*
 * D1 (design round 1, MAJOR). The code is two European-number runs around a
 * neutral space; in a right-to-left paragraph (Urdu) the bidi algorithm lays the
 * runs right to left and paints `913 482` while the phone shows `482 913` - and
 * comparing the two IS the security check. Both the hero and the typed field are
 * pinned left-to-right and isolated from the sentence around them, whatever the
 * interface language. Done in markup, never with bidi controls in a catalogue.
 */
const CODE_LTR = {
	dir: "ltr" as const,
	style: { unicodeBidi: "isolate" as const },
};

export const PairingPopupView: FC<PairingPopupViewProps> = ({
	card,
	now,
	busy = null,
	error = null,
	outcome = null,
	setup = null,
	onApprove,
	onDeny,
	onRetry,
	onClose,
	initialCode = "",
}) => {
	const titleId = useId();
	const codeId = useId();
	const hintId = useId();
	const errorId = useId();
	const os = hostOs();
	/** The typed code's DIGITS; `482 913` is only how they are drawn (U2). */
	const [digits, setDigits] = useState(() =>
		initialCode.replace(/\D/g, "").slice(0, 6),
	);
	const inputRef = useRef<HTMLInputElement>(null);
	/** Where the caret belongs after the next render, as a digit index. */
	const pendingCaret = useRef<number | null>(null);
	const deciding = busy !== null;

	const setCode = (next: { digits: string; caretDigit: number }) => {
		pendingCaret.current = next.caretDigit;
		setDigits(next.digits);
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

	// A wrong code clears the field so the next attempt starts clean.
	const wrongTries = error?.kind === "wrong_code" ? error.triesLeft : null;
	useEffect(() => {
		if (wrongTries !== null) setDigits("");
	}, [wrongTries]);

	const progress = pairingProgress(card, busy);
	const unavailable = card.assurance === null;
	const typedRoute = !(card.mode === "confirm" && card.sas);

	/*
	 * FOCUS AFTER THE PERSON'S OWN PRESS (UX round 1, U1). The press unmounts the
	 * button it landed on (the body swaps to "Confirm on…", an outcome, or a
	 * cleared field), which drops a keyboard user on <body>. So once the person
	 * has acted INSIDE this card, each new stage takes focus at its one sensible
	 * place. Never before they act: appearing must stay focus-neutral (spec §4.2),
	 * which is why `acted` gates every move and the first render moves nothing.
	 *
	 * `acted` alone is not enough (review round 2, R2-1): it stays true for the
	 * card's whole life, while the outcome or a late failure can arrive seconds
	 * after the person has gone back to the composer. Taking focus then is worse
	 * than rude - a failure on the confirm route focuses Deny, so an Enter meant
	 * for the composer would deny a request the person never decided on. So a
	 * stage moves focus only while it is still in the card, or has fallen to
	 * <body> because the pressed button unmounted (the case U1 exists for).
	 */
	const acted = useRef(false);
	const cardRef = useRef<HTMLElement>(null);
	const stageRef = useRef<HTMLElement | null>(null);
	const closeRef = useRef<HTMLButtonElement>(null);
	const denyRef = useRef<HTMLButtonElement>(null);
	const stage = outcome
		? `outcome:${outcome}`
		: progress
			? `progress:${progress}`
			: setup?.running
				? "setup:running"
				: error
					? `error:${error.kind}:${wrongTries ?? ""}`
					: "decide";
	useEffect(() => {
		if (!acted.current) return;
		const focused = document.activeElement;
		if (
			focused &&
			focused !== document.body &&
			!cardRef.current?.contains(focused)
		)
			return;
		if (stage.startsWith("outcome:")) closeRef.current?.focus();
		else if (stage.startsWith("progress:") || stage === "setup:running")
			stageRef.current?.focus();
		else if (stage.startsWith("error:"))
			(typedRoute ? inputRef.current : denyRef.current)?.focus();
	}, [stage, typedRoute]);
	const act =
		<A extends unknown[]>(handler: (...args: A) => void) =>
		(...args: A) => {
			acted.current = true;
			handler(...args);
		};

	let content: JSX.Element;
	let actions: JSX.Element | null = null;
	if (outcome) {
		content = (
			<>
				<p
					className={cn(
						"text-body-sm",
						outcome === "paired" ? "text-ink" : "text-ink-muted",
					)}
					data-testid="pairing-outcome"
				>
					{t(OUTCOME_KEYS[outcome])}
				</p>
				{/*
				 * D3: a settled card names the phone it settled, and success says where
				 * it can be undone - revocability is half of the operator's request.
				 */}
				<PhoneDefinitions card={card} />
				{outcome === "paired" ? (
					<p
						className="text-meta text-ink-muted"
						data-testid="pairing-manage-where"
					>
						{t("ui.phone_pairing.popup.manage_where")}
					</p>
				) : null}
			</>
		);
		actions = (
			<Button
				ref={closeRef}
				type="button"
				// tonal, not secondary: a bordered button would redraw the stroke the
				// floating card gave up (floating-surface-no-border.test.mjs O-9b).
				variant="tonal"
				size="md"
				onClick={onClose}
				data-testid="pairing-close"
			>
				{outcome === "paired"
					? t("ui.phone_pairing.popup.done")
					: t("ui.phone_pairing.popup.close")}
			</Button>
		);
	} else if (progress === "signing" || progress === "admin_prompt") {
		content = (
			<>
				<p
					ref={(node) => {
						stageRef.current = node;
					}}
					tabIndex={-1}
					className="text-body-sm text-ink outline-none"
					data-testid="pairing-progress"
				>
					{progress === "admin_prompt"
						? t("ui.phone_pairing.popup.admin_prompt", { os })
						: t("ui.phone_pairing.popup.signing", { os })}
				</p>
				{card.gesture ? (
					<p className="text-meta text-ink-muted" data-testid="pairing-gesture">
						{card.gesture}
					</p>
				) : null}
			</>
		);
	} else if (progress === "failed") {
		content = (
			<p
				ref={(node) => {
					stageRef.current = node;
				}}
				tabIndex={-1}
				className="text-body-sm text-ink outline-none"
				data-testid="pairing-failed"
			>
				{t("ui.phone_pairing.popup.failed")}
			</p>
		);
		actions = (
			<>
				<DenyButton ref={denyRef} busy={busy} onDeny={act(onDeny)} />
				<DeliberateApprove
					label={t("ui.phone_pairing.popup.try_again")}
					disabled={deciding}
					onApprove={act(onRetry)}
					testId="pairing-retry"
				/>
			</>
		);
	} else {
		const remaining = card.expiresAt === null ? null : card.expiresAt - now;
		const describedBy = error ? `${hintId} ${errorId}` : hintId;
		content = (
			<>
				<p className="text-body-sm text-ink">
					{t("ui.phone_pairing.popup.grant")}
				</p>
				<PhoneDefinitions card={card} />
				{card.mode === "confirm" && card.account ? (
					<p
						className="text-meta text-ink-muted"
						data-testid="pairing-attested"
					>
						{t("ui.phone_pairing.popup.attested")}
					</p>
				) : null}
				{remaining !== null && remaining > 0 ? (
					<p className="text-meta text-ink-muted" data-testid="pairing-expires">
						{t("ui.phone_pairing.popup.expires_in", {
							time: formatCountdown(remaining),
						})}
					</p>
				) : null}
				{unavailable ? (
					<>
						<p
							className="text-body-sm text-ink"
							data-testid="pairing-unavailable"
						>
							{t("ui.phone_pairing.popup.unavailable")}
						</p>
						{setup?.running ? (
							// D2/U4: the OS prompt this press opens may sit behind the app
							// window; say so, as Settings' own turn-on row does.
							<p
								ref={(node) => {
									stageRef.current = node;
								}}
								tabIndex={-1}
								className="text-meta text-ink outline-none"
								data-testid="pairing-setup-working"
							>
								{t("ui.phone_pairing.setup.working", { os })}
							</p>
						) : null}
						{setup?.message ? (
							<p className="text-meta text-ink-muted">{setup.message}</p>
						) : null}
						{setup?.failure ? (
							<p
								className="text-meta text-danger"
								role="alert"
								data-testid="pairing-setup-error"
							>
								{setup.failure}
							</p>
						) : null}
						<p className="text-meta text-ink-muted">
							{t("ui.phone_pairing.popup.unavailable_where")}
						</p>
					</>
				) : !typedRoute && card.sas ? (
					<>
						<div className="flex flex-col items-center gap-1 rounded-md bg-sunken px-3 py-3">
							<span className="text-meta text-ink-muted">
								{t("ui.phone_pairing.popup.code_label")}
							</span>
							<span
								{...CODE_LTR}
								className="font-mono text-ink tracking-widest [font-size:1.75rem] leading-none"
								aria-label={t("ui.phone_pairing.popup.code_aria", {
									digits: sasAriaDigits(card.sas),
								})}
								role="img"
								data-testid="pairing-sas"
							>
								{groupPairingCode(card.sas)}
							</span>
						</div>
						<p className="text-meta text-ink-muted">
							{t("ui.phone_pairing.popup.compare")}
						</p>
					</>
				) : (
					<div className="flex flex-col gap-1">
						<label htmlFor={codeId} className="text-meta text-ink">
							{t("ui.phone_pairing.popup.type_code_label")}
						</label>
						<input
							ref={inputRef}
							id={codeId}
							{...CODE_LTR}
							inputMode="numeric"
							autoComplete="one-time-code"
							spellCheck={false}
							value={formatTypedCode(digits)}
							aria-describedby={describedBy}
							aria-invalid={error ? true : undefined}
							onChange={(event) => {
								const edit = applyCodeEdit(
									event.target.value,
									event.target.selectionStart,
								);
								if (edit) {
									setCode(edit);
									return;
								}
								// More than six digits is refused whole, never clipped:
								// the field keeps the code it had (see `applyCodeEdit`).
								// UX round 2, U7: with no state change React restores the
								// old value itself after this handler, and the browser
								// parks the caret at the END, so the next Backspace ate the
								// last digit. Put the value back here, with the caret where
								// the refused edit began; React then finds nothing to
								// restore and leaves the caret alone.
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
								// Enter in the field never approves: there is no form, and
								// this stops any ancestor from treating it as a submit.
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
							disabled={deciding}
							className="h-10 rounded-sm border border-control bg-surface px-3 text-center font-mono text-ink tracking-widest [font-size:1.25rem]"
							data-testid="pairing-code-input"
						/>
						<p id={hintId} className="text-meta text-ink-muted">
							{t("ui.phone_pairing.popup.type_code_hint")}
						</p>
					</div>
				)}
				{error ? (
					<p
						id={errorId}
						className="text-body-sm text-danger"
						role="alert"
						data-testid="pairing-error"
					>
						{errorText(error)}
					</p>
				) : null}
				{unavailable ? null : (
					<>
						<p className="text-meta text-ink-muted">
							{t("ui.phone_pairing.popup.anti_phishing")}
						</p>
						{card.gesture ? (
							<p
								className="text-meta text-ink-muted"
								data-testid="pairing-gesture"
							>
								{card.gesture}
							</p>
						) : null}
					</>
				)}
			</>
		);
		actions = unavailable ? (
			<>
				<DenyButton ref={denyRef} busy={busy} onDeny={act(onDeny)} />
				{setup ? (
					<Button
						type="button"
						variant="primary"
						size="md"
						onClick={act(setup.onTurnOn)}
						disabled={setup.running}
						data-testid="pairing-setup"
					>
						{t("ui.phone_pairing.setup.turn_on")}
					</Button>
				) : null}
			</>
		) : (
			<>
				<DenyButton ref={denyRef} busy={busy} onDeny={act(onDeny)} />
				{typedRoute ? (
					<DeliberateApprove
						label={t("ui.phone_pairing.popup.approve")}
						disabled={deciding || digits.length !== 6}
						onApprove={act(() => onApprove(digits))}
						testId="pairing-approve"
					/>
				) : (
					<DeliberateApprove
						label={t("ui.phone_pairing.popup.approve_confirm")}
						disabled={deciding}
						onApprove={act(() => onApprove())}
						testId="pairing-approve"
					/>
				)}
			</>
		);
	}

	return (
		// biome-ignore lint/a11y/useSemanticElements: a native <dialog> brings top-layer and UA positioning; this is a fixed, non-modal card that must never trap focus.
		<section
			role="dialog"
			ref={cardRef}
			aria-modal="false"
			aria-labelledby={titleId}
			data-testid="phone-pairing-popup"
			data-pairing-mode={card.mode}
			onKeyDown={(event) => {
				// UX round 1, N4: once settled nothing is at stake, so Escape closes
				// like the app's other transient cards. Never while deciding.
				if (outcome && event.key === "Escape") {
					event.stopPropagation();
					onClose();
				}
			}}
			/*
			 * D5/U5: bounded by the window. At the 800x600 minimum (a ~572 px
			 * viewport) a Russian "changed" card measured 598 px with nothing
			 * scrolling, so the title and grant sentence sat above the screen. The
			 * header and the buttons stay pinned; only the middle scrolls, so the
			 * name and the grant are always reachable before Approve.
			 *
			 * A floating surface carries no stroke (branding §2): the ground and
			 * shadow-overlay separate it from the window, and `data-lo-floating`
			 * lets the forced-colors rule in styles/index.css restore an edge
			 * where shadows are dropped. scripts/floating-surface-no-border.test.mjs
			 * (O-1, O-8) enforces both.
			 */
			data-lo-floating=""
			className="fixed right-4 bottom-4 z-50 flex max-h-[calc(100vh-2rem)] w-[min(380px,calc(100vw-2rem))] flex-col gap-3 rounded-lg bg-surface p-4 shadow-overlay"
		>
			<header className="flex shrink-0 items-start gap-2">
				<Smartphone
					className="mt-0.5 size-4 shrink-0 text-ink-muted"
					aria-hidden="true"
				/>
				<h2 id={titleId} className="font-medium text-body text-ink">
					{outcome
						? t("ui.phone_pairing.popup.title_settled")
						: t("ui.phone_pairing.popup.title")}
				</h2>
			</header>
			<div
				className="flex min-h-0 flex-col gap-3 overflow-y-auto"
				data-testid="pairing-body"
			>
				{content}
			</div>
			{actions ? (
				<div
					className="flex shrink-0 flex-wrap justify-end gap-2"
					data-testid="pairing-actions"
				>
					{actions}
				</div>
			) : null}
		</section>
	);
};

/** Deny, which says "Denying…" while its own post is in flight (D2). */
const DenyButton = forwardRef<
	HTMLButtonElement,
	{ busy: PairingPopupViewProps["busy"]; onDeny: () => void }
>(({ busy, onDeny }, ref) => (
	<Button
		ref={ref}
		type="button"
		// tonal for the same reason as Close: no bordered control inside the
		// borderless floating card (O-9b). Approve stays the one primary.
		variant="tonal"
		size="md"
		onClick={onDeny}
		disabled={busy !== null}
		data-testid="pairing-deny"
	>
		{busy === "deny"
			? t("ui.phone_pairing.popup.denying")
			: t("ui.phone_pairing.popup.deny")}
	</Button>
));
DenyButton.displayName = "DenyButton";

/** The refusal codes core's pairing routes answer with (`pair_op`). */
function refusalCode(error: unknown): string | undefined {
	return error instanceof DesktopControlError ? error.code : undefined;
}

/** A 200 approve that signed but did not apply (`applied.ok: false`). */
function unapplied(result: unknown): boolean {
	if (!result || typeof result !== "object") return false;
	const applied = (result as { applied?: unknown }).applied;
	return (
		Boolean(applied) &&
		typeof applied === "object" &&
		(applied as { ok?: unknown }).ok === false
	);
}

/** Seconds, re-read once a second while a card is up (the countdown). */
function useSecondsClock(active: boolean): number {
	const [now, setNow] = useState(() => Date.now() / 1000);
	useEffect(() => {
		if (!active) return;
		setNow(Date.now() / 1000);
		const timer = setInterval(() => setNow(Date.now() / 1000), 1_000);
		return () => clearInterval(timer);
	}, [active]);
	return now;
}

/**
 * The shell-mounted popup. Renders nothing - and reads nothing - unless the
 * backend advertises `features.phone_pairing`.
 */
export const PhonePairingHost: FC = () => {
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(capabilities.data, "phone_pairing");
	const setupEnabled = desktopFeatureEnabled(
		capabilities.data,
		"operator_setup",
	);
	const feedPairRequest = useFeedPairRequest(enabled);
	const decision = usePairingApprove();
	const deny = usePairingDeny();
	const setupRun = useOperatorSetupRun();
	const cards = usePairingCards(enabled, decision.isPending);
	/** The approval the person pressed on; kept up through its own outcome. */
	const [actedOn, setActedOn] = useState<string | null>(null);
	const [outcome, setOutcome] = useState<PairingOutcome | null>(null);
	const [error, setError] = useState<PairingError | null>(null);
	const [setupMessage, setSetupMessage] = useState<string | null>(null);
	const [setupFailure, setSetupFailure] = useState<string | null>(null);
	/*
	 * True from a press until its post-decision list re-read has landed. Between
	 * the mutation settling and that re-read, the row can already read `paired`,
	 * `expired` or `denied_by_user` (and the feed can already say null) while the
	 * outcome is not yet set; without this, the release below would take that
	 * row for "ended elsewhere" and drop the person's own outcome.
	 */
	const [settling, setSettling] = useState(false);
	/*
	 * The id the feed last NAMED (code review round 1, M3). A frame's `null`
	 * means "the request you were told about is over", and it hides THAT id at
	 * once, before the list refetch lands. It is not a verdict on the list: the
	 * session contract also sends `open.approvals_pair_request: null` when the
	 * daemon's own read failed, and the ticker only publishes on a level change,
	 * so treating null as "show nothing" left a live request blank for its whole
	 * window even after a successful focus refetch. With no id ever named, the
	 * list decides, exactly as before any frame arrives.
	 */
	const lastNamed = useRef<string | null>(null);
	if (feedPairRequest) lastNamed.current = feedPairRequest;

	const rows = cards.data ?? [];
	const pressed = actedOn
		? (rows.find((card) => card.approvalId === actedOn) ?? null)
		: null;
	// The feed saying "none" is authoritative for an untouched card: it vanishes on
	// the frame, before the list refetch lands.
	const live =
		feedPairRequest === null
			? livePairingCard(
					rows.filter((row) => row.approvalId !== lastNamed.current),
					undefined,
				)
			: livePairingCard(rows, feedPairRequest);
	const card = actedOn ? pressed : live;
	const now = useSecondsClock(Boolean(card));
	/*
	 * The held card's request is over, though its row is still in the list (QA
	 * round 3). A press keeps its card up through its own outcome, but a press
	 * that FAILED leaves no outcome, so a phone that then withdrew - or a request
	 * decided elsewhere, or one that ran out its window - kept the dead card with
	 * a live Deny on screen, and a new request never showed. These are the same
	 * signals that make an untouched card vanish: the row's terminal reason, its
	 * expiry, the feed's null for the id it named (M3: only that id), or the feed
	 * naming a different request (core files at most one live pairing). A held
	 * card whose request is still live - e.g. failed and retryable - stays held.
	 */
	const pressedEnded =
		pressed !== null &&
		(!LIVE_OR_RETRYABLE.has(pressed.reason) ||
			(pressed.expiresAt !== null && pressed.expiresAt <= now) ||
			(feedPairRequest === null && lastNamed.current === pressed.approvalId) ||
			(typeof feedPairRequest === "string" &&
				feedPairRequest !== pressed.approvalId));

	// A different request replaced the one the person acted on, or the one they
	// acted on ended without an outcome of their own: start clean. Never while
	// their own decision is in flight or being read back.
	useEffect(() => {
		if (
			actedOn &&
			!outcome &&
			!decision.isPending &&
			(!pressed || (pressedEnded && !deny.isPending && !settling))
		) {
			setActedOn(null);
			setError(null);
		}
	}, [
		actedOn,
		pressed,
		pressedEnded,
		outcome,
		decision.isPending,
		deny.isPending,
		settling,
	]);

	if (!enabled) return null;
	// Untouched and past its window: gone (the row folds to `expired` on refetch).
	const shown =
		card &&
		!(
			!actedOn &&
			card.reason === "waiting" &&
			card.expiresAt !== null &&
			card.expiresAt <= now
		)
			? card
			: null;
	const busy = decision.isPending
		? ("approve" as const)
		: deny.isPending
			? ("deny" as const)
			: null;
	// U3: mounted with the host, empty, BEFORE any card - see `pairingAnnouncement`.
	const announcer = (
		<output
			className="sr-only"
			aria-live="polite"
			aria-atomic="true"
			data-testid="pairing-live"
		>
			{pairingAnnouncement(shown, busy, outcome)}
		</output>
	);
	if (!shown) return announcer;

	const settle = (approvalId: string, fallback: PairingOutcome | null) =>
		cards
			.refetch()
			.then((next) => {
				const row = next.data?.find((item) => item.approvalId === approvalId);
				if (row?.reason === "paired") setOutcome("paired");
				else if (row?.reason === "strikes_exhausted") setOutcome("strikes");
				else if (row?.reason === "denied_by_user") setOutcome("denied");
				else if (row?.reason === "expired") setOutcome("expired");
				else if (fallback) setOutcome(fallback);
				return row;
			})
			.finally(() => setSettling(false));

	const approve = (code?: string, retryApply = false) => {
		const target = shown;
		setActedOn(target.approvalId);
		setError(null);
		setSettling(true);
		decision.mutate(
			{ card: target, code, retryApply },
			{
				onSuccess: (result) => {
					void settle(target.approvalId, unapplied(result) ? null : "paired");
				},
				onError: (failure) => {
					const code_ = refusalCode(failure);
					void settle(
						target.approvalId,
						code_ === "approval_expired" ? "expired" : null,
					).then((row) => {
						if (!row || LIVE_OR_RETRYABLE.has(row.reason)) {
							setError(
								code_ === "pair_code_mismatch"
									? { kind: "wrong_code", triesLeft: row?.triesLeft ?? 0 }
									: code_ === "pair_code_invalid"
										? { kind: "invalid_code" }
										: code_ === "pair_request_changed"
											? { kind: "changed" }
											: { kind: "generic" },
							);
						}
					});
				},
			},
		);
	};

	const onDeny = () => {
		const target = shown;
		setActedOn(target.approvalId);
		setError(null);
		setSettling(true);
		deny.mutate(target.approvalId, {
			onSuccess: () => void settle(target.approvalId, "denied"),
			onError: () => {
				setSettling(false);
				setError({ kind: "generic" });
			},
		});
	};

	const onClose = () => {
		setActedOn(null);
		setOutcome(null);
		setError(null);
	};

	return (
		<>
			{announcer}
			<PairingPopupView
				/*
				 * Keyed by request (code review round 1, M1): core lets a `failed`
				 * request coexist with a new one, and a phone that withdraws and
				 * re-files within one tick switches the card without unmounting it.
				 * Unkeyed, digits typed for the first request stayed in the field and
				 * were sent with the second one's digests - a guaranteed strike - and
				 * the name expansion carried over. A new id is a new card.
				 */
				key={shown.approvalId}
				card={shown}
				now={now}
				busy={busy}
				error={error}
				outcome={outcome}
				setup={
					setupEnabled
						? {
								running: setupRun.isPending,
								message: setupMessage,
								failure: setupFailure,
								onTurnOn: () => {
									setSetupFailure(null);
									setupRun.mutate(undefined, {
										onSuccess: (message) => setSetupMessage(message),
										// The Settings row's rule (M2): core's sentence only for a
										// 409 host refusal, which core keys server-side; anything
										// else - transport, runtime - is the generic keyed line.
										onError: (failure) =>
											setSetupFailure(
												failure instanceof DesktopControlError &&
													failure.status === 409
													? failure.message
													: t("ui.phone_pairing.setup.error"),
											),
									});
								},
							}
						: null
				}
				onApprove={(code) => approve(code)}
				onDeny={onDeny}
				onRetry={() => approve(undefined, true)}
				onClose={onClose}
			/>
		</>
	);
};

const LIVE_OR_RETRYABLE: ReadonlySet<string> = new Set([
	"waiting",
	"signing",
	"admin_prompt_open",
	"failed_retryable",
]);
