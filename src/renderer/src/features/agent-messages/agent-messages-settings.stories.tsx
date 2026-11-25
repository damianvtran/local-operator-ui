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
import { teamBridgeDirectorySchema } from "../../../../shared/team-bridge-contract";
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
	state: "active" | "paused" = "active",
): AgentMessagesSettingsResult {
	return { ...settingsWith(state), screening: { preferred, models } };
}

/* `local.enrolled: true`: this machine holds the endpoint, the only case the
   row is offered in (#1928 round 1, S-2). */
const screeningStatus = statusWith({
	surface_state: "C",
	local: { enabled: true, enrolled: true, session: "aaaaaaaaaaaa" },
});

/* The state-less local write (runtime #4066), echoing the stored block the
   way the runtime answers, so a story save reads back like the real one. */
function screeningApi(
	settings: AgentMessagesSettingsResult,
): AgentMessagesSettingsApi {
	return {
		...fakeApi(settings),
		setScreeningModel: async (_account, value) => ({
			preferred: value === "" ? null : value,
			models: settings.screening?.models ?? [],
		}),
	};
}

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
	args: { status: screeningStatus, api: screeningApi(screeningSettings(null)) },
	play: async ({ canvasElement }) => {
		const row = await findScreeningRow(canvasElement);
		expect(within(row).getByRole("combobox")).toHaveTextContent(
			"anthropic/claude-sonnet-5-5",
		);
	},
};

/** The list open: Automatic first, then the vetted models only. */
export const ScreeningModelOpen: Story = {
	args: { status: screeningStatus, api: screeningApi(screeningSettings(null)) },
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
		api: screeningApi(screeningSettings("anthropic/claude-opus-5-5")),
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
	args: {
		status: screeningStatus,
		api: screeningApi(screeningSettings(null, [])),
	},
	play: async ({ canvasElement }) => {
		const row = await findScreeningRow(canvasElement);
		expect(within(row).queryByRole("combobox")).toBeNull();
	},
};

/** A refused save: the section's shared refusal line, and the row re-reads
 * settings so it shows the stored value (#1928 round 1, R2/S-4). */
