/**
 * Phone access: the ONE block that sets up the Radient-hosted phone tunnel from
 * inside the app, mounted in two places (the Radient provider panel and Settings
 * -> Radient account) as a single component, never two flows.
 *
 * ## What it owns and what it does not
 *
 * The block owns LAYOUT, the heading, the buttons and the one consent sentence
 * (see below). Every other sentence on it is the backend's `remedy.text`, a
 * receipt, or a progress line, rendered verbatim - the backend decides what is
 * true and how to say it, and a second copy of the same event here would drift.
 * It chooses what to show by `blocked_on` / `remedy.kind` and never by reading a
 * sentence, and it never executes `remedy.command` (a report for a person or
 * their agent, not an instruction to this app).
 *
 * ## Authority it does not have
 *
 * No terms checkbox (terms stay in the provider's own browser flow), no credit
 * purchase, no "turn off" (the backend has no route for it), no account pick on
 * the user's behalf, and no browser tab of its own: the only hand-off is the
 * existing OAuth sign-in, which needs the provider's own consent page. The
 * prerequisite blockers (connector tool, phone interface, background service)
 * show the backend's remedy and a fresh check; nothing here installs software.
 * The one exception is the connector tool under the relay transport: when the
 * backend reports `transport: "relay"`, `lop` runs the connector itself, so the
 * "install cloudflared" step is skipped (see `phoneSetupSkipsCloudflared`).
 *
 * ## Success is `verified: true` and nothing else
 *
 * The check mark, the word "Connected" and the success colour appear only when
 * the backend reports `verified: true`. A configured tunnel that is merely
 * connecting, a cached "active" record or a quote that is ready are all neutral,
 * because the colour is spent only on a state somebody actually confirmed.
 *
 * ## The consent sentence is UI-owned, and says why
 *
 * The backend sends its consent wording only inside its terminal rendering, not in
 * `remedy.text` for the quote step (that text is the lead-in "Accept only if you
 * agree:"). The sentence beside the Activate button therefore comes from the
 * catalogue, mirrors the backend's own `mobile.setup.consent`, and states the
 * three things a person is agreeing to: this account, the exact fresh amount, and
 * that no credit is purchased. It adds no legal gate; existing terms are unchanged.
 * The button sends back the SAME amount string it displays, so the backend's fresh
 * comparison is against what the person saw.
 *
 * ## The #3945 remedy vocabulary (`features.tunnel_remedy_kinds`)
 *
 * The operator's ask: a non-technical person signed in to Radient gets phone
 * access without a terminal, and when the tunnel cannot come up the desktop says
 * why in plain words and offers the fix. With the capability, the block renders
 * one control per `remedy.kind` (spec v2 §4.1, D5): `add_credit` and
 * `open_console` open the backend's own `remedy.url` (https only; the fix is in
 * the Radient console, which this app has no authority to perform), a `stopped`
 * tunnel says so and offers Turn on only when the backend says the run is ready,
 * `restore_owner` reuses the sign-in, and the waiting kinds (`wait_network`,
 * `wait_radient`, `wait_reconnect`, and the `reconnecting` plan) get a static
 * status line, "Last checked" and a quiet Check again - never a spinner, because
 * nothing on this computer is working on them (D8). Without the capability
 * every one of those answers renders exactly as before: the backend's sentence
 * and Check again. The new controls still never run `remedy.command`.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { CopyButton } from "@shared/components/common/copy-button";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui";
import { consumePhoneAccessFocus } from "@shared/hooks/phone-access-navigation";
import {
	type PhoneSetupView,
	type UsePhoneSetup,
	usePhoneSetup,
} from "@shared/hooks/use-phone-setup";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { useRadientSessionIssue } from "@shared/hooks/use-radient-session-issue";
import { formatRelativeTime, t } from "@shared/i18n";
import { openConsolePage } from "@shared/utils/radient-account-copy";
import { Check, CircleCheck, Copy, ExternalLink } from "lucide-react";
import {
	type FC,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	type PhoneSetupResult,
	phoneSetupSkipsCloudflared,
} from "../../../../shared/desktop-contract";

type PhoneAccessBlockProps = {
	/**
	 * Whether this mount may offer the browser sign-in itself.
	 *
	 * The provider panel ALREADY carries the sign-in action (its own "Continue in
	 * browser"), so it passes `false` and the block only states the backend's
	 * remedy: a second sign-in button beside it is exactly the duplicate the chat
	 * callout's header warns about. Settings -> Radient account has no sign-in
	 * control while signed in, so it passes `true` and the block reuses the same
	 * sign-in hook, which invalidates the same query keys as the panel.
	 */
	offerSignIn?: boolean;
	/**
	 * Whether this mount carries "Copy diagnostics". Settings -> Radient account
	 * passes `true`: that is where a person is sent when phone access does not
	 * work, and one copy of the button is enough. Still gated on
	 * `features.mobile_doctor`.
	 */
	diagnostics?: boolean;
	/**
	 * The settings-search row id, on the Settings mount only (UX review U2). A
	 * person who pressed "Not now" on the sidebar offer has no other way back to
	 * setup short of knowing where it lives; the search index reads rendered
	 * `[data-search-row]` elements only, so without this "phone" found nothing.
	 */
	searchRow?: string;
};

