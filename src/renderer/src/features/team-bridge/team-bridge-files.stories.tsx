import "../chat/components/story-electron-shim";
import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import { Button } from "@shared/components/ui/button";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import type { Meta, StoryObj } from "@storybook/react";
import { waitFor } from "@storybook/test";
import { useLayoutEffect, useState } from "react";
import type { TeamBridgeFilesCapability } from "../../../../shared/team-bridge-contract";
import { TeamBridgeComposer } from "./team-bridge-composer";

const CAP: TeamBridgeFilesCapability = {
	version: 1,
	enabled: true,
	download_only: true,
	classes: [{ class: "text", max_bytes: 25 * 1024 * 1024 }],
	max_items: 10,
};

/** Component evidence ONLY. The real composer/hook runs, but the upload method
 * is scripted. These frames do not claim Electron, core, S3 or hub transfer. */
function Fixture({
	mode,
}: { mode: "ready" | "loading" | "error" | "off" | "empty" }) {
	const [owner, setOwner] = useState("a");
	const [tenant, setTenant] = useState("one");
	const [conversation, setConversation] = useState("one");
	const [sent, setSent] = useState(false);
	useLayoutEffect(() => {
		const original = TeamBridgeApi.uploadFile;
		let attempts = 0;
		TeamBridgeApi.uploadFile = async () => {
			attempts += 1;
			if (mode === "loading") return new Promise(() => {});
			if (mode === "error" && attempts === 1)
				throw new Error("Scripted upload failure");
			return {
				id: "batt_story_file",
				size: 18,
				mime: "application/octet-stream",
				class: "text",
				display_name: "Project notes.txt",
				state: "staged",
			};
		};
		useConversationInputStore
			.getState()
			.setComposerText("files-story", "A note with the attached file.");
		return () => {
			TeamBridgeApi.uploadFile = original;
		};
	}, [mode]);
	return (
		<div className="flex h-screen flex-col bg-surface">
			<div className="flex flex-wrap gap-2 p-5">
				<Button
					variant="outline"
					size="sm"
					onClick={() => setOwner((value) => (value === "a" ? "b" : "a"))}
				>
					Switch account
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={() =>
						setTenant((value) => (value === "one" ? "two" : "one"))
					}
				>
					Switch tenant
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={() =>
						setConversation((value) => (value === "one" ? "two" : "one"))
					}
				>
					Switch conversation
				</Button>
			</div>
			<output className="px-5 text-sm text-ink-muted">
				Component fixture — account {owner}, tenant {tenant}, conversation{" "}
				{conversation}.{" "}
				{sent ? "Synthetic bind accepted." : "No real network transfer."}
			</output>
			<div className="min-h-0 flex-1" />
			<div className="px-5 pb-4 pt-1">
				<TeamBridgeComposer
					conversationId="files-story"
					placeholder="Message"
					canAttach
					fileContext={{
						accountId: `acct_${owner}`,
						tenantId: `tnt_${tenant}`,
						conversationId: `bcv_${conversation}`,
						capability: mode === "off" ? null : CAP,
					}}
					onSendMessage={async (_body, _images, files) => {
						if (files?.count)
							await files.stageInto(`bcv_${conversation}`, `tnt_${tenant}`);
						setSent(true);
						return true;
					}}
				/>
			</div>
		</div>
	);
}
const meta = {
	title: "Team Bridge/Files composer",
	component: Fixture,
	parameters: { layout: "fullscreen" },
	args: { mode: "ready" },
} satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;
const dropFile: NonNullable<Story["play"]> = async ({ canvasElement }) => {
	// Let the fixture's draft-store initialization settle before dispatching a
	// user event; Storybook can start play before its external-store rerender.
	await new Promise((resolve) => setTimeout(resolve, 100));
	const target = canvasElement.querySelector("[data-composer-bar]");
	if (!target) throw new Error("Composer missing");
	const file = new File(["fixture file bytes"], "Project notes.txt", {
		type: "text/plain",
	});
	const dataTransfer = new DataTransfer();
	dataTransfer.items.add(file);
	target.dispatchEvent(
		new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }),
	);
	await waitFor(() => {
		if (!canvasElement.querySelector("[data-file-chip]"))
			throw new Error("File chip missing");
	});
};
export const Empty: Story = { args: { mode: "empty" } };
export const Populated: Story = { args: { mode: "ready" }, play: dropFile };
export const Loading: Story = { args: { mode: "loading" }, play: dropFile };
export const FailureRetry: Story = { args: { mode: "error" }, play: dropFile };
export const CapabilityOff: Story = { args: { mode: "off" }, play: dropFile };
