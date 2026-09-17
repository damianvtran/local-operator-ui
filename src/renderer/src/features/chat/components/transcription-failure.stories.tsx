/**
 * What a failed dictation tells the reader.
 *
 * The defect these frames exist to show: every transcription failure used to
 * arrive as one literal - "Error transcribing audio. Please try again." - while
 * the server's own reason sat unused in the error the call site logged. The
 * operator lost a day to it (the upstream provider had no credits, and "try
 * again" could not help), so the pair that matters here is the same failure
 * rendered before and after the change: `BeforeGeneric` is the copy this app
 * shipped, and `ProviderOutOfCredits` is the sentence it ships now.
 *
 * The relay's own answer is drawn under the toast because the two together are
 * the claim - status and body in, sentence out - and because a screenshot of a
 * toast alone cannot show which refusal produced it. The toast is the app's real
 * one: the preview frame mounts `ThemedToastContainer`, so this story only has to
 * hand the real mapper a real `TranscriptionRequestError`, which is exactly what
 * both call sites do (see `transcription-failure-copy.test.mjs`).
 *
 * `toastDuration: Number.POSITIVE_INFINITY` holds the toast for the story's
 * lifetime: Sonner's production lifetime would let it expire mid-capture.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useEffect } from "react";
import { toast } from "sonner";
import "../../../styles/index.css";
import {
	TranscriptionRequestError,
	transcriptionFailureMessage,
} from "@shared/api/local-operator/transcription-failure";
import { resetToastDedup, showErrorToast } from "@shared/utils/toast-manager";

/** The copy the app shipped before this change, in both call sites' words. */
const SHIPPED_BEFORE = "Error transcribing audio. Please try again.";

/** The operator's own incident, as the daemon relayed it. */
const OPENAI_QUOTA =
	"OpenAI API error (insufficient_quota): You have no credits remaining. Visit https://platform.openai.com/account/billing to add credits.";

/** The shape the operator's toast never had to survive: a URL plus a body. */
const LONG_BODY =
	'POST https://api.example.com/v1/audio/transcriptions returned 400\n{"error":{"message":"The audio could not be decoded: unsupported codec \'opus\' in a webm container without a duration header, and the request was retried three times before the provider gave up on the segment.","type":"invalid_request_error"}}';

/**
 * Fire one toast on mount, and take it down with the story.
 *
 * The toast manager is the shipped one, cooldown and dedup included, so the
 * teardown resets that state: a frame taken after a story switch must not be a
 * suppressed toast.
 *
 * The delay is not cosmetic. Sonner's `Toaster` is mounted by the preview
 * decorator AFTER the story, so a child's effect runs before the container has
 * subscribed and the toast is emitted into an empty region - measured here as a
 * frame with a live story and no toast at all. One tick puts the emission after
 * the decorator's own mount, which is also the order a real call site has (the
 * user's press always comes after the app is up).
 */
const ToastOnce = ({ message }: { message: string }) => {
	useEffect(() => {
		const timer = setTimeout(() => showErrorToast(message), 0);
		return () => {
			clearTimeout(timer);
			toast.dismiss();
			resetToastDedup();
		};
	}, [message]);
	return null;
};

/** The relay's answer, drawn as the machine voice it is, under the toast. */
const RelayFrame = ({
	status,
	detail,
}: { status: number | null; detail: string }) => (
	<div className="h-screen bg-canvas p-8">
		<div className="mx-auto max-w-2xl">
			<p className="text-meta text-ink-muted">Relay answer</p>
			<p className="mt-1 text-body">HTTP {status ?? "no answer"}</p>
			<p className="mt-4 text-meta text-ink-muted">
				Detail, exactly as the server sent it
			</p>
			<pre className="mt-1 whitespace-pre-wrap break-all font-mono text-mono-sm text-ink-dim">
				{detail || "(empty)"}
			</pre>
			<p className="mt-4 text-meta text-ink-muted">The toast:</p>
		</div>
	</div>
);

const meta: Meta = {
	title: "Chat/Dictation failures",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** One refusal, rendered the way both call sites render it. */
const Refusal = ({
	status,
	detail,
	override,
}: {
	status: number | null;
	detail: string;
	/** Set only by the before frame, which is the copy this change replaced. */
	override?: string;
}) => (
	<>
		<RelayFrame status={status} detail={detail} />
		<ToastOnce
			message={
				override ??
				transcriptionFailureMessage(
					new TranscriptionRequestError(status, detail),
				)
			}
		/>
	</>
);

/**
 * The frame this change replaces: the operator's own failure, told to try again.
 */
export const BeforeGeneric: Story = {
	parameters: { toastDuration: Number.POSITIVE_INFINITY },
	render: () => (
		<Refusal status={500} detail={OPENAI_QUOTA} override={SHIPPED_BEFORE} />
	),
};

/** The same failure, now naming where the money has to come from. */
export const ProviderOutOfCredits: Story = {
	parameters: { toastDuration: Number.POSITIVE_INFINITY },
	render: () => <Refusal status={500} detail={OPENAI_QUOTA} />,
};

/** Radient's own refusal (HTTP 402): a different account, a different fix. */
export const RadientCredits: Story = {
	parameters: { toastDuration: Number.POSITIVE_INFINITY },
	render: () => <Refusal status={402} detail="Payment Required" />,
};

/** A refused credential: signing in again is the action, not retrying. */
export const SignInRefused: Story = {
	parameters: { toastDuration: Number.POSITIVE_INFINITY },
	render: () => <Refusal status={401} detail="Forbidden" />,
};

/** A cause with no shorter truth: the server's sentence, clipped to one line. */
export const ServerMessageClipped: Story = {
	parameters: { toastDuration: Number.POSITIVE_INFINITY },
	render: () => <Refusal status={500} detail={LONG_BODY} />,
};

/** Nothing to quote: a failure with no invented cause. */
export const NoReasonGiven: Story = {
	parameters: { toastDuration: Number.POSITIVE_INFINITY },
	render: () => <Refusal status={503} detail="" />,
};