/**
 * Kinds that clear without anyone acting, mirrored from local-operator
 * `tunnels/gateway.py::WAITING_KINDS` (#3945). A button would invite a person to
 * "fix" something that is not broken, so they get Check again only.
 */
const WAITING_KINDS: ReadonlySet<string> = new Set([
	"wait_network",
	"wait_radient",
	"wait_reconnect",
]);

/**
 * The console link a remedy carries, or null. https only: the URL is the
 * backend's, but it is opened in the person's browser, and a remedy is not the
 * place to accept any other scheme.
 */
export const phoneRemedyLink = (result: PhoneSetupResult): string | null => {
	const url = result.remedy?.url;
	if (typeof url !== "string" || url === "") return null;
	try {
		return new URL(url).protocol === "https:" ? url : null;
	} catch {
		return null;
	}
};

/** "12 seconds ago" / "3 minutes ago" in the active locale, for Last checked. */
export const phoneCheckedAgo = (then: number, now: number): string => {
	const seconds = Math.max(1, Math.round((now - then) / 1000));
	if (seconds < 60) return formatRelativeTime(-seconds, "second");
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return formatRelativeTime(-minutes, "minute");
	return formatRelativeTime(-Math.round(minutes / 60), "hour");
};

/**
 * The clock "Last checked" is measured against. A re-render every 10 s keeps the
 * relative label honest while the waiting state sits on screen; it sends nothing
 * and it lives only while that state is mounted.
 */
const useNow = (intervalMs: number): number => {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), intervalMs);
		return () => clearInterval(timer);
	}, [intervalMs]);
	return now;
};

type Status = "checking" | "applying" | "connected";

const Heading: FC<{ status?: Status }> = ({ status }) => (
	<div className="flex flex-wrap items-center gap-2">
		{status === "connected" ? (
			<CircleCheck
				size={20}
				className="shrink-0 text-success"
				aria-hidden="true"
			/>
		) : null}
		{/*
		 * Focusable by script only (`tabIndex={-1}`): the block's one stable
		 * landing point when a state change removes the button that had focus,
		 * when the sidebar offer navigates here, and when settings search jumps to
		 * this row (UX review U3). Never in the Tab order.
		 */}
		<h4
			tabIndex={-1}
			data-phone-heading=""
			data-search-control=""
			className="rounded-sm text-heading text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
		>
			{t("ui.providers.phone.heading")}
		</h4>
		{status === "checking" ? (
			<span className="flex items-center gap-2 text-body-sm text-ink-muted">
				<Spinner size="sm" />
				<output>{t("ui.providers.phone.status.checking")}</output>
			</span>
		) : null}
		{status === "applying" ? (
			<span className="flex items-center gap-2 text-body-sm text-ink-muted">
				<Spinner size="sm" />
				<output>{t("ui.providers.phone.status.applying")}</output>
			</span>
		) : null}
		{status === "connected" ? (
			<output className="text-body-sm text-success">
				{t("ui.providers.phone.status.connected")}
			</output>
		) : null}
	</div>
);

/** The masked identity and credential number, exactly as the backend sent them. */
const AccountLine: FC<{ result: PhoneSetupResult }> = ({ result }) => {
	if (result.credential_id === null) return null;
	const id = String(result.credential_id);
	return (
		<p className="break-words text-body-sm text-ink-muted">
			{result.identity_label
				? t("ui.providers.phone.account", {
						identity: result.identity_label,
						id,
					})
				: t("ui.providers.phone.account_unlabeled", { id })}
		</p>
	);
};

