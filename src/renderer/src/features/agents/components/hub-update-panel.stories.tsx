/**
 * The detail-pane hub-update panel: the destination of every review, conflict and
 * not-retryable path in the sidebar, and the surface where a person's own text is
 * at stake (design round 1, D1).
 *
 * ## What is stubbed, and what is not
 *
 * The real `AgentsPage` (so the panel sits above the real `ProfileEditor`, which
 * is what R1 is about), the real queries and mutations, and the real
 * `useHubActionStore`. `window.api.desktop.request` is a stub answering from a
 * small mutable model: an `apply` changes what `profiles.get` returns next, which
 * is exactly the path that left the editor showing the pre-merge text.
 *
 * ## What a frame here does NOT prove
 *
 * That the daemon serves these shapes: the payloads are written from the design's
 * B5.1/A8 contract. QA's live pass answers that.
 */

import { useHubActionStore } from "@shared/api/local-operator/hub-action-store";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, waitFor } from "@storybook/test";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import { AgentsPage } from "./agents-page";

type Item = {
	kind: "agent";
	name: string;
	state: string;
	classification?: string;
	auto_will_apply?: boolean;
	error_class?: string | null;
	last_error?: string | null;
};

type Scenario = {
	item?: Item;
	/** Never settle an `apply`, so the busy state is the subject. */
	hold?: boolean;
	/** `apply` answers this outcome and leaves the item listed. */
	outcome?: { outcome: string; error_class?: string; classification?: string };
};

const LOCAL = "Be terse.\n\n## Tone\nAnswer in one line.";
const HUB =
	"Be terse.\n\n## Tone\nAnswer in two friendly lines.\n\n## Sources\nCite them.";
const MERGED =
	"Be terse.\n\n## Tone\nAnswer in one line.\n\n## Sources\nCite them.";

const install = (scenario: Scenario) => {
	useHubActionStore.getState().reset();
	let instructions = LOCAL;
	let item = scenario.item;
	const ok = <T,>(result: T): DesktopResponse => ({
		status: 200,
		body: { result },
	});
	const snapshot = () => ({
		generated_at: "2026-09-29T12:00:00Z",
		credential: "ok",
		settings: { auto_agents: false, auto_teams: false, interval_min: 60 },
		counts: { available: item ? 1 : 0, "up-to-date": 3 },
		items: item ? [item] : [],
	});
	const profile = () => ({
		name: "coder",
		kind: "role",
		source: "installed",
		agent_id: "agent-coder",
		description: "Writes and reviews code.",
		instructions,
		tools: null,
		effort: null,
		delegate: false,
		divergent_fields: [],
	});
	const bridge = async (request: {
		op: string;
		dryRun?: boolean;
		prefer?: string;
	}): Promise<DesktopResponse> => {
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: { profile_catalogue: 1, team_catalogue: 1, hub_updates: 1 },
				});
			case "profiles.list":
				return ok({ profiles: [profile()] });
			case "profiles.get":
				return ok(profile());
			case "hub.updates":
				return ok(snapshot());
			case "hub.apply": {
				if (scenario.hold) return await new Promise(() => {});
				if (request.dryRun)
					return ok({
						reports: [
							{
								kind: "agent",
								name: "coder",
								outcome: "would-merge",
								applied: false,
								fields: [
									{
										field: "instructions",
										outcome: "needs-review",
										regions: [
											{
												id: "r1",
												heading: "## Tone",
												provenance: "unresolved",
												local: "Answer in one line.",
												remote: "Answer in two friendly lines.",
											},
										],
									},
								],
							},
						],
						status: snapshot(),
					});
				if (scenario.outcome)
					return ok({
						reports: [
							{
								kind: "agent",
								name: "coder",
								applied: false,
								...scenario.outcome,
							},
						],
						status: snapshot(),
					});
				instructions = request.prefer === "remote" ? HUB : MERGED;
				item = undefined;
				return ok({
					reports: [
						{
							kind: "agent",
							name: "coder",
							outcome: "merged",
							applied: true,
							classification: "both-changed",
						},
					],
					status: snapshot(),
				});
			}
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};
	const page = window as unknown as { api?: { desktop?: unknown } };
	const api = page.api ?? {};
	(page as { api?: unknown }).api = api;
	(api as { desktop: unknown }).desktop = { request: bridge };
};

const Detail = () => {
	const navigate = useNavigate();
	useEffect(() => {
		navigate("/agents?kind=agent&name=coder", { replace: true });
	}, [navigate]);
	return (
		<div className="h-screen w-[1000px]">
			<AgentsPage />
		</div>
	);
};

