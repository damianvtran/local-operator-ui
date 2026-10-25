/**
 * Provider detail panel: how one provider is connected, in every state a
 * sign-in passes through (design audit § 3).
 *
 * Sign-in flows run as backend auth operations: the backend owns PKCE, state
 * and callback ports, and this panel renders the state `sign-in-flow.ts` emits.
 * The flow module owns the rules that used to be buried here and got one wrong
 * -- the browser opening only on a second click (design D1, UX U1) -- so this
 * file is presentation: which sentence, which button, which fallback.
 *
 * Three rules the layout keeps:
 *
 * - One primary action per state. The method tabs never repeat the provider
 *   name, so a tab and the button beneath it can never share an accessible name
 *   (design D4).
 * - A paste box is a FALLBACK unless the flow is the paste. A flow the backend
 *   marks `input_optional` (Anthropic's redirect, which completes on its own)
 *   leads with "Finish signing in with your browser" and keeps the paste behind a
 *   disclosure; only a flow that needs the paste shows the field open (D2).
 * - A device code is display content to copy, shown as the code alone, never
 *   the sentence around it (UX U4).
 *
 * Keys are saved only by an explicit "Save key"; blur never persists a
 * credential. A rejected key is the backend's 422 sentence, inline under the
 * field, and nothing was stored (UX U3).
 */

import { pollAuthOperation } from "@shared/api/local-operator/auth-operation";
import {
	DesktopControlError,
	desktopResult,
	openAuthorization,
} from "@shared/api/local-operator/desktop-api";
import type {
	AuthOperation,
	DesktopProvider,
	ProviderMethod,
} from "@shared/api/local-operator/desktop-api";
import { desktopKeys } from "@shared/api/local-operator/desktop-hooks";
import { CopyButton } from "@shared/components/common/copy-button";
import { Spinner } from "@shared/components/common/spinner";
import { getModelsForHostingProvider } from "@shared/components/hosting/hosting-model-manifest";
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Button,
	Input,
	Label,
	Tabs,
	TabsList,
	TabsTrigger,
} from "@shared/components/ui";
import { Disclosure } from "@shared/components/ui/disclosure";
import { apiConfig } from "@shared/config/api-config";
/*
 * The verdict is read through the composer callout's own module rather than a
 * query of this feature's: the chip and the callout share one cache entry for
 * `GET /v1/auth/status`, so they cannot disagree about one verdict at one
 * instant (see `useRadientAuthStatus`).
 */
import {
	radientSessionIssueKey,
	useRadientLoginVerdict,
} from "@shared/hooks/use-radient-session-issue";
/*
 * The MODULE, not the `@shared/hooks` barrel: the barrel carries
 * `use-connectivity-status`, which reads the renderer's config at import time and
 * therefore throws in any Node bundle that does not define `import.meta.env` --
 * `scripts/backend-error-surfaces.test.mjs` bundles this grid and says so in its own
 * docblock. Importing the leaf keeps this feature out of that graph.
 */
import {
	commissionAccountRead,
	useRadientUserQuery,
} from "@shared/hooks/use-radient-user-query";
import { useUpdateConfig } from "@shared/hooks/use-update-config";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useModelsStore } from "@shared/store/models-store";
import { useQueryClient } from "@tanstack/react-query";
import {
	CircleCheck,
	ExternalLink,
	Eye,
	EyeOff,
	RotateCcw,
	TriangleAlert,
} from "lucide-react";
import type { FC, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	DefaultsApplied,
	SaveKeyResult,
} from "../../../../shared/desktop-contract";
import { PhoneAccessBlock } from "./phone-access-block";
import {
	brandOf,
	deviceCodeOf,
	hostOf,
	methodBlurb,
	methodName,
	minutesLeft,
	unfinishedMessage,
} from "./provider-catalog";
import {
	type ProviderReadiness,
	loginClaim,
	primaryMethod,
	providerReadiness,
} from "./provider-labels";
import {
	clearKeyOutcome,
	peekKeyOutcome,
	setKeyOutcome,
	useSignInSession,
} from "./sign-in-sessions";

/**
 * Reachability for a local provider.
 *
 * The probe runs when the panel OPENS (design D11): opening a panel is already
 * an explicit user action, and "Not tested yet" was a state that asked the
 * user to press a button whose result the app could have fetched itself. The
 * "no probe on render" rule is about the provider LIST, which still never
 * probes.
 */
const LocalProviderReachability: FC<{ provider: DesktopProvider }> = ({
	provider,
}) => {
	useI18nLocale();
	const [testing, setTesting] = useState(false);
	const [result, setResult] = useState<{
		reachable: boolean;
		detail: string;
	} | null>(null);

	const test = useCallback(async () => {
		setTesting(true);
		try {
			setResult(
				await desktopResult<{ reachable: boolean; detail: string }>({
					op: "auth.probe",
					provider: provider.id,
				}),
			);
		} catch (error) {
			setResult({
				reachable: false,
				detail:
					error instanceof Error
						? error.message
						: t(
								"ui.providers.provider_detail.the_connection_could_not_be_tested",
							),
			});
		} finally {
			setTesting(false);
		}
	}, [provider.id]);

	// A different provider row reuses this component, so the verdict is reset
	// and re-asked per provider rather than left beside the new name.
	useEffect(() => {
		setResult(null);
		void test();
	}, [test]);

	const brand = brandOf(provider);
	return (
		<div className="flex flex-col items-start gap-2">
			{result === null ? (
				<p className="flex items-center gap-2 text-body-sm text-ink-muted">
					<Spinner size="sm" />
					{t("ui.providers.provider_detail.checking_whether")}
					{brand} {t("ui.providers.provider_detail.is_running")}
				</p>
			) : result.reachable ? (
				<p className="text-body-sm text-success">
					{brand} {t("ui.providers.provider_detail.is_running")}
				</p>
			) : (
				<p className="text-body-sm text-ink-muted">
					{brand} {t("ui.providers.provider_detail.isn_t_answering")}
					{provider.base_url ? (
						<>
							{t("ui.providers.provider_detail.at")}
							<span className="font-mono">{provider.base_url}</span>
						</>
					) : null}
				</p>
			)}
			{/*
			 * No second failure line when the probe could not answer: the line above
			 * already carries the verdict AND the address, so the backend's sentence
			 * printed the same failure twice (design round 2 D9). The old guard hid it
			 * only when the detail contained the configured address, which never
			 * matched -- the configured address carries `/v1` and the sentence does not,
			 * and the real backend (routes/auth.py's probe) sends no address at all.
			 */}
			<Button
				variant="secondary"
				size="sm"
				onClick={() => void test()}
				disabled={testing}
			>
				{testing
					? t("ui.providers.provider_detail.checking")
					: t("ui.providers.provider_detail.check_again")}
			</Button>
		</div>
	);
};

/**
 * Where the panel is shown, which decides only the success action's words: in
 * Settings the flow ends with "Done"; in onboarding and the connect dialog the
 * next step is the point, so it reads "Continue".
 */
export type ProviderDetailContext = "settings" | "dialog";