/** A short list of backend-written lines (progress, receipts), verbatim. */
const Lines: FC<{ heading: string; lines: string[] }> = ({ heading, lines }) =>
	lines.length === 0 ? null : (
		<div className="flex flex-col gap-1">
			<p className="text-meta text-ink-dim">{heading}</p>
			<ul className="flex list-none flex-col gap-1 p-0">
				{lines.map((line, index) => (
					<li
						// Lines are append-only for one run; position is their identity.
						// biome-ignore lint/suspicious/noArrayIndexKey: ordered, append-only
						key={index}
						className="break-words text-body-sm text-ink"
					>
						{line}
					</li>
				))}
			</ul>
		</div>
	);

/** Canonical backend mobile.setup wording, selected only from declared outcome
 * fields. Remedy/receipts stay verbatim; unknown values cannot confirm a charge.
 */
const outcomeLines = (result: PhoneSetupResult): string[] => {
	const billing = {
		not_activated: "ui.providers.phone.outcome.billing_not_activated",
		already_active: "ui.providers.phone.outcome.billing_already_active",
		activated: "ui.providers.phone.outcome.billing_activated_status",
		unconfirmed: "ui.providers.phone.outcome.billing_unconfirmed",
	} as const;
	const reservation = {
		saved: "ui.providers.phone.outcome.reservation_saved",
		existing: "ui.providers.phone.outcome.reservation_existing",
		unconfirmed: "ui.providers.phone.outcome.reservation_unconfirmed",
	} as const;
	const stages = {
		billing: "ui.providers.phone.outcome.stage_billing",
		reservation: "ui.providers.phone.outcome.stage_reservation",
		configuration: "ui.providers.phone.outcome.stage_configuration",
		installation: "ui.providers.phone.outcome.stage_installation",
		verification: "ui.providers.phone.outcome.stage_verification",
		prerequisites: "ui.providers.phone.outcome.stage_prerequisites",
	} as const;
	const lines: string[] = [];
	const b = billing[result.billing_outcome as keyof typeof billing];
	const r = reservation[result.reservation_outcome as keyof typeof reservation];
	const stage = stages[result.failure_stage as keyof typeof stages];
	if (b) lines.push(t(b));
	if (r) lines.push(t(r));
	if (stage)
		lines.push(
			t("ui.providers.phone.outcome.failure_stage", { stage: t(stage) }),
		);
	return lines;
};

const Failure: FC<{
	failure: Extract<
		ReturnType<typeof usePhoneSetup>["view"],
		{ kind: "failure" }
	>["failure"];
	onCheck: () => void;
}> = ({ failure, onCheck }) => (
	<div className="flex flex-col items-start gap-3">
		<p role="alert" className="break-words text-body-sm text-ink">
			{failure.kind === "backend"
				? failure.message
				: failure.during === "run"
					? t("ui.providers.phone.failure.run")
					: t("ui.providers.phone.failure.check")}
		</p>
		<Button variant="secondary" size="sm" onClick={onCheck}>
			{t("ui.providers.phone.action.check_again")}
		</Button>
	</div>
);

/**
 * The next step after success (spec U9): the native app, signed in as this
 * Radient account. A COMPONENT so the account read mounts only here, in the one
 * state that names the email, and only with the #3945 vocabulary; the address
 * stays below it as the alternative.
 */
const NextStep: FC = () => {
	const { user } = useRadientAuth();
	const email = user?.email ?? "";
	return (
		<p className="break-words text-body-sm text-ink" data-phone-next-step="app">
			{email
				? t("ui.providers.phone.next_step_app", { email })
				: t("ui.providers.phone.next_step_app_no_email")}
		</p>
	);
};

/** `verified: true`, the only state that earns the success treatment. */
const Verified: FC<{ result: PhoneSetupResult; remedies: boolean }> = ({
	result,
	remedies,
}) => (
	<div
		className="flex flex-col gap-3"
		data-phone-state="verified"
		data-phone-verified="true"
	>
		<Heading status="connected" />
		<AccountLine result={result} />
		{remedies ? <NextStep /> : null}
		{result.url ? (
			<div className="flex flex-col items-start gap-2">
				<p className="text-meta text-ink-dim">
					{remedies
						? t("ui.providers.phone.address_alternative")
						: t("ui.providers.phone.address_label")}
				</p>
				<code className="break-all text-ink text-mono-sm">{result.url}</code>
				<CopyButton
					value={result.url}
					label={t("ui.providers.phone.action.copy_address")}
					variant="secondary"
				/>
			</div>
		) : null}
		{remedies ? null : (
			<p className="break-words text-body-sm text-ink-muted">
				{t("ui.providers.phone.use_address")}
			</p>
		)}
		<Lines
			heading={t("ui.providers.phone.receipts_heading")}
			lines={result.receipts.map((receipt) => receipt.text)}
		/>
	</div>
);