const meta: Meta = {
	title: "Agents/Hub update panel",
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

const render = (scenario: Scenario) => () => {
	install(scenario);
	return <Detail />;
};

/** An update with nothing of the person's in its way: one plain action. */
export const Available: Story = {
	render: render({
		item: {
			kind: "agent",
			name: "coder",
			state: "available",
			classification: "remote-only",
		},
	}),
	play: async () => {
		await screen.findByRole("button", { name: "Update from the hub" });
	},
};

/** A failed attempt a retry can repair: the class sentence and Retry. No raw error text. */
export const FailedRetry: Story = {
	render: render({
		item: {
			kind: "agent",
			name: "coder",
			state: "failed",
			error_class: "provider-error",
			last_error: "HTTPSConnectionPool(host='x'): Max retries exceeded",
		},
	}),
	play: async () => {
		await screen.findByRole("button", { name: "Retry" });
		// R8: the class sentence is shown, the backend's raw exception text is not.
		expect(screen.queryByText(/HTTPSConnectionPool/)).toBeNull();
	},
};

/** A class a retry cannot change: the sentence alone, no Retry to press in vain. */
export const FailedNotRetryable: Story = {
	render: render({
		item: {
			kind: "agent",
			name: "coder",
			state: "failed",
			error_class: "hub-item-missing",
		},
	}),
	play: async () => {
		await screen.findByText(/No longer available on the hub/);
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
	},
};

/** Both sides changed: no one-click apply, a preview, and two quiet choices. */
export const NeedsReview: Story = {
	render: render({
		item: {
			kind: "agent",
			name: "coder",
			state: "available",
			classification: "both-changed",
		},
	}),
	play: async () => {
		await screen.findByRole("button", { name: "Preview the differences" });
		expect(
			screen.queryByRole("button", { name: "Update from the hub" }),
		).toBeNull();
	},
};

/** The preview open: the person's text beside the hub's, per differing region. */
export const NeedsReviewPreview: Story = {
	...NeedsReview,
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: "Preview the differences" }),
		);
		await screen.findByTestId("hub-update-preview");
	},
};

/** Nothing records what the person changed: the panel says what either choice does. */
export const BaselineUnknown: Story = {
	render: render({
		item: {
			kind: "agent",
			name: "coder",
			state: "available",
			classification: "baseline-unknown",
		},
	}),
	play: async () => {
		await screen.findByText(/Nothing records what you changed on this device/);
	},
};

/** A merge is running: every action is inert and the primary one says so. */
export const Busy: Story = {
	render: render({
		item: {
			kind: "agent",
			name: "coder",
			state: "available",
			classification: "remote-only",
		},
		hold: true,
	}),
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: "Update from the hub" }),
		);
		await screen.findByRole("button", { name: "Updating…" });
	},
};

/**
 * The person chose "Keep mine" on a conflict: the item leaves the list, the panel
 * KEEPS its answer, and the editor below shows the MERGED text (R1) - it used to
 * keep the pre-merge text, and Edit - Save wrote it back over the merge.
 */
export const KeptMineAndEditorReseeded: Story = {
	...NeedsReview,
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", {
				name: "Keep mine where they differ",
			}),
		);
		await screen.findByText(
			/Where the hub and your copy differed, yours was kept/,
		);
		await waitFor(() => {
			const box = screen.getByLabelText("Instructions") as HTMLTextAreaElement;
			expect(box.value).toContain("Cite them.");
		});
	},
};

/**
 * A hub update lands while the person has typed something they have not saved.
 * The re-seed still wins - the merge is authoritative (R1) - but the page SAYS
 * the in-flight edits were replaced instead of dropping them silently (agent
 * review round 2, R2-5). The editor below must show the MERGED text AND the
 * sentence must be on screen; either one alone is half the fix.
 */
export const UpdateUnderAnOpenEditor: Story = {
	render: render({
		item: {
			kind: "agent",
			name: "coder",
			state: "available",
			classification: "remote-only",
		},
	}),
	play: async () => {
		await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
		const box = (await screen.findByLabelText(
			"Instructions",
		)) as HTMLTextAreaElement;
		await userEvent.clear(box);
		await userEvent.type(box, "Half a sentence I had not saved.");
		await userEvent.click(
			await screen.findByRole("button", { name: "Update from the hub" }),
		);
		await screen.findByText(/Edits you had not saved were replaced/);
		await waitFor(() => {
			const merged = screen.getByLabelText(
				"Instructions",
			) as HTMLTextAreaElement;
			expect(merged.value).toContain("Cite them.");
		});
	},
};

/** A press that ends without a change says why, in one sentence beside the buttons. */
export const StillNotReady: Story = {
	render: render({
		item: {
			kind: "agent",
			name: "coder",
			state: "available",
			classification: "remote-only",
		},
		outcome: { outcome: "failed", error_class: "concurrent-edit" },
	}),
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: "Update from the hub" }),
		);
		await screen.findByText("It changed while updating. Try again.");
	},
};
