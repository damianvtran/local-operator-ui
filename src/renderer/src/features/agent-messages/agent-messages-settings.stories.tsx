import type { Meta, StoryObj } from "@storybook/react";
import allowlistFixture from "../../../../../scripts/fixtures/agent-messages-allowlist.json";
import settingsFixture from "../../../../../scripts/fixtures/agent-messages-settings.json";
import statusFixture from "../../../../../scripts/fixtures/agent-messages-status.json";
import type {
	AgentMessagesAllowlistResult,
	AgentMessagesSettingsResult,
	AgentMessagesStatus,
} from "../../../../shared/agent-messages-contract";
import type { AgentMessagesSettingsApi } from "./agent-messages-settings";
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
