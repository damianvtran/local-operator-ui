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
 */

import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { CopyButton } from "@shared/components/common/copy-button";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui";
import {
	type UsePhoneSetup,
	usePhoneSetup,
} from "@shared/hooks/use-phone-setup";
import { useRadientSessionIssue } from "@shared/hooks/use-radient-session-issue";
import { t } from "@shared/i18n";
import { CircleCheck, ExternalLink } from "lucide-react";
import { type FC, useEffect, useRef } from "react";
import type { PhoneSetupResult } from "../../../../shared/desktop-contract";

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
		<h4 className="text-heading text-ink">{t("ui.providers.phone.heading")}</h4>
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

/** `verified: true`, the only state that earns the success treatment. */
const Verified: FC<{ result: PhoneSetupResult }> = ({ result }) => (
	<div
		className="flex flex-col gap-3"
		data-phone-state="verified"
		data-phone-verified="true"
	>
		<Heading status="connected" />
		<AccountLine result={result} />
		{result.url ? (
			<div className="flex flex-col items-start gap-2">
				<p className="text-meta text-ink-dim">
					{t("ui.providers.phone.address_label")}
				</p>
				<code className="break-all text-ink text-mono-sm">{result.url}</code>
				<CopyButton
					value={result.url}
					label={t("ui.providers.phone.action.copy_address")}
					variant="secondary"
				/>
			</div>
		) : null}
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
 * Every non-verified answer: the backend's remedy, then at most one primary
 * control chosen by `remedy.kind` (never by its sentence).
 */
const Blocked: FC<{
	result: PhoneSetupResult;
	setup: UsePhoneSetup;
	offerSignIn: boolean;
}> = ({ result, setup, offerSignIn }) => {
	const kind = result.remedy?.kind ?? null;
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
	} else if (canRun && owner !== null) {
		control = (
			<Button variant="primary" size="sm" onClick={() => setup.run(owner)}>
				{t("ui.providers.phone.action.set_up")}
			</Button>
		);
		extra = checkAgain;
	} else if (kind === "sign_in" && offerSignIn) {
		control = <SignInAction onDone={setup.check} />;
		extra = checkAgain;
	}

	return (
		<div
			className="flex flex-col gap-3"
			data-phone-state={result.blocked_on}
			data-remedy-kind={kind ?? "none"}
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
			{result.remedy ? (
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

const PhoneAccessBody: FC<{ offerSignIn: boolean }> = ({ offerSignIn }) => {
	const setup = usePhoneSetup();
	const { view } = setup;
	if (view.kind === "hidden") return null;

	return (
		<section
			className="flex flex-col gap-3 border-hairline border-t pt-4"
			aria-label={t("ui.providers.phone.heading")}
			data-phone-block={view.kind}
		>
			{view.kind === "checking" ? (
				<div className="flex flex-col gap-3" data-phone-state="checking">
					<Heading status="checking" />
				</div>
			) : null}
			{view.kind === "applying" ? (
				<div className="flex flex-col gap-3" data-phone-state="applying">
					<Heading status={view.setup ? "applying" : "checking"} />
					<Lines
						heading={t("ui.providers.phone.progress_heading")}
						lines={view.progress}
					/>
				</div>
			) : null}
			{view.kind === "failure" ? (
				<div className="flex flex-col gap-3" data-phone-state="failure">
					<Heading />
					<Failure failure={view.failure} onCheck={setup.check} />
				</div>
			) : null}
			{view.kind === "result" && view.result.verified ? (
				<Verified result={view.result} />
			) : null}
			{view.kind === "result" && !view.result.verified ? (
				<Blocked result={view.result} setup={setup} offerSignIn={offerSignIn} />
			) : null}
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
}) => {
	const capabilities = useDesktopCapabilities();
	if (!desktopFeatureEnabled(capabilities.data, "tunnel_setup")) return null;
	return <PhoneAccessBody offerSignIn={offerSignIn} />;
};
