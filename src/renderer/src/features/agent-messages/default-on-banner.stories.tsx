import { t } from "@shared/i18n";
import { useAgentMessagesOnboardingStore } from "@shared/store/agent-messages-onboarding-store";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { useLayoutEffect, useMemo, useState } from "react";
import allowlistFixture from "../../../../../scripts/fixtures/agent-messages-allowlist.json";
import settingsFixture from "../../../../../scripts/fixtures/agent-messages-settings.json";
import statusFixture from "../../../../../scripts/fixtures/agent-messages-status.json";
import v2Consent from "../../../../../scripts/fixtures/team-bridge-consent-v2.json";
import type {
	AgentMessagesAllowlistResult,
	AgentMessagesSettingsResult,
	AgentMessagesStatus,
} from "../../../../shared/agent-messages-contract";
import { SettingsSection } from "../settings/components/settings-section";
import { TeamBridgeDefaultOnBanner } from "../team-bridge/team-bridge-default-on-banner";
import { TeamBridgePageView } from "../team-bridge/team-bridge-page";
import pageMeta from "../team-bridge/team-bridge-page.stories";
import {
	AgentMessagesSettings,
	type AgentMessagesSettingsApi,
} from "./agent-messages-settings";

type FrameState =
	| "pending"
	| "expanded"
	| "dismissed"
	| "off"
	| "failed"
	| "v1"
	| "loading";
type FrameProps = {
	surface: "settings" | "page";
	state: FrameState;
	/** The v1/no-field compatibility control, not a claim of historical pixels. */
	before?: boolean;
};

/**
 * Both REAL surface components with a stateful desktop transport fixture.
 * Expanded, dismissed, off and failed frames are reached by clicking the real
 * controls in `play`, not by swapping in a decorative approximation of a banner.
 * The local onboarding belt and query cache are isolated per story: visiting a
 * Dismissed board must not hide Pending on the next board or in another theme.
 *
 * BEFORE is explicitly the no-default_on compatibility control. It uses the
 * unchanged opt-in branches in this checkout; it is NOT an old-source build.
 * Pixel evidence must label that distinction rather than claiming a historical
 * before frame that was never rendered.
 */
function Frame({ surface, state, before = false }: FrameProps) {
	const [ready, setReady] = useState(false);
	const [client] = useState(
		() =>
			new QueryClient({
				defaultOptions: { queries: { retry: false, gcTime: 0 } },
			}),
	);
	useLayoutEffect(() => {
		const store = useAgentMessagesOnboardingStore;
		const previous = store.getState();
		store.setState({ seen: {}, defaultOnDismissed: {} });
		setReady(true);
		return () => {
			client.clear();
			store.setState({
				seen: previous.seen,
				defaultOnDismissed: previous.defaultOnDismissed,
			});
		};
	}, [client]);
	const fixture = useMemo(() => {
		const legacy = before || state === "v1";
		const status = structuredClone(statusFixture) as AgentMessagesStatus;
		const settings = structuredClone(
			settingsFixture,
		) as AgentMessagesSettingsResult;
		status.tenant_id = settings.settings.tenant_id;
		status.surface_state = legacy && state === "v1" ? "B" : "C";
		status.local.enabled = status.surface_state === "C";
		status.visibility.onboarding = status.surface_state === "B";
		if (status.surface_state === "B") settings.endpoint = null;
		if (!legacy) {
			status.default_on = { in_force: true, notice_pending: true };
			settings.default_on = true;
			status.consent = {
				version: v2Consent.version,
				text: v2Consent.text,
				source: "served",
			};
			settings.settings.consent_version = v2Consent.version;
			if (settings.endpoint?.consent) {
				settings.endpoint.consent.consented_via = "default_on";
				settings.endpoint.consent.version = v2Consent.version;
			}
		}
		// Authoritative 2035-byte ConsentTextV2, extracted without paraphrasing.
		// Its source and SHA-256 live beside the fixture; the suite pins the hash.
		if (before && state === "off" && settings.endpoint) {
			settings.endpoint.state = "disabled";
			settings.settings.consent_required = true;
			status.surface_state = "E";
			status.local.enabled = false;
		}
		let current = settings;
		const api: AgentMessagesSettingsApi = {
			settings: async () =>
				state === "loading" ? new Promise(() => {}) : structuredClone(current),
			allowlist: async () =>
				structuredClone(allowlistFixture) as AgentMessagesAllowlistResult,
			updateAllowlist: async () =>
				structuredClone(allowlistFixture) as AgentMessagesAllowlistResult,
			updateSettings: async (body) => {
				if (state === "failed")
					throw new Error("Story fixture: turn off refused");
				if (current.endpoint)
					current = {
						...current,
						endpoint: { ...current.endpoint, state: body.state },
					};
				return structuredClone(current);
			},
			localSetting: async () => ({}),
			dismissOnboarding: async () => ({ onboarding: "seen" }),
		};
		return { status, api };
	}, [state, before]);
	if (!ready) return null;
	return (
		<QueryClientProvider client={client}>
			{surface === "settings" ? (
				<div className="h-dvh overflow-y-auto bg-canvas p-6">
					<SettingsSection
						title={t("ui.agentMessages.settings.section")}
						icon={MessageSquare}
					>
						<AgentMessagesSettings
							availability="visible"
							status={fixture.status}
							accountId={fixture.status.account_id}
							api={fixture.api}
							onRefreshStatus={async () => {}}
						/>
					</SettingsSection>
				</div>
			) : (
				<div className="h-dvh">
					<TeamBridgePageView
						{...pageMeta.args}
						gatePending={state === "loading"}
						notice={
							before ? null : (
								<TeamBridgeDefaultOnBanner
									status={fixture.status}
									api={fixture.api}
								/>
							)
						}
					/>
				</div>
			)}
		</QueryClientProvider>
	);
}

