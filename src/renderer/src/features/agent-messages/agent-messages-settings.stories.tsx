import { SettingsSection } from "@features/settings/components/settings-section";
import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, waitFor, within } from "@storybook/test";
import { MessageSquare } from "lucide-react";
import allowlistFixture from "../../../../../scripts/fixtures/agent-messages-allowlist.json";
import settingsFixture from "../../../../../scripts/fixtures/agent-messages-settings.json";
import statusFixture from "../../../../../scripts/fixtures/agent-messages-status.json";
import type {
	AgentMessagesAllowlistResult,
	AgentMessagesSettingsResult,
	AgentMessagesStatus,
} from "../../../../shared/agent-messages-contract";
import type {
	AgentMessagesSettingsApi,
	AgentMessagesSettingsProps,
} from "./agent-messages-settings";
import { AgentMessagesSettings } from "./agent-messages-settings";

/**
 * Presentation fixtures only. The section's real reads and writes cross the
 * desktop transport; Storybook substitutes them so a state is one props
 * change rather than a live daemon plus a five-minute status cache.
 *
 * The status shape is the wave-1 fixture with the surface letter changed; the
 * settings/allowlist payloads are the server's own `result` shapes.
 */
const baseStatus: AgentMessagesStatus =
	statusFixture as unknown as AgentMessagesStatus;

function statusWith(
	patch: Omit<Partial<AgentMessagesStatus>, "local"> & {
		local?: Partial<AgentMessagesStatus["local"]>;
	},
): AgentMessagesStatus {
	return {
		...baseStatus,
		...patch,
		local: { ...baseStatus.local, ...(patch.local ?? {}) },
	};
}

const activeSettings =
	settingsFixture as unknown as AgentMessagesSettingsResult;
const allowlistResult =
	allowlistFixture as unknown as AgentMessagesAllowlistResult;

function settingsWith(
	state: "active" | "paused" | "disabled" | null,
): AgentMessagesSettingsResult {
	if (state === null) {
		return {
			endpoint: null,
			settings: {
				tenant_id: "tnt_bridge_e2e",
				eligible: true,
				consent_version: "bridge_consent_v1",
				consent_required: true,
			},
		};
	}
	const endpoint = activeSettings.endpoint;
	if (!endpoint) throw new Error("the active fixture carries an endpoint");
	return { ...activeSettings, endpoint: { ...endpoint, state } };
}

function fakeApi(
	settings: AgentMessagesSettingsResult,
	allowlist: AgentMessagesAllowlistResult | null = allowlistResult,
): AgentMessagesSettingsApi {
	return {
		settings: async () => structuredClone(settings),
		updateSettings: async (body) => ({
			...structuredClone(settings),
			endpoint:
				settings.endpoint === null
					? structuredClone(activeSettings.endpoint)
					: { ...settings.endpoint, state: body.state },
		}),
		allowlist: async () =>
			allowlist === null ? null : structuredClone(allowlist),
		updateAllowlist: async () => structuredClone(allowlistResult),
		localSetting: async () => ({}),
		dismissOnboarding: async () => ({ onboarding: "seen" as const }),
	};
}

const meta: Meta<typeof AgentMessagesSettings> = {
	title: "Agent messages/Settings",
	component: AgentMessagesSettings,
	parameters: { layout: "fullscreen" },
	args: {
		availability: "visible",
		status: statusWith({ surface_state: "C" }),
		accountId: "account-a",
		refusal: null,
		api: fakeApi(activeSettings),
		onRefreshStatus: () => {},
		sessions: [
			{ session_id: "aaaaaaaaaaaa", title: "Research" },
			{ session_id: "bbbbbbbbbbbb", title: "Inbox triage" },
		],
	},
};
export default meta;
type Story = StoryObj<typeof meta>;

/** State B: eligible, no endpoint yet. The on-ramp renders the served text. */
export const OnRamp: Story = {
	args: {
		status: statusWith({ surface_state: "B", local: { enabled: false } }),
		api: fakeApi(settingsWith(null)),
	},
};

/** State C: active, with a listed-only send policy and one blocked person. */
export const Populated: Story = {
	args: {
		status: statusWith({
			surface_state: "C",
			local: { enabled: true, session: "aaaaaaaaaaaa" },
		}),
	},
};

/** State D: paused by the reader; resume needs no consent. */
export const Paused: Story = {
	args: {
		status: statusWith({ surface_state: "D", local: { enabled: true } }),
		api: fakeApi(settingsWith("paused")),
	},
};

