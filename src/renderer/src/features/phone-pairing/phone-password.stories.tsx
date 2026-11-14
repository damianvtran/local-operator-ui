/**
 * Settings → Phone access → "Using your own tunnel?" → Show phone password
 * (pairing design v2 §4.1 / D10; core local-operator #3963). Each story pins the
 * panel's state so design can compare frames; the read-on-click, clear-on-collapse
 * and never-logged rules are exercised by `scripts/phone-pairing.test.mjs`.
 *
 * The value below is a FAKE fixture, never a real password.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type { FC, ReactNode } from "react";
import {
	PhonePasswordDisclosure,
	type PhonePasswordReader,
} from "./phone-password";
import "../../styles/index.css";

const FAKE_PASSWORD = "fixture-Tq7v-9KmP-x2Lr";

/** Answers after a short pause, so pressing "Show phone password" shows the read. */
const fakeRead: PhonePasswordReader = () =>
	new Promise((resolve) => setTimeout(() => resolve(FAKE_PASSWORD), 400));

const Panel: FC<{ children: ReactNode }> = ({ children }) => (
	<div className="max-w-[640px] bg-canvas p-6">{children}</div>
);

const meta: Meta = {
	title: "Phone pairing/Phone password",
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

/** How Settings first shows it: one collapsed line. */
export const Collapsed: Story = {
	render: () => (
		<Panel>
			<PhonePasswordDisclosure read={fakeRead} />
		</Panel>
	),
};

/** Opened: an explanation and the button; nothing has been read yet. */
export const OpenNotRead: Story = {
	render: () => (
		<Panel>
			<PhonePasswordDisclosure read={fakeRead} defaultOpen />
		</Panel>
	),
};

/** Read, and masked by default: Show and Copy. */
export const ReadMasked: Story = {
	render: () => (
		<Panel>
			<PhonePasswordDisclosure
				read={fakeRead}
				defaultOpen
				initial={{ password: FAKE_PASSWORD }}
			/>
		</Panel>
	),
};

export const ReadRevealed: Story = {
	render: () => (
		<Panel>
			<PhonePasswordDisclosure
				read={fakeRead}
				defaultOpen
				initial={{ password: FAKE_PASSWORD, revealed: true }}
			/>
		</Panel>
	),
};

/** Core answered 404 `mobile_password_unset`. */
export const NotSet: Story = {
	render: () => (
		<Panel>
			<PhonePasswordDisclosure
				read={fakeRead}
				defaultOpen
				initial={{ state: "unset" }}
			/>
		</Panel>
	),
};

export const ReadFailed: Story = {
	render: () => (
		<Panel>
			<PhonePasswordDisclosure
				read={fakeRead}
				defaultOpen
				initial={{ state: "error" }}
			/>
		</Panel>
	),
};

/** The same, in a right-to-left language: the password stays one LTR token. */
export const ReadRevealedUrdu: Story = {
	args: { locale: "ur" },
	render: () => (
		<Panel>
			<PhonePasswordDisclosure
				read={fakeRead}
				defaultOpen
				initial={{ password: FAKE_PASSWORD, revealed: true }}
			/>
		</Panel>
	),
};