/**
 * The existing sign-in, reused: `useRadientSessionIssue` starts the same
 * `auth.start` operation, opens the browser through `openAuthorization`, polls it
 * and invalidates `radientSessionIssueKey` plus the account read. Once it ends
 * the block re-checks, because the plan on screen predates the new login.
 *
 * A COMPONENT, not a hook the block always calls, because that hook owns a polled
 * account read (`accounts.list`) and a block that is hidden, verified, or mounted
 * where the provider panel already carries the sign-in has no business running it.
 * It mounts only in the one state that needs it: the backend says `sign_in` and
 * this mount offers the action.
 */
const SignInAction: FC<{ onDone: () => void }> = ({ onDone }) => {
	const { issue, start, cancel } = useRadientSessionIssue();
	const signingIn =
		issue.kind === "signing-in" || issue.kind === "input-required";
	const was = useRef(false);
	useEffect(() => {
		if (was.current && !signingIn) onDone();
		was.current = signingIn;
	}, [signingIn, onDone]);
	if (signingIn) {
		return (
			<div className="flex items-center gap-3">
				<Spinner size="sm" />
				<output className="text-body-sm text-ink-muted">
					{t("ui.providers.phone.signing_in")}
				</output>
				<Button variant="ghost" size="sm" onClick={cancel}>
					{t("ui.providers.phone.action.cancel")}
				</Button>
			</div>
		);
	}
	return (
		<Button variant="primary" size="sm" onClick={start}>
			{t("ui.providers.phone.action.sign_in")}
			<ExternalLink aria-hidden="true" />
		</Button>
	);
};

/**
 * A state nothing on this computer is working on (D8): the backend's sentence as
 * a static status line, when it was last observed, and a QUIET Check again. No
 * spinner: a spinner says "working", and the honest answer is "waiting". The
 * `reconnecting` plan re-asks on its own (`use-phone-setup.ts`), and a press here
 * during it is the same read-only plan, which answers `reconnecting` again rather
 * than an error (U10).
 */
const Waiting: FC<{
	result: PhoneSetupResult;
	setup: UsePhoneSetup;
	kind: string;
}> = ({ result, setup, kind }) => {
	const now = useNow(10_000);
	return (
		<div
			className="flex flex-col gap-3"
			data-phone-state={result.blocked_on}
			data-remedy-kind={kind}
			data-phone-waiting="true"
		>
			<Heading />
			<AccountLine result={result} />
			{result.remedy ? (
				<output className="block break-words text-body-sm text-ink">
					{result.remedy.text}
				</output>
			) : null}
			{setup.checkedAt > 0 ? (
				<p className="text-meta text-ink-dim" data-phone-last-checked="">
					{t("ui.providers.phone.last_checked", {
						when: phoneCheckedAgo(setup.checkedAt, now),
					})}
				</p>
			) : null}
			<div className="flex flex-wrap items-center gap-2">
				<Button variant="ghost" size="sm" onClick={setup.check}>
					{t("ui.providers.phone.action.check_again")}
				</Button>
			</div>
		</div>
	);
};

/**
 * Every non-verified answer: the backend's remedy, then at most one primary
 * control chosen by `remedy.kind` (never by its sentence).
 */
