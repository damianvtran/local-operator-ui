import { t } from "@shared/i18n";
import { useTextDirection } from "@shared/i18n/use-document-direction";
import { useAgentMessagesOnboardingStore } from "@shared/store/agent-messages-onboarding-store";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLayoutEffect, useState } from "react";
import type { AgentMessagesStatus } from "../../../../shared/agent-messages-contract";
import { TeamBridgePage } from "../team-bridge/team-bridge-page";
import pageMeta from "../team-bridge/team-bridge-page.stories";
import { teamBridgeKeys } from "../team-bridge/use-team-bridge";
import {
	type ContainerAuditEntry,
	createDefaultOnContainerFixture,
} from "./default-on-container.fixture";

/**
 * D1 delta only: the FULL network-owning page, with its real status observer.
 * No `status` prop, settings API prop or mocked query hook can shortcut the
 * disabled PUT -> invalidation -> status GET -> page rerender chain.
 *
 * Setup is installed before the page mounts and restored on unmount, so the
 * fixture cannot capture another story's requests or touch a live desktop.
 * `data-runtime-audit` is nonvisual evidence, not an extra product affordance.
 */
function FullContainer({
	minimum = false,
}: { locale?: string; minimum?: boolean }) {
	const direction = useTextDirection();
	const [client] = useState(
		() =>
			new QueryClient({
				defaultOptions: { queries: { retry: false, gcTime: 0 } },
			}),
	);
	const [ready, setReady] = useState(false);
	const [audit, setAudit] = useState<ContainerAuditEntry[]>([]);
	const [statusAudit, setStatusAudit] = useState<{
		data: AgentMessagesStatus | undefined;
		fetchStatus: string;
		observers: number;
	} | null>(null);
	useLayoutEffect(() => {
		const previousDesktop = window.api.desktop;
		const store = useAgentMessagesOnboardingStore;
		const previousOnboarding = store.getState();
		store.setState({ seen: {}, defaultOnDismissed: {} });
		const conversation = pageMeta.args.conversations[0];
		const fixture = createDefaultOnContainerFixture({
			conversation,
			messages: pageMeta.args.messages.filter(
				(message) => message.conversation_id === conversation.id,
			),
			onEntry: (entry) => setAudit((entries) => [...entries, entry]),
		});
		window.api.desktop = {
			request: fixture.request,
			openAuthorization: async () => {
				throw new Error("Authorization is outside this isolated fixture");
			},
		};
		// Observe cache UPDATE events only: observerOptionsUpdated can fire on a
		// React rerender, so subscribing indiscriminately and writing state there
		// would create the very evidence-harness loop this fixture must avoid.
		const stopAudit = client.getQueryCache().subscribe((event) => {
			if (
				event.type !== "updated" ||
				JSON.stringify(event.query.queryKey) !==
					JSON.stringify(teamBridgeKeys.status)
			)
				return;
			setStatusAudit({
				data: event.query.state.data as AgentMessagesStatus | undefined,
				fetchStatus: event.query.state.fetchStatus,
				observers: event.query.getObserversCount(),
			});
		});
		setReady(true);
		return () => {
			stopAudit();
			client.clear();
			window.api.desktop = previousDesktop;
			store.setState({
				seen: previousOnboarding.seen,
				defaultOnDismissed: previousOnboarding.defaultOnDismissed,
			});
		};
	}, [client]);
	return (
		<QueryClientProvider client={client}>
			{/* Pin the real layout box as well as Storybook's viewport parameter:
			    direct iframe captures do not apply the manager's viewport addon. */}
			<div
				className="flex h-dvh flex-col overflow-hidden"
				style={minimum ? { width: 800, height: 600 } : undefined}
				dir={direction}
				data-full-default-on-container=""
			>
				{ready && <TeamBridgePage />}
			</div>
			<pre hidden data-runtime-audit="">
				{JSON.stringify(audit, null, 2)}
			</pre>
			{/* Per-response nodes keep evidence reads below the browser tool's
			    output bound; no repeated consent blocks are silently truncated. */}
			<pre hidden data-runtime-audit-count="">
				{audit.length}
			</pre>
			{audit.map((entry, index) => (
				<pre
					hidden
					key={`${index}:${entry.request.op}`}
					data-runtime-entry={index}
				>
					{JSON.stringify(entry, null, 2)}
				</pre>
			))}
			<pre hidden data-status-observer-audit="">
				{JSON.stringify(statusAudit, null, 2)}
			</pre>
			<pre hidden data-off-observation="" />
		</QueryClientProvider>
	);
}

const meta = {
	title: "Team Bridge/Default on container",
	component: FullContainer,
	parameters: { layout: "fullscreen" },
	// A changed theme/locale must get a new adapter AND query cache; a status
	// already disabled by the light-board click is not the dark-board start.
	render: (args, context) => (
		<FullContainer
			{...args}
			key={`${context.id}:${String((context.args as Record<string, unknown>).theme)}:${String((context.args as Record<string, unknown>).locale)}:${args.minimum}`}
		/>
	),
} satisfies Meta<typeof FullContainer>;
export default meta;
type Story = StoryObj<typeof meta>;

function readAudit(canvas: HTMLElement): ContainerAuditEntry[] {
	return JSON.parse(
		canvas.querySelector("[data-runtime-audit]")?.textContent ?? "[]",
	);
}

