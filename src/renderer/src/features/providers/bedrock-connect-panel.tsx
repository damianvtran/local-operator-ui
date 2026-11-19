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
 *   The session key is `bedrock-sso`, distinct from the provider's own, so an
 *   SSO refresh never collides with the provider-level flow registry.
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
import { formatDateTime, formatList, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useQuery } from "@tanstack/react-query";
import type { FC, ReactNode } from "react";
import { useMemo, useState } from "react";
import type {
	BedrockAwsContext,
	BedrockCheckResult,
	BedrockConnectResult,
	BedrockConnection,
	BedrockConnectionInput,
	BedrockProfile,
	BedrockProfileKind,
} from "../../../../shared/desktop-contract";
import { deviceCodeOf } from "./provider-catalog";
import { SecretInput } from "./secret-input";
import { useSignInSession } from "./sign-in-sessions";

/** The panel's five ways in; SSO and Profile both submit `method: "profile"`. */
export type BedrockMethod =
	| "profile"
	| "sso"
	| "access_key"
	| "api_key"
	| "ambient";

const METHODS: readonly BedrockMethod[] = [
	"profile",
	"sso",
	"access_key",
	"api_key",
	"ambient",
];

/** Profiles whose session the AWS CLI's SSO/login flow refreshes. */
const SSO_KINDS: ReadonlySet<BedrockProfileKind> = new Set(["sso", "login"]);

/** Query key for the AWS context; exported so stories/tests can seed it. */
export const BEDROCK_CONTEXT_KEY = ["desktop", "bedrock", "aws"] as const;

/* Mirrors the contract's own bound, so a typed Region is refused here rather
 * than by a strict-schema rejection the user cannot read. */
const AWS_REGION = /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/;

const methodLabel = (method: BedrockMethod): string => {
	switch (method) {
		case "profile":
			return t("ui.providers.bedrock.tab_profile");
		case "sso":
			return t("ui.providers.bedrock.tab_sso");
		case "access_key":
			return t("ui.providers.bedrock.tab_access_key");
		case "api_key":
			return t("ui.providers.bedrock.tab_api_key");
		case "ambient":
			return t("ui.providers.bedrock.tab_ambient");
	}
};

const kindLabel = (kind: BedrockProfileKind): string => {
	switch (kind) {
		case "static":
			return t("ui.providers.bedrock.kind_static");
		case "sso":
			return t("ui.providers.bedrock.kind_sso");
		case "login":
			return t("ui.providers.bedrock.kind_login");
		case "assume_role":
			return t("ui.providers.bedrock.kind_assume_role");
		case "process":
			return t("ui.providers.bedrock.kind_process");
		case "web_identity":
			return t("ui.providers.bedrock.kind_web_identity");
		default:
			return t("ui.providers.bedrock.kind_other");
	}
};

/**
 * The session badge for a profile, or null when sessions do not apply (a
 * static key pair has no session to expire). `expired_refreshable` is NOT a
 * warning: botocore refreshes it with the stored refresh token on first use,
 * so telling the user to sign in again would be a false alarm.
 */
export function sessionBadge(
	profile: BedrockProfile,
): { text: string; tone: "success" | "warning" | "neutral" } | null {
	const { state, expires_at: expiresAt } = profile.session;
	switch (state) {
		case "valid":
			return {
				text: expiresAt
					? t("ui.providers.bedrock.session_valid_until", {
							time: formatDateTime(new Date(expiresAt), {
								hour: "numeric",
								minute: "2-digit",
							}),
						})
					: t("ui.providers.bedrock.session_valid"),
				tone: "success",
			};
		case "expired_refreshable":
			return {
				text: t("ui.providers.bedrock.session_refreshes"),
				tone: "neutral",
			};
		case "expired":
			return {
				text: t("ui.providers.bedrock.session_expired"),
				tone: "warning",
			};
		case "missing":
			return {
				text: t("ui.providers.bedrock.session_missing"),
				tone: "warning",
			};
		default:
			return null;
	}
}

/** Whether a profile needs an SSO sign-in before it can sign requests. */
export const needsSignIn = (profile: BedrockProfile | null): boolean =>
	profile !== null &&
	SSO_KINDS.has(profile.kind) &&
	(profile.session.state === "expired" || profile.session.state === "missing");

