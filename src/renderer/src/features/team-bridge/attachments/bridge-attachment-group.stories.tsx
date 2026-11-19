import type { Meta, StoryObj } from "@storybook/react";
import {
	FILE_SAVE_FILES,
	fileSaveAnswer,
	pressFileSaves,
} from "../team-bridge-attachments.fixtures";
import {
	type BridgeFileDescriptor,
	toBridgeFileDescriptor,
} from "./attachment-model";
import { BridgeAttachmentGroup } from "./bridge-attachment-group";

const metadata = {
	id: "synthetic-receipt",
	mime: "image/png",
	size: 2048,
	width: 640,
	height: 480,
	state: "bound",
};
const meta = {
	title: "Team Bridge/Shared attachment cards",
	component: BridgeAttachmentGroup,
	parameters: { layout: "padded" },
	args: { attachments: [metadata] },
} satisfies Meta<typeof BridgeAttachmentGroup>;
export default meta;
type Story = StoryObj<typeof meta>;

// These are descriptors only: no relay or upload is simulated. Existing member
// image stories exercise the same anatomy through the authenticated member seam.
export const AuditMetadata: Story = {};
export const FileMetadata: Story = {
	args: { attachments: [{ ...metadata, mime: "application/octet-stream" }] },
};
export const CountOnlyAudit: Story = { args: { attachments: [], count: 3 } };
export const Empty: Story = { args: { attachments: [] } };
export const Unavailable: Story = {
	args: {
		compact: true,
		attachments: ["expired", "withheld", "deleted", "unknown", "revoked"].map(
			(state) => ({ ...metadata, id: state, state }),
		),
	},
};
export const NarrowAudit: Story = {
	args: {
		compact: true,
		attachments: [metadata, { ...metadata, id: "second" }],
	},
	decorators: [
		(Story) => (
			<div style={{ width: 272 }}>
				<Story />
			</div>
		),
	],
};

/*
 * S3b generic files (`files[]` / `file_count`). Synthetic descriptors shaped
 * like agent-server `docs/bridge-files-s3b-binding.md`; names are fixture text,
 * never real uploads. Without a `readFile` (these first stories) a card offers
 * nothing; the Save stories below hand in a synthetic one.
 */
const file = (
	id: string,
	fileClass: string,
	displayName: string | null,
	size: number,
	state = "bound",
): BridgeFileDescriptor => ({
	id,
	fileClass,
	displayName,
	size,
	state,
	expiresAt: null,
});
const s3bFiles = [
	file("bfile_pdf", "pdf", "Q4 board report (signed).pdf", 184_320),
	file("bfile_csv", "text", "تقرير الربع الرابع.csv", 920),
	file(
		"bfile_docx",
		"container",
		"Customer onboarding checklist v12.docx",
		2_400_000,
	),
	file("bfile_bin", "other", null, 25_000_000),
];
export const Files: Story = { args: { attachments: [], files: s3bFiles } };
export const FilesExpired: Story = {
	args: {
		attachments: [],
		files: [s3bFiles[0], file("bfile_gone", "", null, 0, "expired")],
	},
};
export const FilesCountOnly: Story = {
	args: { attachments: [], files: [], fileCount: 2 },
};
export const MixedImagesAndFilesCompact: Story = {
	args: {
		compact: true,
		attachments: [0, 1, 2, 3].map((index) => ({
			...metadata,
			id: `image-${index}`,
		})),
		files: [
			...s3bFiles,
			file(
				"bfile_long",
				"pdf",
				"An extremely long exported filename from a shared drive folder.pdf",
				9_800_000,
			),
			file("bfile_md", "text", "notes.md", 3_100),
		],
	},
	decorators: [
		(Story) => (
			<div style={{ width: 420 }}>
				<Story />
			</div>
		),
	],
};

/*
 * SAVE (decision a-fdf0). `readFile` is the caller's authority in the app (the
 * member relay or the owner-audit relay); here it is the shared synthetic file
 * lane, keyed by fixture id. One story per state that needs a press, so each
 * frame also shows where focus lands: on the control while saving or after a
 * failure, on the card once the control is gone (refused, too large).
 */
const saveFiles = FILE_SAVE_FILES.map(toBridgeFileDescriptor);
const readFile = async (target: BridgeFileDescriptor) => {
	const answer = await fileSaveAnswer(target.id);
	if (answer.kind === "bytes") return answer.data;
	throw Object.assign(new Error("synthetic refusal"), {
		status: answer.status,
	});
};
const pressOnly: NonNullable<Story["play"]> = async ({ canvasElement }) => {
	canvasElement.querySelector<HTMLButtonElement>("li button")?.click();
	await new Promise((resolve) => setTimeout(resolve, 50));
};
const only = (id: string): Story => ({
	args: {
		attachments: [],
		files: saveFiles.filter((row) => row.id === id),
		readFile,
	},
	play: pressOnly,
});
export const FileSaveAvailable: Story = {
	args: { attachments: [], files: saveFiles, readFile },
};
export const FileSaveStates: Story = {
	args: { attachments: [], files: saveFiles, readFile },
	play: async ({ canvasElement }) => pressFileSaves(canvasElement),
};
export const FileSaveSaving = only("bfile_save_hold");
export const FileSaveRefused = only("bfile_save_refused");
export const FileSaveTooLarge = only("bfile_save_large");
export const FileSaveFailed = only("bfile_save_offline");
export const FileSaveExpired: Story = {
	args: {
		attachments: [],
		files: saveFiles.filter(
			(row) => row.id.endsWith("expired") || row.id.endsWith("lapsed"),
		),
		readFile,
	},
};