export const ScreeningModelSaveFailed: Story = {
	args: {
		status: screeningStatus,
		api: {
			...screeningApi(screeningSettings(null)),
			setScreeningModel: async () => {
				throw new DesktopControlError(
					429,
					"Too many requests",
					undefined,
					"rate_limited",
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

/** A PAUSED endpoint this machine holds: the row is offered, and a save
 * cannot resume it because the write carries no state (#1928 round 1, D4). */
export const ScreeningModelPaused: Story = {
	args: {
		status: statusWith({
			surface_state: "D",
			local: { enabled: true, enrolled: true, session: "aaaaaaaaaaaa" },
		}),
		api: screeningApi(screeningSettings(null, SCREENING_MODELS, "paused")),
	},
	play: async ({ canvasElement }) => {
		const row = await findScreeningRow(canvasElement);
		expect(within(row).getByRole("combobox")).toBeEnabled();
	},
};

/** The hub endpoint is active but THIS machine is not enrolled ("on
 * elsewhere"): no Screening model row (#1928 round 1, S-2). */
export const ScreeningModelNotEnrolledHere: Story = {
	args: {
		status: statusWith({
			surface_state: "C",
			local: { enabled: false, enrolled: false, session: "" },
		}),
		api: screeningApi(screeningSettings(null)),
	},
	play: async ({ canvasElement }) => {
		await waitFor(() =>
			expect(
				// The reach editor renders once the settings read is ready.
				canvasElement.querySelector("[data-agent-messages-allowlist]"),
			).not.toBeNull(),
		);
		expect(
			canvasElement.querySelector("[data-agent-messages-screening-model]"),
		).toBeNull();
	},
};

/* ---------------------------------------------------------------------------
 * Reach editor: choosing people and agents from the organization directory.
 *
 * Each fake answer goes through the REAL `teamBridgeDirectorySchema`, so a
 * story cannot show a row the contract would refuse. Two people share the name
 * "Ada Park" and both run an agent named "Helper": the open list must keep them
 * apart by owner and full id. Choosing only fills the ID field; nothing is
 * written until Add and then Save. A long agent name, a long owner name and a
 * long organization name are here on purpose, so the label above the picker,
 * the options and the named list rows show how they wrap.
 * ------------------------------------------------------------------------- */
const DIRECTORY_MEMBERS = {
	members: [
		{
			account_id: "acc_ada_one",
			display_label: "Ada Park",
			role: "member",
			bridge_enabled: true,
			bridge_state: "active",
			agent: { endpoint_id: "bep_ada_one", name: "Helper", state: "active" },
		},
		{
			account_id: "acc_ada_two",
			display_label: "Ada Park",
			role: "member",
			bridge_enabled: true,
			bridge_state: "active",
			agent: { endpoint_id: "bep_ada_two", name: "Helper", state: "active" },
		},
		{
			account_id: "acc_bo_chen",
			display_label: "Bo Chen",
			role: "admin",
			bridge_enabled: true,
			bridge_state: "active",
			agent: {
				endpoint_id: "bep_bo_research",
				name: "Research desk",
				state: "active",
			},
		},
		{
			account_id: "acc_maximiliana",
			display_label: "Maximiliana Oyelaran-Featherstonehaugh",
			role: "member",
			bridge_enabled: true,
			bridge_state: "active",
			agent: {
				endpoint_id: "bep_maximiliana_forecasting",
				name: "Quarterly revenue reconciliation and forecasting assistant",
				state: "active",
			},
		},
	],
};

function directoryStoryApi(
	answer: () => Promise<unknown>,
	allowlist: AgentMessagesAllowlistResult = allowlistResult,
): AgentMessagesSettingsApi {
	return {
		...fakeApi(activeSettings, allowlist),
		directory: async () => teamBridgeDirectorySchema.parse(await answer()),
	};
}

/** Status whose tenant row matches the allowlist's, so the organization is named. */
function directoryStatusNamed(tenantName?: string) {
	return statusWith({
		surface_state: "C",
		local: { enabled: true, session: "aaaaaaaaaaaa" },
		status: {
			available: true,
			tenants: [
				{
					tenant_id: "tnt_bridge_e2e",
					...(tenantName ? { tenant_name: tenantName } : {}),
					eligible: true,
					endpoint: null,
				},
			],
		},
	});
}

// The option's accessible name starts with the agent name, then ", Run by …".
const RESEARCH_DESK_OPTION = /^Research desk,/;
const LONG_ORGANIZATION = "Northwind Research & Development Cooperative";
const directoryStatus = directoryStatusNamed("Example organization");

/**
 * Saved entries a directory can name (Helper, the long-named assistant, a
 * person) beside one it cannot (`bep_peer_send`, typed by hand earlier), so the
 * named rows and the bare-id fallback render together.
 */
const namedAllowlist: AgentMessagesAllowlistResult = (() => {
	const entries: AgentMessagesAllowlistResult["allowlist"]["entries"] = [
		{
			id: "bal_send_allow",
			direction: "send",
			effect: "allow",
			target: { kind: "endpoint", endpoint_id: "bep_peer_send" },
		},
		{
			id: "bal_send_helper",
			direction: "send",
			effect: "allow",
			target: { kind: "endpoint", endpoint_id: "bep_ada_one" },
		},
		{
			id: "bal_send_forecast",
			direction: "send",
			effect: "allow",
			target: { kind: "endpoint", endpoint_id: "bep_maximiliana_forecasting" },
		},
		{
			id: "bal_receive_deny",
			direction: "receive",
			effect: "deny",
			target: { kind: "account", account_id: "acc_bo_chen" },
		},
	];
	return {
		allowlist: { ...allowlistResult.allowlist, entries },
		view: {
			...allowlistResult.view,
			entries,
			directions: {
				send: { mode: "listed_only", allow: 3, deny: 0 },
				receive: { mode: "class_default", allow: 0, deny: 1 },
			},
		},
	};
})();

/** The roster read is in flight: said once for the section; typing still works. */
export const ReachDirectoryLoading: Story = {
	args: {
		status: directoryStatus,
		api: directoryStoryApi(() => new Promise(() => {})),
	},
};

/** The organization lists nobody to choose: said once for the section. */
export const ReachDirectoryEmpty: Story = {
	args: {
		status: directoryStatus,
		api: directoryStoryApi(async () => ({ members: [] })),
	},
};

/** The roster read failed: said once, with Try again; typing still works. */
export const ReachDirectoryFailed: Story = {
	args: {
		status: directoryStatus,
		api: directoryStoryApi(async () => {
			throw new DesktopControlError(null, "Agent server unreachable");
		}),
	},
};

/**
 * Populated, under a long organization name: saved rows show the name and
 * "Run by …" with the id underneath; `bep_peer_send`, which the directory does
 * not hold, falls back to its bare id.
 */
export const ReachDirectoryPopulated: Story = {
	args: {
		status: directoryStatusNamed(LONG_ORGANIZATION),
		api: directoryStoryApi(async () => DIRECTORY_MEMBERS, namedAllowlist),
	},
};

/** The organization has no name on status: the label falls back. */
export const ReachDirectoryUnnamedOrganization: Story = {
	args: {
		status: directoryStatusNamed(),
		api: directoryStoryApi(async () => DIRECTORY_MEMBERS),
	},
};

/** The list open: owner, full id and the same-name marker on each "Helper". */
export const ReachDirectoryOpen: Story = {
	args: {
		status: directoryStatusNamed(LONG_ORGANIZATION),
		api: directoryStoryApi(async () => DIRECTORY_MEMBERS),
	},
	play: async ({ canvasElement }) => {
		const picker = await waitFor(() => {
			const found = canvasElement.querySelector<HTMLElement>(
				"[data-agent-messages-direction='receive'] button[data-agent-messages-directory-picker]",
			);
			expect(found).not.toBeNull();
			return found as HTMLElement;
		});
		await userEvent.click(picker);
		await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(4));
	},
};

/**
 * Add, then the dedupe: "Research desk" is chosen and added to the send
 * Allowed list, where it shows by name and owner and is no longer offered;
 * typing its id again is refused with a message instead of a second row.
 */
export const ReachDirectoryAddedAndDuplicate: Story = {
	args: {
		status: directoryStatusNamed(LONG_ORGANIZATION),
		api: directoryStoryApi(async () => DIRECTORY_MEMBERS, namedAllowlist),
	},
	play: async ({ canvasElement }) => {
		const send = await waitFor(() => {
			const found = canvasElement.querySelector<HTMLElement>(
				"[data-agent-messages-direction='send']",
			);
			expect(
				found?.querySelector("button[data-agent-messages-directory-picker]"),
			).not.toBeNull();
			return found as HTMLElement;
		});
		const picker = send.querySelector<HTMLElement>(
			"button[data-agent-messages-directory-picker]",
		) as HTMLElement;
		await userEvent.click(picker);
		await userEvent.click(
			await screen.findByRole("option", { name: RESEARCH_DESK_OPTION }),
		);
		const allowRow = within(send).getAllByRole("textbox")[0];
		const add = within(send).getAllByRole("button", { name: "Add" })[0];
		await userEvent.click(add);
		await waitFor(() =>
			expect(
				within(send).getByRole("button", {
					name: "Remove Research desk, Run by Bo Chen",
				}),
			).toBeTruthy(),
		);
		await userEvent.type(allowRow, "bep_bo_research");
		await userEvent.click(add);
		await waitFor(() =>
			expect(
				within(send).getByText("That agent or person is already in this list."),
			).toBeTruthy(),
		);
		expect(
			send.querySelectorAll("[data-agent-messages-entry='bep_bo_research']"),
		).toHaveLength(1);
	},
};
