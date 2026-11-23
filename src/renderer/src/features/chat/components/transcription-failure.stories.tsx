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
import { CircleAlert } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import "../../../styles/index.css";
import {
	TranscriptionRequestError,
	retakeOfferFor,
	transcriptionFailureMessage,
} from "@shared/api/local-operator/transcription-failure";
import { DictationTakeRow } from "@shared/components/composer/dictation-take-row";
import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
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
const RelayFrame = ({ status, detail }: { status: number; detail: string }) => (
	<div className="h-screen bg-canvas p-8">
		<div className="mx-auto max-w-2xl">
			<p className="text-meta text-ink-muted">Relay answer</p>
			<p className="mt-1 text-body">HTTP {status}</p>
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
	status: number;
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

/**
 * The server's own reason, read out of the relayed body and then answered.
 *
 * The body here is the shape the first cut photographed as four lines of URL and
 * JSON punctuation with the answer buried mid-line - the reason is the `message`
 * INSIDE that document, and the toast now shows it followed by what to do about
 * it (review round 1, D2).
 */
export const ServerMessageClipped: Story = {
	parameters: { toastDuration: Number.POSITIVE_INFINITY },
	render: () => <Refusal status={500} detail={LONG_BODY} />,
};

/** Nothing to quote: a failure that states the absence rather than inventing one. */
export const NoReasonGiven: Story = {
	parameters: { toastDuration: Number.POSITIVE_INFINITY },
	render: () => <Refusal status={503} detail="" />,
};

/*
 * THE ROW, AND WHY IT NEEDS ITS OWN FRAMES.
 *
 * The toast stories above are about a sentence. These are about a control: the
 * row under the composer is the only place a failed take can be discarded, and
 * before this change it offered Retry-only or nothing - so a recording the app
 * refused for its size (413) or a request the server rejected (422) had copy
 * telling the reader to try again and no surface at all to try again from.
 *
 * EACH STORY DRIVES THE SHIPPED ROW THROUGH THE SHIPPED POLICY. `retakeOfferFor`
 * decides the sentence and whether Retry exists; the story passes its answer to
 * `DictationTakeRow`, the component the composer renders, and does not restate
 * either. A story that hard-coded "no Retry" would photograph a claim rather than
 * the code making it.
 *
 * THE FRAME SHOWS THE ROW IN ITS SLOT. The box above it is a stand-in for the
 * composer band - the same ground, border and measure - because mounting the real
 * composer in a story needs a microphone and a relay; the row's own geometry,
 * controls and copy are the real ones. Behaviour (what Discard does, what Retry
 * re-sends) is driven in `scripts/shared-composer.test.mjs`, not claimed here.
 */
const RowFrame = ({ children }: { children: React.ReactNode }) => (
	<div className="min-h-screen bg-canvas p-8">
		<div className="mx-auto max-w-3xl">
			<div className="rounded-xl border border-control bg-surface p-3">
				<div className="px-2 py-2 text-body text-ink-dim">
					Type a message, or hold to dictate…
				</div>
				{children}
			</div>
		</div>
	</div>
);

/** The row the policy chose for one failure, rendered by the shipped component. */
const PolicyRow = ({ status, detail }: { status: number; detail: string }) => {
	const offer = retakeOfferFor(new TranscriptionRequestError(status, detail));
	return (
		<DictationTakeRow
			message={offer.message}
			retry={offer.retry}
			onRetry={() => undefined}
			onDiscard={() => undefined}
		/>
	);
};

/**
 * The row this branch replaces: Retry beside the transient sentence, and no way
 * out for a take the app or the server will not accept.
 *
 * Reproduced from the markup at `origin/main` rather than imported, because the
 * component it lived in no longer renders it - and a "before" frame that called
 * the new component would be a photograph of the after.
 */
const BeforeRow = ({ message }: { message: string }) => (
	<div className="mt-1 flex items-center gap-2 px-2 [min-height:1.5rem]">
		<CircleAlert aria-hidden="true" className="size-3.5 shrink-0 text-danger" />
		<span className="font-medium text-body-sm text-ink-muted">{message}</span>
		{/*
		 * The control as `origin/main` rendered it: the shared `Button` in the `link`
		 * variant, so the before frame carries the same green, underlined word.
		 */}
		<Button
			type="button"
			variant="link"
			size="sm"
			className="h-7 shrink-0 px-2 underline"
		>
			{t("ui.common.actions.retry")}
		</Button>
	</div>
);

/** The transient class: Retry AND Discard, the take kept across a spent burst. */
export const RowTransientRetryAndDiscard: Story = {
	parameters: { layout: "fullscreen" },
	render: () => (
		<RowFrame>
			<PolicyRow
				status={502}
				detail='Transcription failed upstream. Upstream responded 500: {"error":"failed to check billing account"}'
			/>
		</RowFrame>
	),
};

/** HTTP 413: the app's own plane refused the bytes before sending them. */
export const RowTooLongDiscardOnly: Story = {
	parameters: { layout: "fullscreen" },
	render: () => (
		<RowFrame>
			<PolicyRow status={413} detail="This file is too large." />
		</RowFrame>
	),
};

/** HTTP 422: the server rejected the request itself; its reason is quoted. */
export const RowRejectedDiscardOnly: Story = {
	parameters: { layout: "fullscreen" },
	render: () => (
		<RowFrame>
			<PolicyRow status={422} detail="The audio track is missing." />
		</RowFrame>
	),
};

/** The shape this branch replaces: one sentence, Retry, and nothing else. */
export const RowBeforeRetryOnly: Story = {
	parameters: { layout: "fullscreen" },
	render: () => (
		<RowFrame>
			<BeforeRow message="Dictation failed: the transcription service had a temporary fault. Your recording is kept — Retry sends it again." />
		</RowFrame>
	),
};
