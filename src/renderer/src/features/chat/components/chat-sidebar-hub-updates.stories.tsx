/**
 * The chat sidebar's hub-update marks, in the four states the operator asked to
 * see: nothing to update (the mark is ABSENT), an update available, an update
 * in flight, and a failure with its retry.
 *
 * ## What is stubbed, and what is not
 *
 * The real `ChatSidebar`, its real `useProfiles` / `useTeams` / `useHubUpdates`
 * queries and the real `useHubActions` mutations. Below them
 * `window.api.desktop.request` is a stub that answers the catalogue reads and the
 * hub plane from a small mutable model, so a press in a play function changes
 * what the next poll reports - the row really goes from "available" to gone.
 *
 * ## What a frame here does NOT prove
 *
 * That the local backend serves `/v1/desktop/hub/updates` with these shapes. The
 * payload is written from the design's B5.1 contract, not a live call; the
 * backend's own tests and QA's live-organization pass answer that. Nor does a
 * frame prove the merge itself: the stub answers `apply` with a canned report.
 *
 * ## Every story pins the same shared origin state
 *
 * Like `chat-sidebar-agents.stories.tsx`, the built-ins offer's dismissal lives
 * in one localStorage key shared by the whole sweep, and every story here has
 * agents of its own (so no offer is drawn), which is what keeps them
 * order-independent without a fixture.
 */

import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, waitFor } from "@storybook/test";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import { ChatSidebar } from "./chat-sidebar";

/* ---------------------------------------------------------------- the model */

type WireItem = {
	kind: "agent" | "team";
	name: string;
	state: string;
	classification?: string | null;
	auto_will_apply?: boolean;
	error_class?: string | null;
	last_error?: string | null;
};

type Scenario = {
	credential?: "ok" | "none";
	autoAgents?: boolean;
	items: WireItem[];
	/** Never settle an `apply`, so the in-flight glyph is the subject. */
	holdApply?: boolean;
	/** Answer `apply` with a 409 so the row's refusal line is the subject. */
	applyRefused?: boolean;
	uptodate?: number;
};

const AGENTS = ["coder", "reviewer", "architect", "release-captain"];
const TEAMS = ["lopdev", "minerva-support"];

const profile = (name: string) => ({
	name,
	kind: "role",
	source: "installed",
	agent_id: `agent-${name}`,
	description: `${name} - reusable instructions for this role.`,
	tools: null,
	effort: null,
	delegate: false,
	seed_origin: null,
	divergent_fields: [],
});

const installBridge = (scenario: Scenario) => {
	let items = [...scenario.items];
	const ok = <T,>(result: T): DesktopResponse => ({
		status: 200,
		body: { result },
	});
	const snapshot = () => ({
		generated_at: "2026-09-29T12:00:00Z",
		credential: scenario.credential ?? "ok",
		settings: {
			auto_agents: scenario.autoAgents ?? true,
			auto_teams: scenario.autoAgents ?? true,
			interval_min: 60,
		},
		counts: {
			available: items.filter((item) => item.state === "available").length,
			failed: items.filter((item) => item.state === "failed").length,
			updating: 0,
			"up-to-date": scenario.uptodate ?? 4,
		},
		items,
	});
	const bridge = async (request: {
		op: string;
		name?: string;
		kind?: "agent" | "team";
	}): Promise<DesktopResponse> => {
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: {
						session_catalogue: 2,
						profile_catalogue: 1,
						team_catalogue: 1,
						hub_updates: 1,
					},
				});
			case "sessions.list":
				return ok({ sessions: [], truncated: false });
			case "profiles.list":
				return ok({ profiles: AGENTS.map(profile) });
			case "teams.list":
				return ok({
					teams: TEAMS.map((name) => ({
						name,
						manager: "manager",
						members: [],
					})),
				});
			case "hub.updates":
				return ok(snapshot());
			case "hub.apply":
			case "hub.retry": {
				if (scenario.holdApply) return await new Promise(() => {});
				if (scenario.applyRefused)
					return {
						status: 409,
						body: { detail: "It changed while updating. Try again." },
					};
				items = items.filter(
					(item) => !(item.kind === request.kind && item.name === request.name),
				);
				return ok({
					reports: [
						{
							kind: request.kind,
							name: request.name,
							outcome: "merged",
							applied: true,
						},
					],
					status: snapshot(),
				});
			}
			case "hub.applyAll": {
				const taken = items.filter(
					(item) =>
						item.kind === request.kind &&
						item.state === "available" &&
						!item.error_class,
				);
				items = items.filter((item) => !taken.includes(item));
				return ok({
					reports: taken.map((item) => ({
						kind: item.kind,
						name: item.name,
						outcome: "merged",
						applied: true,
					})),
					status: snapshot(),
				});
			}
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};
	const page = window as unknown as {
		api?: {
			desktop?: {
				request: (r: {
					op: string;
					name?: string;
					kind?: "agent" | "team";
				}) => Promise<DesktopResponse>;
			};
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: bridge };
};

const Page = ({ width = 360 }: { width?: number }) => (
	<div className={cn("flex h-screen overflow-hidden bg-canvas text-ink")}>
		<div
			style={{ width }}
			className="shrink-0 border-r border-hairline"
			data-testid="hub-story-frame"
		>
			<ChatSidebar
				selectedConversation={undefined}
				onSelectConversation={() => undefined}
				onStageDraft={() => undefined}
			/>
		</div>
	</div>
);

