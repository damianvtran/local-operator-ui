import type { Meta, StoryObj } from "@storybook/react";
import { BrowserSitesSheet } from "./browser-sites-sheet";

/**
 * The revocation surface, complete and scrolled (design 9.3/9.4, and design round
 * 1's D3, which asked for the whole sheet after the copy revision).
 *
 * Each state is populated at a representative size rather than with one row, because
 * the sheet's whole claim is that the granted set is inspectable and revocable in
 * one place: a frame with a single row cannot show the separate Approved/Denied
 * sections, the scope labels, or the scopes this app invents (`session`).
 *
 * The `deny` rows are deliberately present beside the grants. "What may the agent
 * reach" and "what have I turned off" are two readings of one store, and the copy
 * that separates them is the part worth reviewing.
 */

const meta = {
	title: "Browser/Sites sheet",
	component: BrowserSitesSheet,
} satisfies Meta<typeof BrowserSitesSheet>;
export default meta;
type Story = StoryObj<typeof meta>;

const APPROVALS = [
	{
		origin: "https://login.example.com",
		scope: "origin" as const,
		grantedAt: Date.now() - 60_000,
	},
	{
		origin: "https://example.com",
		scope: "domain" as const,
		grantedAt: Date.now() - 3_600_000,
	},
	{
		origin: "https://docs.example.org",
		scope: "session" as const,
		grantedAt: Date.now() - 120_000,
	},
	{
		origin: "https://ads.example.net",
		scope: "deny" as const,
		grantedAt: Date.now() - 900_000,
	},
];

export const Populated: Story = {
	args: {
		open: true,
		onOpenChange: () => {},
		approvals: APPROVALS,
		currentOrigin: "https://login.example.com",
		busy: false,
		onRevoke: () => {},
		onRevokeAll: () => {},
		onForgetSite: () => {},
		onClearData: () => {},
	},
};

/** Nothing granted and nothing denied: the first-run state, which still has to
 * explain the three affordances that look alike and are not. */
export const Empty: Story = {
	args: {
		open: true,
		onOpenChange: () => {},
		approvals: [],
		currentOrigin: null,
		busy: false,
		onRevoke: () => {},
		onRevokeAll: () => {},
		onForgetSite: () => {},
		onClearData: () => {},
	},
};