const Blocked: FC<{
	result: PhoneSetupResult;
	setup: UsePhoneSetup;
	offerSignIn: boolean;
}> = ({ result, setup, offerSignIn }) => {
	const kind = result.remedy?.kind ?? null;
	const remedies = setup.remedies;
	if (
		remedies &&
		(WAITING_KINDS.has(kind ?? "") || result.blocked_on === "reconnecting")
	) {
		return (
			<Waiting result={result} setup={setup} kind={kind ?? "wait_reconnect"} />
		);
	}
	// The relay transport needs no `cloudflared`, so the install step is skipped:
	// the backend's sentence (which names the binary to install) is replaced by a
	// neutral UI sentence, and "Check again" asks the backend for a fresh plan that
	// a relay-aware backend answers past this prerequisite. Without `transport` (an
	// older backend) or with `cloudflare`, the step renders exactly as before.
	const skipCloudflared = phoneSetupSkipsCloudflared(result);
	const owner = result.credential_id;
	const price = result.quote?.monthly_price_usd ?? null;

	const checkAgain = (
		<Button variant="secondary" size="sm" onClick={setup.check}>
			{t("ui.providers.phone.action.check_again")}
		</Button>
	);

	// Activation needs the account, a FRESH quote with an amount, and the backend's
	// own `ready`. A `quote_changed` answer is `ready: false`, so the person sees
	// the backend's sentence and checks again to see the new amount: the old
	// acceptance is never re-sent against a price they have not seen.
	// Chosen by `remedy.kind` alone: `quote.eligible` is the backend's name for
	// "no activation required", so it reads inverted and is not a second authority.
	const canActivate =
		kind === "accept_quote" && result.ready && owner !== null && price !== null;
	const canRun = kind === "run" && result.ready && owner !== null;
	// A tunnel the person stopped is never resumed behind their back; Turn on is
	// offered only when the backend says the run would act on it (`ready`). The
	// #3945 backend answers `stopped` with `ready: false` (its `apply` declines a
	// stopped tunnel), so there the sentence stands with Check again and the
	// backend's own remedy beneath it.
	const stopped = remedies && result.blocked_on === "stopped";
	const canTurnOn = stopped && result.ready && owner !== null;
	// The console is the whole fix for these two; the backend sends the link.
	const link =
		remedies && (kind === "add_credit" || kind === "open_console")
			? phoneRemedyLink(result)
			: null;

	let control = checkAgain;
	let extra = null;
	if (canActivate && owner !== null && price !== null) {
		control = (
			<Button
				variant="primary"
				size="sm"
				onClick={() => setup.run(owner, price)}
			>
				{t("ui.providers.phone.action.activate", { amount: price })}
			</Button>
		);
		extra = checkAgain;
	} else if (canTurnOn && owner !== null) {
		control = (
			<Button variant="primary" size="sm" onClick={() => setup.run(owner)}>
				{t("ui.providers.phone.action.turn_on")}
			</Button>
		);
		extra = checkAgain;
	} else if (canRun && owner !== null) {
		control = (
			<Button variant="primary" size="sm" onClick={() => setup.run(owner)}>
				{remedies && result.step === "reconnect"
					? t("ui.providers.phone.action.reconnect")
					: t("ui.providers.phone.action.set_up")}
			</Button>
		);
		extra = checkAgain;
	} else if (link !== null) {
		control = (
			<Button variant="primary" size="sm" onClick={() => openConsolePage(link)}>
				{kind === "add_credit"
					? t("ui.providers.phone.action.add_credit")
					: t("ui.providers.phone.action.open_console")}
				<ExternalLink aria-hidden="true" />
			</Button>
		);
		extra = checkAgain;
	} else if (
		(kind === "sign_in" || (remedies && kind === "restore_owner")) &&
		offerSignIn
	) {
		// `restore_owner`: the account that set this up is no longer signed in
		// here, and signing it back in IS the fix (the backend never switches
		// owners). The same browser sign-in, so nothing new is trusted.
		control = <SignInAction onDone={setup.check} />;
		extra = checkAgain;
	}

	return (
		<div
			className="flex flex-col gap-3"
			data-phone-state={result.blocked_on}
			data-remedy-kind={kind ?? "none"}
			data-phone-step-skipped={skipCloudflared ? "cloudflared" : undefined}
		>
			<Heading />
			<AccountLine result={result} />
			{kind === "choose_account" ? (
				<div className="flex flex-col items-start gap-2">
					<p className="text-meta text-ink-dim">
						{t("ui.providers.phone.choose_heading")}
					</p>
					{result.credential_choices.map((choice) => (
						<Button
							key={choice.id}
							variant="secondary"
							size="sm"
							onClick={() => setup.choose(choice.id)}
						>
							{choice.identity_label
								? t("ui.providers.phone.action.choose", {
										identity: choice.identity_label,
										id: String(choice.id),
									})
								: t("ui.providers.phone.action.choose_unlabeled", {
										id: String(choice.id),
									})}
						</Button>
					))}
				</div>
			) : null}
			{stopped ? (
				// UI-owned (spec §4.1): the backend's sentence names a terminal
				// command, which is what this surface exists to avoid. It is kept
				// below only while no Turn on is offered, because it is then the only
				// way back.
				<p className="break-words text-body-sm text-ink">
					{t("ui.providers.phone.stopped")}
				</p>
			) : null}
			{stopped && canTurnOn ? null : skipCloudflared ? (
				// UI-owned, not the backend's: the backend sentence is the one being
				// suppressed, and a blocked state with no sentence reads as a bug
				// (design review D1). It never names the transport or the tool.
				<p className="break-words text-body-sm text-ink">
					{t("ui.providers.phone.connector_not_needed")}
				</p>
			) : result.remedy ? (
				<p className="break-words text-body-sm text-ink">
					{result.remedy.text}
				</p>
			) : null}
			{canActivate && price !== null ? (
				<p className="break-words text-body-sm text-ink">
					{t("ui.providers.phone.consent", { amount: price })}
				</p>
			) : null}
			<Lines
				heading={t("ui.providers.phone.progress_heading")}
				lines={outcomeLines(result)}
			/>
			<Lines
				heading={t("ui.providers.phone.receipts_heading")}
				lines={result.receipts.map((receipt) => receipt.text)}
			/>
			{kind === "choose_account" ? null : (
				<div className="flex flex-wrap items-center gap-2">
					{control}
					{extra}
				</div>
			)}
		</div>
	);
};

