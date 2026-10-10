/**
 * @file session-model-access.tsx
 * @description
 * The session band's standing statement that the model this session runs
 * cannot authenticate, with the two ways out.
 *
 * ## Why this block exists
 *
 * The runtime pins a session's model in its journal, and a pinned model can
 * outlive the credential that once made it runnable — the operator's report is
 * exactly that state: a session left on `radient/auto` with the Radient
 * sign-in gone, where every frame still looks healthy and every turn fails at
 * the provider. The runtime publishes `model_access` beside `selected_model`
 * for it; this is the desktop band's rendering of `signed_out`, and the
 * reading it takes (`modelAccessReading`) renders NOTHING for `ok` or for an
 * older host's silence — an absent field is not a state.
 *
 * ## Copy, and what it deliberately does not say
 *
 * The sentence names the PROVIDER, not the selector: the user's remedy is a
 * sign-in for a provider account, and the provider's own human name is what
 * every other auth surface shows. The selector is the band chip's fact, and
 * restating it here would be a second claim about the same thing. `label` is
 * runtime display metadata that may arrive empty; `modelAccessReading` falls
 * it back to the provider id so the sentence always names something.
 *
 * ## The two actions, and why exactly these
 *
 * - `Switch model` dispatches the SAME `/model` command the band chip fires
 *   (`onCommand`), so this block cannot become a second way into the picker —
 *   and the picker's default scope then offers only rows that can run.
 * - `Connect` opens the connect dialog every other connect surface opens
 *   (`useConnectProviderStore`), pre-focused on this provider, never a
 *   second sign-in flow.
 *
 * `onSwitchModel` is optional because a host with no command dispatcher
 * cannot open a picker; `Connect` is not, because this block only renders at
 * all when the host published `model_access`, which is a newer contract than
 * the connect dialog the app has carried since it shipped.
 *
 * The kind rides a `data-lo-model-access` attribute, in the shape this
 * repository's other standing blocks use (`data-lo-radient-issue`), so a
 * driver scene can read which state is on screen without matching prose.
 * The copy is not a contract a scene should key on.
 */

import {
	Alert,
	AlertDescription,
	AlertTitle,
	Button,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import { CHAT_MEASURE } from "../chat-measure";
import type { ModelAccessReading } from "./session-model";

export type SessionModelAccessBandProps = {
	/** The `signed_out` reading; see `modelAccessReading`. */
	access: ModelAccessReading;
	/**
	 * Dispatch `/model` — the picker's one entrance. Absent on a host with no
	 * command dispatcher, which renders the sentence without this action.
	 */
	onSwitchModel?: () => void;
	/** Open the connect dialog, pre-focused on `access.provider`. */
	onConnect: () => void;
	isSmallView?: boolean;
};

export const SessionModelAccessBand: FC<SessionModelAccessBandProps> = ({
	access,
	onSwitchModel,
	onConnect,
	isSmallView = false,
}) => (
	/*
	 * The band's own horizontal inset, not the alert's `p-3`, for the reason
	 * every block in this band shares it: a callout whose border sits on a
	 * different edge than the sentence under it reads as unrelated chrome
	 * (`radient-session-issue.tsx`).
	 */
	<Alert
		data-lo-model-access="signed_out"
		variant="warning"
		className={cn(CHAT_MEASURE, isSmallView ? "px-2 py-2" : "px-4 py-2")}
	>
		<AlertTitle>Not signed in to {access.label}</AlertTitle>
		<AlertDescription>
			This session runs {access.label} without a working sign-in, so it cannot
			answer until you connect it.
		</AlertDescription>
		<div className="flex min-h-6 flex-wrap items-center gap-3">
			{onSwitchModel && (
				<Button
					type="button"
					variant="link"
					size="sm"
					// `underline` at rest, matching the composer's other actions:
					// `link` underlines only on hover and active, so without this
					// the affordance is carried by colour alone, which is not one.
					className="cursor-pointer text-body-sm underline"
					onClick={onSwitchModel}
				>
					Switch model
				</Button>
			)}
			<Button
				type="button"
				variant="link"
				size="sm"
				className="cursor-pointer text-body-sm underline"
				onClick={onConnect}
			>
				Connect
			</Button>
		</div>
	</Alert>
);