const meta: Meta = {
	title: "Chat sidebar/Hub updates",
	parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj;

/** Nothing on the hub differs: no mark, no strip - the section is byte-for-byte today's. */
export const UpToDate: Story = {
	render: () => {
		installBridge({ items: [] });
		return <Page />;
	},
	play: async () => {
		await screen.findByRole("button", { name: "New chat with coder" });
		expect(screen.queryByTestId("hub-mark-agent-coder")).toBeNull();
		expect(screen.queryByTestId("hub-update-all-agent")).toBeNull();
	},
};

/**
 * One agent with an update waiting, auto-update ON: the mark says it "updates
 * automatically" (tooltip and accessible description). One waiting item gets no
 * "Update all" strip - the row's own mark is already the single click.
 */
export const AvailableAutoOn: Story = {
	render: () => {
		installBridge({
			autoAgents: true,
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
					auto_will_apply: true,
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		const mark = await screen.findByTestId("hub-mark-agent-coder");
		expect(mark.getAttribute("aria-label")).toBe("Update coder from the hub");
	},
};

/**
 * Manual mode, three indicators across both sections: the operator's ask that
 * an update be visible even when auto-update is off. The team row needs a
 * decision (`both-changed`), the agents just wait.
 */
export const AvailableManualMixed: Story = {
	render: () => {
		installBridge({
			autoAgents: false,
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
				},
				{
					kind: "agent",
					name: "reviewer",
					state: "available",
					classification: "remote-only",
				},
				{
					kind: "team",
					name: "lopdev",
					state: "available",
					classification: "both-changed",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		await screen.findByTestId("hub-mark-agent-coder");
		await screen.findByTestId("hub-mark-agent-reviewer");
		await screen.findByTestId("hub-mark-team-lopdev");
	},
};

/** The press really updates: the mark leaves the row when the next snapshot says so. */
export const ClickUpdatesTheItem: Story = {
	render: () => {
		installBridge({
			autoAgents: false,
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
				},
				{
					kind: "agent",
					name: "reviewer",
					state: "available",
					classification: "remote-only",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		await userEvent.click(await screen.findByTestId("hub-mark-agent-coder"));
		await waitFor(() => {
			expect(screen.queryByTestId("hub-mark-agent-coder")).toBeNull();
		});
		expect(screen.getByTestId("hub-mark-agent-reviewer")).toBeTruthy();
	},
};

/** "Update all" takes the section's waiting items and leaves a one-line roll-up. */
export const UpdateAllRollup: Story = {
	render: () => {
		installBridge({
			autoAgents: false,
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
				},
				{
					kind: "agent",
					name: "reviewer",
					state: "available",
					classification: "remote-only",
				},
				{
					kind: "agent",
					name: "architect",
					state: "available",
					classification: "remote-only",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		await userEvent.click(await screen.findByTestId("hub-update-all-agent"));
		await screen.findByText("3 updated");
		expect(screen.queryByTestId("hub-mark-agent-coder")).toBeNull();
	},
};

/** A merge is running: the glyph becomes a spinner IN THE SAME 24px box. */
export const Updating: Story = {
	render: () => {
		installBridge({
			holdApply: true,
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		await userEvent.click(await screen.findByTestId("hub-mark-agent-coder"));
		await waitFor(() => {
			expect(
				screen
					.getByTestId("hub-mark-agent-coder")
					.getAttribute("data-hub-mark"),
			).toBe("updating");
		});
	},
};

/** A failed attempt the backend still holds: a warning glyph whose press retries. */
export const Failed: Story = {
	render: () => {
		installBridge({
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
					error_class: "provider-error",
					last_error: "The model call timed out.",
				},
				{
					kind: "team",
					name: "lopdev",
					state: "failed",
					error_class: "prompt-too-long",
					last_error: "Too large.",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		const mark = await screen.findByTestId("hub-mark-agent-coder");
		expect(mark.getAttribute("data-hub-mark")).toBe("failed");
		expect(mark.getAttribute("aria-label")).toBe(
			"Retry the hub update for coder",
		);
	},
};

/** A press the server refuses: the sentence lands under the row, not in a toast. */
export const PressRefused: Story = {
	render: () => {
		installBridge({
			applyRefused: true,
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		await userEvent.click(await screen.findByTestId("hub-mark-agent-coder"));
		await screen.findByRole("alert");
	},
};

/** Both-changed items are a decision, not a failure: a distinct mark, no retry. */
export const NeedsReview: Story = {
	render: () => {
		installBridge({
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "both-changed",
					error_class: "merge-refused",
					last_error: "Both changed a section.",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		const mark = await screen.findByTestId("hub-mark-agent-coder");
		expect(mark.getAttribute("data-hub-mark")).toBe("review");
	},
};

/** Signed out with hub-linked items: one section line, no per-row marks. */
export const SignedOut: Story = {
	render: () => {
		installBridge({ credential: "none", items: [] });
		return <Page />;
	},
	play: async () => {
		await screen.findAllByText("Sign in to Radient to get hub updates");
	},
};

/** The 360px measurement the sidebar's own comments cite, with the longest copy. */
export const NarrowWidth: Story = {
	render: () => {
		installBridge({
			autoAgents: false,
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
				},
				{
					kind: "agent",
					name: "release-captain",
					state: "available",
					classification: "both-changed",
					error_class: "merge-refused",
				},
				{
					kind: "team",
					name: "minerva-support",
					state: "failed",
					error_class: "concurrent-edit",
				},
			],
		});
		return <Page width={279} />;
	},
};