const meta = {
	title: "Team Bridge/Default on",
	component: Frame,
	// A theme switch replays play(). Remount its isolated state too, otherwise a
	// prior Dismiss click would make the next theme's pending control disappear.
	render: (args, context) => (
		<Frame
			key={`${context.id}:${String((context.args as Record<string, unknown>).theme)}:${args.state}:${args.before}`}
			{...args}
		/>
	),
	parameters: { layout: "fullscreen" },
	args: { surface: "settings", state: "pending", before: false },
} satisfies Meta<typeof Frame>;
export default meta;
type Story = StoryObj<typeof meta>;

function scene(
	surface: FrameProps["surface"],
	state: FrameState,
	before = false,
): Story {
	return {
		args: { surface, state, before },
		play: async ({ canvasElement }) => {
			const canvas = within(canvasElement);
			if (state === "loading") return;
			if (before || state === "v1") {
				if (surface === "settings") {
					await canvas.findByRole("heading", {
						name:
							state === "v1"
								? "Agent messages are off"
								: state === "off"
									? "Turned off"
									: "On",
					});
					if (state === "failed") {
						await userEvent.click(
							canvas.getByRole("button", { name: "Turn off" }),
						);
						await canvas.findByText(/could not be enabled/);
					}
				}
				await waitFor(() =>
					expect(
						canvasElement.querySelector(
							'[data-agent-messages-banner="default-on"]',
						),
					).toBeNull(),
				);
				return;
			}
			const band = await canvas.findByRole("region", {
				name: "Team Bridge is on for you",
			});
			const actions = within(band);
			if (state === "expanded")
				await userEvent.click(
					actions.getByRole("button", { name: "Read what this means" }),
				);
			if (state === "dismissed")
				await userEvent.click(actions.getByRole("button", { name: "Dismiss" }));
			if (state === "off" || state === "failed")
				await userEvent.click(
					actions.getByRole("button", { name: "Turn off" }),
				);
			if (state === "dismissed" || state === "off")
				await waitFor(() =>
					expect(
						canvas.queryByRole("region", { name: "Team Bridge is on for you" }),
					).toBeNull(),
				);
			if (state === "failed") await canvas.findByRole("alert");
			expect(canvas.queryByRole("button", { name: /enable/i })).toBeNull();
			expect(canvas.queryByRole("dialog")).toBeNull();
			expect(canvas.queryByRole("alertdialog")).toBeNull();
		},
	};
}

// Every board supports ?args=theme:localOperatorLight or localOperatorDark via
// the existing preview-level theme control; no parallel theme implementation.
export const SettingsPending = scene("settings", "pending");
export const SettingsExpanded = scene("settings", "expanded");
export const SettingsDismissed = scene("settings", "dismissed");
export const SettingsOff = scene("settings", "off");
export const SettingsFailed = scene("settings", "failed");
export const SettingsV1 = scene("settings", "v1");
export const SettingsLoading = scene("settings", "loading");
export const PagePending = scene("page", "pending");
export const PageExpanded = scene("page", "expanded");
export const PageDismissed = scene("page", "dismissed");
export const PageOff = scene("page", "off");
export const PageFailed = scene("page", "failed");
export const PageV1 = scene("page", "v1");
export const PageLoading = scene("page", "loading");
export const BeforeSettingsPending = scene("settings", "pending", true);
export const BeforeSettingsDismissed = scene("settings", "dismissed", true);
export const BeforeSettingsOff = scene("settings", "off", true);
export const BeforeSettingsFailed = scene("settings", "failed", true);
export const BeforeSettingsV1 = scene("settings", "v1", true);
export const BeforePagePending = scene("page", "pending", true);
export const BeforePageDismissed = scene("page", "dismissed", true);
export const BeforePageOff = scene("page", "off", true);
export const BeforePageFailed = scene("page", "failed", true);
export const BeforePageV1 = scene("page", "v1", true);
