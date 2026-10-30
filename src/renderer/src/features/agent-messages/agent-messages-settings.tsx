import { agentMessagesApi } from "@shared/api/local-operator/agent-messages-api";
import { NOTICE_BAND } from "@shared/components/common/notice-band";
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Button,
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Skeleton,
	Switch,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import type { WithoutParams } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Save } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { FC } from "react";
import {
	type AgentMessagesAllowlistResult,
	type AgentMessagesRefusal,
	type AgentMessagesSettingsResult,
	type AgentMessagesStatus,
	agentMessagesDefaultOnBannerConsentText,
	agentMessagesDefaultOnInForce,
} from "../../../../shared/agent-messages-contract";
import { InfoGrid, InfoItem } from "../settings/components/settings-section";
import { agentMessagesRefusal } from "./agent-messages-refusal";
import {
	type AgentMessagesSettingsAvailability,
	type AllowlistDirection,
	type AllowlistDraftEntry,
	type AllowlistEntryKind,
	type AllowlistMode,
	agentMessagesChiefOfStaffHold,
	agentMessagesSettingsAvailability,
	agentMessagesSettingsConsent,
	agentMessagesSettingsState,
	allowlistDraft,
	allowlistIdentifierError,
	allowlistReplaceSet,
	allowlistSaveGate,
	allowlistSignature,
	settingsRefusalSentence,
} from "./agent-messages-settings-model";
import { DefaultOnBanner } from "./default-on-banner";
import {
	checkAgentMessagesSurface,
	useAgentMessages,
} from "./use-agent-messages";
import {
	useDefaultOnBannerActions,
	useDefaultOnBannerVisible,
} from "./use-default-on-banner";

export type AgentMessagesSettingsApi = Pick<
	typeof agentMessagesApi,
	| "settings"
	| "updateSettings"
	| "allowlist"
	| "updateAllowlist"
	| "localSetting"
	| "dismissOnboarding"
>;

type Load =
	| { kind: "loading" }
	| {
			kind: "ready";
			settings: AgentMessagesSettingsResult;
			allowlist: AgentMessagesAllowlistResult | null;
	  }
	| { kind: "error"; refusal: AgentMessagesRefusal };

export type AgentMessagesSettingsProps = {
	availability: AgentMessagesSettingsAvailability;
	status: AgentMessagesStatus | null;
	accountId: string | null;
	refusal?: AgentMessagesRefusal | null;
	api?: AgentMessagesSettingsApi;
	onRefreshStatus: (force?: boolean) => Promise<unknown> | undefined;
	/** The real canonical sessions store; the section never invents a row. */
	sessions?: readonly { session_id: string; title?: string | null }[];
	/**
	 * Opens a conversation by session id. The page owns navigation (the section
	 * stays prop-driven for stories and the test lane); without it the
	 * chief-of-staff hold notice still explains itself but offers no button.
	 */
	onOpenSession?: (sessionId: string) => void;
	/**
	 * A deep link named this section's way-back control and it should be
	 * revealed and focused: the Team Bridge page's off gate links here
	 * (`/settings?setting=team_bridge.enabled`, design round 1 D1).
	 */
	focus?: boolean;
	/**
	 * A second reveal of the same row, from a second search jump. The `focused`
	 * ref keeps the reveal idempotent so a repaint cannot steal the caret; a new
	 * nonce re-arms it (see `language-dialog.tsx`'s `focusNonce`).
	 */
	focusNonce?: number;
};

/**
 * The off gate's way-back controls, most specific first (review R2-3). E's
 * own re-enrol control comes first; E renders no machine switch, so its
 * "Enable again" (v1) is reached only after the switch has been ruled out.
 * In C/D the switch outranks ConsentRenewal's "Enable again", because the
 * switch is what the `off_local` gate is waiting on.
 */
const OFF_GATE_FOCUS_ORDER = [
	'[data-agent-messages-action="turn_on_again"]',
	'[role="switch"]',
	'[data-agent-messages-action="enable"]',
] as const;

/** Radix refuses an empty item value, and "" is the designation's own word. */
const NO_SESSION = "__none__";

/**
 * Settings -> Agent messages (RFC §5.6). One section body over the settings
 * read; the global status model above it owns visibility and consent text.
 *
 * The component is prop-driven rather than store-driven so stories and the
 * test lane can render a state without a daemon, a signed-in account or a
 * five-minute status cache.
 */