/**
 * "Copy diagnostics": the backend's redacted `lop mobile doctor --json`, as
 * text, on the clipboard - what a person without a terminal hands to support or
 * to an agent. Fetched on the press, never before (it describes this machine,
 * and nobody asked yet). "Copied" resets after 2 s like `CopyButton`; a failure
 * (the read or the clipboard) says so in place and stays until the next press,
 * because a vanishing error is one a person can miss.
 *
 * While the read runs (the backend's doctor probes the tunnel, the health route
 * and Radient, bounded at up to ~10 s on a slow network) the button says
 * "Copying…" with a spinner and is `aria-disabled` (UX review U5): a silent
 * button looked dead in exactly the case someone wants diagnostics. NOT the
 * `disabled` attribute, which would drop keyboard focus to <body> the moment
 * the press lands; the busy guard below already ignores repeat presses. The
 * helper line under it says what the text is for and that it is redacted, so a
 * person knows it is safe to paste to whoever is helping.
 */
const CopyDiagnostics: FC = () => {
	const [state, setState] = useState<"idle" | "busy" | "copied" | "failed">(
		"idle",
	);
	useEffect(() => {
		if (state !== "copied") return undefined;
		const timer = setTimeout(() => setState("idle"), 2000);
		return () => clearTimeout(timer);
	}, [state]);
	const copy = async () => {
		if (state === "busy") return;
		setState("busy");
		try {
			const report = await desktopResult<unknown>({ op: "mobile.doctor" });
			await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
			setState("copied");
		} catch {
			setState("failed");
		}
	};
	const busy = state === "busy";
	const helpId = useId();
	return (
		<div
			className="flex flex-wrap items-center gap-2"
			data-phone-diagnostics={state}
		>
			<Button
				variant="ghost"
				size="sm"
				onClick={() => void copy()}
				aria-busy={busy ? true : undefined}
				aria-disabled={busy ? true : undefined}
				aria-describedby={helpId}
				className={busy ? "cursor-wait text-ink-disabled" : undefined}
			>
				{busy ? (
					<Spinner size="xs" />
				) : state === "copied" ? (
					<Check aria-hidden="true" />
				) : (
					<Copy aria-hidden="true" />
				)}
				{busy
					? t("ui.providers.phone.action.copying_diagnostics")
					: state === "copied"
						? t("ui.common.actions.copied")
						: t("ui.providers.phone.action.copy_diagnostics")}
			</Button>
			<p id={helpId} className="w-full break-words text-meta text-ink-dim">
				{t("ui.providers.phone.diagnostics_help")}
			</p>
			{state === "failed" ? (
				<p role="alert" className="break-words text-body-sm text-ink">
					{t("ui.providers.phone.diagnostics_failed")}
				</p>
			) : null}
		</div>
	);
};

/**
 * Re-plan when the Radient sign-in settles on a DIFFERENT account (U10): the
 * answer on screen predates it, and the backend's post-sign-in reconnect may
 * already be running. Not on the first value, which the open's own plan covers.
 * A component so the account read mounts only with the #3945 vocabulary.
 */