/** State E: opted out. Enabling again must echo the served consent version. */
export const OptedOut: Story = {
	args: {
		status: statusWith({ surface_state: "E", local: { enabled: false } }),
		api: fakeApi(settingsWith("disabled")),
	},
};

/** State F: an organization kill with a retained endpoint. Read-only consent. */
export const TurnedOff: Story = {
	args: {
		status: statusWith({
			surface_state: "F",
			read_only: true,
			state_note: "Agent messages are turned off",
			local: { enabled: true },
		}),
	},
};

/** The dark launch: a launch state, not a fault, and no controls at all. */
export const NotAvailableYet: Story = {
	args: {
		availability: "dark",
		status: statusWith({ surface_state: "G" }),
	},
};

/** The first read is in flight: skeletons, never a page spinner. */
export const Loading: Story = {
	args: {
		api: {
			...fakeApi(activeSettings),
			settings: () => new Promise(() => {}),
		},
	},
};

/** A failed read keeps a Retry, with the refusal sentence rather than a stack. */
export const ReadFailed: Story = {
	args: {
		api: {
			...fakeApi(activeSettings),
			settings: async () => {
				throw new Error("offline");
			},
		},
	},
};

/*
 * The chief-of-staff delivery hold (runtime #2777). The runtime holds incoming
 * messages while the designated chief of staff has never been opened, and the
 * status read reports how many; each story below is one count.
 */
const HOLD_SESSION = "aaaaaaaaaaaa";
function holdStatus(count: number | null): AgentMessagesStatus {
	return statusWith({
		surface_state: "C",
		local: { enabled: true, session: HOLD_SESSION },
		delivery_hold:
			count === null
				? null
				: { code: "open_chief_of_staff", count, session: HOLD_SESSION },
	});
}

/** One message held: singular copy, with the button that opens the session. */
export const HoldOneMessage: Story = {
	args: { status: holdStatus(1), onOpenSession: () => {} },
};

/** Several messages held: plural copy. */
export const HoldSeveralMessages: Story = {
	args: { status: holdStatus(7), onOpenSession: () => {} },
};

/** Nothing held (the runtime sends `null`; an older one omits the key): no notice. */
export const HoldNone: Story = {
	args: { status: holdStatus(null), onOpenSession: () => {} },
};

/** The hold renders while the settings read is still loading. */
export const HoldWhileLoading: Story = {
	args: {
		status: holdStatus(3),
		onOpenSession: () => {},
		api: {
			...fakeApi(activeSettings),
			settings: () => new Promise(() => {}),
		},
	},
};

/*
 * Design D2: no session to open - neither the runtime's designation nor the
 * local preference names one - so there is no button, and the sentence says
 * where to find the conversation instead. `onOpenSession` is still passed,
 * as the page always does: the missing target is the trigger, not the prop.
 */
export const HoldNoSession: Story = {
	args: {
		status: statusWith({
			surface_state: "C",
			local: { enabled: true, session: "" },
			delivery_hold: { code: "open_chief_of_staff", count: 2, session: null },
		}),
		onOpenSession: () => {},
	},
};

/*
 * Design D1: the notice in its real context - the page's `SettingsSection`
 * heading, description, column width and closing rule, copied from the
 * `settings-page.tsx` mount - so its placement under the heading can be
 * judged rather than the bare section edge to edge.
 */
export const HoldInSettingsSection: Story = {
	args: { status: holdStatus(7), onOpenSession: () => {} },
	render: (args) => (
		<div className="min-h-screen bg-canvas p-8">
			<div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
				<SettingsSection
					title="Agent messages"
					icon={MessageSquare}
					description="Your agent can exchange messages with other members' agents in your organization."
					className="border-b border-hairline pb-8"
				>
					{/* Storybook merges meta args into these at render; its type
					    only knows they are partial. */}
					<AgentMessagesSettings {...(args as AgentMessagesSettingsProps)} />
				</SettingsSection>
			</div>
		</div>
	),
};

/**
 * "Show when I'm typing" with the `team_bridge_typing` capability on. The
 * switch sits directly under "Enabled on this machine" - the two per-machine
 * switches read as one group (design round 1, D2) - and is a settings-search
 * row like its siblings (D3). The play pins both.
 */
