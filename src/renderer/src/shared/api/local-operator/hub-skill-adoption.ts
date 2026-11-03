import { z } from "zod";
import type { HubDirectionalReport } from "./hub-link-actions";
import type { HubLink, HubLinks } from "./hub-links";

export const skillAdoptionStrategy = z.enum([
	"merge",
	"keep-local",
	"take-hub",
]);
export type SkillAdoptionStrategy = z.infer<typeof skillAdoptionStrategy>;

// Only review fields are validated here: older cores can still return their
// ordinary pull response, while future additive metadata must survive parsing.
export const skillAdoptionPreviewSchema = z
	.object({
		adoption: z
			.object({
				state: z.enum(["equal", "ready", "needs-choice"]),
				// Equal describes the core's comparison result, never a request policy.
				strategy: z
					.union([skillAdoptionStrategy, z.literal("equal")])
					.nullable()
					.optional(),
				files: z.array(
					z
						.object({
							path: z.string(),
							local_path: z.string().nullable().optional(),
							action: z.string(),
							proposed: z.string().nullable(),
							diff_vs_local: z.string(),
							diff_vs_hub: z.string(),
							kept: z.record(z.array(z.string())).optional(),
							engine: z
								.object({ model: z.string().nullable().optional() })
								.passthrough()
								.optional(),
							reason: z.string().nullable().optional(),
						})
						.passthrough(),
				),
				model: z.string().nullable().optional(),
				warnings: z.array(z.string()).optional(),
			})
			.passthrough(),
		adoption_receipt: z.string().min(16).max(128),
		snapshot: z
			.object({
				path: z.string().min(1),
				tree_hash: z.string(),
				manifest: z.array(z.unknown()),
			})
			.passthrough(),
		confirmation_required: z.literal(true),
	})
	.passthrough();

export type SkillAdoptionPreview = z.infer<typeof skillAdoptionPreviewSchema>;
export type SkillPullResult = {
	// Adoption previews describe an item before a link exists, so directional
	// link/operation IDs are absent until the core has actually created one.
	reports: (Pick<HubDirectionalReport, "outcome" | "applied"> &
		Partial<HubDirectionalReport>)[];
	link: HubLink | null;
	links: HubLinks;
	dry_run?: boolean;
	confirmation_required?: boolean;
	adoption?: SkillAdoptionPreview["adoption"];
	adoption_receipt?: string;
	snapshot?: SkillAdoptionPreview["snapshot"];
};

/** A preview carries an inventory for context, not evidence of an install. */
export function skillPullDidWrite(result: SkillPullResult, dryRun?: boolean) {
	return (
		!dryRun &&
		!result.dry_run &&
		!result.confirmation_required &&
		result.reports.some(
			(report) => report.applied || report.outcome === "unchanged",
		)
	);
}
