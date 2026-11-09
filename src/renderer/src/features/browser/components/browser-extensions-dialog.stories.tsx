import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import type { ExtensionSummary } from "../../../../../shared/browser-extensions";
import { BrowserExtensionsDialog } from "./browser-extensions-dialog";
import { BrowserExtensionsSubmenu } from "./browser-extensions-menu";

/**
 * The extension manager's states for design review without a running browser
 * host: empty, populated, starting, a worker that never started, a failed
 * verification and an update waiting for approval. The dialog is presentational
 * (main owns every decision and every confirmation), so these rows are exactly
 * the ExtensionSummary projections main would send. Nothing is mocked but the
 * callbacks.
 */
const base: ExtensionSummary = {
	id: "aeblfdkhhhdcdjpifhhbdiojplfjncoa",
	name: "1Password – Password Manager",
	version: "8.12.44.33",
	status: "enabled",
	error: null,
	hasPopup: true,
	hasOptions: false,
	iconDataUrl: null,
	allSites: true,
	hosts: [],
	permissions: [
		"contextMenus",
		"downloads",
		"notifications",
		"privacy",
		"storage",
		"tabs",
	],
	pendingVersion: null,
};
const other: ExtensionSummary = {
	...base,
	id: "cjpalhdlnbpafiamejdnhcphjbkeiagm",
	name: "Example Blocker",
	version: "1.62.0",
	hasPopup: true,
	hasOptions: true,
	allSites: false,
	hosts: ["*.example.com", "news.example.org"],
	permissions: ["storage"],
};

const noop = () => {};
const callbacks = {
	onClose: noop,
	onSetEnabled: noop,
	onRemove: noop,
	onOpen: noop,
	onOpenStore: noop,
	onCheckUpdates: noop,
};

const meta = {
	title: "Browser/Extensions dialog",
	component: BrowserExtensionsDialog,
	parameters: { layout: "centered" },
	decorators: [
		(Story: FC) => (
			<div className="bg-canvas p-6">
				<Story />
			</div>
		),
	],
	args: {
		open: true,
		extensions: [],
		busy: new Set(),
		checking: false,
		...callbacks,
	},
} satisfies Meta<typeof BrowserExtensionsDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Populated: Story = {
	args: {
		extensions: [
			base,
			{ ...other, status: "disabled", hasPopup: false, hasOptions: false },
		],
	},
};
export const Starting: Story = {
	args: { extensions: [{ ...base, status: "loading", hasPopup: false }] },
};
export const WorkerNotStarted: Story = {
	args: { extensions: [{ ...base, status: "error", error: "worker" }] },
};
export const VerificationFailed: Story = {
	args: {
		extensions: [
			{ ...base, status: "error", error: "verify", hasPopup: false },
		],
	},
};
export const UpdateWaitingForApproval: Story = {
	args: {
		extensions: [
			{ ...other, status: "needs-reconsent", pendingVersion: "1.63.0" },
		],
	},
};
export const CheckingForUpdates: Story = {
	args: {
		extensions: [base, other],
		checking: true,
		busy: new Set(["updates"]),
	},
};

/** The page-menu submenu, opened, with one usable and one disabled row. */
export const Submenu: StoryObj = {
	render: () => (
		<DropdownMenu open>
			<DropdownMenuTrigger>…</DropdownMenuTrigger>
			<DropdownMenuContent>
				<BrowserExtensionsSubmenu
					extensions={[base, { ...other, status: "disabled", hasPopup: false }]}
					onOpenPopup={noop}
					onManage={noop}
					onOpenStore={noop}
				/>
			</DropdownMenuContent>
		</DropdownMenu>
	),
};