export function AgentMessagesSettings({
	availability,
	status,
	accountId,
	refusal = null,
	api = agentMessagesApi,
	onRefreshStatus,
	sessions = [],
	onOpenSession,
	focus = false,
	focusNonce,
}: AgentMessagesSettingsProps) {
	useI18nLocale();
	const [load, setLoad] = useState<Load>({ kind: "loading" });
	const [reloadKey, setReloadKey] = useState(0);
	const [pending, setPending] = useState<string | null>(null);
	const [actionRefusal, setActionRefusal] =
		useState<AgentMessagesRefusal | null>(null);
	const [localEnabled, setLocalEnabled] = useState(
		status?.local.enabled ?? false,
	);
	const [sessionValue, setSessionValue] = useState(status?.local.session ?? "");

	const tenantId = status?.tenant_id ?? undefined;
	const visible = availability === "visible";
	/*
	 * The load belongs to ONE account. `tenant_id` alone is not enough: two
	 * accounts in the same organization share it, so a sign-in switch would keep
	 * the previous account's settings and allowlist while the writes carry the
	 * new account's receipt (round-1 R2).
	 */
	const loadAccount = status?.account_id ?? null;
	const accountMatches = loadAccount !== null && loadAccount === accountId;

	// biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is the explicit retry trigger, not a value the effect reads.
	useEffect(() => {
		if (!visible) return undefined;
		let cancelled = false;
		setLoad({ kind: "loading" });
		setActionRefusal(null);
		void (async () => {
			try {
				const settings = await api.settings(tenantId);
				if (cancelled) return;
				if (!settings) {
					setLoad({
						kind: "error",
						refusal: {
							code: "invalid_response",
							message: t("ui.agentMessages.settings.error.unreadable"),
						},
					});
					return;
				}
				let allowlist: AgentMessagesAllowlistResult | null = null;
				if (settings.endpoint) {
					allowlist = await api.allowlist(settings.settings.tenant_id);
					if (cancelled) return;
					if (!allowlist) {
						setLoad({
							kind: "error",
							refusal: {
								code: "invalid_response",
								message: t("ui.agentMessages.settings.error.unreadable"),
							},
						});
						return;
					}
				}
				setLoad({ kind: "ready", settings, allowlist });
			} catch (error) {
				if (cancelled) return;
				setLoad({ kind: "error", refusal: agentMessagesRefusal(error) });
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [visible, accountId, loadAccount, tenantId, reloadKey, api]);

	/*
	 * B -> C creates an endpoint without changing the tenant or visibility, so
	 * the first read legitimately carried `allowlist: null`. The reach editor
	 * needs that policy as soon as the endpoint exists; fetch it directly
	 * rather than re-running the whole load, which would flash the skeletons
	 * over the state the enable just confirmed.
	 */
	useEffect(() => {
		if (!visible || load.kind !== "ready" || !load.settings.endpoint)
			return undefined;
		if (load.allowlist) return undefined;
		let cancelled = false;
		void (async () => {
			try {
				const allowlist = await api.allowlist(load.settings.settings.tenant_id);
				if (cancelled || !allowlist) return;
				setLoad((current) =>
					current.kind === "ready" && !current.allowlist
						? { ...current, allowlist }
						: current,
				);
			} catch (error) {
				if (!cancelled) setActionRefusal(agentMessagesRefusal(error));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [visible, load, api]);

	// A status refresh (a boundary read) can change the org, endpoint state or
	// the local preference underneath a mounted section. Mirror those facts
	// rather than leaving a stale switch.
	useEffect(() => {
		if (!status) return;
		setLocalEnabled(status.local.enabled);
		setSessionValue(status.local.session);
	}, [status]);

	const retry = () => setReloadKey((key) => key + 1);

	/*
	 * Default-on banner (runtime #2790). Hooks sit above the early returns below
	 * because the section can flip between availabilities while mounted.
	 * `accountMatches` gates the actions: a status that belongs to another
	 * account must not be able to write this account's receipt.
	 */
	const readySettings = load.kind === "ready" ? load.settings : null;
	const bannerVisible = useDefaultOnBannerVisible(
		status,
		readySettings,
		loadAccount,
	);
	const bannerActions = useDefaultOnBannerActions({
		api,
		accountId: accountMatches ? loadAccount : null,
		tenantId: readySettings?.settings.tenant_id ?? null,
		markerTenantId: status?.tenant_id ?? null,
		onSettings: (settings) =>
			setLoad((current) =>
				current.kind === "ready" ? { ...current, settings } : current,
			),
		onChanged: () => onRefreshStatus(true),
	});

	/*
	 * THE OFF GATE'S LANDING (design round 1, D1). The Team Bridge page, when
	 * off, links here instead of offering an Enable of its own, so the link
	 * must land ON the control that turns it back on, not at the section top.
	 * Which control that is depends on how it was turned off: E offers "Turn
	 * on again" (default-on) or "Enable again" (v1), both after the served
	 * consent text; a local opt-out in C/D is the "Enabled on this machine"
	 * switch. Only an ENABLED control is focused - a disabled one (no consent
	 * served yet, a write in flight) cannot take focus - so the effect re-runs
	 * as the settings read, the pending write and the status settle. Native
	 * `focus()` also scrolls the control into view. Same mechanism as the
	 * General language row's `focus` prop.
	 *
	 * PRIORITY, NOT DOCUMENT ORDER (review R2-3). A selector list returns the
	 * first match in the DOM, so a v1 C state with stale consent and the
	 * machine switch off landed on ConsentRenewal's "Enable again" (which
	 * renders above the switch) instead of the switch that actually clears
	 * the gate. The candidates are tried one by one in `OFF_GATE_FOCUS_ORDER`.
	 */
	const sectionRoot = useRef<HTMLDivElement>(null);
	const focused = useRef(false);
	const focusNonceRef = useRef(focusNonce);
	useEffect(() => {
		if (focusNonce === focusNonceRef.current) return;
		focusNonceRef.current = focusNonce;
		focused.current = false;
	}, [focusNonce]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `status` is a re-run trigger, not a value the body reads - a status refresh can enable the control (served consent arrives) after the settings read has settled.
	useEffect(() => {
		if (!focus) {
			focused.current = false;
			return;
		}
		if (focused.current || load.kind !== "ready" || pending !== null) return;
		const root = sectionRoot.current;
		const control = OFF_GATE_FOCUS_ORDER.map((selector) =>
			root?.querySelector<HTMLElement>(`${selector}:not(:disabled)`),
		).find((candidate) => candidate != null);
		if (!control) return;
		control.focus();
		focused.current = true;
	}, [focus, focusNonce, load, pending, status]);

	if (availability === "absent") return null;

	if (availability === "dark") {
		return (
			/*
			 * The dark launch is a LAUNCH STATE, not a fault: no Alert, no icon that
			 * says something broke, and no control that would pretend to work.
			 */
			<div data-agent-messages-section="" className="flex flex-col gap-2">
				<h3 className="text-heading text-ink">
					{t("ui.agentMessages.settings.dark.title")}
				</h3>
				<p className="max-w-2xl text-body-sm text-ink-muted">
					{t("ui.agentMessages.settings.dark.body")}
				</p>
				<p className="max-w-2xl text-body-sm text-ink-muted">
					{t("ui.agentMessages.settings.dark.nothing_enabled")}
				</p>
			</div>
		);
	}

	if (availability === "error") {
		return (
			<div data-agent-messages-section="">
				<Alert variant="warning">
					<AlertTitle>{t("ui.agentMessages.settings.error.title")}</AlertTitle>
					<AlertDescription>
						{refusal
							? settingsRefusalSentence(refusal)
							: t("ui.agentMessages.settings.refusal.generic")}
						<Button
							className="mt-3"
							variant="secondary"
							onClick={() => {
								retry();
								void onRefreshStatus(true);
							}}
						>
							{t("ui.agentMessages.settings.error.retry")}
						</Button>
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	if (!status || !accountId) return null;

	const hold = agentMessagesChiefOfStaffHold(status);

	return (
		<div
			ref={sectionRoot}
			data-agent-messages-section=""
			className="flex flex-col gap-6"
		>
			{/*
			 * Above the settings read on purpose: the hold comes from the status
			 * read the section already has, so it must not wait behind (or vanish
			 * with) the settings skeleton or a failed settings read.
			 */}
			{hold && (
				<ChiefOfStaffHoldNotice
					count={hold.count}
					onMessage={
						hold.sessionId && onOpenSession
							? () => onOpenSession(hold.sessionId as string)
							: undefined
					}
				/>
			)}

			{bannerVisible && (
				<DefaultOnBanner
					consentText={agentMessagesDefaultOnBannerConsentText(
						status,
						readySettings,
					)}
					pending={bannerActions.pending}
					failure={bannerActions.failure}
					onTurnOff={() => void bannerActions.turnOff()}
					onDismiss={() => void bannerActions.dismiss()}
				/>
			)}

			{actionRefusal && (
				<Alert variant="warning">
					<AlertDescription>
						{settingsRefusalSentence(actionRefusal)}
					</AlertDescription>
				</Alert>
			)}

			{load.kind === "loading" && <SettingsSkeleton />}

			{load.kind === "error" && (
				<Alert variant="warning">
					<AlertTitle>{t("ui.agentMessages.settings.error.title")}</AlertTitle>
					<AlertDescription>
						{load.refusal.code !== "client_unavailable" && (
							<span className="block">
								{settingsRefusalSentence(load.refusal)}
							</span>
						)}
						<span className="block">
							{t("ui.agentMessages.settings.error.no_changes")}
						</span>
						<Button className="mt-3" variant="secondary" onClick={retry}>
							{t("ui.agentMessages.settings.error.retry")}
						</Button>
					</AlertDescription>
				</Alert>
			)}

			{load.kind === "ready" && (
				<>
					<SettingsState
						state={agentMessagesSettingsState(status, load.settings)}
						status={status}
						settings={load.settings}
						accountId={loadAccount ?? accountId}
						accountMatches={accountMatches}
						api={api}
						pending={pending}
						localEnabled={localEnabled}
						onActionRefusal={setActionRefusal}
						onSettings={(settings) =>
							setLoad((current) =>
								current.kind === "ready" ? { ...current, settings } : current,
							)
						}
						onLocalEnabled={setLocalEnabled}
						onRefreshStatus={onRefreshStatus}
						setPending={setPending}
					/>

					<SessionDesignation
						value={sessionValue}
						sessions={sessions}
						pending={pending === "session"}
						disabled={pending !== null}
						onSave={async (next) => {
							setPending("session");
							setActionRefusal(null);
							try {
								await api.localSetting("team_bridge.session", next);
								setSessionValue(next);
								await onRefreshStatus(true);
							} catch (error) {
								setActionRefusal(agentMessagesRefusal(error));
							} finally {
								setPending(null);
							}
						}}
					/>

					{load.allowlist &&
						(agentMessagesSettingsState(status, load.settings) === "C" ||
							agentMessagesSettingsState(status, load.settings) === "D" ||
							agentMessagesSettingsState(status, load.settings) === "F") && (
							<AllowlistEditor
								key={load.allowlist.view.tenant_id ?? "tenant"}
								allowlist={load.allowlist}
								accountId={loadAccount ?? accountId}
								accountMatches={accountMatches}
								readOnly={
									status.read_only === true &&
									agentMessagesSettingsState(status, load.settings) === "F"
								}
								pending={pending !== null}
								onSaving={(saving) => setPending(saving ? "allowlist" : null)}
								onRefusal={setActionRefusal}
								onSaved={(allowlist) =>
									setLoad((current) =>
										current.kind === "ready"
											? { ...current, allowlist }
											: current,
									)
								}
								api={api}
							/>
						)}
				</>
			)}
		</div>
	);
}

function SettingsSkeleton() {
	return (
		<div className="flex flex-col gap-3" aria-busy="true">
			<Skeleton className="h-5 w-40" />
			<Skeleton className="h-4 w-full max-w-xl" />
			<Skeleton className="h-9 w-36" />
			<Skeleton className="h-4 w-64" />
		</div>
	);
}

/**
 * "N messages are waiting for your chief of staff" (runtime #2777, F8).
 *
 * WHY IT EXISTS. Under consent v1 the runtime holds incoming Team Bridge
 * messages rather than waking a chief of staff the owner has never used, and
 * that hold was silent: messages simply never arrived. One action releases
 * them, and it is SENDING a message in that conversation: #2777 releases the
 * hold only once the session has a real user turn on disk, so opening it
 * alone does nothing (review R1-1). The copy names that action and the button
 * takes the reader to where it happens.
 *
 * WITHOUT A TARGET (design D2) there is no button, and the sentence says
 * where to find the conversation instead of pointing at a control that is not
 * there.
 *
 * WHY IT LOOKS LIKE THIS. It is news, not a fault: the info band grammar
 * (`NOTICE_BAND`, the delegated-cleanup notice's shape) with its border made
 * transparent so the wash alone separates it, per the borderless rule for
 * quiet chrome. The button stays ghost (nothing is broken) but at full `ink`
 * rather than the ghost's muted resting ink (design D3): it is the one remedy
 * on the band, and outlined Pause/Turn off below must not out-shout it.
 * `<output>` is a polite live region, so a hold that appears while Settings is
 * open is announced without interrupting.
 */
const ChiefOfStaffHoldNotice: FC<{ count: number; onMessage?: () => void }> = ({
	count,
	onMessage,
}) => (
	<output className="block" data-agent-messages-hold="open_chief_of_staff">
		<Alert variant="info" className={cn(NOTICE_BAND, "border-transparent")}>
			<div className="flex w-full min-w-0 items-center gap-3">
				<p className="min-w-0 flex-1 text-body-sm text-ink">
					{onMessage
						? t("ui.agentMessages.settings.hold.chief_of_staff", { count })
						: t("ui.agentMessages.settings.hold.chief_of_staff_unlinked", {
								count,
							})}
				</p>
				{onMessage && (
					<Button
						variant="ghost"
						size="sm"
						className="shrink-0 text-ink"
						onClick={onMessage}
					>
						{t("ui.agentMessages.settings.hold.open")}
					</Button>
				)}
			</div>
		</Alert>
	</output>
);

/** The consent block every state that collects consent renders verbatim. */
const ConsentText: FC<{ text: string }> = ({ text }) => (
	<div className="rounded-md border border-hairline bg-sunken p-3">
		<p className="whitespace-pre-wrap text-body-sm text-ink-muted">{text}</p>
	</div>
);

type SettingsStateProps = {
	state: "B" | "C" | "D" | "E" | "F";
	status: AgentMessagesStatus;
	settings: AgentMessagesSettingsResult;
	accountId: string;
	/** False while the section's status belongs to a different account. */
	accountMatches: boolean;
	api: AgentMessagesSettingsApi;
	pending: string | null;
	localEnabled: boolean;
	onActionRefusal: (refusal: AgentMessagesRefusal | null) => void;
	onSettings: (settings: AgentMessagesSettingsResult) => void;
	onLocalEnabled: (enabled: boolean) => void;
	onRefreshStatus: (force?: boolean) => Promise<unknown> | undefined;
	setPending: (pending: string | null) => void;
};

const STATE_TITLE_KEY: Record<SettingsStateProps["state"], WithoutParams> = {
	B: "ui.agentMessages.settings.state.b_title",
	C: "ui.agentMessages.settings.state.c_title",
	D: "ui.agentMessages.settings.state.d_title",
	E: "ui.agentMessages.settings.state.e_title",
	F: "ui.agentMessages.settings.state.f_title",
};
const STATE_BODY_KEY: Record<SettingsStateProps["state"], WithoutParams> = {
	B: "ui.agentMessages.settings.state.b_body",
	C: "ui.agentMessages.settings.state.c_body",
	D: "ui.agentMessages.settings.state.d_body",
	E: "ui.agentMessages.settings.state.e_body",
	F: "ui.agentMessages.settings.state.f_body",
};

/*
 * Copy overrides for the two states whose opt-in wording would be false or
 * would invite an Enable under default-on. B (no endpoint yet) is described as
 * waiting for the automatic set-up, not as "off, turn it on"; E (turned off by
 * the member) points at the explicit path back without the word Enable.
 */
function defaultOnTitleKey(state: SettingsStateProps["state"]): WithoutParams {
	if (state === "B") return "ui.agentMessages.settings.default_on.b_title";
	return STATE_TITLE_KEY[state];
}
function defaultOnBodyKey(state: SettingsStateProps["state"]): WithoutParams {
	if (state === "B") return "ui.agentMessages.settings.default_on.b_body";
	if (state === "E") return "ui.agentMessages.settings.default_on.e_body";
	return STATE_BODY_KEY[state];
}

const SettingsState: FC<SettingsStateProps> = ({
	state,
	status,
	settings,
	accountId,
	accountMatches,
	api,
	pending,
	localEnabled,
	onActionRefusal,
	onSettings,
	onLocalEnabled,
	onRefreshStatus,
	setPending,
}) => {
	const consent = agentMessagesSettingsConsent(status);
	const tenant = settings.settings.tenant_id;
	const disabled = pending !== null || !accountMatches;
	/*
	 * Default-on is in force (runtime #2790): there is nothing to opt INTO, so
	 * this state renders no Enable button, no "enable later" or "off by
	 * default" cue and no consent-collection form for the not-yet-enrolled
	 * state. The way back after a Turn off stays the explicit settings path,
	 * worded "Turn on again" so no control here is named Enable. When the flag
	 * is absent or false (v1 hub, older runtime) every branch below is the
	 * opt-in UI it has always been.
	 */
	const defaultOn = agentMessagesDefaultOnInForce(status);

	async function write(
		next: "active" | "paused" | "disabled",
		extra: { consent_version?: string; consented_via?: "settings" } = {},
	) {
		// The controls are disabled in this state; this is the second gate.
		if (!accountMatches) return null;
		setPending(next);
		onActionRefusal(null);
		try {
			const result = await api.updateSettings({
				expected_account_id: accountId,
				tenant_id: tenant,
				state: next,
				...extra,
			});
			onSettings(result);
			// Under default-on the runtime persists the sticky local opt-out itself
			// once the hub accepts the disable; a second client write would be a
			// second source of truth for the same switch.
			if (next === "disabled" && !defaultOn) {
				// Opting out IS the endpoint's off switch, so the machine-local
				// preference follows it. Pause deliberately does not: "not now" is
				// not "off", and the enrollment stays usable for other machines.
				try {
					await api.localSetting("team_bridge.enabled", false);
					onLocalEnabled(false);
				} catch (error) {
					// The endpoint is already off; say the local preference failed
					// rather than implying the server write did.
					onActionRefusal(agentMessagesRefusal(error));
				}
			}
			return result;
		} catch (error) {
			const refusal = agentMessagesRefusal(error);
			onActionRefusal(refusal);
			if (refusal.code === "consent_version_unknown") {
				// Refresh and re-render; the NEXT click carries the new version.
				await onRefreshStatus(true);
			}
			return null;
		} finally {
			setPending(null);
		}
	}

	async function enable() {
		if (!consent || !accountMatches) return;
		const result = await write("active", {
			consent_version: consent.version,
			consented_via: "settings",
		});
		if (!result) return;
		setPending("local");
		try {
			await api.localSetting("team_bridge.enabled", true);
			onLocalEnabled(true);
			await onRefreshStatus(true);
		} catch (error) {
			onActionRefusal(agentMessagesRefusal(error));
		} finally {
			setPending(null);
		}
	}

	if (state === "F") {
		return (
			<div data-agent-messages-state={state} className="flex flex-col gap-3">
				<div className="rounded-md border border-hairline bg-sunken p-3">
					<p className="text-body-sm text-ink">
						{status.state_note?.trim()
							? status.state_note
							: t("ui.agentMessages.settings.state.turned_off_title")}
					</p>
					<p className="mt-1 text-body-sm text-ink-muted">
						{t("ui.agentMessages.settings.state.turned_off_org")}
					</p>
				</div>
				<p className="text-body-sm text-ink-muted">
					{t("ui.agentMessages.settings.state.read_only")}
				</p>
				<EndpointConsent settings={settings} status={status} readOnly />
				<LocalSwitch
					searchRow="agent-messages.enabled"
					value={localEnabled}
					disabled={disabled}
					description={t("ui.agentMessages.settings.local.stays_enrolled")}
					onChange={async (next) => {
						setPending("local");
						onActionRefusal(null);
						try {
							await api.localSetting("team_bridge.enabled", next);
							onLocalEnabled(next);
							await onRefreshStatus(true);
						} catch (error) {
							onActionRefusal(agentMessagesRefusal(error));
						} finally {
							setPending(null);
						}
					}}
				/>
			</div>
		);
	}

	const endpointLabel = settings.endpoint?.label?.trim();
	const consentRecord = settings.endpoint?.consent ?? null;
	const staleConsent = consentRecord !== null && !consentRecord.current;

	return (
		<div data-agent-messages-state={state} className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<h3 className="text-heading text-ink">
					{t(defaultOn ? defaultOnTitleKey(state) : STATE_TITLE_KEY[state])}
				</h3>
				{endpointLabel && (
					<span className="text-body-sm text-ink-muted">{endpointLabel}</span>
				)}
			</div>
			<p className="max-w-2xl text-body-sm text-ink-muted">
				{t(defaultOn ? defaultOnBodyKey(state) : STATE_BODY_KEY[state])}
			</p>

			{/* B and E collect consent: the served text is shown EXACTLY. Under
			    default-on B renders nothing here (no opt-in to offer) and E offers
			    the explicit way back without the word Enable. */}
			{defaultOn && state === "E" && (
				<div className="flex flex-col gap-3">
					{consent ? (
						<ConsentText text={consent.text} />
					) : (
						<Alert variant="warning">
							<AlertDescription>
								{t("ui.agentMessages.settings.consent.unavailable")}
							</AlertDescription>
						</Alert>
					)}
					{/* DELIBERATE consent-bearing re-opt-in (operator ruling, review
					    R1-2). After an EXPLICIT opt-out the runtime needs consent again
					    and the member must read the served text before re-enrolling;
					    removing this would strand them with no way back. The "no Enable
					    affordance" rule covers the default-on FIRST-RUN and ENROLLED
					    paths (B, C, D); this is the one control that opts back in. */}
					<div className="flex flex-wrap items-center gap-3">
						<Button
							data-agent-messages-action="turn_on_again"
							data-search-row="agent-messages.enabled"
							data-search-control
							onClick={() => void enable()}
							disabled={disabled || !consent}
						>
							{t("ui.agentMessages.settings.action.turn_on_again")}
						</Button>
					</div>
				</div>
			)}
			{!defaultOn && (state === "B" || state === "E") && (
				<div className="flex flex-col gap-3">
					{consent ? (
						<ConsentText text={consent.text} />
					) : (
						<Alert variant="warning">
							<AlertDescription>
								{t("ui.agentMessages.settings.consent.unavailable")}
							</AlertDescription>
						</Alert>
					)}
					<div className="flex flex-wrap items-center gap-3">
						<Button
							data-agent-messages-action="enable"
							data-search-row="agent-messages.enabled"
							data-search-control
							onClick={() => void enable()}
							disabled={disabled || !consent}
						>
							{state === "B"
								? t("ui.agentMessages.settings.action.enable")
								: t("ui.agentMessages.settings.action.enable_again")}
						</Button>
						<span className="text-meta text-ink-dim">
							{t("ui.agentMessages.settings.off_by_default")}
						</span>
					</div>
				</div>
			)}

			{state === "C" && settings.endpoint && (
				<div className="flex flex-col gap-4">
					<div className="flex flex-wrap gap-2">
						<Button
							data-agent-messages-action="pause"
							variant="secondary"
							disabled={disabled}
							onClick={() => void write("paused")}
						>
							{t("ui.agentMessages.settings.action.pause")}
						</Button>
						<Button
							data-agent-messages-action="turn_off"
							variant="secondary"
							disabled={disabled}
							onClick={() => void write("disabled")}
						>
							{t("ui.agentMessages.settings.action.turn_off")}
						</Button>
					</div>
					<EndpointConsent settings={settings} status={status} />
					{staleConsent && !defaultOn && (
						<ConsentRenewal
							onRenew={() => void enable()}
							disabled={disabled || !consent}
						/>
					)}
					<LocalSwitch
						searchRow="agent-messages.enabled"
						value={localEnabled}
						disabled={disabled}
						description={t("ui.agentMessages.settings.local.stays_enrolled")}
						onChange={async (next) => {
							setPending("local");
							onActionRefusal(null);
							try {
								await api.localSetting("team_bridge.enabled", next);
								onLocalEnabled(next);
								await onRefreshStatus(true);
							} catch (error) {
								onActionRefusal(agentMessagesRefusal(error));
							} finally {
								setPending(null);
							}
						}}
					/>
				</div>
			)}

			{state === "D" && settings.endpoint && (
				<div className="flex flex-col gap-4">
					<div className="flex flex-wrap gap-2">
						<Button
							data-agent-messages-action="resume"
							disabled={
								disabled ||
								(settings.settings.consent_required && consent === null)
							}
							onClick={() =>
								void write(
									"active",
									settings.settings.consent_required && consent
										? {
												consent_version: consent.version,
												consented_via: "settings",
											}
										: {},
								)
							}
						>
							{t("ui.agentMessages.settings.action.resume")}
						</Button>
						<Button
							data-agent-messages-action="turn_off"
							variant="secondary"
							disabled={disabled}
							onClick={() => void write("disabled")}
						>
							{t("ui.agentMessages.settings.action.turn_off")}
						</Button>
					</div>
					{settings.settings.consent_required && !consent && (
						<p className="text-body-sm text-ink-muted">
							{t("ui.agentMessages.settings.consent.unavailable")}
						</p>
					)}
					<EndpointConsent settings={settings} status={status} />
					{staleConsent && !defaultOn && (
						<ConsentRenewal
							onRenew={() => void enable()}
							disabled={disabled || !consent}
						/>
					)}
					{/* The machine switch belongs to D too (review R2-2). Paused is
					    an endpoint state; the switch is this machine's preference
					    under it. Without it, a member who turned this machine off
					    while paused had no way to clear the Team Bridge page's
					    `off_local` gate: Resume reactivates the endpoint and leaves
					    the machine off. Same control and write as C. */}
					<LocalSwitch
						searchRow="agent-messages.enabled"
						value={localEnabled}
						disabled={disabled}
						description={t("ui.agentMessages.settings.local.stays_enrolled")}
						onChange={async (next) => {
							setPending("local");
							onActionRefusal(null);
							try {
								await api.localSetting("team_bridge.enabled", next);
								onLocalEnabled(next);
								await onRefreshStatus(true);
							} catch (error) {
								onActionRefusal(agentMessagesRefusal(error));
							} finally {
								setPending(null);
							}
						}}
					/>
				</div>
			)}
		</div>
	);
};

const ConsentRenewal: FC<{ onRenew: () => void; disabled: boolean }> = ({
	onRenew,
	disabled,
}) => (
	<Alert variant="warning">
		<AlertDescription>
			{t("ui.agentMessages.settings.consent.renew")}
			<Button
				data-agent-messages-action="enable"
				className="mt-3"
				variant="secondary"
				disabled={disabled}
				onClick={onRenew}
			>
				{t("ui.agentMessages.settings.action.enable_again")}
			</Button>
		</AlertDescription>
	</Alert>
);

/**
 * The label for where consent was collected. The wire value is an open string
 * (a newer runtime may add a spelling), so an unknown one is shown as the
 * runtime sent it rather than as a missing catalogue key. Literal keys keep
 * the catalogue audit and the typed key union honest.
 */
function consentViaLabel(via: string): string {
	switch (via) {
		case "dialog":
			return t("ui.agentMessages.settings.consent.via_dialog");
		case "settings":
			return t("ui.agentMessages.settings.consent.via_settings");
		case "default_on":
			return t("ui.agentMessages.settings.consent.via_default_on");
		default:
			return via;
	}
}

/**
 * The consent/enrollment record in C/D. `readOnly` keeps F's retained record
 * read-only: a kill ends the flow, not the history, and no control may imply
 * the user can renew their way out of an organization's decision.
 */
const EndpointConsent: FC<{
	settings: AgentMessagesSettingsResult;
	status: AgentMessagesStatus;
	readOnly?: boolean;
}> = ({ settings, status, readOnly = false }) => {
	const record = settings.endpoint?.consent ?? null;
	const consent = agentMessagesSettingsConsent(status);
	if (!record) {
		return (
			<p className="text-body-sm text-ink-muted">
				{t("ui.agentMessages.settings.consent.no_record")}
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			<InfoGrid>
				<InfoItem
					label={t("ui.agentMessages.settings.consent.version")}
					value={record.version}
				/>
				<InfoItem
					label={t("ui.agentMessages.settings.consent.via")}
					value={consentViaLabel(record.consented_via)}
				/>
				<InfoItem
					label={t("ui.agentMessages.settings.consent.at")}
					value={record.consented_at}
				/>
			</InfoGrid>
			{!readOnly && consent && (
				<details>
					<summary className="cursor-pointer text-body-sm text-ink-muted">
						{t("ui.agentMessages.settings.consent.show")}
					</summary>
					<p className="mt-2 whitespace-pre-wrap text-body-sm text-ink-muted">
						{consent.text}
					</p>
				</details>
			)}
		</div>
	);
};

const LocalSwitch: FC<{
	value: boolean;
	disabled: boolean;
	description: string;
	onChange: (next: boolean) => Promise<void> | void;
	/**
	 * Settings search's stable row id, when this switch IS one of the page's
	 * searchable rows. The `team_bridge.enabled` preference is machine-local,
	 * so its only editor is this control — which is why the row has to exist
	 * here for a search result to land on it (review round 1, backend note).
	 */
	searchRow?: string;
}> = ({ value, disabled, description, onChange, searchRow }) => {
	const id = useId();
	return (
		<div
			data-search-row={searchRow}
			data-search-control={searchRow ? "" : undefined}
			className="flex items-start justify-between gap-4"
		>
			<div className="min-w-0">
				<p id={id} className="text-body-sm text-ink">
					{t("ui.agentMessages.settings.local.label")}
				</p>
				<p className="mt-0.5 text-meta text-ink-dim">{description}</p>
			</div>
			<Switch
				aria-labelledby={id}
				checked={value}
				disabled={disabled}
				onCheckedChange={(next) => void onChange(next)}
			/>
		</div>
	);
};

const SessionDesignation: FC<{
	value: string;
	sessions: readonly { session_id: string; title?: string | null }[];
	pending: boolean;
	disabled: boolean;
	onSave: (value: string) => Promise<void>;
}> = ({ value, sessions, pending, disabled, onSave }) => {
	const known = sessions.some((session) => session.session_id === value);
	return (
		<div
			data-search-row="agent-messages.session"
			data-search-control
			className="flex flex-col gap-2"
		>
			<h3 className="text-heading text-ink">
				{t("ui.agentMessages.settings.session.title")}
			</h3>
			<p className="max-w-2xl text-meta text-ink-dim">
				{t("ui.agentMessages.settings.session.help")}
			</p>
			<Select
				value={value === "" ? NO_SESSION : value}
				disabled={disabled}
				onValueChange={(next) => void onSave(next === NO_SESSION ? "" : next)}
			>
				<SelectTrigger
					className="w-full max-w-md"
					aria-label={t("ui.agentMessages.settings.session.title")}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={NO_SESSION}>
						{t("ui.agentMessages.settings.session.none")}
					</SelectItem>
					{sessions.map((session) => (
						<SelectItem key={session.session_id} value={session.session_id}>
							{session.title?.trim() || session.session_id}
						</SelectItem>
					))}
					{value !== "" && !known && (
						<SelectItem value={value}>{value}</SelectItem>
					)}
				</SelectContent>
			</Select>
			{value !== "" && !known && (
				<p className="text-meta text-ink-dim">
					{t("ui.agentMessages.settings.session.unavailable")}
				</p>
			)}
			{pending && (
				<p className="text-meta text-ink-dim" aria-live="polite">
					{t("ui.agentMessages.settings.saving")}
				</p>
			)}
		</div>
	);
};

type AllowlistEditorProps = {
	allowlist: AgentMessagesAllowlistResult;
	accountId: string;
	/** False while the section's status belongs to a different account. */
	accountMatches: boolean;
	/** F's posture: the server admits only safety-increasing edits. */
	readOnly: boolean;
	pending: boolean;
	api: AgentMessagesSettingsApi;
	onSaving: (saving: boolean) => void;
	onRefusal: (refusal: AgentMessagesRefusal | null) => void;
	onSaved: (allowlist: AgentMessagesAllowlistResult) => void;
};

const AllowlistEditor: FC<AllowlistEditorProps> = ({
	allowlist,
	accountId,
	accountMatches,
	readOnly,
	pending,
	api,
	onSaving,
	onRefusal,
	onSaved,
}) => {
	const [entries, setEntries] = useState<AllowlistDraftEntry[]>(() =>
		allowlistDraft(allowlist.allowlist.entries),
	);
	const [modes, setModes] = useState<Record<AllowlistDirection, AllowlistMode>>(
		() => ({
			send: allowlist.view.directions.send.mode,
			receive: allowlist.view.directions.receive.mode,
		}),
	);
	const disabled = pending || readOnly || !accountMatches;
	const savedSignature = allowlistSignature(
		allowlistReplaceSet(entriesFromWire(allowlist), modesFromView(allowlist)),
	);
	const gate = allowlistSaveGate({
		entries,
		modes,
		savedSignature,
		saving: pending,
	});

	// A local sequence, not a clock: two adds in one tick must not collide on a
	// React key (the clock can repeat within a millisecond).
	const sequence = useRef(0);
	const add = (entry: Omit<AllowlistDraftEntry, "key">) =>
		setEntries((current) => [
			...current,
			{
				...entry,
				key: `${entry.direction}:${entry.effect}:${sequence.current++}`,
			},
		]);
	const remove = (key: string) =>
		setEntries((current) => current.filter((entry) => entry.key !== key));

	const save = async () => {
		// The controls are disabled, so this is the second gate: a read-only or
		// cross-account state must never send a replace-set.
		if (disabled) return;
		onSaving(true);
		onRefusal(null);
		try {
			const result = await api.updateAllowlist({
				expected_account_id: accountId,
				tenant_id: allowlist.allowlist.tenant_id,
				entries: allowlistReplaceSet(entries, modes),
			});
			const wire = allowlistDraft(result.allowlist.entries);
			setEntries(wire);
			setModes({
				send: result.view.directions.send.mode,
				receive: result.view.directions.receive.mode,
			});
			onSaved(result);
		} catch (error) {
			onRefusal(agentMessagesRefusal(error));
		} finally {
			onSaving(false);
		}
	};

	return (
		<div data-agent-messages-allowlist="" className="flex flex-col gap-5">
			<div>
				<h3 className="text-heading text-ink">
					{t("ui.agentMessages.settings.allowlist.title")}
				</h3>
				<p className="mt-1 max-w-2xl text-body-sm text-ink-muted">
					{t("ui.agentMessages.settings.allowlist.description")}
				</p>
			</div>

			<DirectionGroup
				direction="receive"
				title={t("ui.agentMessages.settings.allowlist.receive")}
				mode={modes.receive}
				cues={allowlist.view.cues}
				entries={entries.filter((entry) => entry.direction === "receive")}
				disabled={disabled}
				onMode={(mode) =>
					setModes((current) => ({ ...current, receive: mode }))
				}
				onAdd={(entry) => add({ ...entry, direction: "receive" })}
				onRemove={remove}
			/>
			<DirectionGroup
				direction="send"
				title={t("ui.agentMessages.settings.allowlist.send")}
				mode={modes.send}
				cues={allowlist.view.cues}
				entries={entries.filter((entry) => entry.direction === "send")}
				disabled={disabled}
				onMode={(mode) => setModes((current) => ({ ...current, send: mode }))}
				onAdd={(entry) => add({ ...entry, direction: "send" })}
				onRemove={remove}
			/>

			<div className="flex flex-wrap items-center gap-3">
				<Button
					onClick={() => void save()}
					disabled={gate.disabled || disabled}
				>
					<Save size={14} />
					{t("ui.agentMessages.settings.allowlist.save")}
				</Button>
				{gate.disabled && gate.reason === "needs_entry" && (
					<span className="text-meta text-ink-dim">
						{t("ui.agentMessages.settings.allowlist.needs_entry")}
					</span>
				)}
				{gate.disabled && gate.reason === "unchanged" && (
					<span className="text-meta text-ink-dim">
						{t("ui.agentMessages.settings.allowlist.unchanged")}
					</span>
				)}
				{readOnly && (
					<span className="text-meta text-ink-dim">
						{t("ui.agentMessages.settings.allowlist.read_only")}
					</span>
				)}
				{pending && (
					<span className="text-meta text-ink-dim" aria-live="polite">
						{t("ui.agentMessages.settings.saving")}
					</span>
				)}
			</div>
		</div>
	);
};

/** The saved policy as draft rows, WITHOUT the editor's live edits. */
function entriesFromWire(allowlist: AgentMessagesAllowlistResult) {
	return allowlistDraft(allowlist.allowlist.entries);
}

function modesFromView(
	allowlist: AgentMessagesAllowlistResult,
): Record<AllowlistDirection, AllowlistMode> {
	return {
		send: allowlist.view.directions.send.mode,
		receive: allowlist.view.directions.receive.mode,
	};
}

type DirectionGroupProps = {
	direction: AllowlistDirection;
	title: string;
	mode: AllowlistMode;
	cues: AgentMessagesAllowlistResult["view"]["cues"];
	entries: readonly AllowlistDraftEntry[];
	disabled: boolean;
	onMode: (mode: AllowlistMode) => void;
	onAdd: (entry: {
		effect: "allow" | "deny";
		kind: AllowlistEntryKind;
		id: string;
	}) => void;
	onRemove: (key: string) => void;
};

const DirectionGroup: FC<DirectionGroupProps> = ({
	direction,
	title,
	mode,
	cues,
	entries,
	disabled,
	onMode,
	onAdd,
	onRemove,
}) => {
	const allowed = entries.filter((entry) => entry.effect === "allow");
	const blocked = entries.filter((entry) => entry.effect === "deny");
	return (
		<fieldset
			data-agent-messages-direction={direction}
			data-agent-messages-level={mode}
			className="flex flex-col gap-3 rounded-md border border-hairline p-3"
		>
			<legend className="px-1 text-body-sm text-ink">{title}</legend>
			<LevelControl mode={mode} disabled={disabled} onMode={onMode} />
			<div className="flex flex-col gap-1 text-meta text-ink-dim">
				{cues.allow_entry_switches_direction_to_listed_only && (
					<p>{t("ui.agentMessages.settings.allowlist.cue_listed_only")}</p>
				)}
				{cues.removing_allow_does_not_stop_open_thread && (
					<p>{t("ui.agentMessages.settings.allowlist.cue_remove")}</p>
				)}
				{cues.deny_stops_pair_both_directions && (
					<p>{t("ui.agentMessages.settings.allowlist.cue_deny")}</p>
				)}
			</div>

			{mode === "listed_only" && (
				<div className="flex flex-col gap-2">
					<p className="text-meta text-ink-dim">
						{t("ui.agentMessages.settings.allowlist.allowed_heading")}
					</p>
					{allowed.length === 0 && (
						<p className="text-body-sm text-ink-muted">
							{t("ui.agentMessages.settings.allowlist.allowed_empty")}
						</p>
					)}
					{allowed.map((entry) => (
						<EntryRow
							key={entry.key}
							entry={entry}
							disabled={disabled}
							onRemove={() => onRemove(entry.key)}
						/>
					))}
					<AddEntryForm
						label={t("ui.agentMessages.settings.allowlist.add_allowed")}
						disabled={disabled}
						onAdd={(entry) => onAdd({ ...entry, effect: "allow" })}
					/>
				</div>
			)}

			<div className="flex flex-col gap-2">
				<p className="text-meta text-ink-dim">
					{t("ui.agentMessages.settings.allowlist.blocked_heading")}
				</p>
				{blocked.length === 0 && (
					<p className="text-body-sm text-ink-muted">
						{t("ui.agentMessages.settings.allowlist.blocked_empty")}
					</p>
				)}
				{blocked.map((entry) => (
					<EntryRow
						key={entry.key}
						entry={entry}
						disabled={disabled}
						onRemove={() => onRemove(entry.key)}
					/>
				))}
				<AddEntryForm
					label={t("ui.agentMessages.settings.allowlist.add_blocked")}
					disabled={disabled}
					onAdd={(entry) => onAdd({ ...entry, effect: "deny" })}
				/>
			</div>
		</fieldset>
	);
};

const LevelControl: FC<{
	mode: AllowlistMode;
	disabled: boolean;
	onMode: (mode: AllowlistMode) => void;
}> = ({ mode, disabled, onMode }) => {
	const options: { value: AllowlistMode; label: string }[] = [
		{
			value: "class_default",
			label: t("ui.agentMessages.settings.allowlist.anyone"),
		},
		{
			value: "listed_only",
			label: t("ui.agentMessages.settings.allowlist.listed_only"),
		},
	];
	return (
		/*
		 * The shipped segmented-pair idiom (settings-page UsageInfo): a sunken
		 * well holding ghost Buttons, the pressed one lifted to `surface`. No
		 * new fill or border triple is introduced, so the contrast contract
		 * needs no row for it.
		 */
		<fieldset className="m-0 w-fit border-0 p-0">
			<legend className="sr-only">
				{t("ui.agentMessages.settings.allowlist.level")}
			</legend>
			<div
				data-glass-well=""
				className="flex gap-0.5 rounded-md bg-sunken p-0.5"
			>
				{options.map((option) => (
					<Button
						key={option.value}
						variant="ghost"
						size="sm"
						aria-pressed={mode === option.value}
						disabled={disabled}
						onClick={() => onMode(option.value)}
						className={cn(
							mode === option.value && "bg-surface text-ink hover:bg-surface",
						)}
					>
						{option.label}
					</Button>
				))}
			</div>
		</fieldset>
	);
};

const EntryRow: FC<{
	entry: AllowlistDraftEntry;
	disabled: boolean;
	onRemove: () => void;
}> = ({ entry, disabled, onRemove }) => (
	<div className="flex items-center justify-between gap-3 rounded border border-hairline px-2 py-1">
		<div className="flex min-w-0 items-baseline gap-2">
			<span className="shrink-0 text-meta text-ink-dim">
				{entry.kind === "endpoint"
					? t("ui.agentMessages.settings.allowlist.agent_id")
					: t("ui.agentMessages.settings.allowlist.person_id")}
			</span>
			{/* The full id stays visible and selectable: it is the only
			    identity the wire carries, and truncation would make it
			    unverifiable. */}
			<span className="break-all font-mono text-body-sm text-ink">
				{entry.id}
			</span>
		</div>
		<Button
			variant="secondary"
			size="sm"
			disabled={disabled}
			aria-label={`${t("ui.agentMessages.settings.allowlist.remove")} ${entry.id}`}
			onClick={onRemove}
		>
			{t("ui.agentMessages.settings.allowlist.remove")}
		</Button>
	</div>
);

const AddEntryForm: FC<{
	label: string;
	disabled: boolean;
	onAdd: (entry: { kind: AllowlistEntryKind; id: string }) => void;
}> = ({ label, disabled, onAdd }) => {
	const [kind, setKind] = useState<AllowlistEntryKind>("endpoint");
	const [value, setValue] = useState("");
	const [error, setError] = useState<string | null>(null);
	const fieldId = useId();
	const helpId = `${fieldId}-help`;

	const submit = () => {
		const problem = allowlistIdentifierError(value.trim());
		setError(problem);
		if (problem) return;
		onAdd({ kind, id: value.trim() });
		setValue("");
	};

	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor={fieldId}>{label}</Label>
			<div className="flex flex-wrap items-center gap-2">
				<Select
					value={kind}
					disabled={disabled}
					onValueChange={(next) => setKind(next as AllowlistEntryKind)}
				>
					<SelectTrigger
						className="w-32"
						aria-label={t("ui.agentMessages.settings.allowlist.kind")}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="endpoint">
							{t("ui.agentMessages.settings.allowlist.kind_agent")}
						</SelectItem>
						<SelectItem value="account">
							{t("ui.agentMessages.settings.allowlist.kind_person")}
						</SelectItem>
					</SelectContent>
				</Select>
				<Input
					id={fieldId}
					aria-describedby={helpId}
					className="max-w-xs"
					value={value}
					disabled={disabled}
					placeholder={t("ui.agentMessages.settings.allowlist.identifier")}
					onChange={(event) => setValue(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							submit();
						}
					}}
				/>
				<Button
					variant="secondary"
					size="sm"
					disabled={disabled}
					onClick={submit}
				>
					{t("ui.agentMessages.settings.allowlist.add")}
				</Button>
			</div>
			<p id={helpId} className="text-meta text-ink-dim">
				{kind === "endpoint"
					? t("ui.agentMessages.settings.allowlist.identifier_help_agent")
					: t("ui.agentMessages.settings.allowlist.identifier_help_person")}
			</p>
			{error && <p className="text-meta text-danger">{error}</p>}
		</div>
	);
};

/**
 * The availability latch for the page and rail. Once the section has been
 * observable, a later failed read keeps an error surface on screen; a status
 * this client never observed keeps it absent.
 */
export function useAgentMessagesSettingsAvailability(): AgentMessagesSettingsAvailability {
	const { snapshot } = useAgentMessages();
	const [everVisible, setEverVisible] = useState(false);
	const availability = agentMessagesSettingsAvailability({
		status: snapshot.status,
		refused: snapshot.refusal !== null,
		everVisible,
		checking: snapshot.checking,
	});
	useEffect(() => {
		if (availability !== "absent") setEverVisible(true);
	}, [availability]);
	// Settings mounting is one of §5.1's natural boundaries. The shared model's
	// five-minute floor still applies; this is not a timer.
	useEffect(() => {
		void checkAgentMessagesSurface();
	}, []);
	return availability;
}
