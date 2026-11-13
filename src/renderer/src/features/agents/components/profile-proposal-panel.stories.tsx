/** Mocked wire, real queries/actions: frames prove the review UI, not core's persistence. */
import type { Meta, StoryObj } from "@storybook/react";
import type {
	DesktopRequest,
	DesktopResponse,
} from "../../../../../shared/desktop-contract";
import { ProfileProposalPanel } from "./profile-proposal-panel";

const ID = "pp_0123456789abcdef";
const before =
	"Be direct.\n\nExplain constraints before suggesting a change.\nCite sources.";
const after =
	"Be concise.\n\nExplain constraints before suggesting a change.\nCite primary sources.";
const detail = (state = "pending") => ({
	id: ID,
	kind: "team",
	name: "lopdev",
	label: "Development team",
	operation: "update",
	fields: ["instructions"],
	state,
	stale: state === "stale",
	origin: {
		trust: "agent",
		session_id: "synthetic-conversation",
		trigger: "wake_prompt",
	},
	created_at: 1794232800,
	expires_at: 1796824800,
	changes: [
		{
			field: "instructions",
			label: "Instructions",
			before_text: before,
			after_text: after,
			format: "text",
		},
	],
});
function install(state: string) {
	let proposal = detail(state);
	const ok = (result: unknown): DesktopResponse => ({
		status: 200,
		body: { result },
	});
	const request = async (op: DesktopRequest): Promise<DesktopResponse> => {
		if (state === "loading") return new Promise(() => {});
		if (state === "error")
			return {
				status: 503,
				body: {
					detail: { code: "store_busy", message: "Proposal store is busy." },
				},
			};
		switch (op.op) {
			case "profileProposals.list":
				return ok({
					proposals: state === "empty" ? [] : [proposal],
					counts: { team: { lopdev: state === "empty" ? 0 : 1 }, agent: {} },
				});
			case "profileProposals.get":
				return ok(proposal);
			case "profileProposals.accept":
				if (state === "conflict")
					return {
						status: 409,
						body: {
							detail: {
								code: "profile_proposal_stale",
								message:
									"lopdev changed since this was proposed; nothing was applied.",
							},
						},
					};
				proposal = { ...proposal, state: "accepted" };
				return ok({ proposal, profile: {}, backup_id: "synthetic-backup" });
			case "profileProposals.reject":
				proposal = { ...proposal, state: "rejected" };
				return ok({ proposal });
			default:
				return ok({});
		}
	};
	const page = window as unknown as {
		api: { desktop: { request: typeof request } };
	};
	page.api = { ...page.api, desktop: { request } };
}
const meta: Meta = {
	title: "Agents/Profile proposal panel",
	parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj;
const render = (state: string) => () => {
	install(state);
	return (
		<div className="mx-auto max-w-3xl">
			<h2 className="mb-4 text-heading">lopdev</h2>
			<ProfileProposalPanel
				kind="team"
				name="lopdev"
				enabled
				proposalId={state === "accepted" || state === "rejected" ? ID : null}
			/>
		</div>
	);
};
export const Loading: Story = { render: render("loading") };
export const Empty: Story = { render: render("empty") };
export const LoadError: Story = { render: render("error") };
export const Populated: Story = { render: render("pending") };
export const Stale: Story = { render: render("stale") };
export const Accepted: Story = { render: render("accepted") };
export const Rejected: Story = { render: render("rejected") };
export const ConflictOnAccept: Story = { render: render("conflict") };
