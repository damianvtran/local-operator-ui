/**
 * Amazon Bedrock's AWS panel: the structured connect form the generic API-key
 * panel cannot express.
 *
 * ## Why Bedrock gets its own panel
 *
 * Every other provider connects with ONE secret (`auth.key`) or ONE browser
 * flow (`auth.start`). A Bedrock connection is a method, a Region and, per
 * method, a profile name or up to three secrets - and AWS users arrive with
 * credentials in five different shapes (a Bedrock API key, a named profile, an
 * SSO / IAM Identity Center profile, an IAM access key pair, or whatever the
 * machine's default chain resolves). The backend therefore answers
 * `auth.start` for `bedrock` with 422 `bedrock_use_aws_panel` and serves four
 * `auth.bedrock.*` ops instead (bedrock design §7). This panel is their only
 * caller.
 *
 * ## Constraints
 *
 * - Rendered ONLY when the backend advertises `features.bedrock_auth`; without
 *   it `ProviderDetail` drops the `aws` method and the provider falls back to
 *   the plain API-key field, which every backend with a `bedrock` row serves.
 * - `auth.bedrock.context` never returns a credential value. Secrets live only
 *   in this component's state until `auth.bedrock.connect` sends them, and are
 *   cleared on every outcome, success or refusal.
 * - Validation happens on the backend before anything is stored: a 422 means
 *   NOTHING was saved, and its `code` picks the heading shown here while the
 *   backend's `text` (already localised there) is the body.
 * - SSO sign-in reuses the provider sign-in machinery (`useSignInSession`,
 *   `pollAuthOperation`): `auth.bedrock.ssoLogin` returns an ordinary
 *   `AuthOperation`, polled with `auth.status` and cancelled with `auth.cancel`.
 *   The session key is `bedrock-sso:<profile>` (`ssoSessionKey`), distinct
 *   from the provider's own, so an SSO refresh never collides with the
 *   provider-level flow registry, and one profile's run never shows on another.
 * - The rules (which profiles a tab lists, when secrets survive, what a failed
 *   Check is called) live in `bedrock-connect-model.ts`, tested in Node.
 * - Success is reported UP (`onConnected`), and `ProviderDetail` renders the
 *   same receipt view every other provider's saved key gets, so Bedrock's
 *   "connected" looks and behaves like everyone else's.
 */

import { pollAuthOperation } from "@shared/api/local-operator/auth-operation";
import {
	DesktopControlError,
	desktopResult,
	openAuthorization,
} from "@shared/api/local-operator/desktop-api";
import type { AuthOperation } from "@shared/api/local-operator/desktop-api";
import { CopyButton } from "@shared/components/common/copy-button";
import { Spinner } from "@shared/components/common/spinner";
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Badge,
	Button,
	Input,
	Label,
	Tabs,
	TabsList,
	TabsTrigger,
} from "@shared/components/ui";
import {
	type SearchableOption,
	SearchableSelect,
} from "@shared/components/ui/searchable-select";
import { formatList, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useQuery } from "@tanstack/react-query";
import type { FC, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
	BedrockAwsContext,
	BedrockCheckResult,
	BedrockConnectResult,
	BedrockConnection,
	BedrockProfile,
} from "../../../../shared/desktop-contract";
import {
	BEDROCK_METHODS,
	type BedrockMethod,
	accessKeyIdError,
	canConnect,
	checkResultFromError,
	checkVerdict,
	connectionInput,
	customRegionError,
	defaultMethod,
	isSsoProfile,
	keepsSecretsAfter,
	kindLabel,
	methodDescription,
	methodLabel,
	needsSignIn,
	normalizeRegion,
	outcomeUnknown,
	profilesFor,
	refusalTitle,
	regionHelp,
	sessionBadge,
	signInCommand,
	signInCopy,
	signInLabel,
	ssoSessionKey,
} from "./bedrock-connect-model";
import { deviceCodeOf } from "./provider-catalog";
import { SecretInput } from "./secret-input";
import { useSignInSession } from "./sign-in-sessions";