export const ShareTypingSwitch: Story = {
	args: {
		status: statusWith({
			surface_state: "C",
			local: { enabled: true, session: "aaaaaaaaaaaa" },
		}),
		typingAvailable: true,
		api: {
			...fakeApi({ ...activeSettings, share_typing: true }),
			setShareTyping: async (_accountId: string, next: boolean) => next,
		},
	},
	play: async ({ canvasElement }) => {
		const typing = await waitFor(() => {
			const row = canvasElement.querySelector<HTMLElement>(
				"[data-agent-messages-share-typing]",
			);
			expect(row).not.toBeNull();
			return row as HTMLElement;
		});
		expect(typing.getAttribute("data-search-row")).toBe(
			"agent-messages.share-typing",
		);
		expect(typing.hasAttribute("data-search-control")).toBe(true);
		const rows = [
			...canvasElement.querySelectorAll<HTMLElement>(
				'[data-search-row="agent-messages.enabled"], [data-agent-messages-share-typing], [data-search-row="agent-messages.session"]',
			),
		].map((row) => row.getAttribute("data-search-row"));
		expect(rows).toEqual([
			"agent-messages.enabled",
			"agent-messages.share-typing",
			"agent-messages.session",
		]);
	},
};

/*
 * Screening model (local-operator #3632). The vetted list is the runtime's,
 * served on the settings read; these stories use the four pairs it ships.
 * Automatic (`preferred: null`) is the default and names the first model.
 */
const SCREENING_MODELS = [
	["anthropic", "claude-sonnet-5-5"],
	["radient", "anthropic/claude-sonnet-5.5"],
	["anthropic", "claude-opus-5-5"],
	["radient", "anthropic/claude-opus-5.5"],
].map(([provider, model_id]) => ({
	value: `${provider}/${model_id}`,
	provider,
	model_id,
}));

function screeningSettings(
	preferred: string | null,
	models = SCREENING_MODELS,
): AgentMessagesSettingsResult {
	return { ...activeSettings, screening: { preferred, models } };
}

const screeningStatus = statusWith({
	surface_state: "C",
	local: { enabled: true, session: "aaaaaaaaaaaa" },
});

const findScreeningRow = (canvasElement: HTMLElement) =>
	waitFor(() => {
		const row = canvasElement.querySelector<HTMLElement>(
			"[data-agent-messages-screening-model]",
		);
		expect(row).not.toBeNull();
		return row as HTMLElement;
	});

/** The default: Automatic, naming the first vetted model. */
export const ScreeningModelAutomatic: Story = {
	args: { status: screeningStatus, api: fakeApi(screeningSettings(null)) },
	play: async ({ canvasElement }) => {
		const row = await findScreeningRow(canvasElement);
		expect(within(row).getByRole("combobox")).toHaveTextContent(
			"anthropic/claude-sonnet-5-5",
		);
	},
};

/** The list open: Automatic first, then the vetted models only. */
export const ScreeningModelOpen: Story = {
	args: { status: screeningStatus, api: fakeApi(screeningSettings(null)) },
	play: async ({ canvasElement }) => {
		const row = await findScreeningRow(canvasElement);
		await userEvent.click(within(row).getByRole("combobox"));
		await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(5));
	},
};

/** A chosen preference, read back from the runtime's answer. */
export const ScreeningModelChosen: Story = {
	args: {
		status: screeningStatus,
		api: fakeApi(screeningSettings("anthropic/claude-opus-5-5")),
	},
	play: async ({ canvasElement }) => {
		const row = await findScreeningRow(canvasElement);
		expect(within(row).getByRole("combobox")).toHaveTextContent(
			"anthropic/claude-opus-5-5",
		);
	},
};

/** The runtime lists no models: a notice that screening still runs. */
export const ScreeningModelUnavailable: Story = {
	args: { status: screeningStatus, api: fakeApi(screeningSettings(null, [])) },
	play: async ({ canvasElement }) => {
		const row = await findScreeningRow(canvasElement);
		expect(within(row).queryByRole("combobox")).toBeNull();
	},
};

/** A refused save: the section's shared refusal line, choice unchanged. */
export const ScreeningModelSaveFailed: Story = {
	args: {
		status: screeningStatus,
		api: {
			...fakeApi(screeningSettings(null)),
			updateSettings: async () => {
				throw new DesktopControlError(
					503,
					"upstream detail",
					undefined,
					"bridge_unavailable",
				);
			},
		},
	},
	play: async ({ canvasElement }) => {
		const row = await findScreeningRow(canvasElement);
		await userEvent.click(within(row).getByRole("combobox"));
		const option = await screen.findByRole("option", {
			name: "anthropic/claude-opus-5-5",
		});
		await userEvent.click(option);
		await waitFor(() =>
			expect(within(row).getByRole("combobox")).not.toBeDisabled(),
		);
	},
};