const RefetchOnSignIn: FC<{ onChange: () => void }> = ({ onChange }) => {
	const { user, authStatus } = useRadientAuth();
	const accountId =
		authStatus === "loading" || authStatus === "restoring"
			? undefined
			: (user?.radientUser.account.id ?? null);
	const last = useRef<string | null | undefined>(undefined);
	useEffect(() => {
		if (accountId === undefined) return;
		if (last.current !== undefined && last.current !== accountId) onChange();
		last.current = accountId;
	}, [accountId, onChange]);
	return null;
};

/**
 * What the live region compares between renders: a settled state, or null
 * while nothing is settled (checking, applying) so a re-check's in-between
 * never counts as a change. Only `connected` and `reconnecting` are announced
 * (the transitions nobody pressed for); a failure carries its own
 * `role="alert"`, and every other state is reached by a press whose result the
 * person is already looking at.
 */
const announcedStatus = (
	view: PhoneSetupView,
	remedies: boolean,
): string | null => {
	if (view.kind === "failure") return "failure";
	if (view.kind !== "result") return null;
	if (view.result.verified) return "connected";
	if (remedies && view.result.blocked_on === "reconnecting") {
		return "reconnecting";
	}
	// i18n: ignore comparison key, never rendered or announced
	return `blocked:${view.result.blocked_on}:${view.result.remedy?.kind ?? ""}`;
};

/**
 * The block's polite live region (UX review U4). Kept mounted for the block's
 * whole life: a region inserted together with its text is not announced by
 * many screen-reader/browser pairs, which is why the reconnecting -> Connected
 * swap (a whole new subtree) said nothing. Announces (a) the two transitions
 * that happen without a press, and (b) after a Check again whose answer did not
 * change the state, "Last checked ..." - otherwise a press in a waiting state
 * changed only a plain <p> and a screen-reader user could not tell it ran.
 */
const useAnnouncement = (
	view: PhoneSetupView,
	remedies: boolean,
	checkedAt: number,
): { message: string; pressed: () => void } => {
	const [message, setMessage] = useState("");
	const previous = useRef<string | null>(null);
	// When Check again was pressed (ms epoch), or 0 when no press is waiting for
	// its answer. An answer counts only if it was observed after the press.
	const pressedAt = useRef(0);
	const status = announcedStatus(view, remedies);
	useEffect(() => {
		if (status === null) return;
		const before = previous.current;
		previous.current = status;
		let next: string | null = null;
		if (before !== null && before !== status) {
			if (status === "connected") {
				next = t("ui.providers.phone.announce.connected");
			} else if (status === "reconnecting") {
				next = t("ui.providers.phone.announce.reconnecting");
			}
		}
		const answered = pressedAt.current > 0 && checkedAt >= pressedAt.current;
		if (status === "failure" || answered) pressedAt.current = 0;
		if (next === null && answered && status !== "failure") {
			next = t("ui.providers.phone.last_checked", {
				when: phoneCheckedAgo(checkedAt, Date.now()),
			});
		}
		if (next === null) return;
		const said = next;
		// The same words twice in a row are not re-announced by a live region, so a
		// second identical message differs by one invisible no-break space.
		setMessage((current) => (current === said ? `${said}\u00a0` : said));
	}, [status, checkedAt]);
	const pressed = useCallback(() => {
		pressedAt.current = Date.now();
	}, []);
	return { message, pressed };
};

const headingIn = (section: HTMLElement | null): HTMLElement | null =>
	section?.querySelector<HTMLElement>("[data-phone-heading]") ?? null;

