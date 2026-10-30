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
 * for it; this band consumes the serving host's effective native access reading.
 * A remote holder is not a login: convergence, owner outage, expiry and
 * withdrawal have different consequences. Older hosts still use the original
 * `signed_out` / temporary-unavailability copy; absence is not a state.
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
 * - `Connect` retains the same connect dialog, only for truly absent access
 *   or the legacy signed-out reading. Owner/refresh/convergence states repair
 *   automatically on the next request and never offer a redundant OAuth prompt.
 *   Device-bound sign-in must happen on the serving device; this generic callback
 *   cannot safely target it, so that state offers the existing model switch only.
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
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import { CHAT_MEASURE } from "../chat-measure";
import {
	type ModelAccessReading,
	modelAccessPresentation,
} from "./session-model";

export type SessionModelAccessBandProps = {
	/** The serving host's selected-provider reading; old hosts keep legacy copy. */
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
}) => {
	useI18nLocale();
	const presentation = modelAccessPresentation(access);
	return (
		/*
		 * The band's own horizontal inset, not the alert's `p-3`, for the reason
		 * every block in this band shares it: a callout whose border sits on a
		 * different edge than the sentence under it reads as unrelated chrome
		 * (`radient-session-issue.tsx`).
		 */
		<Alert
			data-lo-model-access={
				access.effectiveState ?? access.state ?? "signed_out"
			}
			variant={presentation.tone}
			className={cn(CHAT_MEASURE, isSmallView ? "px-2 py-2" : "px-4 py-2")}
		>
			<AlertTitle>{presentation.title}</AlertTitle>
			<AlertDescription>
				{presentation.description}
				{presentation.history && (
					<span
						data-lo-model-access-history
						className={cn("mt-2 block text-body-sm text-ink-muted")}
					>
						{presentation.history}
					</span>
				)}
			</AlertDescription>
			{(presentation.canSwitchModel || presentation.canConnect) && (
				<div className={cn("flex min-h-6 flex-wrap items-center gap-3")}>
					{presentation.canSwitchModel && onSwitchModel && (
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
							{t("ui.chat.header.session_model_switch")}
						</Button>
					)}
					{presentation.canConnect && (
						<Button
							type="button"
							variant="link"
							size="sm"
							className="cursor-pointer text-body-sm underline"
							onClick={onConnect}
						>
							{t("ui.chat.header.session_model_connect")}
						</Button>
					)}
				</div>
			)}
		</Alert>
	);
};
