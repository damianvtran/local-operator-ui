import type { SkillAdoptionPreview } from "@shared/api/local-operator/hub-skill-adoption";

// Invented review content shared by presentation and production-composition stories.
export const adoptionFixture: SkillAdoptionPreview = {
	adoption: {
		state: "ready",
		strategy: "merge",
		model: "fixture/model",
		files: [
			{
				path: "SKILL.md",
				local_path: "SKILL.md",
				action: "merged",
				proposed:
					"---\nname: release-checklist\ndescription: Verify a release without losing local guardrails.\n---\n# Release checklist\n\n## Local safety\nPreserve original files and require explicit approval.\n\n## Hub verification\nExercise the real endpoint and record its response.\n",
				diff_vs_local:
					"--- local/SKILL.md\n+++ proposed/SKILL.md\n@@ -5,2 +5,5 @@\n ## Local safety\n Preserve original files and require explicit approval.\n+\n+## Hub verification\n+Exercise the real endpoint and record its response.\n",
				diff_vs_hub:
					"--- hub/SKILL.md\n+++ proposed/SKILL.md\n@@ -4,2 +4,5 @@\n # Release checklist\n+\n+## Local safety\n+Preserve original files and require explicit approval.\n \n ## Hub verification\n",
				kept: {
					local: ["Local safety"],
					hub: ["Hub verification"],
					combined: ["Release checklist"],
					unresolved: [],
				},
			},
			{
				path: "assets/release.png",
				local_path: "assets/release.png",
				action: "carried",
				proposed: null,
				diff_vs_local: "",
				diff_vs_hub: "",
			},
		],
		warnings: [],
	},
	adoption_receipt: "fixture-receipt-1234567890",
	snapshot: {
		path: "~/.config/local-operator/backups/skills/release-checklist/2026-11-03T120000Z",
		tree_hash: "fixture-tree-hash",
		manifest: [],
	},
	confirmation_required: true,
};