export const Pending: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByRole("region", {
			name: t("ui.agentMessages.banner.title"),
		});
		await canvas.findByRole("textbox");
	},
};

export const TurnOffObserved: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const band = await canvas.findByRole("region", {
			name: t("ui.agentMessages.banner.title"),
		});
		await canvas.findByRole("textbox");
		await userEvent.click(
			within(band).getByRole("button", {
				name: t("ui.agentMessages.banner.turn_off"),
			}),
		);
		await waitFor(() => {
			const entries = readAudit(canvasElement);
			const put = entries.findIndex(
				(entry) => entry.request.op === "agent_messages.settings.put",
			);
			expect(put).toBeGreaterThanOrEqual(0);
			const refreshed = entries
				.slice(put + 1)
				.find((entry) => entry.request.op === "team_bridge.status");
			expect(refreshed).toBeDefined();
			const result = (
				refreshed?.response.body as { result: AgentMessagesStatus }
			).result;
			expect(result.surface_state).toBe("E");
			expect(result.local.enabled).toBe(false);
			expect(result.read_only).toBe(false); // runtime truth: only F returns true
		});
		await waitFor(() => {
			const cache = JSON.parse(
				canvasElement.querySelector("[data-status-observer-audit]")
					?.textContent ?? "null",
			);
			expect(cache?.data?.surface_state).toBe("E");
			expect(cache?.fetchStatus).toBe("idle");
			expect(cache?.observers).toBeGreaterThan(0);
		});
		await waitFor(() =>
			expect(
				canvas.queryByRole("region", {
					name: t("ui.agentMessages.banner.title"),
				}),
			).toBeNull(),
		);
		await canvas.findByRole("heading", {
			name: t("ui.agentMessages.settings.state.e_title"),
		});
		expect(canvas.queryByRole("textbox")).toBeNull();
		expect(
			canvas.queryByRole("button", { name: t("ui.teamBridge.composer.send") }),
		).toBeNull();
		const entries = readAudit(canvasElement);
		expect(
			entries.filter(
				(entry) => entry.request.op === "agent_messages.settings.put",
			),
		).toHaveLength(1);
		expect(
			entries.filter((entry) => entry.request.op === "settings.edit"),
		).toHaveLength(0);
		expect(canvas.queryByRole("dialog")).toBeNull();
		expect(canvas.queryByRole("alertdialog")).toBeNull();
		// RED evidence was saved before the product fix. The same real observer
		// chain now asserts the plain off state without altering read_only=false.
		const observation = canvasElement.querySelector("[data-off-observation]");
		if (observation)
			observation.textContent = JSON.stringify(
				{
					statusQueryKey: teamBridgeKeys.status,
					statusRefreshAfterPut: true,
					composerPresentAfterRefresh: canvas.queryByRole("textbox") !== null,
					sendPresentAfterRefresh:
						canvas.queryByRole("button", {
							name: t("ui.teamBridge.composer.send"),
						}) !== null,
					audit: entries,
				},
				null,
				2,
			);
	},
};

export const Expanded: Story = {
	play: async ({ canvasElement }) => {
		const band = await within(canvasElement).findByRole("region", {
			name: t("ui.agentMessages.banner.title"),
		});
		await userEvent.click(
			within(band).getByRole("button", {
				name: t("ui.agentMessages.banner.read"),
			}),
		);
	},
};

// The native window floor is 800x600 (src/main/window-mode.ts). Use the actual
// viewport, not CSS scaling: text wrapping is the regression neighbor at issue.
const minimumViewport = {
	viewport: {
		defaultViewport: "bridgeMinimum",
		viewports: {
			bridgeMinimum: {
				name: "800 × 600",
				styles: { width: "800px", height: "600px" },
			},
		},
	},
};
export const MinimumExpanded: Story = {
	...Expanded,
	parameters: minimumViewport,
	args: { minimum: true },
};
export const MinimumOffObserved: Story = {
	...TurnOffObserved,
	parameters: minimumViewport,
	args: { minimum: true },
};
// Preview's locale control sets strings; useTextDirection applies the app's
// own direction resolver to this isolated pane (the preview does not mount App's
// document-root hook). Existing audited translations, never fabricated labels.
export const MinimumExpandedFrench: Story = {
	...Expanded,
	parameters: minimumViewport,
	args: { locale: "fr", minimum: true },
};
export const MinimumExpandedUrdu: Story = {
	...Expanded,
	parameters: minimumViewport,
	args: { locale: "ur", minimum: true },
};

/** The bottom of the real overflow element, not a shortened disclosure. */
export const MinimumDisclosureEnd: Story = {
	...MinimumExpanded,
	play: async (context) => {
		await Expanded.play?.(context);
		const disclosure = context.canvasElement.querySelector<HTMLElement>(
			"[data-agent-messages-banner-consent]",
		);
		expect(disclosure).not.toBeNull();
		if (!disclosure) return;
		expect(disclosure.scrollHeight).toBeGreaterThan(disclosure.clientHeight);
		disclosure.scrollTo({ top: disclosure.scrollHeight, behavior: "instant" });
		expect(disclosure.scrollTop).toBeGreaterThan(0);
	},
};
