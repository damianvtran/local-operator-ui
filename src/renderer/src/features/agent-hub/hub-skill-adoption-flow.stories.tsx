import { hubSourceAddress } from "@shared/api/radient/skills-api";
import { apiConfig } from "@shared/config";
import type { Meta, StoryObj } from "@storybook/react";
import type {
	DesktopRequest,
	DesktopResponse,
} from "../../../../shared/desktop-contract";
import { HubSkillsLibrary } from "./components/hub-skills-library";
import { adoptionFixture } from "./hub-skill-adoption.fixtures";

const row = {
	id: "fixture-release-checklist",
	name: "release-checklist",
	description: "Review releases while preserving local safety guidance.",
	document_version: 1,
	visibility: "public",
	content_revision: 4,
	revision: "fixture-revision-4",
	sync_contract: { revision_cas: 1, skills: 1 },
	files: [
		{
			path: "SKILL.md",
			content:
				"# Release checklist\n\nExercise the real endpoint and record its response.\n",
		},
	],
};
const ok = (result: unknown): DesktopResponse => ({
	status: 200,
	body: { result },
});

function installFixture() {
	let adopted = false;
	let captured = adoptionFixture;
	let sequence = 0;
	const ledger: DesktopRequest[] = [];
	// This is the shipping catalogue, detail Dialog, collision remedy and real
	// pull hook. Only the IPC/Hub boundaries are fixtures; no native write occurs.
	const link = {
		link_id: "fixture-skill-link",
		kind: "skill",
		local_id: row.name,
		name: row.name,
		hub_id: row.id,
		hub_source: hubSourceAddress(apiConfig.radientBaseUrl),
		visibility: "public",
		tenant_id: null,
		tenant_name: null,
		policy: { subscribe: false, auto_push: false, revision: "fixture-policy" },
		eligibility: { can_auto_push: false, reason: null },
		baseline_state: "pulled",
		remote_revision: row.revision,
		content_state: "present",
		local_path: "~/.config/local-operator/skills/release-checklist",
		auto_will_apply: false,
		auto_will_push: false,
		pull: { state: "up-to-date", enabled: true },
		push: { state: "up-to-date", enabled: false },
	};
	const page = window as unknown as {
		api: {
			desktop: { request: (input: DesktopRequest) => Promise<DesktopResponse> };
		};
		__skillAdoptionLedger: DesktopRequest[];
	};
	page.__skillAdoptionLedger = ledger;
	page.api.desktop.request = async (input) => {
		ledger.push(input);
		if (input.op === "capabilities")
			return ok({
				desktop_contract: 1,
				desktop_available: true,
				desktop_auth: "bearer",
				features: { hub_skills: 1, hub_links: 1 },
			});
		if (input.op === "hub.links")
			return ok({ links: adopted ? [link] : [], unresolved: [] });
		if (input.op !== "hub.skillPull")
			throw new Error(`Unexpected adoption fixture op: ${input.op}`);
		if (input.dryRun) {
			sequence += 1;
			const strategy = input.adoptionStrategy ?? "merge";
			captured = {
				...adoptionFixture,
				adoption_receipt: `fixture-adoption-receipt-${sequence}`,
				adoption: {
					...adoptionFixture.adoption,
					strategy,
					state:
						strategy === "merge" && !input.allowLlm ? "needs-choice" : "ready",
					model: input.allowLlm ? "fixture/model" : null,
					files: adoptionFixture.adoption.files.map((file) =>
						strategy === "keep-local" && file.path === "SKILL.md"
							? {
									...file,
									action: "kept-local",
									proposed:
										"# Local release checklist\n\nPreserve original files and require explicit approval.\n",
									diff_vs_local: "",
									diff_vs_hub:
										"--- hub\n+++ local\n+Preserve original files and require explicit approval.\n",
									kept: {
										local: ["Local safety"],
										hub: [],
										combined: [],
										unresolved: [],
									},
								}
							: file,
					),
				},
			};
			return ok({
				...captured,
				dry_run: true,
				reports: [{ outcome: "needs-review", applied: false }],
				link: null,
				links: { links: [], unresolved: [] },
			});
		}
		if (!input.confirm || !input.adoptionReceipt)
			return {
				status: 409,
				body: {
					detail: {
						code: "alias-occupied",
						message: "A local skill occupies this alias.",
					},
				},
			};
		if (
			input.adoptionReceipt !== captured.adoption_receipt ||
			input.adoptionStrategy !== captured.adoption.strategy
		)
			return {
				status: 409,
				body: {
					detail: {
						code: "adoption-preview-changed",
						message: "Preview changed.",
					},
				},
			};
		adopted = true;
		return ok({
			adoption: captured.adoption,
			snapshot: captured.snapshot,
			reports: [{ outcome: "merged", applied: true }],
			link,
			links: { links: [link], unresolved: [] },
		});
	};
	const original = window.fetch.bind(window);
	window.fetch = async (input, init) => {
		const url = String(input instanceof Request ? input.url : input);
		if (!url.includes("/v1/skills")) return original(input, init);
		const parsed = new URL(url);
		const detail = parsed.pathname.endsWith(`/${row.id}`);
		return new Response(
			JSON.stringify({
				result: detail
					? row
					: {
							records: [row],
							total_records: 1,
							total_pages: 1,
							page: 1,
							per_page: 20,
							sync_contract: row.sync_contract,
						},
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	};
}
const meta = {
	title: "Agent Hub/Skill adoption flow",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ProductionComposition: Story = {
	render: () => {
		installFixture();
		return (
			<div className="p-6">
				<HubSkillsLibrary
					scope={{ visibility: "public", tenantId: null, organization: null }}
					signedIn
				/>
			</div>
		);
	},
};
