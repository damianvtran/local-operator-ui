import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { t } from "@shared/i18n";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
	type AdoptionReviewState,
	HubSkillAdoptionReview,
} from "./components/hub-skill-adoption";
import {
	adoptionFixture,
	useAdoptionFixtureDocumentDirection,
} from "./hub-skill-adoption.fixtures";

const preview = adoptionFixture;
const fixtureAlias = "release-checklist";

function Fixture({
	initial = "review",
}: {
	initial?:
		| "idle"
		| "loading"
		| "conflict"
		| "error"
		| "stale"
		| "review"
		| "applied";
}) {
	useAdoptionFixtureDocumentDirection();
	const [allowLlm, setAllowLlm] = useState(false);
	const [state, setState] = useState<AdoptionReviewState>({
		preview: ["idle", "loading", "error"].includes(initial)
			? null
			: initial === "conflict"
				? {
						...preview,
						adoption: {
							...preview.adoption,
							state: "needs-choice",
							model: null,
							files: preview.adoption.files.map((file) => ({
								...file,
								action: "needs-choice",
								proposed: null,
							})),
						},
					}
				: preview,
		pending: initial === "loading",
		applied: initial === "applied",
		error:
			initial === "error" ? "failed" : initial === "stale" ? "stale" : null,
	});
	return (
		<Dialog open>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{fixtureAlias}</DialogTitle>
					<DialogDescription>
						{t("ui.hub.links.source_public")}
					</DialogDescription>
				</DialogHeader>
				<HubSkillAdoptionReview
					state={state}
					allowLlm={allowLlm}
					onAllowLlm={setAllowLlm}
					onPreview={(strategy) =>
						setState({
							preview: {
								...preview,
								adoption: { ...preview.adoption, strategy },
							},
							pending: false,
							applied: false,
							error: null,
						})
					}
					onConfirm={() => setState((value) => ({ ...value, applied: true }))}
					onCancel={() =>
						setState({
							preview: null,
							pending: false,
							applied: false,
							error: null,
						})
					}
				/>
			</DialogContent>
		</Dialog>
	);
}

const meta = {
	title: "Agent Hub/Skill adoption",
	component: Fixture,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;

// These are presentation fixtures, never proof of a native filesystem write.
// The real-hook test pins receipt/policy forwarding and non-mutating previews.
export const Review: Story = { args: { initial: "review" } };
export const Loading: Story = { args: { initial: "loading" } };
export const Conflict: Story = { args: { initial: "conflict" } };
export const Failed: Story = { args: { initial: "error" } };
export const Stale: Story = { args: { initial: "stale" } };
export const Applied: Story = { args: { initial: "applied" } };
export const Idle: Story = { args: { initial: "idle" } };
