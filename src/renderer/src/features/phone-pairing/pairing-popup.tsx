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
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import {
	type PairingCard,
	formatCountdown,
	groupPairingCode,
	livePairingCard,
	normalizeTypedCode,
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
	/** Core's own sentence for the last attempt's outcome, when it gave one. */
	message?: string | null;
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
					{expanded ? card.phoneNameFull : card.phoneName}
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
}) => {
	const titleId = useId();
	const codeId = useId();
	const [typed, setTyped] = useState("");
	const digits = normalizeTypedCode(typed);
	const deciding = busy !== null;
	// A wrong code clears the field so the next attempt starts clean.
	const wrongTries = error?.kind === "wrong_code" ? error.triesLeft : null;
	useEffect(() => {
		if (wrongTries !== null) setTyped("");
	}, [wrongTries]);

	const progress =
		card.reason === "admin_prompt_open"
			? "admin_prompt"
			: card.reason === "signing" || busy === "approve"
				? "signing"
				: card.reason === "failed_retryable"
					? "failed"
					: null;

	let body: JSX.Element;
	if (outcome) {
		body = (
			<>
				<output
					className={cn(
						"text-body-sm",
						outcome === "paired" ? "text-ink" : "text-ink-muted",
					)}
					data-testid="pairing-outcome"
				>
					{t(OUTCOME_KEYS[outcome])}
				</output>
				<div className="flex justify-end">
					<Button
						type="button"
						variant="secondary"
						size="md"
						onClick={onClose}
						data-testid="pairing-close"
					>
						{outcome === "paired"
							? t("ui.phone_pairing.popup.done")
							: t("ui.phone_pairing.popup.close")}
					</Button>
				</div>
			</>
		);
	} else if (progress === "signing" || progress === "admin_prompt") {
		body = (
			<>
				<output
					className="block text-body-sm text-ink"
					data-testid="pairing-progress"
				>
					{progress === "admin_prompt"
						? t("ui.phone_pairing.popup.admin_prompt")
						: t("ui.phone_pairing.popup.signing")}
				</output>
				{card.gesture ? (
					<p className="text-meta text-ink-muted" data-testid="pairing-gesture">
						{card.gesture}
					</p>
				) : null}
			</>
		);
	} else if (progress === "failed") {
		body = (
			<>
				<p className="text-body-sm text-ink" data-testid="pairing-failed">
					{t("ui.phone_pairing.popup.failed")}
				</p>
				<div className="flex justify-end gap-2">
					<Button
						type="button"
						variant="secondary"
						size="md"
						onClick={onDeny}
						disabled={deciding}
						data-testid="pairing-deny"
					>
						{t("ui.phone_pairing.popup.deny")}
					</Button>
					<DeliberateApprove
						label={t("ui.phone_pairing.popup.try_again")}
						disabled={deciding}
						onApprove={onRetry}
						testId="pairing-retry"
					/>
				</div>
			</>
		);
	} else {
		const unavailable = card.assurance === null;
		const remaining = card.expiresAt === null ? null : card.expiresAt - now;
		body = (
			<>
				<p className="text-body-sm text-ink">
					{t("ui.phone_pairing.popup.grant")}
				</p>
				<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-meta text-ink-muted">
					<dt>{t("ui.phone_pairing.popup.name_label")}</dt>
					<dd className="min-w-0">
						<PhoneName card={card} />
					</dd>
					<dt>{t("ui.phone_pairing.popup.platform_label")}</dt>
					<dd data-testid="pairing-platform">{platformLabel(card.platform)}</dd>
				</dl>
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
						{setup?.message ? (
							<p className="text-meta text-ink-muted">{setup.message}</p>
						) : null}
						<p className="text-meta text-ink-muted">
							{t("ui.phone_pairing.popup.unavailable_where")}
						</p>
						<div className="flex flex-wrap justify-end gap-2">
							<Button
								type="button"
								variant="secondary"
								size="md"
								onClick={onDeny}
								disabled={deciding}
								data-testid="pairing-deny"
							>
								{t("ui.phone_pairing.popup.deny")}
							</Button>
							{setup ? (
								<Button
									type="button"
									variant="primary"
									size="md"
									onClick={setup.onTurnOn}
									disabled={setup.running}
									data-testid="pairing-setup"
								>
									{t("ui.phone_pairing.setup.turn_on")}
								</Button>
							) : null}
						</div>
					</>
				) : card.mode === "confirm" && card.sas ? (
					<>
						<div className="flex flex-col items-center gap-1 rounded-md bg-sunken px-3 py-3">
							<span className="text-meta text-ink-muted">
								{t("ui.phone_pairing.popup.code_label")}
							</span>
							<span
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
							id={codeId}
							inputMode="numeric"
							autoComplete="one-time-code"
							spellCheck={false}
							maxLength={7}
							value={
								digits.length > 3
									? `${digits.slice(0, 3)} ${digits.slice(3)}`
									: digits
							}
							onChange={(event) => setTyped(event.target.value)}
							onKeyDown={(event) => {
								// Enter in the field never approves: there is no form, and
								// this stops any ancestor from treating it as a submit.
								if (event.key === "Enter") event.preventDefault();
							}}
							disabled={deciding}
							className="h-10 rounded-sm border border-control bg-surface px-3 text-center font-mono text-ink tracking-widest [font-size:1.25rem]"
							data-testid="pairing-code-input"
						/>
						<p className="text-meta text-ink-muted">
							{t("ui.phone_pairing.popup.type_code_hint")}
						</p>
					</div>
				)}
				{error ? (
					<p
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
						<div className="flex justify-end gap-2">
							<Button
								type="button"
								variant="secondary"
								size="md"
								onClick={onDeny}
								disabled={deciding}
								data-testid="pairing-deny"
							>
								{t("ui.phone_pairing.popup.deny")}
							</Button>
							{card.mode === "confirm" && card.sas ? (
								<DeliberateApprove
									label={t("ui.phone_pairing.popup.approve_confirm")}
									disabled={deciding}
									onApprove={() => onApprove()}
									testId="pairing-approve"
								/>
							) : (
								<DeliberateApprove
									label={t("ui.phone_pairing.popup.approve")}
									disabled={deciding || digits.length !== 6}
									onApprove={() => onApprove(digits)}
									testId="pairing-approve"
								/>
							)}
						</div>
					</>
				)}
			</>
		);
	}

	return (
		// biome-ignore lint/a11y/useSemanticElements: a native <dialog> brings top-layer and UA positioning; this is a fixed, non-modal card that must never trap focus.
		<section
			role="dialog"
			aria-modal="false"
			aria-labelledby={titleId}
			data-testid="phone-pairing-popup"
			data-pairing-mode={card.mode}
			className="fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-3 rounded-lg border border-hairline bg-surface p-4 shadow-overlay"
		>
			<header className="flex items-start gap-2">
				<Smartphone
					className="mt-0.5 size-4 shrink-0 text-ink-muted"
					aria-hidden="true"
				/>
				<h2 id={titleId} className="font-medium text-body text-ink">
					{t("ui.phone_pairing.popup.title")}
				</h2>
			</header>
			{body}
		</section>
	);
};

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

	const rows = cards.data ?? [];
	const pressed = actedOn
		? (rows.find((card) => card.approvalId === actedOn) ?? null)
		: null;
	// The feed saying "none" is authoritative for an untouched card: it vanishes on
	// the frame, before the list refetch lands.
	const live =
		feedPairRequest === null ? null : livePairingCard(rows, feedPairRequest);
	const card = actedOn ? pressed : live;
	const now = useSecondsClock(Boolean(card));

	// A different request replaced the one the person acted on: start clean.
	useEffect(() => {
		if (actedOn && !pressed && !outcome && !decision.isPending) {
			setActedOn(null);
			setError(null);
		}
	}, [actedOn, pressed, outcome, decision.isPending]);

	if (!enabled || !card) return null;
	// Untouched and past its window: gone (the row folds to `expired` on refetch).
	if (
		!actedOn &&
		card.reason === "waiting" &&
		card.expiresAt !== null &&
		card.expiresAt <= now
	)
		return null;

	const settle = (approvalId: string, fallback: PairingOutcome | null) =>
		cards.refetch().then((next) => {
			const row = next.data?.find((item) => item.approvalId === approvalId);
			if (row?.reason === "paired") setOutcome("paired");
			else if (row?.reason === "strikes_exhausted") setOutcome("strikes");
			else if (row?.reason === "denied_by_user") setOutcome("denied");
			else if (row?.reason === "expired") setOutcome("expired");
			else if (fallback) setOutcome(fallback);
			return row;
		});

	const approve = (code?: string, retryApply = false) => {
		const target = card;
		setActedOn(target.approvalId);
		setError(null);
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
		const target = card;
		setActedOn(target.approvalId);
		setError(null);
		deny.mutate(target.approvalId, {
			onSuccess: () => void settle(target.approvalId, "denied"),
			onError: () => setError({ kind: "generic" }),
		});
	};

	const onClose = () => {
		setActedOn(null);
		setOutcome(null);
		setError(null);
	};

	return (
		<PairingPopupView
			card={card}
			now={now}
			busy={decision.isPending ? "approve" : deny.isPending ? "deny" : null}
			error={error}
			outcome={outcome}
			setup={
				setupEnabled
					? {
							running: setupRun.isPending,
							message: setupMessage,
							onTurnOn: () =>
								setupRun.mutate(undefined, {
									onSuccess: (message) => setSetupMessage(message),
									onError: (failure) =>
										setSetupMessage(
											failure instanceof Error ? failure.message : null,
										),
								}),
						}
					: null
			}
			onApprove={(code) => approve(code)}
			onDeny={onDeny}
			onRetry={() => approve(undefined, true)}
			onClose={onClose}
		/>
	);
};

const LIVE_OR_RETRYABLE: ReadonlySet<string> = new Set([
	"waiting",
	"signing",
	"admin_prompt_open",
	"failed_retryable",
]);