/** The heading for a refused connect, by the backend's `bedrock_*` code. */
export function refusalTitle(code: string | undefined): string {
	switch (code) {
		case "bedrock_credentials_rejected":
			return t("ui.providers.bedrock.error_credentials_rejected");
		case "bedrock_sso_expired":
			return t("ui.providers.bedrock.sso_expired_title");
		case "bedrock_profile_not_found":
			return t("ui.providers.bedrock.error_profile_not_found");
		case "bedrock_region_invalid":
			return t("ui.providers.bedrock.error_region_invalid");
		case "bedrock_no_credentials":
			return t("ui.providers.bedrock.error_no_credentials");
		default:
			return t("ui.providers.bedrock.error_generic");
	}
}

const regionSourceLabel = (
	source: BedrockAwsContext["default_region_source"],
): string => {
	switch (source) {
		case "config":
			return t("ui.providers.bedrock.region_source_config");
		case "profile":
			return t("ui.providers.bedrock.region_source_profile");
		case "fallback":
			return t("ui.providers.bedrock.region_source_fallback");
		default:
			// AWS_REGION / AWS_DEFAULT_REGION: an env var name is a machine
			// token and stays untranslated.
			return source;
	}
};

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
	const [apiKey, setApiKey] = useState("");
	const [accessKeyId, setAccessKeyId] = useState("");
	const [secretAccessKey, setSecretAccessKey] = useState("");
	const [sessionToken, setSessionToken] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [refusal, setRefusal] = useState<Refusal | null>(null);

	const profiles = data?.profiles ?? [];
	const ssoProfiles = profiles.filter((p) => SSO_KINDS.has(p.kind));
	/*
	 * The first method a person most likely wants: an SSO profile if the machine
	 * has one (the common corporate setup), any profile next, else the API key -
	 * the one method that needs nothing on this computer.
	 */
	const method: BedrockMethod =
		chosenMethod ??
		(ssoProfiles.length > 0
			? "sso"
			: profiles.length > 0
				? "profile"
				: "api_key");
	const listed = method === "sso" ? ssoProfiles : profiles;
	const profile =
		listed.find((candidate) => candidate.name === profileName) ??
		listed[0] ??
		null;
	/*
	 * Region precedence, as the backend resolves it for an unsaved connection:
	 * what the user picked, then the profile's own Region, then the backend's
	 * default (settings > AWS_REGION > AWS_DEFAULT_REGION > fallback).
	 */
	const usesProfile = method === "profile" || method === "sso";
	const region =
		regionChoice ??
		(usesProfile ? profile?.region : null) ??
		data?.default_region ??
		null;

	const sso = useSignInSession("bedrock-sso", () => ({
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
		// The session state lives in the context; a fresh read repaints badges.
		onSucceeded: () => void context.refetch(),
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
		setSecretAccessKey("");
		setSessionToken("");
	};

	const connection = (): BedrockConnectionInput | null => {
		if (method === "ambient") return { method: "ambient", region };
		if (!region) return null;
		if (method === "api_key")
			return apiKey.trim()
				? { method: "api_key", region, api_key: apiKey.trim() }
				: null;
		if (method === "access_key")
			return accessKeyId.trim() && secretAccessKey.trim()
				? {
						method: "access_key",
						region,
						access_key_id: accessKeyId.trim(),
						secret_access_key: secretAccessKey.trim(),
						session_token: sessionToken.trim() || null,
					}
				: null;
		return profile
			? { method: "profile", profile: profile.name, region }
			: null;
	};
	const pending = connection();

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
			 * Secrets are cleared on a refusal too: nothing was stored, and a key
			 * AWS just rejected is not worth keeping in memory for a retry.
			 */
			clearSecrets();
			setRefusal({
				code: error instanceof DesktopControlError ? error.code : undefined,
				text:
					error instanceof Error && error.message
						? error.message
						: t("ui.providers.bedrock.error_generic"),
			});
			// A refusal may be stale context (an SSO session that just ran out).
			void context.refetch();
		} finally {
			setSubmitting(false);
		}
	};

	const chooseMethod = (next: string) => {
		setChosenMethod(next as BedrockMethod);
		setProfileName(null);
		setRegionChoice(null);
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
	const showSignIn =
		usesProfile &&
		(needsSignIn(profile) || refusal?.code === "bedrock_sso_expired");
	const badge = profile ? sessionBadge(profile) : null;
	const helpId = "bedrock-secret-help";

	/* --------------------------------------------- per-method input block */
	let fields: ReactNode;
	if (usesProfile && listed.length === 0) {
		fields = (
			<Alert variant="neutral" data-sign-in-state="bedrock-no-profiles">
				<AlertTitle>
					{method === "sso"
						? t("ui.providers.bedrock.no_sso_profiles_title")
						: t("ui.providers.bedrock.no_profiles_title")}
				</AlertTitle>
				<AlertDescription>
					{method === "sso"
						? t("ui.providers.bedrock.no_sso_profiles_body", {
								command: "aws configure sso",
							})
						: t("ui.providers.bedrock.no_profiles_body")}
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
					autoComplete="off"
					spellCheck={false}
					className="font-mono"
				/>
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
			<div
				className="flex flex-col gap-1 text-body-sm"
				data-sign-in-state="bedrock-ambient"
			>
				<p className="text-ink-muted">
					{t("ui.providers.bedrock.ambient_body")}
				</p>
				<p className="text-ink-dim text-meta">
					{data.ambient.sources.length > 0
						? t("ui.providers.bedrock.ambient_sources", {
								sources: formatList(data.ambient.sources),
							})
						: t("ui.providers.bedrock.ambient_none")}
				</p>
			</div>
		);
	}

	const regionSelected =
		regionOptions.find((option) => option.id === region) ??
		(region ? { id: region, name: region } : null);
	/*
	 * Connect waits on an SSO sign-in the profile still needs: a profile whose
	 * session is missing would be refused by the backend's own check, and an
	 * enabled button that can only fail is the dead affordance this app avoids.
	 */
	const blocked = usesProfile && needsSignIn(profile);

	return (
		<div className="flex flex-col gap-4" data-sign-in-state="bedrock">
			<Tabs value={method} onValueChange={chooseMethod}>
				<TabsList aria-label={t("ui.providers.bedrock.how_to_connect")}>
					{METHODS.map((candidate) => (
						<TabsTrigger key={candidate} value={candidate}>
							{methodLabel(candidate)}
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>

			{fields}

			<SearchableSelect
				label={t("ui.providers.bedrock.region_label")}
				placeholder={t("ui.providers.bedrock.region_placeholder")}
				busyLabel={t("ui.providers.bedrock.loading_context")}
				emptyText={t("ui.providers.bedrock.region_no_match")}
				options={regionOptions}
				selected={regionSelected}
				onSelect={(option) => setRegionChoice(option.id)}
				onCustomSubmit={(text) => {
					const typed = text.trim();
					if (AWS_REGION.test(typed)) setRegionChoice(typed);
				}}
				customRowLabel={(text) =>
					t("ui.providers.bedrock.region_custom", { region: text.trim() })
				}
				helperText={t("ui.providers.bedrock.region_help", {
					region: data.default_region,
					source: regionSourceLabel(data.default_region_source),
				})}
			/>

			{/* An SSO-expired refusal is said once, by the sign-in block above. */}
			{refusal && !(showSignIn && refusal.code === "bedrock_sso_expired") ? (
				<Alert variant="danger" data-sign-in-state="bedrock-refused">
					<AlertTitle>{refusalTitle(refusal.code)}</AlertTitle>
					<AlertDescription>{refusal.text}</AlertDescription>
				</Alert>
			) : null}

			<div>
				<Button
					variant="primary"
					size="sm"
					disabled={!pending || submitting || blocked || ssoActive}
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
	cliAvailable,
	active,
	code,
	canOpen,
	failure,
	onStart,
	onOpen,
	onCancel,
}) => {
	const command =
		profile.session.login_command ?? `aws sso login --profile ${profile.name}`;
	return (
		<Alert variant="warning" data-sign-in-state="bedrock-sso-expired">
			<AlertTitle>{t("ui.providers.bedrock.sso_expired_title")}</AlertTitle>
			<AlertDescription className="flex flex-col items-start gap-2">
				{t("ui.providers.bedrock.sso_expired_body")}
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
						{t("ui.providers.bedrock.sso_sign_in")}
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
			setResult({
				valid: false,
				reason: error instanceof Error ? error.message : null,
				code:
					error instanceof DesktopControlError ? (error.code ?? null) : null,
			});
		} finally {
			setChecking(false);
		}
	};
	const verdict =
		result === null
			? null
			: result.valid === true
				? {
						tone: "success" as const,
						text: t("ui.providers.bedrock.check_ok"),
					}
				: result.valid === null
					? {
							tone: "neutral" as const,
							text: t("ui.providers.bedrock.check_unverified"),
						}
					: {
							tone: "danger" as const,
							text: t("ui.providers.bedrock.check_failed"),
						};
	return (
		<li className="flex flex-wrap items-center gap-2 text-body-sm">
			<span className="font-mono">{connection.label}</span>
			{verdict ? (
				<Badge variant={verdict.tone} title={result?.reason ?? undefined}>
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
		</li>
	);
};
