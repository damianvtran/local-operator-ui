import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import type { WebauthnChoiceRequest } from "../model/webauthn-chooser";
import {
	type WebauthnEnding,
	chooserPanel,
	endingFor,
} from "../model/webauthn-panel";
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

/**
 * One story's inputs, turned into the panel the dialog actually renders.
 *
 * The panel is BUILT BY THE MODEL (`chooserPanel`) rather than written out, so a
 * frame of any state below shows what the product would compute from these
 * inputs. That is also what makes the round-2 rule visible in the artifact: an
 * ending passed while a request is still queued does NOT render the ending, so
 * there is no story — and no state — in which a live request sits behind one.
 */
const state = (
	input: {
		requests?: WebauthnChoiceRequest[];
		ending?: WebauthnEnding | null;
		answering?: boolean;
	} = {},
) => ({
	render: (args: Parameters<typeof BrowserWebauthnDialog>[0]) => (
		<BrowserWebauthnDialog {...args} />
	),
	args: {
		open: true,
		panel: chooserPanel({
			requests: input.requests ?? [request()],
			ending: input.ending ?? null,
			answering: input.answering ?? false,
		}),
		onChoose: () => {},
		onCancelRequest: () => {},
		onDismissEnding: () => {},
		onCloseAutoFocus: () => {},
	},
});

/** Two passkeys, both named: the everyday multi-match. */
export const SeveralNamed: Story = state();

/** One passkey. Electron dispatches a single match itself, so this is the
 * defensive shape — but the copy has to be true for it (design round 1, D3). */
export const OneAccount: Story = state({
	requests: [request({ accounts: [request().accounts[0]] })],
});

/** Three credentials, none of which the OS gave a name. The rows say so, and the
 * lead sentence explains what the choice actually decides (UX round 1, U1). */
export const Nameless: Story = state({
	requests: [
		request({
			accounts: [
				{ credentialId: "a", displayName: null, name: null },
				{ credentialId: "b", displayName: "  ", name: "" },
				{ credentialId: "c", displayName: null, name: null },
			],
		}),
	],
});

/** A display name and a login that both exceed the panel: the case that used to be
 * cut mid-character with no ellipsis and no wrap (design round 1, D1). */
export const LongNames: Story = state({
	requests: [
		request({
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
	],
});

/** Twelve credentials in a 900-tall viewport: the list scrolls, and the Touch ID
 * sentence is pinned rather than left below the fold (design round 1, D8). */
export const ManyAccounts: Story = state({
	requests: [
		request({
			accounts: Array.from({ length: 12 }, (_, index) => ({
				credentialId: `cred-${index + 1}`,
				displayName: `Account ${index + 1}`,
				name: `account.${index + 1}@example.com`,
			})),
		}),
	],
});

/** An answer in flight: this dialog's own state, not the surface's shared busy
 * flag, so an unrelated action cannot freeze it (design round 1, D5). */
export const Answering: Story = state({ answering: true });

/** A second request waiting behind this one, named rather than silently
 * replacing it (reviewer round 1, finding 7). */
export const WaitingBehind: Story = state({
	requests: [
		request(),
		request({ requestId: "req-2" }),
		request({ requestId: "req-3" }),
	],
});

/** The page that asked, which is the one thing the user cannot see while the
 * chooser is up because the native view is suppressed (UX round 1, U3). */
export const FromAPage: Story = state({
	requests: [request({ pageTitle: "Quincy Beginnings — Muddy River News" })],
});

/** The ending the user did not cause, in words instead of a live-looking dialog
 * whose click would be discarded (design round 1, D2). */
export const Expired: Story = state({
	requests: [],
	ending: endingFor("req-1", "expired"),
});

/** The same panel for a cancellation: the tab that asked went away. */
export const HostStopped: Story = state({
	requests: [],
	ending: endingFor("req-1", "host-stopped"),
});