type ProviderDetailProps = {
	provider: DesktopProvider;
	/** Called once an auth method has stored a credential. */
	onConnected?: () => void;
	/**
	 * Called when the user presses the success state's action. Settings uses it
	 * to collapse the panel; the dialogs to move on.
	 */
	onDone?: () => void;
	/** Opens the model picker from the receipt's "Change". */
	onChangeModel?: () => void;
	context?: ProviderDetailContext;
	/**
	 * The verdict the SURFACE AROUND this panel already holds, when there is one.
	 *
	 * WHY IT IS PASSED IN: the row above this panel paints a claim from the login
	 * verdict, and when the panel derived its own the pair could disagree -- measured
	 * on a backend whose `radient_login` names no credential, where the row read
	 * "Needs sign-in" and the panel open on that same row read "Signed in to Radient"
	 * (QA round 4, Q4-2). One surface, one read, one verdict. Omitted (the account
	 * section's sign-in block, the remount tests) means "derive it here", which is
	 * what the panel did before.
	 */
	readiness?: ProviderReadiness | null;
};

const SecretInput: FC<{
	id: string;
	value: string;
	onChange: (value: string) => void;
	label: string;
	invalid?: boolean;
	describedBy?: string;
}> = ({ id, value, onChange, label, invalid, describedBy }) => {
	useI18nLocale();
	const [visible, setVisible] = useState(false);
	return (
		<div className="relative">
			<Input
				id={id}
				type={visible ? "text" : "password"}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				autoComplete="off"
				spellCheck={false}
				aria-label={label}
				aria-invalid={invalid || undefined}
				aria-describedby={describedBy}
				className="pr-10 font-mono"
			/>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="absolute top-1/2 right-1 -translate-y-1/2"
				onClick={() => setVisible((current) => !current)}
				aria-label={
					visible
						? t("ui.providers.provider_detail.hide_key")
						: t("ui.providers.provider_detail.show_key")
				}
			>
				{visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
			</Button>
		</div>
	);
};

/**
 * The success receipt: the backend's own sentence, never re-derived here,
 * because the backend is what decided and wrote the default (`DefaultsApplied`).
 * An older backend sends no receipt; the panel then says only that the sign-in
 * worked, rather than implying a default it cannot see.
 */
/*
 * A sentence the caller supplied is finished before the next one begins: the
 * verdict's `detail` has no terminal-punctuation contract of its own, and this
 * view appends a second sentence (UX round 6, U25). The regex lives at module
 * scope because `useTopLevelRegex` is an error in this repo's biome config.
 */
const TERMINAL_STOP = /[.!?]$/;
const verdictStop = (sentence: string): string =>
	TERMINAL_STOP.test(sentence.trim()) ? sentence : `${sentence}.`;

const SignedIn: FC<{
	brand: string;
	verb: "Signed in to" | "Connected";
	defaults: DefaultsApplied | null | undefined;
	retainedNotice?: string | null;
	unverified?: string | null;
	onChangeModel?: () => void;
	actionLabel: string;
	onAction: () => void;
	primaryAction: boolean;
	/** Overrides the headline, for the states that are not a plain success. */
	headline?: string;
	/**
	 * `unchecked` is a save whose key the backend did not verify. The success
	 * colour and the word "connected" are spent only on a verified success
	 * (branding contract, design round 1 D4), so this tone moves the check to
	 * `text-ink-muted` and promotes the caveat from the dimmest line on the panel
	 * to a body-sized muted one.
	 */
	tone?: "success" | "unchecked";
	/**
	 * THE SURFACE'S VERDICT, which is what this panel may say about a sign-in.
	 *
	 * WHY IT IS AN INPUT: the panel renders this view whenever the sign-in OPERATION
	 * settled succeeded, and an operation that succeeded does not mean the provider
	 * still accepts the grant it stored. Measured live twice (UX round 5, U19): one
	 * second after a completed browser sign-in the row read "Needs sign-in" while this
	 * view read "Signed in to Radient"; and with a refused grant the row read "Needs
	 * re-authentication" while this view showed a green check. The row's claim and the
	 * panel's headline now come from ONE source, so the pair cannot state opposite
	 * things at one instant -- and where the panel still says the refusal the row says,
	 * that is DELIBERATE agreement rather than a second opinion (review round 5, R5-m4).
	 */
	verdict?: ProviderReadiness | null;
}> = ({
	brand,
	verb,
	defaults,
	retainedNotice,
	unverified,
	onChangeModel,
	actionLabel,
	onAction,
	primaryAction,
	headline,
	tone = "success",
	verdict,
}) => {
	useI18nLocale();
	/*
	 * A verdict this panel cannot repeat as a success. `Needs sign-in` is both the
	 * refusal and the not-confirmed arm (`unknown` with a credential): in the first the
	 * grant is dead, in the second the app asked and could not get an answer -- and
	 * neither is a green check with the provider's name after it.
	 */
	const contested = verdict?.group === "Needs sign-in";
	const actionRef = useRef<HTMLButtonElement>(null);
	/*
	 * THE VIEW THAT ARRIVES TAKES FOCUS, ON ITS OWN ACTION (UX round 5, U22). The
	 * success view replaces the field and, in a dialog, leaves Radix's container as the
	 * focused element -- so a keyboard user's next Tab starts from the dialog rather
	 * than from the control the app just offered.
	 */
	useEffect(() => {
		actionRef.current?.focus();
	}, []);
	return (
		<div
			className="flex flex-col gap-3"
			data-sign-in-state="succeeded"
			/*
			 * For rigs and for the swept stories: the verdict this view was rendered under,
			 * so a frame can wait for the refusal instead of for the clock (the same reason
			 * the row publishes `data-claim-tone`).
			 */
			data-verdict={contested ? verdict.tone : undefined}
		>
			<div className="flex items-center gap-2">
				{contested && verdict ? (
					<TriangleAlert
						size={20}
						/*
						 * THE TONE FOLLOWS THE VERDICT. `attention` is the refusal and takes the
						 * warning ink; the not-confirmed arm is neutral and must not spend it
						 * (review round 5, R5-m4: the alert below this was hard-coded to
						 * `warning`, so a neutral verdict was painted as a warning).
						 */
						className={
							verdict.tone === "attention" ? "text-warning" : "text-ink-muted"
						}
						aria-hidden="true"
					/>
				) : (
					<CircleCheck
						size={20}
						className={tone === "unchecked" ? "text-ink-muted" : "text-success"}
						aria-hidden="true"
					/>
				)}
				<output className="text-heading text-ink">
					{contested && verdict
						? verdict.label
						: (headline ??
							(verb === "Connected"
								? t("ui.providers.provider_detail.connected_variant_163", {
										brand,
									})
								: t("ui.providers.provider_detail.signed_in_to_variant_164", {
										brand,
									})))}
				</output>
			</div>
			{contested && verdict ? (
				/*
				 * WHAT THE OPERATION DID, SAID UNDER WHAT THE APP CAN PROVE. The receipt below
				 * still states the default this sign-in wrote -- that is a fact about the
				 * operation and this panel is where a user reads it. What is NOT said is that
				 * the sign-in works.
				 */
				<p className="text-body-sm text-ink-muted">
					{/*
					 * THE VERDICT'S OWN SENTENCE, and in its own register when it has none:
					 * a refusal says the provider stopped accepting this sign-in, an
					 * unconfirmed one says the app could not confirm it. The first version
					 * printed the refusal sentence for both, so the neutral arm made a claim
					 * the verdict did not (review round 6, minor).
					 */}
					{/*
					 * THE VERDICT'S OWN SENTENCE ends before the next one starts: a
					 * `detail` that arrives without terminal punctuation ran the two
					 * together -- "…on this machine The sign-in itself finished…"
					 * (UX round 6, U25).
					 */}
					{verdictStop(
						verdict.detail ??
							(verdict.tone === "attention"
								? t(
										"ui.providers.provider_detail.is_no_longer_accepting_the_sign_in",
										{ brand },
									)
								: t(
										"ui.providers.provider_detail.this_app_could_not_confirm_the_sign",
										{ brand },
									)),
					)}{" "}
					{t(
						"ui.providers.provider_detail.the_sign_in_itself_finished_what_follows",
					)}
				</p>
			) : null}
			{retainedNotice?.trim() ? (
				// Record references belong on separate lines; preserve the trusted
				// indentation while allowing long tokens to wrap in narrow panels.
				<p
					className="min-w-0 whitespace-pre-wrap text-body-sm text-ink-muted [overflow-wrap:anywhere]"
					data-retained-notice
				>
					{retainedNotice}
				</p>
			) : null}
			{defaults?.receipt || defaults?.model_name ? (
				<p className="text-body-sm text-ink-muted">
					{defaults.receipt}
					{/*
					 * The model, named -- and ONLY when the backend sent no sentence at all.
					 *
					 * WHY A RECEIPT SILENCES THIS LINE: the receipt IS the backend's own
					 * sentence about the default it wrote ("Set default hosting to
					 * 'openrouter', model to 'anthropic/claude-opus-5.5'"), so anything the app
					 * adds is the same fact twice. The guard here used to compare the model's
					 * DISPLAY name against that sentence, which carries the model's ID, so it
					 * never matched and the pane printed both (UX rounds 3 and 4, U12 then
					 * U17). An older backend sends no receipt and no sentence, and then this
					 * line is the only thing that names the default.
					 */}
					{!defaults.receipt && defaults.model_name ? (
						<>
							{t("ui.providers.provider_detail.default_model")}{" "}
							<span className="text-ink">{defaults.model_name}</span>.
						</>
					) : null}
					{onChangeModel ? (
						<>
							{" "}
							<Button variant="link" size="sm" onClick={onChangeModel}>
								{t("ui.providers.provider_detail.change")}
							</Button>
						</>
					) : null}
				</p>
			) : null}
			{/*
			 * A receipt with no hosting is a change that did NOT happen: on an older
			 * backend the sign-in writes a credential and leaves the default alone, so
			 * saying so is the difference between "nothing happened" and "your model
			 * is unchanged" (code round 1, m5).
			 */}
			{defaults && !defaults.hosting && defaults.receipt ? (
				<p className="text-body-sm text-ink-muted">
					{t("ui.providers.provider_detail.your_default_model_is_unchanged")}
				</p>
			) : null}
			{unverified ? (
				<p
					className={
						tone === "unchecked"
							? "text-body-sm text-ink-muted"
							: "text-ink-dim text-meta"
					}
				>
					{t("ui.providers.provider_detail.saved_but_not_checked_yet")}
					{unverified}
				</p>
			) : null}
			<div>
				<Button
					ref={actionRef}
					variant={primaryAction ? "primary" : "secondary"}
					size="sm"
					onClick={onAction}
				>
					{actionLabel}
				</Button>
			</div>
		</div>
	);
};

export const ProviderDetail: FC<ProviderDetailProps> = ({
	provider,
	onConnected,
	onDone,
	onChangeModel,
	context = "settings",
	readiness: readinessProp,
}) => {
	useI18nLocale();
	const queryClient = useQueryClient();
	/*
	 * The verdict on this machine's Radient sign-in. This panel rendered its
	 * "Signed in" badge from `provider.configured` alone, which is a fact about
	 * the credential store: a revoked grant kept the row, kept that flag, and
	 * left the panel telling the user they were signed in while the sentence
	 * directly above it said they were not (UX U1). Called before the panel's
	 * early returns, so the hook order is the same for every provider.
	 *
	 * `retryOnMount: false` for the reason the account read below carries it, on
	 * the other key (QA round 3, Q-8): this panel REPORTS the verdict its host
	 * (the grid, or the account section's sign-in block) already reads, and with
	 * the default a panel mounting on a FAILED, data-less verdict re-commissioned
	 * it. Every card press on a failing `GET /v1/auth/status` became a loop -
	 * measured at 1,579 requests in 20 s and a grid stuck on "Loading providers" -
	 * because the grid's hold unmounted this panel for each re-read and its
	 * remount started the next. See `RadientLoginVerdictOptions` for the
	 * mechanism, and `useRadientAuthStatus`'s `settling` for the gate's half.
	 */
	const login = useRadientLoginVerdict({ retryOnMount: false });
	/**
	 * The app's own answer about whether a Radient sign-in is stored, and whether
	 * it could be asked at all (see `loginState`; design round 1's D3 is why the
	 * chip may not fall back to the credential row when the verdict is absent).
	 *
	 * `retryOnMount: false` IS THE FIX FOR THE ONE REGRESSION THIS PR CAUSED, and
	 * it is here rather than in the hook because it is a property of THIS caller:
	 * the panel REPORTS this read, it does not own it. Round 2 measured what an
	 * owning observer costs when it lives inside a subtree the read's own loading
	 * state unmounts (design D7, QA Q-5, one defect from two rigs):
	 *
	 *   the account section early-returns its spinner for `isLoading`, which is
	 *   true again the moment any observer starts a read; the sign-in block it
	 *   hides contains this panel, so this panel is unmounted by the very read it
	 *   is watching. React Query re-runs a FAILED, data-less query when a new
	 *   observer mounts on it (`@tanstack/query-core@5.73.3`
	 *   `shouldLoadOnMount`, `retryOnMount` default true), so the sequence is:
	 *   read fails / the section renders its content / this panel mounts / the
	 *   mount re-commissions the read / the section spins again / this panel is
	 *   unmounted / repeat. Measured on the real composition (settings section +
	 *   its sign-in block) in this repo's jsdom harness: 14 account reads in 14 s,
	 *   the section never leaving the spinner, `status: pending`,
	 *   `fetchStatus: fetching`, `failureCount: 2` -- the same shape QA read off
	 *   the live app (54 reads a boot, ~1/s) and design read off its own rig
	 *   (39 in 30 s on this head against 4 on `origin/main`). With this option the
	 *   same composition settles in one read and renders the sentence, the chip
	 *   and the sign-in control.
	 *
	 * WHAT WAS RULED OUT, because the leading hypothesis was the other one: the
	 * hook's options are written inline (`queryKey: radientUserKeys.user()`, an
	 * inline `retry`), and a fresh options object per render was the suspect. It is
	 * not the cause. Ten forced re-renders of an errored observer whose `queryKey`
	 * array and `retry` function are rebuilt every render start ZERO further reads
	 * (React Query hashes the key by value and only compares options), and hoisting
	 * `retry` to module scope AND pinning the key to one module-level array leaves
	 * the loop at exactly 14 reads in 14 s. Only the mount is load-bearing, which
	 * is why the fix is one option on this call and not a rewrite of the hook.
	 */
	const { accountRead, unavailable } = useRadientUserQuery({
		retryOnMount: false,
	});
	/**
	 * The badge's own words, from the same predicate the grid's cards use, so one
	 * credential cannot be called two things on one screen -- including the
	 * WITHHELD answer (`null`, design round 4's D12): while no read that can
	 * support a claim has answered, the grid's card shows none and neither does
	 * this badge.
	 */
	const claim = loginClaim(provider.id, login, { accountRead, unavailable });
	/*
	 * The claim THIS panel may make: the surrounding surface's verdict when it has
	 * one, and this panel's own read otherwise (see the `readiness` prop). It is used
	 * to state a refusal the row above is stating, in the panel's own words, and NOT
	 * as a badge: the badge was the same sentence 40 px below the row that already
	 * said it (UX round 4, U16; design round 4, D15).
	 */
	const readiness =
		readinessProp !== undefined
			? readinessProp
			: claim === null
				? null
				: providerReadiness(provider, claim);
	const [methodId, setMethodId] = useState<string | null>(null);
	const [keyValue, setKeyValue] = useState("");
	const [keySaving, setKeySaving] = useState(false);
	const [keyError, setKeyError] = useState<string | null>(
		() => peekKeyOutcome(provider.id).error,
	);
	const [keySaved, setKeySaved] = useState<SaveKeyResult | null>(
		() => peekKeyOutcome(provider.id).saved,
	);
	/*
	 * Every write goes through here as well as through React state, so the panel that
	 * mounts after the save (the row moves into "Connected", which remounts it) finds
	 * the receipt instead of an invitation to paste the key again. Same cause, same
	 * fix as the flow itself: QA round 2 R2-Q1, UX round 2 U3.
	 */
	const rememberKey = useCallback(
		(next: { saved?: SaveKeyResult | null; error?: string | null }) => {
			if ("saved" in next) setKeySaved(next.saved ?? null);
			if ("error" in next) setKeyError(next.error ?? null);
			setKeyOutcome(provider.id, next);
		},
		[provider.id],
	);
	const [promptValue, setPromptValue] = useState("");
	const [promptError, setPromptError] = useState<string | null>(null);
	const brand = brandOf(provider);

	// Resolved by METHOD identity, not provider id: a provider can offer several
	// methods that all act on the same provider (D2 of the earlier round).
	const method: ProviderMethod | null =
		provider.auth_methods.find(
			(candidate) => candidate.method_id === methodId,
		) ?? primaryMethod(provider.auth_methods);

	const refreshProviders = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: desktopKeys.providers });
		/*
		 * The CATALOGUE is dropped at the same moment, and that is the point of this
		 * line rather than a tidy-up: the models a provider offers are a function of
		 * the credential, so a listing fetched before a sign-in is exactly the one
		 * that cannot hold whatever the account just unlocked — the operator's report
		 * is a model released since lop's last build being absent from the picker
		 * after a successful sign-in.
		 *
		 * The backend already drops its cached listing documents when a credential
		 * changes (`providers/controller._invalidate_cached_listing`), so nothing has
		 * to be re-listed here; what is missing without this line is the RENDERER
		 * forgetting its own copy. `desktopKeys.catalogue` is the prefix both of the
		 * picker's keys sit under, so one call drops the registry document and the
		 * live one together — the next open re-reads both.
		 *
		 * This runs on every credential write this panel performs (the polling loop's
		 * success and the API-key save), which is deliberate: each of them is the
		 * same event as far as the catalogue is concerned.
		 */
		void queryClient.invalidateQueries({ queryKey: desktopKeys.catalogue });
		/*
		 * THE ACCOUNT READ, when the credential that just landed is Radient's own.
		 *
		 * WHY IT MUST BE HERE AT ALL: every surface that completes a Radient
		 * sign-in funnels through this callback - the settings grid's Radient row,
		 * the connect dialog and the onboarding step all render this same panel,
		 * and `RadientAuthButtons` renders it for the account section and the
		 * upload dialog. Before this branch none of those wrote to
		 * `radientUserKeys` from here: only `RadientAuthButtons`' own `onConnected`
		 * (which its two surfaces reach through `onConnected` below) invalidated
		 * the key, and the grid, connect dialog and onboarding step have no such
		 * callback - so the re-read waited for something else to mount an observer
		 * on the failed query. That is the operator's report: after a re-sign-in
		 * the sidebar foot still read "Account unavailable", and it healed only
		 * when a later Settings visit happened to mount a new observer.
		 *
		 * WHY THE GATE, when the four invalidations around it are unconditional:
		 * their input is "any credential", the account read's input is the RADIENT
		 * credential alone. A write to any other provider cannot change who the
		 * account is, and re-asking anyway would make the foot say "Checking
		 * account…" about a fact nothing touched.
		 *
		 * WHAT THE CALL DOES: `commissionAccountRead` clears the class the write
		 * just falsified and CANCELS any pre-write chain before invalidating -
		 * without the cancel, an invalidation JOINS a data-less chain still in
		 * flight and re-asks nothing, and the abandoned chain's late settle would
		 * re-record the stale class (review round 1, M1; both are measured in
		 * `scripts/settings-account-gate.test.mjs`). The full reasoning lives on
		 * the function's own docblock. `RadientAuthButtons`' own `onConnected`
		 * invalidation, reached through `onConnected?.()` below, stays and is
		 * idempotent with this one.
		 */
		if (provider.id === "radient") {
			void commissionAccountRead(queryClient);
		}
		/*
		 * AND THE CONFIG: a sign-in can write the default model, and the composer,
		 * the model settings, the empty-chat card and the composer's model chip all
		 * read it from there. The two invalidations answer two different questions
		 * about one event -- what this account can offer, and what the app now uses --
		 * so neither replaces the other.
		 */
		void queryClient.invalidateQueries({ queryKey: ["config"] });
		/*
		 * And the VERDICT, whose query is what the claim actually reads (code round
		 * 2, M3). It sits AFTER the catalogue line rather than between the two
		 * above, because `scripts/picker-feedback.test.mjs` pins the providers and
		 * catalogue invalidations within a bounded distance of each other, and a
		 * comment this long between them breaks that pin. Without this a sign-in that
		 * just succeeded from this panel left the row and this panel saying "Needs
		 * re-authentication" until the 60 s poll or a window focus -- the user who
		 * fixed the fault was told it was still broken, on the surface that had just
		 * fixed it. Reproduced with this PR's harness: refused / press the row /
		 * `auth.status` answers `succeeded` (verdict `ok`) / back to providers, and
		 * the row still read "Needs re-authentication" with the verdict request count
		 * unchanged at 1 and `{credential_id: 7, state: "login_required"}` still in
		 * the cache.
		 */
		void queryClient.invalidateQueries({ queryKey: radientSessionIssueKey });
		onConnected?.();
	}, [queryClient, onConnected, provider.id]);

	/*
	 * The default this Local Operator writes ITSELF -- and only in ONE case.
	 *
	 * WHY IT EXISTS: a released backend applies no defaults on a connect (it has no
	 * `defaults_applied` field at all), so setup finished with no `hosting` and the
	 * first message failed on whatever stale model the backend's own default named
	 * (UX round 2 U1: a DeepSeek key, a 404 on `gemini-2.0-flash-001`). The UI can
	 * write what it can see: the provider that just connected and a model its own
	 * catalogue lists for it.
	 *
	 * AND ONLY THEN, because the first cut of this wrote when it should not have:
	 *
	 * - `defaults_applied` PRESENT means the backend answered -- an object when it
	 *   applied something, `null` with a receipt when it deliberately applied nothing
	 *   (TypeSafe is decision-only: "Nothing changed - pick a chat model with /model
	 *   first"). Both are the backend's answer, so the only signal to adopt on is the
	 *   field being ABSENT (review round 3 R3-M1).
	 * - A `hosting` already in the config is a working choice, and it is not this
	 *   panel's to move: the first cut read `config.get`'s result at the wrong LEVEL
	 *   (`hosting` sits under `values`), so that guard never fired and connecting a
	 *   second provider silently replaced a working default with a pair that could
	 *   not run (QA round 3 Q3-2, UX round 3 U11).
	 * - A provider this Local Operator cannot list a model for gets NOTHING written,
	 *   not even `hosting` on its own.
	 */
	const updateConfig = useUpdateConfig();
	const adoptDefault = useCallback(
		async (
			connected: string,
			applied: DefaultsApplied | null | undefined,
			suggestedModelId?: string | null,
		) => {
			/*
			 * The readings are refreshed on EVERY connect, before any early return:
			 * the chat's model chip reads a SESSION PREVIEW rather than the config, so
			 * a connect that left the chip saying "Choose a model" for thirty seconds
			 * (UX round 3 U10) is not repaired by the config invalidation alone.
			 */
			const refreshReadings = async () => {
				await queryClient.invalidateQueries({ queryKey: ["config"] });
				await queryClient.invalidateQueries({
					queryKey: ["desktop", "session-preview"],
				});
			};
			try {
				if (applied !== undefined) {
					await refreshReadings();
					return;
				}
				const current = await desktopResult<{
					values?: { hosting?: string | null };
				}>({ op: "config.get" });
				await refreshReadings();
				if (current?.values?.hosting) return;
				let models = getModelsForHostingProvider(connected);
				if (models.length === 0) {
					/*
					 * ASK BEFORE WRITING. Nothing had loaded the catalogue on the dialog's
					 * connect path, so a UI default written here named a provider with no
					 * model beside it -- and the user's first message then failed on the
					 * backend's own stale model (UX round 3 U1's remaining half). One
					 * fetch, then the same rule: no model this Local Operator can see, no
					 * write.
					 */
					await useModelsStore.getState().fetchModels(apiConfig.baseUrl, true);
					models = getModelsForHostingProvider(connected);
				}
				if (models.length === 0) return;
				/*
				 * The model, in preference order: what the backend suggests for this
				 * provider, then what the catalogue marks recommended, then the first
				 * row -- which for an aggregator is whatever the listing happens to
				 * start with (review round 3 R3-m5).
				 */
				const preferred =
					(suggestedModelId || "").trim() ||
					models.find((model) => model.recommended)?.id ||
					models[0].id;
				await updateConfig.mutateAsync({
					hosting: connected,
					model_name: preferred,
				});
				await refreshReadings();
			} catch {
				/*
				 * A backend that refuses the write leaves the user where they were,
				 * and the ways out are still on screen: the status line's Connect, the
				 * empty-chat card and the chip all lead back here.
				 */
			}
		},
		[queryClient, updateConfig],
	);
	const adoptDefaultRef = useRef(adoptDefault);
	adoptDefaultRef.current = adoptDefault;

	const onConnectedRef = useRef(refreshProviders);
	onConnectedRef.current = refreshProviders;

	/*
	 * The flow lives in a per-provider session rather than in this component
	 * (sign-in-sessions.ts): the row this panel is rendered on MOVES into
	 * "Connected" the moment a credential lands, which remounts this panel -- and
	 * a flow owned by the panel went back to idle with it, so a user who had just
	 * signed in was invited to do it again and never saw the receipt (QA round 1
	 * Q1, UX U3). Attaching instead also resumes an operation that is still
	 * running when the panel comes back (UX U4).
	 */
	const { flow: flowHandle, state: flow } = useSignInSession(
		provider.id,
		() => ({
			start: (id: string) =>
				desktopResult<AuthOperation>({ op: "auth.start", provider: id }),
			read: (id: string) =>
				desktopResult<AuthOperation>({ op: "auth.status", id }),
			cancel: (id: string) => desktopResult({ op: "auth.cancel", id }),
			// Main opens the operation's CURRENT url and never takes one from the
			// renderer, so a compromised render path cannot turn this into a general
			// link opener; it also dedups the same operation and url.
			open: (id: string, reopen: boolean) => openAuthorization(id, reopen),
			poll: pollAuthOperation,
			onSucceeded: (operation) => {
				onConnectedRef.current();
				void adoptDefaultRef.current(
					provider.id,
					operation.defaults_applied,
					provider.suggested_model?.id,
				);
			},
		}),
	);

	/*
	 * A panel reused for ANOTHER provider starts clean -- and ONLY the panel's own
	 * state does.
	 *
	 * The FLOW is not reset here, and that is the point of this comment: the
	 * round-2 fix made this effect skip its first run, which stopped it wiping the
	 * receipt the session had just kept, but the branch could not be reached at all
	 * -- both callers key the panel per provider, and a probe that reused one
	 * instance found the reset hitting the WRONG provider's session (it reset
	 * Anthropic's running flow, cleared OpenAI's key outcome, and then ran OpenAI's
	 * Start through Anthropic's flow: review round 3 R3-m1). The session hook now
	 * follows the id itself, so what is left for this effect is the state that
	 * belongs to the panel rather than to a provider: the chosen method, the field,
	 * and the key outcome shown -- which is re-read from the NEW provider's session.
	 */
	const previousProviderId = useRef<string | null>(null);
	useEffect(() => {
		const moved = previousProviderId.current !== null;
		const changed = previousProviderId.current !== provider.id;
		previousProviderId.current = provider.id;
		if (!(moved && changed)) return;
		setMethodId(null);
		setKeyValue("");
		setKeyError(peekKeyOutcome(provider.id).error);
		setKeySaved(peekKeyOutcome(provider.id).saved);
	}, [provider.id]);

	const chooseMethod = (next: string) => {
		setMethodId(next);
		rememberKey({ error: null });
		setKeySaved(null);
		flowHandle.reset();
	};

	const submitPrompt = useCallback(async () => {
		const operation = flow.operation;
		if (!operation?.prompt_id || !promptValue) return;
		setPromptError(null);
		try {
			await desktopResult({
				op: "auth.input",
				id: operation.id,
				promptId: operation.prompt_id,
				value: promptValue,
			});
			// Ephemeral by contract: the pasted code clears here and never enters
			// state that could land in a transcript, log or persisted store.
			setPromptValue("");
		} catch (error) {
			setPromptError(
				error instanceof Error
					? error.message
					: t("ui.providers.provider_detail.the_code_was_not_accepted"),
			);
		}
	}, [flow.operation, promptValue]);

	const saveKey = useCallback(async () => {
		if (!method || !keyValue.trim()) return;
		setKeySaving(true);
		rememberKey({ error: null });
		try {
			const result =
				(await desktopResult<SaveKeyResult | null>({
					op: "auth.key",
					provider: method.id,
					value: keyValue.trim(),
				})) ?? {};
			setKeyValue("");
			rememberKey({ saved: result });
			refreshProviders();
			void adoptDefaultRef.current(
				provider.id,
				result?.defaults_applied,
				provider.suggested_model?.id,
			);
		} catch (error) {
			// A 422 is the backend refusing THIS key (validation, or a provider
			// with no key route), and its sentence belongs under the field.
			// Anything else is also shown there: the field is what the user
			// acts on next either way.
			rememberKey({
				error:
					error instanceof DesktopControlError || error instanceof Error
						? error.message
						: t("ui.providers.provider_detail.the_key_could_not_be_saved"),
			});
		} finally {
			setKeySaving(false);
		}
	}, [
		method,
		keyValue,
		refreshProviders,
		rememberKey,
		provider.id,
		provider.suggested_model?.id,
	]);

	const doneLabel =
		context === "dialog"
			? t("ui.providers.provider_detail.continue")
			: t("ui.providers.provider_detail.done");
	const finish = () => {
		clearKeyOutcome(provider.id);
		setKeySaved(null);
		flowHandle.reset();
		onDone?.();
	};

	if (provider.local) {
		return (
			<div className="flex flex-col gap-3">
				<p className="text-body-sm text-ink-muted">
					{t("ui.providers.provider_detail.runs_on_this_computer_and_needs_no")}
					{brand}
					{t("ui.providers.provider_detail.then_check_the_connection")}
				</p>
				<LocalProviderReachability provider={provider} />
			</div>
		);
	}

	if (!method) {
		return (
			<Alert variant="warning">
				{t(
					"ui.providers.provider_detail.this_provider_has_no_supported_sign_in",
				)}
			</Alert>
		);
	}

	const apiKeyMethod = provider.auth_methods.find(
		(candidate) => candidate.kind === "api_key",
	);
	const operation = flow.operation;
	const keyHelpId = `key-help-${provider.id}`;

	/*
	 * Hidden once the flow is settled. A finished sign-in with "Claude
	 * subscription | API key" still above it invites a method switch on a result
	 * the user is done with, and in the unfinished states the tabs duplicate the
	 * "Use an API key instead" action right below them (design round 1, D4).
	 */
	const methodTabs =
		provider.auth_methods.length > 1 && flow.phase !== "settled" ? (
			<Tabs value={method.method_id} onValueChange={chooseMethod}>
				<TabsList aria-label={t("ui.providers.provider_detail.how_to_connect")}>
					{provider.auth_methods.map((candidate) => (
						<TabsTrigger key={candidate.method_id} value={candidate.method_id}>
							{methodName(candidate)}
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>
		) : null;

	/* ------------------------------------------------------------ API key */
	if (method.kind === "api_key") {
		if (keySaved) {
			return (
				<div className="flex flex-col gap-4">
					{methodTabs}
					<SignedIn
						brand={brand}
						verb="Connected"
						defaults={keySaved.defaults_applied}
						/*
						 * `valid: true` is the only verified answer. `null` is the backend
						 * saying it could not check, and ABSENT is a released backend that
						 * checks nothing at all and answers `{}` -- treating that as success
						 * printed "Radient connected" for a fabricated key (code round 1
						 * Q6, UX U1).
						 */
						unverified={
							keySaved.valid === true
								? null
								: (keySaved.reason ??
									t(
										"ui.providers.provider_detail.this_local_operator_does_not_check_keys",
									))
						}
						tone={keySaved.valid === true ? "success" : "unchecked"}
						headline={
							keySaved.valid === true
								? undefined
								: t("ui.providers.provider_detail.key_saved", { brand })
						}
						onChangeModel={onChangeModel}
						actionLabel={doneLabel}
						onAction={finish}
						primaryAction={context === "dialog"}
						/*
						 * THE SAME VERDICT AS THE FLOW'S SUCCESS VIEW (review round 6, minor).
						 * Radient offers an API key as well as a browser sign-in, so this
						 * branch can render under a credential the provider has stopped
						 * accepting -- and with no verdict it printed "Radient connected" over a
						 * row saying otherwise: U19's contradiction, one route over.
						 */
						verdict={readiness}
					/>
				</div>
			);
		}
		return (
			<div className="flex flex-col gap-4">
				{methodTabs}
				<div className="flex flex-col gap-2" data-sign-in-state="api-key">
					<Label htmlFor={`key-${provider.id}`}>
						{t("ui.providers.provider_catalog.api_key")}
					</Label>
					<SecretInput
						id={`key-${provider.id}`}
						value={keyValue}
						onChange={(next) => {
							setKeyValue(next);
							rememberKey({ error: null });
						}}
						label={t("ui.providers.provider_detail.api_key_variant_215", {
							brand,
						})}
						invalid={keyError !== null}
						describedBy={keyHelpId}
					/>
					<p
						id={keyHelpId}
						className={
							keyError ? "text-danger text-meta" : "text-ink-dim text-meta"
						}
						role={keyError ? "alert" : undefined}
					>
						{keyError ??
							(provider.has_credential
								? t("ui.providers.provider_detail.a_key_is_saved_paste_a_new", {
										brand,
									})
								: t(
										"ui.providers.provider_detail.stored_encrypted_on_this_computer_billed_per",
										{ brand },
									))}
					</p>
					<div>
						<Button
							variant="primary"
							size="sm"
							disabled={!keyValue.trim() || keySaving}
							onClick={() => void saveKey()}
						>
							{keySaving ? <Spinner size="sm" /> : null}
							{keySaving
								? t("ui.providers.provider_detail.checking_key")
								: t("ui.providers.provider_detail.save_key")}
						</Button>
					</div>
				</div>
			</div>
		);
	}

	/* ----------------------------------------------- browser / device flows */
	const start = () => void flowHandle.start(method.id);
	/*
	 * `auth_url` ONLY. `launch_url` is the loopback `/launch` alias the backend
	 * reports for EVERY callback flow (measured on #1507: `localhost:54549`), so
	 * preferring it named a port as the provider in the waiting sentence and in
	 * the paste label (code round 1 M1, UX N2).
	 */
	const host = hostOf(operation?.auth_url);
	const deviceCode = operation ? deviceCodeOf(operation) : null;
	const minutes = operation ? minutesLeft(operation.expires_in) : null;
	/*
	 * Is the paste box the flow itself, or a fallback? A newer backend says so
	 * (`input_optional`); on an older one a method whose registry entry offers a
	 * paste FALLBACK (`paste_fallback`, Anthropic) is optional, and one that
	 * requires the paste is not.
	 */
	const pasteIsFallback =
		operation?.input_optional ??
		(method.paste_fallback && !method.requires_secret_input);

	let body: ReactNode;
	if (flow.phase === "idle") {
		body = (
			<div
				className="flex flex-col items-start gap-3"
				data-sign-in-state="idle"
			>
				{provider.configured && readiness?.group === "Needs sign-in" ? (
					/*
					 * THE ROW'S VERDICT, SAID ONCE MORE WHERE THE CONTROLS ARE. This
					 * provider is in the Connected list (`has_credential || configured`),
					 * and a grant the provider has stopped accepting keeps both flags --
					 * so without this the row said "Needs sign-in" and the panel offered a
					 * frictionless "Continue in browser" as if it were ready (QA round 4,
					 * Q4-2). The sentence is the row's own detail, so the two surfaces
					 * spell one verdict one way.
					 */
					<Alert
						variant={readiness.tone === "attention" ? "warning" : "neutral"}
					>
						<AlertTitle>{readiness.label}</AlertTitle>
						<AlertDescription>
							{readiness.detail ??
								t(
									"ui.providers.provider_detail.is_no_longer_accepting_the_sign_in",
									{ brand },
								)}
						</AlertDescription>
					</Alert>
				) : null}
				<p className="text-body-sm text-ink-muted">
					{methodBlurb(method, provider)}{" "}
					{method.kind === "device"
						? t("ui.providers.provider_detail.you_ll_get_a_code_to_enter")
						: t("ui.providers.provider_detail.it_opens_in_your_browser")}
				</p>
				<div className="flex items-center gap-2">
					<Button variant="primary" size="sm" onClick={start}>
						{method.kind === "device"
							? t("ui.providers.provider_detail.get_a_sign_in_code")
							: t("ui.providers.provider_detail.continue_in_browser")}
						{method.kind === "device" ? null : (
							<ExternalLink aria-hidden="true" />
						)}
					</Button>
				</div>
			</div>
		);
	} else if (
		flow.phase === "starting" ||
		(flow.phase === "active" &&
			operation &&
			!operation.auth_url &&
			!deviceCode &&
			/*
			 * A flow that NEEDS a paste can ask for it before it has any URL at
			 * all: QwenCloud's Token Plan wants the key first. Without this
			 * clause the panel sat on "Getting a code" with no field to type in
			 * and no way to finish the sign-in (QA round 1 Q2).
			 */
			!(operation.input_required && !pasteIsFallback))
	) {
		body = (
			<div className="flex items-center gap-3" data-sign-in-state="starting">
				<Spinner size="sm" />
				<output className="text-body-sm text-ink-muted">
					{method.kind === "device"
						? t("ui.providers.provider_detail.getting_a_code")
						: t("ui.providers.provider_detail.opening_your_browser")}
				</output>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => void flowHandle.cancel()}
				>
					{t("ui.providers.provider_detail.cancel")}
				</Button>
			</div>
		);
	} else if (flow.phase === "active" && operation && deviceCode) {
		const page = operation.auth_url;
		body = (
			<div
				className="flex flex-col items-start gap-3"
				data-sign-in-state="device-code"
			>
				{/* Instructions carry the host's privacy/billing disclosure. Device
				 * flows must not drop it or auto-open; React renders it as plain text
				 * and the existing Copy action remains the explicit browser handoff. */}
				<p className="whitespace-pre-line text-body-sm text-ink-muted">
					{operation.instructions?.trim() || (
						<>
							{t("ui.providers.provider_detail.enter_this_code")}
							{host
								? t("ui.providers.provider_detail.at_variant_248", {
										host,
									})
								: t("ui.providers.provider_detail.on_the_sign_in_page")}
							{t(
								"ui.providers.provider_detail.this_page_updates_on_its_own_once",
							)}
						</>
					)}
				</p>
				<div className="flex items-center gap-3 rounded-md bg-sunken p-3">
					<code className="font-mono text-ink text-title tracking-wider">
						{deviceCode}
					</code>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<CopyButton
						value={deviceCode}
						label={
							page
								? t("ui.providers.provider_detail.copy_code_and_open_page")
								: t("ui.providers.provider_detail.copy_code")
						}
						variant="primary"
						onCopied={() => {
							if (page) void flowHandle.reopen();
						}}
					/>
					{page ? (
						/* The copy-chained handoff must not be the ONLY route to the
						 * approval page: a refused clipboard write (permission policy,
						 * inactive document) leaves the user holding a code they can
						 * hand-copy with nowhere to enter it (UX round 1, U1). A plain
						 * reopen beside it, same shape as the paste-required and waiting
						 * panels' own; pressing it is still an explicit act, so nothing
						 * auto-opens on arrival. */
						<Button
							variant="secondary"
							size="sm"
							onClick={() => void flowHandle.reopen()}
						>
							<ExternalLink aria-hidden="true" />
							{flow.opened
								? t("ui.providers.provider_detail.open_browser_again")
								: t("ui.providers.provider_detail.open_sign_in_page")}
						</Button>
					) : null}
					<Button
						variant="ghost"
						size="sm"
						onClick={() => void flowHandle.cancel()}
					>
						{t("ui.providers.provider_detail.cancel")}
					</Button>
				</div>
				{minutes ? (
					<p className="text-ink-dim text-meta">
						{t("ui.providers.provider_detail.code_expiry", { minutes })}
					</p>
				) : null}
			</div>
		);
	} else if (flow.phase === "active" && operation) {
		/*
		 * Built once, placed by whichever state owns it: the paste-required panel
		 * makes its Continue the PRIMARY action (the field is the only way forward
		 * there, design round 1 D10) while the waiting panel's disclosure keeps it
		 * secondary, because the browser is still the flow in that state.
		 */
		const pasteField = (primary: boolean) =>
			operation.input_required ? (
				<div className="flex flex-col gap-2">
					<Label htmlFor={`prompt-${operation.id}`}>
						{host
							? t("ui.providers.provider_detail.code_from", { host })
							: t("ui.providers.provider_detail.code_from_the_sign_in_page")}
					</Label>
					<div className="flex items-start gap-2">
						<div className="flex-1">
							<SecretInput
								id={`prompt-${operation.id}`}
								value={promptValue}
								onChange={(next) => {
									setPromptValue(next);
									setPromptError(null);
								}}
								label={t("ui.providers.provider_detail.sign_in_code")}
								invalid={promptError !== null}
							/>
						</div>
						<Button
							variant={primary ? "primary" : "secondary"}
							size="md"
							disabled={!promptValue}
							onClick={() => void submitPrompt()}
						>
							{t("ui.providers.provider_detail.continue")}
						</Button>
					</div>
					{promptError ? (
						<p className="text-danger text-meta" role="alert">
							{promptError}
						</p>
					) : null}
				</div>
			) : null;

		if (operation.input_required && !pasteIsFallback) {
			// The paste IS the flow: the field is the headline, open.
			body = (
				<div
					className="flex flex-col items-start gap-3"
					data-sign-in-state="paste-required"
				>
					<p className="text-body text-ink">
						{t("ui.providers.provider_detail.paste_the_code")}
						{host ?? t("ui.providers.provider_detail.the_provider")}{" "}
						{t("ui.providers.provider_detail.shows_after_you_approve")}
					</p>
					<div className="w-full">{pasteField(true)}</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							variant="secondary"
							size="sm"
							onClick={() => void flowHandle.reopen()}
						>
							<ExternalLink aria-hidden="true" />
							{flow.opened
								? t("ui.providers.provider_detail.open_browser_again")
								: t("ui.providers.provider_detail.open_sign_in_page")}
						</Button>
						{operation.auth_url ? (
							<CopyButton
								value={operation.auth_url}
								label={t("ui.providers.provider_detail.copy_link")}
							/>
						) : null}
						<Button
							variant="ghost"
							size="sm"
							onClick={() => void flowHandle.cancel()}
						>
							{t("ui.providers.provider_detail.cancel")}
						</Button>
					</div>
				</div>
			);
		} else {
			body = (
				<div
					className="flex flex-col items-start gap-3"
					data-sign-in-state="waiting"
				>
					<div className="flex items-center gap-2">
						<Spinner size="sm" />
						<output className="text-body text-ink">
							{t(
								"ui.providers.provider_detail.finish_signing_in_with_your_browser",
							)}
						</output>
					</div>
					<p className="text-body-sm text-ink-muted">
						{flow.opened
							? t(
									"ui.providers.provider_detail.we_opened_approve_access_there_and_this",
									{
										host:
											host ??
											t("ui.providers.provider_detail.the_sign_in_page"),
									},
								)
							: flow.openFailed
								? t(
										"ui.providers.provider_detail.your_browser_didn_t_open_open_the",
									)
								: t(
										"ui.providers.provider_detail.opening_approve_access_there_and_this_page",
										{
											host:
												host ??
												t("ui.providers.provider_detail.the_sign_in_page"),
										},
									)}
					</p>
					<div className="flex flex-wrap items-center gap-2">
						{/* "Open again" only once something opened: a Reopen for a page
						    that never opened is the lie design D2 photographed. */}
						<Button
							variant="secondary"
							size="sm"
							onClick={() => void flowHandle.reopen()}
						>
							<ExternalLink aria-hidden="true" />
							{flow.opened
								? t("ui.providers.provider_detail.open_browser_again")
								: t("ui.providers.provider_detail.open_sign_in_page")}
						</Button>
						{operation.auth_url ? (
							<CopyButton
								value={operation.auth_url}
								label={t("ui.providers.provider_detail.copy_link")}
							/>
						) : null}
						<Button
							variant="ghost"
							size="sm"
							onClick={() => void flowHandle.cancel()}
						>
							{t("ui.providers.provider_detail.cancel")}
						</Button>
					</div>
					{minutes ? (
						<p className="text-ink-dim text-meta">
							{t("ui.providers.provider_detail.link_expiry", { minutes })}
						</p>
					) : null}
					{/*
					 * `input_required` is the predicate, NOT `pasteField`: `pasteField` is a
					 * function and a function is always truthy, so guarding on it put an
					 * empty "Browser showed a code?" disclosure on every waiting flow --
					 * Radient, OpenAI's browser flow and Z.AI among them -- and made the
					 * three waiting frames byte-identical to `panel-optional-paste`
					 * (review round 2 R2-M2, caught from the committed frames).
					 */}
					{operation.input_required ? (
						<Disclosure
							summary={t(
								"ui.providers.provider_detail.browser_showed_a_code_paste_it_here",
							)}
							className="w-full"
						>
							<div className="pt-2">{pasteField(false)}</div>
						</Disclosure>
					) : null}
				</div>
			);
		}
	} else if (flow.phase === "settled" && operation?.state === "succeeded") {
		body = (
			<SignedIn
				brand={brand}
				verb="Signed in to"
				defaults={operation.defaults_applied}
				// Recovery copy belongs to this successful Radient operation only;
				// a generic message can contain provider diagnostics, not this receipt.
				retainedNotice={
					provider.id === "radient" && operation.provider === "radient"
						? operation.retained_notice
						: undefined
				}
				onChangeModel={onChangeModel}
				// A completed OAuth operation is not a working grant. The refused
				// Radient row still needs the existing re-auth flow; Done alone
				// stranded the phone block on "sign in, then check again".
				actionLabel={
					provider.id === "radient" && readiness?.group === "Needs sign-in"
						? "Sign in again"
						: doneLabel
				}
				onAction={
					provider.id === "radient" && readiness?.group === "Needs sign-in"
						? start
						: finish
				}
				primaryAction={context === "dialog"}
				/*
				 * THE SURFACE'S VERDICT, and this is the branch U19 was about: a settled
				 * operation renders here whether or not the provider still accepts its
				 * grant, so without this the panel said "Signed in to Radient" over a row
				 * saying the sign-in was refused or unconfirmed.
				 */
				verdict={readiness}
			/>
		);
	} else {
		// Failed, expired, cancelled by another window, or a refused start.
		const message = operation
			? unfinishedMessage(operation, brand)
			: (flow.error ??
				t("ui.providers.provider_detail.didn_t_confirm_the_sign_in", {
					brand,
				}));
		body = (
			<div className="flex flex-col gap-3" data-sign-in-state="unfinished">
				<Alert
					variant={operation?.state === "cancelled" ? "neutral" : "warning"}
				>
					<AlertTitle>
						{t("ui.providers.provider_detail.sign_in_didn_t_finish")}
					</AlertTitle>
					<AlertDescription>{message}</AlertDescription>
				</Alert>
				<div className="flex flex-wrap items-center gap-2">
					<Button variant="secondary" size="sm" onClick={start}>
						<RotateCcw aria-hidden="true" />
						{t("ui.providers.provider_detail.try_again")}
					</Button>
					{apiKeyMethod ? (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => chooseMethod(apiKeyMethod.method_id)}
						>
							{t("ui.providers.provider_detail.use_an_api_key_instead")}
						</Button>
					) : null}
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			{methodTabs}
			{body}
			{/*
			 * PHONE ACCESS, for the one provider whose login owns the phone tunnel.
			 * Rendered only with a stored Radient credential (the signed-out
			 * onboarding mount of this panel has none), and only when the backend
			 * advertises `tunnel_setup` - the block renders nothing and sends no
			 * request otherwise. This panel already carries the sign-in action, so the
			 * block is told not to offer a second one.
			 */}
			{provider.id === "radient" && provider.has_credential ? (
				<PhoneAccessBlock offerSignIn={false} />
			) : null}
		</div>
	);
};