export type { BedrockMethod } from "./bedrock-connect-model";

/** Query key for the AWS context; exported so stories/tests can seed it. */
export const BEDROCK_CONTEXT_KEY = ["desktop", "bedrock", "aws"] as const;

/*
 * After a Connect the app gave up on (deadline, IPC), the backend may still
 * store the row: its worst case runs past any deadline a person waits for
 * (see `auth.bedrock.connect` in desktop-contract.ts). One more read of the
 * context this long after the first lets a late save appear in "Saved
 * connections" without the user reopening the panel (R4).
 */
const LATE_SAVE_REREAD_MS = 15_000;

type Refusal = { code?: string; text: string };

export type BedrockConnectPanelProps = {
	/** A connect the backend stored; the caller renders the receipt. */
	onConnected: (result: BedrockConnectResult) => void;
	/** Which method opens first; stories use it, the app lets the data decide. */
	initialMethod?: BedrockMethod;
};

export const BedrockConnectPanel: FC<BedrockConnectPanelProps> = ({
	onConnected,
	initialMethod,
}) => {
	useI18nLocale();
	const context = useQuery({
		queryKey: BEDROCK_CONTEXT_KEY,
		queryFn: () =>
			desktopResult<BedrockAwsContext>({ op: "auth.bedrock.context" }),
		// The SSO session state goes stale by the minute; re-read on each open.
		staleTime: 0,
		retry: false,
	});
	const data = context.data ?? null;

	const [chosenMethod, setChosenMethod] = useState<BedrockMethod | null>(
		initialMethod ?? null,
	);
	const [profileName, setProfileName] = useState<string | null>(null);
	const [regionChoice, setRegionChoice] = useState<string | null>(null);
	const [regionError, setRegionError] = useState<string | null>(null);
	const [apiKey, setApiKey] = useState("");
	const [accessKeyId, setAccessKeyId] = useState("");
	const [secretAccessKey, setSecretAccessKey] = useState("");
	const [sessionToken, setSessionToken] = useState("");
	const [accessKeyIdLeft, setAccessKeyIdLeft] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [refusal, setRefusal] = useState<Refusal | null>(null);

	const lateReread = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (lateReread.current) clearTimeout(lateReread.current);
		},
		[],
	);

	const profiles = data?.profiles ?? [];
	const method: BedrockMethod =
		chosenMethod ?? defaultMethod(profiles, data?.ambient.enabled ?? false);
	const usesProfile = method === "profile" || method === "sso";
	const listed = profilesFor(method, profiles);
	const profile =
		listed.find((candidate) => candidate.name === profileName) ??
		listed[0] ??
		null;
	/*
	 * Region precedence, as the backend resolves it for an unsaved connection:
	 * what the user picked, then the profile's own Region, then the backend's
	 * default (settings > AWS_REGION > AWS_DEFAULT_REGION > fallback).
	 */
	const region =
		regionChoice ??
		(usesProfile ? profile?.region : null) ??
		data?.default_region ??
		null;

	/*
	 * One sign-in session PER PROFILE (R2): the device code, the waiting state,
	 * Cancel and a failure belong to the profile the run was started for, so
	 * picking another profile shows that profile's own state, and coming back
	 * finds the first run still going. Only an SSO-kind profile can start one;
	 * the key for anything else is never started.
	 */
	const ssoKey = ssoSessionKey(
		usesProfile && profile && isSsoProfile(profile) ? profile.name : "",
	);
	const sso = useSignInSession(ssoKey, () => ({
		start: (name: string) =>
			desktopResult<AuthOperation>({
				op: "auth.bedrock.ssoLogin",
				profile: name,
			}),
		read: (id: string) =>
			desktopResult<AuthOperation>({ op: "auth.status", id }),
		cancel: (id: string) => desktopResult({ op: "auth.cancel", id }),
		open: (id: string, reopen: boolean) => openAuthorization(id, reopen),
		poll: pollAuthOperation,
		/*
		 * The session state lives in the context; a fresh read repaints badges.
		 * An earlier `bedrock_sso_expired` refusal is answered by this sign-in,
		 * so it stops being shown over a now-valid session (R1).
		 */
		onSucceeded: () => {
			setRefusal(null);
			void context.refetch();
		},
	}));

	const regionOptions: SearchableOption[] = useMemo(
		() =>
			(data?.regions ?? []).map((entry) => ({
				id: entry.id,
				name: entry.label,
				description: entry.id,
				keywords: [entry.id],
			})),
		[data?.regions],
	);
	const profileOptions: SearchableOption[] = listed.map((entry) => ({
		id: entry.name,
		name: entry.name,
		description: [kindLabel(entry.kind), sessionBadge(entry)?.text]
			.filter(Boolean)
			.join(" · "),
	}));

	const clearSecrets = () => {
		setApiKey("");
		setAccessKeyId("");
		setAccessKeyIdLeft(false);
		setSecretAccessKey("");
		setSessionToken("");
	};

	const pending = connectionInput({
		method,
		region,
		profile,
		apiKey,
		accessKeyId,
		secretAccessKey,
		sessionToken,
	});
	/*
	 * Said once the field is left, or at once for a character no access key ID
	 * can hold: a half-typed `AKIA` is not yet wrong, a lower-case one already is.
	 */
	const accessKeyIdProblem =
		method === "access_key" &&
		(accessKeyIdLeft || /[^A-Z0-9]/.test(accessKeyId.trim()))
			? accessKeyIdError(accessKeyId)
			: null;

	const connect = async () => {
		if (!pending) return;
		setSubmitting(true);
		setRefusal(null);
		try {
			const result = await desktopResult<BedrockConnectResult>({
				op: "auth.bedrock.connect",
				connection: pending,
			});
			clearSecrets();
			onConnected(result);
		} catch (error) {
			/*
			 * Secrets are cleared once AWS judged them or the outcome is unknown,
			 * and kept when only the input's shape was refused (R3):
			 * `keepsSecretsAfter` holds the rule.
			 */
			if (!keepsSecretsAfter(error)) clearSecrets();
			setRefusal({
				code: error instanceof DesktopControlError ? error.code : undefined,
				text:
					error instanceof Error && error.message
						? error.message
						: t("ui.providers.bedrock.error_generic"),
			});
			// A refusal may be stale context (an SSO session that just ran out),
			// and an abandoned request may have been stored: re-read either way.
			void context.refetch();
			if (outcomeUnknown(error)) {
				if (lateReread.current) clearTimeout(lateReread.current);
				lateReread.current = setTimeout(
					() => void context.refetch(),
					LATE_SAVE_REREAD_MS,
				);
			}
		} finally {
			setSubmitting(false);
		}
	};

	const chooseMethod = (next: string) => {
		setChosenMethod(next as BedrockMethod);
		setProfileName(null);
		setRegionChoice(null);
		setRegionError(null);
		setRefusal(null);
		clearSecrets();
	};

	/* ---------------------------------------------------------- loading */
	if (context.isPending) {
		return (
			<div
				className="flex items-center gap-2 text-body-sm text-ink-muted"
				data-sign-in-state="bedrock-loading"
				aria-busy="true"
			>
				<Spinner size="sm" />
				{t("ui.providers.bedrock.loading_context")}
			</div>
		);
	}
	if (context.isError || !data) {
		return (
			<Alert variant="danger" data-sign-in-state="bedrock-context-error">
				<AlertTitle>{t("ui.providers.bedrock.context_failed")}</AlertTitle>
				<AlertDescription className="flex flex-col items-start gap-2">
					{context.error instanceof Error ? context.error.message : null}
					<Button
						variant="secondary"
						size="sm"
						onClick={() => void context.refetch()}
					>
						{t("ui.providers.bedrock.retry")}
					</Button>
				</AlertDescription>
			</Alert>
		);
	}

	const ssoOperation = sso.state.operation;
	const ssoActive =
		sso.state.phase === "starting" || sso.state.phase === "active";
	const ssoCode = ssoOperation ? deviceCodeOf(ssoOperation) : null;
	const ssoFailed =
		sso.state.phase === "settled" &&
		(sso.state.error !== null ||
			(ssoOperation !== null && ssoOperation.state !== "succeeded"));
	const ssoRefused = refusal?.code === "bedrock_sso_expired";
	const showSignIn = usesProfile && (needsSignIn(profile) || ssoRefused);
	const badge = profile ? sessionBadge(profile) : null;
	const helpId = "bedrock-secret-help";
	const accessKeyIdHelpId = "bedrock-access-key-id-help";
	const regionErrorId = "bedrock-region-error";

	/* --------------------------------------------- per-method input block */
	let fields: ReactNode;
	if (usesProfile && listed.length === 0) {
		/*
		 * Three empties, three sentences: no ~/.aws at all; only SSO profiles
		 * (they are on the AWS SSO tab); only self-signing ones.
		 */
		const noAws = profiles.length === 0;
		fields = (
			<Alert variant="neutral" data-sign-in-state="bedrock-no-profiles">
				<AlertTitle>
					{method === "sso"
						? t("ui.providers.bedrock.no_sso_profiles_title")
						: noAws
							? t("ui.providers.bedrock.no_profiles_title")
							: t("ui.providers.bedrock.no_plain_profiles_title")}
				</AlertTitle>
				<AlertDescription>
					{method === "sso"
						? t("ui.providers.bedrock.no_sso_profiles_body", {
								command: "aws configure sso",
							})
						: noAws
							? t("ui.providers.bedrock.no_profiles_body")
							: t("ui.providers.bedrock.no_plain_profiles_body")}
				</AlertDescription>
			</Alert>
		);
	} else if (usesProfile) {
		fields = (
			<div className="flex flex-col gap-2">
				<SearchableSelect
					label={t("ui.providers.bedrock.profile_label")}
					placeholder={t("ui.providers.bedrock.profile_placeholder")}
					busyLabel={t("ui.providers.bedrock.loading_context")}
					emptyText={t("ui.providers.bedrock.profile_no_match")}
					options={profileOptions}
					selected={
						profileOptions.find((option) => option.id === profile?.name) ?? null
					}
					onSelect={(option) => {
						setProfileName(option.id);
						setRegionChoice(null);
						setRegionError(null);
						setRefusal(null);
					}}
				/>
				{profile ? (
					<div
						className="flex flex-wrap items-center gap-1.5"
						data-bedrock-profile-kind={profile.kind}
					>
						<Badge variant="neutral">{kindLabel(profile.kind)}</Badge>
						{badge ? <Badge variant={badge.tone}>{badge.text}</Badge> : null}
					</div>
				) : null}
				{showSignIn && profile ? (
					<SsoSignIn
						profile={profile}
						afterRefusedConnect={ssoRefused}
						cliAvailable={data.aws_cli_available}
						active={ssoActive}
						code={ssoCode}
						canOpen={Boolean(ssoOperation?.auth_url)}
						failure={
							ssoFailed
								? (sso.state.error ??
									ssoOperation?.message ??
									t("ui.providers.bedrock.sso_failed"))
								: null
						}
						onStart={() => void sso.flow.start(profile.name)}
						onOpen={() => void sso.flow.reopen()}
						onCancel={() => void sso.flow.cancel()}
					/>
				) : null}
			</div>
		);
	} else if (method === "api_key") {
		fields = (
			<div className="flex flex-col gap-2">
				<Label htmlFor="bedrock-api-key">
					{t("ui.providers.bedrock.api_key_label")}
				</Label>
				<SecretInput
					id="bedrock-api-key"
					value={apiKey}
					onChange={setApiKey}
					label={t("ui.providers.bedrock.api_key_label")}
					describedBy={helpId}
				/>
				<p id={helpId} className="text-ink-dim text-meta">
					{t("ui.providers.bedrock.secrets_help")}
				</p>
			</div>
		);
	} else if (method === "access_key") {
		fields = (
			<div className="flex flex-col gap-2">
				<Label htmlFor="bedrock-access-key-id">
					{t("ui.providers.bedrock.access_key_id_label")}
				</Label>
				<Input
					id="bedrock-access-key-id"
					value={accessKeyId}
					onChange={(event) => setAccessKeyId(event.target.value)}
					onBlur={() => setAccessKeyIdLeft(true)}
					autoComplete="off"
					spellCheck={false}
					aria-invalid={accessKeyIdProblem ? true : undefined}
					aria-describedby={accessKeyIdProblem ? accessKeyIdHelpId : undefined}
					className="font-mono"
				/>
				{accessKeyIdProblem ? (
					<p
						id={accessKeyIdHelpId}
						className="text-danger text-meta"
						data-sign-in-state="bedrock-access-key-id-invalid"
					>
						{accessKeyIdProblem}
					</p>
				) : null}
				<Label htmlFor="bedrock-secret-access-key">
					{t("ui.providers.bedrock.secret_access_key_label")}
				</Label>
				<SecretInput
					id="bedrock-secret-access-key"
					value={secretAccessKey}
					onChange={setSecretAccessKey}
					label={t("ui.providers.bedrock.secret_access_key_label")}
					describedBy={helpId}
				/>
				<Label htmlFor="bedrock-session-token">
					{t("ui.providers.bedrock.session_token_label")}
				</Label>
				<SecretInput
					id="bedrock-session-token"
					value={sessionToken}
					onChange={setSessionToken}
					label={t("ui.providers.bedrock.session_token_label")}
				/>
				<p id={helpId} className="text-ink-dim text-meta">
					{t("ui.providers.bedrock.secrets_help")}
				</p>
			</div>
		);
	} else {
		fields = (
			<p
				className="text-ink-dim text-meta"
				data-sign-in-state="bedrock-ambient"
			>
				{data.ambient.sources.length > 0
					? t("ui.providers.bedrock.ambient_sources", {
							sources: formatList(data.ambient.sources),
						})
					: t("ui.providers.bedrock.ambient_none")}
			</p>
		);
	}

	const regionSelected =
		regionOptions.find((option) => option.id === region) ??
		(region ? { id: region, name: region } : null);
	/*
	 * Connect waits on an SSO sign-in the profile still needs: a profile whose
	 * session is missing would be refused by the backend's own check, and an
	 * enabled button that can only fail is the dead affordance this app avoids.
	 * A running sign-in holds only the profile tabs; the key and default
	 * credential methods never wait on one (R2).
	 */
	const blocked = usesProfile && (needsSignIn(profile) || ssoActive);

	return (
		<div className="flex flex-col gap-4" data-sign-in-state="bedrock">
			<div className="flex flex-col gap-2">
				<Tabs value={method} onValueChange={chooseMethod}>
					{/*
					 * Five method labels do not fit one row in every locale: es/ru/vi
					 * measure 644-730 px against the connect/onboarding dialogs' ~560 px
					 * content box, whose RowList is overflow-hidden (design D2-1). The
					 * track therefore wraps onto a second row instead of clipping or
					 * scrolling with no affordance; `h-auto` lets it grow and `max-w-full`
					 * binds it to the column. Radix Tabs keeps roving focus and arrow
					 * keys in DOM order, so wrapping changes no keyboard behaviour.
					 */}
					<TabsList
						aria-label={t("ui.providers.bedrock.how_to_connect")}
						className="h-auto max-w-full flex-wrap"
						data-sign-in-state="bedrock-methods"
					>
						{BEDROCK_METHODS.map((candidate) => (
							<TabsTrigger key={candidate} value={candidate}>
								{methodLabel(candidate)}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
				<p
					className="text-body-sm text-ink-muted"
					data-sign-in-state="bedrock-method-description"
				>
					{methodDescription(method, profiles)}
				</p>
			</div>

			{fields}

			<div className="flex flex-col gap-1">
				<SearchableSelect
					label={t("ui.providers.bedrock.region_label")}
					placeholder={t("ui.providers.bedrock.region_placeholder")}
					busyLabel={t("ui.providers.bedrock.loading_context")}
					emptyText={t("ui.providers.bedrock.region_no_match")}
					options={regionOptions}
					selected={regionSelected}
					onSelect={(option) => {
						setRegionChoice(option.id);
						setRegionError(null);
					}}
					onCustomSubmit={(text) => {
						// The same bound the backend holds; a refusal says why (R3).
						const problem = customRegionError(text);
						setRegionError(problem);
						if (problem === null) setRegionChoice(normalizeRegion(text));
					}}
					customRowLabel={(text) =>
						t("ui.providers.bedrock.region_custom", {
							region: normalizeRegion(text),
						})
					}
					helperText={regionHelp(data, profile, usesProfile)}
				/>
				{regionError ? (
					<p
						id={regionErrorId}
						className="text-danger text-meta"
						role="alert"
						data-sign-in-state="bedrock-region-invalid"
					>
						{regionError}
					</p>
				) : null}
			</div>

			{/* An SSO-expired refusal is said once, by the sign-in block above. */}
			{refusal && !(showSignIn && ssoRefused) ? (
				<Alert variant="danger" data-sign-in-state="bedrock-refused">
					<AlertTitle>{refusalTitle(refusal.code)}</AlertTitle>
					<AlertDescription>{refusal.text}</AlertDescription>
				</Alert>
			) : null}

			<div>
				<Button
					variant="primary"
					size="sm"
					// A refused typed Region keeps the previous choice in the field, so
					// connecting now would silently save a Region the user just replaced
					// (QA Q4); it re-enables once a listed or valid Region is chosen.
					disabled={
						!canConnect({
							pending: pending !== null,
							submitting,
							blocked,
							regionError,
						})
					}
					onClick={() => void connect()}
				>
					{submitting ? <Spinner size="sm" /> : null}
					{submitting
						? t("ui.providers.bedrock.checking", {
								region: region ?? data.default_region,
							})
						: t("ui.providers.bedrock.connect")}
				</Button>
			</div>

			{data.connections.length > 0 ? (
				<SavedConnections connections={data.connections} />
			) : null}
		</div>
	);
};

/**
 * The SSO sign-in block: the button, the code to confirm and the waiting
 * state. Without the AWS CLI the backend cannot run `aws sso login` (422
 * `aws_cli_missing`), so the button is replaced by the command to run by hand
 * rather than offered as an action that can only fail.
 */
const SsoSignIn: FC<{
	profile: BedrockProfile;
	afterRefusedConnect: boolean;
	cliAvailable: boolean;
	active: boolean;
	code: string | null;
	canOpen: boolean;
	failure: string | null;
	onStart: () => void;
	onOpen: () => void;
	onCancel: () => void;
}> = ({
	profile,
	afterRefusedConnect,
	cliAvailable,
	active,
	code,
	canOpen,
	failure,
	onStart,
	onOpen,
	onCancel,
}) => {
	const command = signInCommand(profile);
	const copy = signInCopy(profile, afterRefusedConnect);
	return (
		<Alert
			variant="warning"
			data-sign-in-state={
				profile.session.state === "missing"
					? "bedrock-sso-missing"
					: "bedrock-sso-expired"
			}
		>
			<AlertTitle>{copy.title}</AlertTitle>
			<AlertDescription className="flex flex-col items-start gap-2">
				<span>{copy.body}</span>
				{copy.nothingSaved ? <span>{copy.nothingSaved}</span> : null}
				{!cliAvailable ? (
					<>
						<span>{t("ui.providers.bedrock.sso_needs_cli")}</span>
						<span className="flex items-center gap-1">
							{/* i18n: ignore AWS CLI syntax the user runs verbatim. */}
							<code className="font-mono text-meta">{command}</code>
							<CopyButton
								value={command}
								label={t("ui.providers.bedrock.copy_command")}
							/>
						</span>
					</>
				) : active ? (
					<div
						className="flex flex-col items-start gap-2"
						data-sign-in-state="bedrock-sso-waiting"
					>
						<span className="flex items-center gap-2">
							<Spinner size="sm" />
							{t("ui.providers.bedrock.sso_waiting")}
						</span>
						{code ? (
							<span className="flex items-center gap-1">
								{t("ui.providers.bedrock.sso_code_label")}
								<code className="font-mono">{code}</code>
								<CopyButton
									value={code}
									label={t("ui.providers.bedrock.copy_code")}
								/>
							</span>
						) : null}
						<span className="flex gap-2">
							{canOpen ? (
								<Button variant="secondary" size="sm" onClick={onOpen}>
									{t("ui.providers.bedrock.sso_open_page")}
								</Button>
							) : null}
							<Button variant="ghost" size="sm" onClick={onCancel}>
								{t("ui.providers.bedrock.sso_cancel")}
							</Button>
						</span>
					</div>
				) : (
					<Button variant="secondary" size="sm" onClick={onStart}>
						{signInLabel(profile)}
					</Button>
				)}
				{failure ? (
					<span className="text-danger" role="alert">
						{failure}
					</span>
				) : null}
			</AlertDescription>
		</Alert>
	);
};

/**
 * Connections already stored, each re-checkable on demand
 * (`auth.bedrock.check`). Removal stays where every account is removed (the
 * logout picker), so this list adds no second delete path.
 */
const SavedConnections: FC<{ connections: BedrockConnection[] }> = ({
	connections,
}) => (
	<div className="flex flex-col gap-1.5" data-sign-in-state="bedrock-saved">
		<p className="text-meta text-ink-dim">
			{t("ui.providers.bedrock.saved_connections")}
		</p>
		<ul className="flex flex-col gap-1">
			{connections.map((entry) => (
				<SavedConnectionRow key={entry.credential_id} connection={entry} />
			))}
		</ul>
	</div>
);

const SavedConnectionRow: FC<{ connection: BedrockConnection }> = ({
	connection,
}) => {
	const [checking, setChecking] = useState(false);
	const [result, setResult] = useState<BedrockCheckResult | null>(null);
	const check = async () => {
		setChecking(true);
		try {
			setResult(
				await desktopResult<BedrockCheckResult>({
					op: "auth.bedrock.check",
					credentialId: connection.credential_id,
				}),
			);
		} catch (error) {
			// Only the backend's 4xx is a verdict; anything else is "could not
			// tell" (R4) - `checkResultFromError` holds the rule.
			setResult(checkResultFromError(error));
		} finally {
			setChecking(false);
		}
	};
	const verdict = checkVerdict(result);
	const detailId = `bedrock-check-${connection.credential_id}`; // i18n: ignore DOM id, not copy
	return (
		<li className="flex flex-col gap-0.5 text-body-sm">
			<span className="flex flex-wrap items-center gap-2">
				<span className="font-mono">{connection.label}</span>
				{verdict ? (
					<Badge
						variant={verdict.tone}
						aria-describedby={verdict.detail ? detailId : undefined}
					>
						{verdict.text}
					</Badge>
				) : null}
				<Button
					variant="ghost"
					size="sm"
					disabled={checking}
					onClick={() => void check()}
				>
					{checking ? <Spinner size="sm" /> : null}
					{t("ui.providers.bedrock.check")}
				</Button>
			</span>
			{/*
			 * The reason is a visible line, not a hover title (D2): keyboard and
			 * touch users never see a title, and "Not working" alone does not
			 * say what to fix. Unverified keeps the neutral ink of its badge.
			 */}
			{verdict?.detail ? (
				<output
					id={detailId}
					className={
						verdict.tone === "danger"
							? "block text-danger text-meta"
							: "block text-ink-muted text-meta"
					}
					data-sign-in-state={`bedrock-check-${verdict.tone}`}
				>
					{verdict.detail}
				</output>
			) : null}
		</li>
	);
};
