import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import type { WebauthnChoiceRequest } from "../model/webauthn-chooser";
import { BrowserWebauthnDialog } from "./browser-webauthn-dialog";

/**
 * The passkey chooser's own states, for the rounds that have to judge its copy and
 * its rows without a signed build.
 *
 * WHY A STORY FILE EXISTS AT ALL (design round 1, D6): the chooser shipped with no
 * rendered artifact anywhere — the design round had to improvise one from an
 * untracked file, and `scripts/capture-evidence.mjs` had no entry for it — so the
 * surface had no frame at its head and no regression could be seen. These are the
 * states that carry the findings: a named pair, the nameless case the copy was
 * contradicting, a long login that used to be cut mid-character at the panel edge,
 * a list long enough to scroll, an answer in flight, the waiting-behind note, and
 * the two endings the user did not cause.
 *
 * WHY THE REQUESTS ARE BUILT RATHER THAN HAND-WRITTEN IN THE MARKUP: the copy is
 * computed by `../model/webauthn-chooser` — the lead sentence, the page note, the
 * unnamed-row sentence and the settled paragraph all come from there — so a frame
 * of this story shows what the product would compute from these accounts, not what
 * a story author typed.
 *
 * NOTHING IS MOCKED BUT THE CALLBACKS: the dialog is presentational, which is
 * exactly why it can be evidenced here — a passkey request cannot be raised on
 * this machine (the authenticator is inert without a signed, entitled bundle), so
 * the alternative to these frames is no frame at all.
 */

const meta = {
	title: "Browser/Webauthn dialog",
	component: BrowserWebauthnDialog,
	parameters: { layout: "centered" },
	decorators: [
		(Story: FC) => (
			<div className="bg-canvas p-6">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof BrowserWebauthnDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function request(
	overrides: Partial<WebauthnChoiceRequest> = {},
): WebauthnChoiceRequest {
	return {
		requestId: "req-1",
		relyingPartyId: "accounts.example.com",
		tabId: 3,
		pageTitle: null,
		accounts: [
			{
				credentialId: "a",
				displayName: "Ada Lovelace",
				name: "ada@example.com",
			},
			{
				credentialId: "b",
				displayName: "Grace Hopper",
				name: "grace@example.com",
			},
		],
		...overrides,
	};
}

const state = (
	overrides: Partial<Parameters<typeof BrowserWebauthnDialog>[0]> = {},
) => ({
	render: (args: Parameters<typeof BrowserWebauthnDialog>[0]) => (
		<BrowserWebauthnDialog {...args} />
	),
	args: {
		open: true,
		request: request(),
		waitingBehind: 0,
		answering: false,
		notice: null,
		onDismiss: () => {},
		onChoose: () => {},
		...overrides,
	},
});

/** Two passkeys, both named: the everyday multi-match. */
export const SeveralNamed: Story = state();

/** One passkey. Electron dispatches a single match itself, so this is the
 * defensive shape — but the copy has to be true for it (design round 1, D3). */
export const OneAccount: Story = state({
	request: request({ accounts: [request().accounts[0]] }),
});

/** Three credentials, none of which the OS gave a name. The rows say so, and the
 * lead sentence explains what the choice actually decides (UX round 1, U1). */
export const Nameless: Story = state({
	request: request({
		accounts: [
			{ credentialId: "a", displayName: null, name: null },
			{ credentialId: "b", displayName: "  ", name: "" },
			{ credentialId: "c", displayName: null, name: null },
		],
	}),
});

/** A display name and a login that both exceed the panel: the case that used to be
 * cut mid-character with no ellipsis and no wrap (design round 1, D1). */
export const LongNames: Story = state({
	request: request({
		relyingPartyId: "identity.very-long-corporate-domain.example.com",
		accounts: [
			{
				credentialId: "a",
				displayName:
					"Alexandra Featherstonehaugh-Wallington the Third (Personal)",
				name: "alexandra.featherstonehaugh-wallington+personal@very-long-corporate-domain.example.com",
			},
			{
				credentialId: "b",
				displayName: null,
				name: "a.much.longer.login.with.a.plus.tag+work@another-long-domain.example.com",
			},
		],
	}),
});

/** Twelve credentials in a 900-tall viewport: the list scrolls, and the Touch ID
 * sentence is pinned rather than left below the fold (design round 1, D8). */
export const ManyAccounts: Story = state({
	request: request({
		accounts: Array.from({ length: 12 }, (_, index) => ({
			credentialId: `cred-${index + 1}`,
			displayName: `Account ${index + 1}`,
			name: `account.${index + 1}@example.com`,
		})),
	}),
});

/** An answer in flight: this dialog's own state, not the surface's shared busy
 * flag, so an unrelated action cannot freeze it (design round 1, D5). */
export const Answering: Story = state({ answering: true });

/** A second request waiting behind this one, named rather than silently
 * replacing it (reviewer round 1, finding 7). */
export const WaitingBehind: Story = state({ waitingBehind: 2 });

/** The page that asked, which is the one thing the user cannot see while the
 * chooser is up because the native view is suppressed (UX round 1, U3). */
export const FromAPage: Story = state({
	request: request({ pageTitle: "Quincy Beginnings — Muddy River News" }),
});

/** The ending the user did not cause, in words instead of a live-looking dialog
 * whose click would be discarded (design round 1, D2). */
export const Expired: Story = state({
	request: null,
	notice: {
		title: "This passkey request expired",
		body: "Nobody chose a passkey within a minute, so the site's request was cancelled. Ask the site for a passkey again.",
	},
});

/** The same panel for a cancellation: the tab that asked went away. */
export const HostStopped: Story = state({
	request: null,
	notice: {
		title: "This passkey request was cancelled",
		body: "The browser tab that asked went away before a passkey was chosen, so the request was cancelled.",
	},
});