const PhoneAccessBody: FC<{
	offerSignIn: boolean;
	diagnostics: boolean;
	searchRow?: string;
}> = ({ offerSignIn, diagnostics, searchRow }) => {
	const setup = usePhoneSetup();
	const capabilities = useDesktopCapabilities();
	const { view } = setup;
	const sectionRef = useRef<HTMLElement>(null);
	const announcement = useAnnouncement(view, setup.remedies, setup.checkedAt);
	const { pressed } = announcement;
	const rawCheck = setup.check;
	const check = useCallback(() => {
		pressed();
		rawCheck();
	}, [pressed, rawCheck]);

	// Focus that a state change would otherwise drop (UX review U3b). A poll,
	// a focus refetch or a finished run replaces the subtree, and with it the
	// button that had focus (Check again, Add credit), which sends a keyboard
	// user back to the top of the document. The last control focused in here is
	// remembered; after a commit that disconnected it while focus fell to
	// <body>, focus moves to this block's heading. Focus that LEFT the block for
	// another control is forgotten, and a window that merely lost focus keeps
	// its element connected, so neither is ever pulled back.
	const lastFocused = useRef<HTMLElement | null>(null);
	useLayoutEffect(() => {
		const element = lastFocused.current;
		if (!element || element.isConnected) return;
		lastFocused.current = null;
		const active = document.activeElement;
		if (active !== null && active !== document.body) return;
		headingIn(sectionRef.current)?.focus({ preventScroll: true });
	});

	// The sidebar offer's [Set up phone access] lands here, not at the top of the
	// Radient section (UX review U3c). The offer navigates to plain `/settings`
	// rather than `?section=radient`: that deep link re-scrolls to the SECTION's
	// top once the page settles (up to 2 s later) and would undo this landing.
	const visible = view.kind !== "hidden";
	useEffect(() => {
		if (!visible || !sectionRef.current) return;
		if (!consumePhoneAccessFocus()) return;
		// Optional call: jsdom (the test rig) has no scrollIntoView.
		sectionRef.current.scrollIntoView?.({ block: "center" });
		headingIn(sectionRef.current)?.focus({ preventScroll: true });
	}, [visible]);

	if (view.kind === "hidden") return null;
	const showDiagnostics =
		diagnostics && desktopFeatureEnabled(capabilities.data, "mobile_doctor");
	// Children press Check again through this, so the live region knows a press
	// is waiting for its answer. The sign-in re-plan below keeps the raw check:
	// nobody pressed anything there.
	const pressable: UsePhoneSetup = { ...setup, check };

	return (
		<section
			ref={sectionRef}
			className="flex flex-col gap-3 border-hairline border-t pt-4"
			aria-label={t("ui.providers.phone.heading")}
			data-phone-block={view.kind}
			data-search-row={searchRow}
			data-search-label={
				searchRow ? t("ui.providers.phone.heading") : undefined
			}
			data-search-terms={
				searchRow ? t("ui.providers.phone.search_terms") : undefined
			}
			onFocus={(event) => {
				lastFocused.current = event.target;
			}}
			onBlur={(event) => {
				const to = event.relatedTarget;
				if (to instanceof Node && !event.currentTarget.contains(to)) {
					lastFocused.current = null;
				}
			}}
		>
			<p
				aria-live="polite"
				aria-atomic="true"
				className="sr-only"
				data-phone-announcement=""
			>
				{announcement.message}
			</p>
			{view.kind === "checking" ? (
				<div className="flex flex-col gap-3" data-phone-state="checking">
					<Heading status="checking" />
				</div>
			) : null}
			{view.kind === "applying" ? (
				<div className="flex flex-col gap-3" data-phone-state="applying">
					<Heading status={view.setup ? "applying" : "checking"} />
					{view.account ? <AccountLine result={view.account} /> : null}
					<Lines
						heading={t("ui.providers.phone.progress_heading")}
						lines={view.progress}
					/>
				</div>
			) : null}
			{view.kind === "failure" ? (
				<div className="flex flex-col gap-3" data-phone-state="failure">
					<Heading />
					<Failure failure={view.failure} onCheck={check} />
				</div>
			) : null}
			{view.kind === "result" && view.result.verified ? (
				<Verified result={view.result} remedies={setup.remedies} />
			) : null}
			{view.kind === "result" && !view.result.verified ? (
				<Blocked
					result={view.result}
					setup={pressable}
					offerSignIn={offerSignIn}
				/>
			) : null}
			{showDiagnostics ? <CopyDiagnostics /> : null}
			{setup.remedies ? <RefetchOnSignIn onChange={setup.check} /> : null}
		</section>
	);
};

/**
 * The gate. Without `features.tunnel_setup` this renders nothing and mounts nothing
 * beneath it, so an older backend costs the shared capabilities read the app
 * already makes and no other request, observer or timer.
 */
export const PhoneAccessBlock: FC<PhoneAccessBlockProps> = ({
	offerSignIn = false,
	diagnostics = false,
	searchRow,
}) => {
	const capabilities = useDesktopCapabilities();
	if (!desktopFeatureEnabled(capabilities.data, "tunnel_setup")) return null;
	return (
		<PhoneAccessBody
			offerSignIn={offerSignIn}
			diagnostics={diagnostics}
			searchRow={searchRow}
		/>
	);
};
