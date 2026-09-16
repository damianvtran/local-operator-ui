/**
 * The PRE-CHANGE reproduction of `/compact`'s stuck dialog (base `9adf108dc`).
 *
 * SCRATCH RIG, NOT A COMMITTED FILE. It exists only in a detached worktree of
 * the base commit, because the component it mounts - `CompactView` - is
 * deleted by the change these frames are the before-half of. The frames it
 * produced are committed under
 * `docs/evidence/chat-compact-dialog-before/`, declared as a `supplementary` set in
 * the manifest for exactly this reason: a sweep of the shipping tree cannot
 * produce them, because the tree no longer has the dialog.
 *
 * WHAT IT PROVES. The dialog's only exit is its own Close button. Both stories
 * mount the REAL `CompactView` through the REAL `PickerHost`, with two
 * stand-ins and nothing else:
 *
 *  - `window.api.desktop.request` answers `sessions.command` with the owner's
 *    own optimistic receipt for `/compact` (`SlashResult(kind="notice",
 *    text="compacting context...", style="info")`, the literal
 *    `_compact_slash` returns);
 *  - the canonical handle is a stub whose transcript holds the records the
 *    story hands it.
 *
 * `Pending` is the state the operator is stuck in on the way there: the pass is
 * asked for and no record has landed, so the dialog sits on "Asking the owner to
 * compact". `Settled` is the one that matters: the transcript now carries the
 * REAL reducer's own `compaction` record, which is the thing the dialog was
 * waiting for - and the dialog is still open, on the same Close button, saying
 * the pass finished. Nothing retired it, and that is the defect.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import type { CanonicalSessionHandle } from "@renderer/shared/hooks/use-canonical-session";
import {
	EMPTY_TRANSCRIPT,
	applyEvent,
} from "../canonical/transcript-reducer";
import { CompactView } from "./destination-pickers";

/** The owner's answer to a `/compact` receipt, verbatim from `_compact_slash`. */
const RECEIPT = {
	kind: "notice",
	text: "compacting context\u2026",
	style: "info",
	data: {},
};

/**
 * Stub the one bridge `useSessionCommand` rides, for this story only.
 *
 * At MODULE scope rather than in an effect, and that is a measured detail
 * rather than a style: `CompactView` fires the command from its own mount
 * effect, child effects run before the parent's, and a mock installed from the
 * wrapper's effect therefore arrived one render too late - the first run of this
 * rig photographed `/compact did not run: Desktop controls need a compatible
 * backend connection.`, which is the dialog's FAILURE state and not the receipt
 * the operator was stuck on.
 */
const armBridge = () => {
	window.api = {
		desktop: {
			request: async () => ({
				status: 200,
				// The HTTP envelope: `CRUDResponse[CommandReceipt]`, whose `result`
				// is the receipt and whose receipt's own `result` is the SlashResult
				// the owner answered with. Getting one level wrong here is what the
				// first runs of this rig measured - `toResult` then reads `.kind` off
				// undefined and the dialog shows a transport failure instead.
				body: { result: { command: "compact", result: RECEIPT } },
			}),
		},
	} as unknown as typeof window.api;
};

/**
 * A canonical handle with the ONE field `CompactView` reads.
 *
 * `records` is passed in rather than derived, because the two stories differ in
 * exactly that: whether the compaction record the dialog waits for is there.
 */
const handle = (records: CanonicalSessionHandle["transcript"]["records"]) =>
	({ transcript: { records } }) as unknown as CanonicalSessionHandle;

const settledRecords = () => {
	const state = applyEvent(EMPTY_TRANSCRIPT, {
		type: "compaction_end",
		success: true,
		tokens_before: 41_000,
		tokens_after: 9_000,
	});
	return state.records;
};

const Dialog = ({ records }: { records: CanonicalSessionHandle["transcript"]["records"] }) => {
	/*
	 * Armed in the RENDER PHASE, not at module scope and not in an effect.
	 *
	 * Module scope lost the race: Vite's HMR re-evaluates the preview module
	 * (whose module-level block installs Storybook's own `window.api` stub) after
	 * a story edit, so the stub came back on top of this one and the rig
	 * photographed the dialog's failure state instead of its receipt. An effect
	 * loses the other race, and the parent/child one measured above. A lazy state
	 * initializer runs during this component's first render, which is before
	 * `CompactView` mounts and fires its command, and after every module above it
	 * has finished evaluating.
	 */
	useState(() => {
		armBridge();
		return null;
	});
	return (
		<div className="p-8">
			<CompactView
				// Only `sessionId` and `canonical` are read by this adapter; the rest
				// of `PickerContext` is required by the type and unused here, so each
				// is a no-op rather than a second behaviour this rig would be
				// reproducing by accident.
				action={{ kind: "native_action", destination: "session.compact" } as never}
				spec={{} as never}
				sessionId="repro-session"
				canonical={handle(records)}
				commands={[]}
				onClose={() => {}}
				note={() => {}}
				dispatch={() => {}}
				rebind={() => {}}
			/>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Compact dialog (before)",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The wait: the receipt came back and no record ever lands. */
export const Pending: Story = {
	render: () => <Dialog records={[]} />,
};

/** The defect: the record the dialog was waiting for HAS landed, and the dialog
 * is still open on its own Close button. */
export const Settled: Story = {
	render: () => <Dialog records={settledRecords()} />,
};
