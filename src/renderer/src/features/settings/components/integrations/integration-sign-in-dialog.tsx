import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
/**
 * Signing in to one integration, from Settings.
 *
 * Every sentence here states only what the app KNOWS, which is the whole of
 * this component's reason to exist beside the run panel's dialog:
 *
 * - Before the press it says what WILL happen ("Local Operator opens your
 *   browser…"), not "Your browser opens to approve access" - that line was on
 *   screen before anything opened, and on the walk nothing ever did (UX N2).
 * - After it, the browser is only said to have opened when the backend's
 *   operation reports `browser_opened: true`. `false` shows the link to open by
 *   hand; absent or `null` (an older backend, or the launcher not back yet)
 *   says the sign-in is waiting, and claims nothing about the browser.
 * - A failure carries the backend's own sanitized reason when there is one, and
 *   says the server gave none when there is not - never a bare
 *   "Sign-in failed." (UX N4).
 *
 * The operation's state comes from the list document the section already
 * polls while an operation runs, so this dialog adds no timer of its own.
 */

import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui";
import { showInfoToast } from "@shared/utils/toast-manager";
import { Copy, TriangleAlert } from "lucide-react";
import { type FC, useEffect, useRef } from "react";
import type { McpCatalogOperation } from "../../../../../../shared/desktop-control-contract";
import { publicSignInReason } from "./integration-model";

export type SignInPhase =
	/** Not started: the dialog explains, the user presses Continue. */
	| { kind: "ready" }
	/** The start request is in flight. */
	| { kind: "starting" }
	/** Started; `operation` is the backend's record, once the list has it. */
	| { kind: "running"; operation: McpCatalogOperation | null }
	/** The start request itself was refused, already worded. */
	| { kind: "refused"; message: string };

/** The sentence for a running or settled operation, and whether it is final. */
export function signInProgress(
	name: string,
	operation: McpCatalogOperation | null,
	/*
	 * Whether the row this dialog was opened for HAS a key route on this
	 * surface. Required rather than optional: an omitted flag defaults to the
	 * sentence that names a control nobody can press, which is the defect D15
	 * raised, so the compiler asks every call site instead of the copy guessing.
	 */
	keyRoute: boolean,
): {
	message: string;
	tone: "progress" | "success" | "failure";
	link: string | null;
	/** The server's own words about a failure, when it gave any (D6). */
	reason?: string | null;
	/** What the user can do about it (D6). */
	nextStep?: string | null;
} {
	if (!operation || operation.status === "running") {
		if (operation?.browser_opened === true)
			return {
				message: t(
					"ui.settings.integrations.integration_sign_in_dialog.your_browser_opened_approve_access_to_name_there_then_come_back_h",
					{ name: String(name) },
				),
				tone: "progress",
				link: operation.authorization_url ?? null,
			};
		if (operation?.browser_opened === false)
			return {
				message: operation.authorization_url
					? t(
							"ui.settings.integrations.integration_sign_in_dialog.your_browser_didn_t_open_open_this_link_to_approve_access",
						)
					: t(
							"ui.settings.integrations.integration_sign_in_dialog.your_browser_didn_t_open_and_no_link_was_provided_cancel_and_try_",
						),
				tone: "progress",
				link: operation.authorization_url ?? null,
			};
		return {
			message: t(
				"ui.settings.integrations.integration_sign_in_dialog.waiting_for_you_to_approve_access_to_name",
				{ name: String(name) },
			),
			tone: "progress",
			link: operation?.authorization_url ?? null,
		};
	}
	if (operation.status === "complete")
		return {
			message: t(
				"ui.settings.integrations.integration_sign_in_dialog.signed_in_to_name_agents_can_use_it_now",
				{ name: String(name) },
			),
			tone: "success",
			link: null,
		};
	if (operation.status === "cancelled")
		return {
			message: t(
				"ui.settings.integrations.integration_sign_in_dialog.sign_in_cancelled",
			),
			tone: "failure",
			link: null,
			reason: null,
			nextStep: t(
				"ui.settings.integrations.integration_sign_in_dialog.press_try_again_when_you_are_ready",
			),
		};
	/*
	 * WHAT HAPPENED, THEN THE SERVER'S OWN WORDS, THEN WHAT TO DO (D6). One
	 * paragraph with the backend's sentence spliced in mid-line read as a
	 * capital letter after a colon inside a wall of `danger` text, and its only
	 * offered action - Try again - cannot fix a rejected redirect. The three
	 * parts are drawn separately: the lead in `ink`, the server's sentence in
	 * `ink-muted`, and a next step that is actually about this failure.
	 */
	return {
		message: t(
			"ui.settings.integrations.integration_sign_in_dialog.sign_in_didn_t_finish",
		),
		tone: "failure",
		link: null,
		// The absent-reason case still says so rather than leaving the reader to
		// wonder whether the dialog lost it (N4).
		reason:
			publicSignInReason(operation.message, keyRoute) ??
			t(
				"ui.settings.integrations.integration_sign_in_dialog.the_server_didn_t_say_why",
			),
		nextStep: signInNextStep(operation.message ?? null, keyRoute),
	};
}

/**
 * What to do about a failed sign-in, when the reason says.
 *
 * A rejected redirect and a missing authorization server are configuration
 * refusals: pressing Try again re-runs the same refusal, so the next step names
 * the two things that can change it - the server's own settings, or a key. The
 * generic line is the one for a failure this page cannot classify.
 */
export function signInNextStep(
	reason: string | null,
	keyRoute: boolean,
): string {
	const text = (reason ?? "").toLowerCase();
	/*
	 * The key sentence is offered ONLY when the row offers the key (D15, round
	 * 2). `linear` in this state has no `add_key`/`set_key` in its actions and no
	 * secret reference, so its overflow is Test / Open config file / Remove:
	 * "add a key instead" sent the reader looking for a control that does not
	 * exist anywhere on the surface - which is the same defect D5 was raised
	 * for. When there is no key route the honest half of the sentence is the
	 * part that IS actionable.
	 */
	if (text.includes("redirect"))
		return keyRoute
			? t(
					"ui.settings.integrations.integration_sign_in_dialog.this_server_may_not_accept_sign_ins_from_local_operator_check_the",
				)
			: t(
					"ui.settings.integrations.integration_sign_in_dialog.this_server_may_not_accept_sign_ins_from_local_operator_check_the_2",
				);
	if (text.includes("no oauth") || text.includes("authorization server"))
		return keyRoute
			? t(
					"ui.settings.integrations.integration_sign_in_dialog.this_server_doesn_t_publish_a_browser_sign_in_add_its_key_instead",
				)
			: t(
					"ui.settings.integrations.integration_sign_in_dialog.this_server_doesn_t_publish_a_browser_sign_in_check_the_server_s_",
				);
	if (text.includes("network") || text.includes("connect"))
		return t(
			"ui.settings.integrations.integration_sign_in_dialog.check_the_server_s_url_and_your_network_then_try_again",
		);
	return t(
		"ui.settings.integrations.integration_sign_in_dialog.check_the_server_s_settings_then_try_again",
	);
}

/**
 * Which control leads a phase, for the focus move on a phase change (D3).
 *
 * Exported and pure so the mapping can be asserted rather than inferred from a
 * render: the phase decides it, and the phase is the only thing that changes
 * between two presses of the same button.
 */
export function signInFocusTarget(
	phase: SignInPhase,
	progress: { tone: "progress" | "success" | "failure" } | null,
): "ready" | "running" | "failure" | "success" {
	if (phase.kind === "ready") return "ready";
	if (phase.kind === "running" && progress && progress.tone !== "progress")
		return progress.tone === "success" ? "success" : "failure";
	return "running";
}

export type IntegrationSignInDialogProps = {
	name: string;
	/** `reauth` replaces an existing sign-in; the copy says so. */
	action: "login" | "reauth";
	/**
	 * Whether the row this dialog belongs to offers the key route (D15).
	 *
	 * It rides in from the row's own action list through the section, because
	 * the failed-sign-in copy may only name a control the surface can actually
	 * draw - and the dialog cannot see the row.
	 */
	keyRoute: boolean;
	phase: SignInPhase;
	onStart: () => void;
	onCancel: (operationId: string) => void;
	onOpenLink: (url: string) => void;
	/*
	 * The close reports what it MEANS, not just that it happened: a completed
	 * sign-in leaves the row with no primary action, so the caller has to move
	 * focus somewhere of its own choosing (U12). The dialog is the only place
	 * that knows the phase, and a second copy of the success rule in the caller
	 * is how the two would come to disagree.
	 */
	onClose: (outcome: "signed-in" | "dismissed") => void;
};

export const IntegrationSignInDialog: FC<IntegrationSignInDialogProps> = ({
	name,
	action,
	keyRoute,
	phase,
	onStart,
	onCancel,
	onOpenLink,
	onClose,
}) => {
	useI18nLocale();
	const operation = phase.kind === "running" ? phase.operation : null;
	const progress =
		phase.kind === "running" ? signInProgress(name, operation, keyRoute) : null;
	const running =
		phase.kind === "starting" ||
		(phase.kind === "running" && progress?.tone === "progress");
	const settled = progress && progress.tone !== "progress";
	/*
	 * FOCUS FOLLOWS THE PHASE (D3). The primary that had focus unmounts when the
	 * phase changes, so Radix fell back to the dialog frame - and the frame then
	 * drew the accent outline around the whole dialog, which reads as a selected
	 * dialog and spends the accent on chrome. Each phase names the control that
	 * now leads, and focus moves there. The mount case is Radix's own
	 * `onOpenAutoFocus` below, so the effect skips it.
	 */
	const leadRef = useRef<HTMLButtonElement>(null);
	const mounted = useRef(false);
	/*
	 * The control that leads the CURRENT phase. Naming it is what makes the
	 * effect below honest: its dependency is a value the effect reads, and the
	 * value changes exactly when the leading control is replaced.
	 */
	const focusTarget = signInFocusTarget(phase, progress);
	useEffect(() => {
		if (!mounted.current) {
			mounted.current = true;
			return;
		}
		if (focusTarget) leadRef.current?.focus();
	}, [focusTarget]);

	/** Every close path - Done, Close, Escape, the scrim - reports the phase's outcome. */
	const close = () =>
		onClose(progress?.tone === "success" ? "signed-in" : "dismissed");

	return (
		<BaseDialog
			open
			onClose={close}
			maxWidth="xs"
			/*
			 * `fullWidth` is not cosmetic here (D19): every phase is capped by
			 * `max-w-md`, but a SHORT phase - the one-sentence success state -
			 * collapsed to the 320 px floor, so the panel snapped 64 px narrower on
			 * each side at the moment the user came back from the browser and their
			 * eye was on it. `w-full` makes every phase hold the same 448 px.
			 */
			fullWidth
			title={t(
				"ui.settings.integrations.integration_sign_in_dialog.sign_in_to_name",
				{ name: String(name) },
			)}
			/*
			 * Initial focus belongs on the control the dialog opens FOR, not on
			 * Close (D3): the ready state exists to be continued.
			 */
			dialogProps={{
				onOpenAutoFocus: (event: Event) => {
					event.preventDefault();
					leadRef.current?.focus();
				},
			}}
			actions={
				<>
					{running && operation ? (
						<SecondaryButton
							ref={leadRef}
							onClick={() => onCancel(operation.id)}
						>
							{t(
								"ui.settings.integrations.integration_sign_in_dialog.cancel_sign_in",
							)}
						</SecondaryButton>
					) : (
						<SecondaryButton
							ref={phase.kind === "ready" ? undefined : leadRef}
							onClick={close}
						>
							{progress?.tone === "success"
								? t("ui.settings.integrations.integration_sign_in_dialog.done")
								: t(
										"ui.settings.integrations.integration_sign_in_dialog.close",
									)}
						</SecondaryButton>
					)}
					{phase.kind === "ready" ? (
						<PrimaryButton ref={leadRef} onClick={onStart}>
							{t(
								"ui.settings.integrations.integration_sign_in_dialog.continue_in_browser",
							)}
						</PrimaryButton>
					) : null}
					{phase.kind === "refused" || progress?.tone === "failure" ? (
						<PrimaryButton
							ref={progress?.tone === "failure" ? leadRef : undefined}
							onClick={onStart}
						>
							{t(
								"ui.settings.integrations.integration_sign_in_dialog.try_again",
							)}
						</PrimaryButton>
					) : null}
				</>
			}
		>
			<div
				/*
				 * `p-1.5` is the room a control's outline needs inside the dialog's scroll
				 * body, and it is all of the body's geometry: the negative margin that
				 * used to sit beside it made the body 12 px wider than the scroller, so
				 * the box was 404 px inside a 398 px area and the scroller drew a stray
				 * horizontal strip under the last control (n3). The prose carries its own
				 * `-mx-1.5`, which puts the TEXT back on the title's edge (D7) without
				 * making anything overflow, and the controls inside sit one step in - the
				 * 6 px the ring needs, which is the shared-component indent the design
				 * round deferred as D20.
				 */
				className="flex flex-col gap-3 p-1.5 text-body text-ink-muted"
				aria-live="polite"
			>
				{phase.kind === "ready" ? (
					<p className="-mx-1.5">
						{t(
							"ui.settings.integrations.integration_sign_in_dialog.local_operator_opens_your_browser_so_you_can_approve_access_to",
						)}{" "}
						{name}.
						{action === "reauth"
							? t(
									"ui.settings.integrations.integration_sign_in_dialog.this_replaces_the_sign_in_it_has_now",
								)
							: ""}
					</p>
				) : null}
				{phase.kind === "starting" ? (
					<p className="-mx-1.5 flex items-center gap-2">
						<Spinner size="xs" />
						{t(
							"ui.settings.integrations.integration_sign_in_dialog.starting_sign_in",
						)}
					</p>
				) : null}
				{progress ? (
					<div
						className="flex flex-col gap-1"
						role={settled ? "status" : undefined}
					>
						{/*
						 * `items-start` and a first-line-height spinner box: on a
						 * two-line paragraph the centred spinner used to sit beside
						 * the middle of the block (D11).
						 */}
						<p
							className={
								progress.tone === "success"
									? "-mx-1.5 flex items-start gap-2 text-ink"
									: "-mx-1.5 flex items-start gap-2 text-ink"
							}
						>
							{progress.tone === "progress" ? (
								<Spinner size="xs" className="mt-0.5" />
							) : null}
							{progress.tone === "failure" ? (
								<TriangleAlert
									aria-hidden="true"
									className="mt-0.5 size-4 shrink-0 text-danger"
								/>
							) : null}
							<span>{progress.message}</span>
						</p>
						{/* The server's own words, quieter than the line that frames
						    them (D6). */}
						{progress.reason ? (
							<p className="-mx-1.5 text-ink-muted">{progress.reason}</p>
						) : null}
						{progress.nextStep ? (
							<p className="-mx-1.5 text-ink-muted">{progress.nextStep}</p>
						) : null}
					</div>
				) : null}
				{progress?.link && progress.tone === "progress" ? (
					/*
					 * The row holds two focusable controls, and they sit where every other
					 * control in this dialog sits - one step in from the prose (the body's
					 * `p-1.5`), which is the room the ring is drawn in (D12, n3).
					 *
					 * The URL owns its own line (`min-w-0 flex-1` + a nowrap row) so the
					 * copy control anchors to the END of the truncated URL instead of
					 * wrapping to the line below it, where it read as the leading icon
					 * of "Open the sign-in page" (D14, round 2).
					 */
					<div className="flex flex-col items-start gap-1">
						<div className="flex w-full min-w-0 items-center gap-1">
							<span
								className="min-w-0 flex-1 truncate font-mono text-ink-dim text-mono-sm"
								title={progress.link}
							>
								{progress.link}
							</span>
							{/* The link truncates at narrow widths, so it needs a way to
							    be taken away whole (D11, U4). The tooltip is the visible
							    half of its name: icon-only, nothing on screen said what
							    it does (D14). */}
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t(
									"ui.settings.integrations.integration_sign_in_dialog.copy_the_sign_in_link",
								)}
								title={t(
									"ui.settings.integrations.integration_sign_in_dialog.copy_the_sign_in_link",
								)}
								onClick={() => {
									void navigator.clipboard
										.writeText(progress.link ?? "")
										.then(() =>
											showInfoToast(
												t(
													"ui.settings.integrations.integration_sign_in_dialog.sign_in_link_copied",
												),
											),
										)
										.catch(() => undefined);
								}}
							>
								<Copy aria-hidden="true" />
							</Button>
						</div>
						<Button
							variant="link"
							size="sm"
							onClick={() => onOpenLink(progress.link ?? "")}
						>
							{t(
								"ui.settings.integrations.integration_sign_in_dialog.open_the_sign_in_page",
							)}
						</Button>
					</div>
				) : null}
				{phase.kind === "refused" ? (
					<p className="text-danger" role="alert">
						{phase.message}
					</p>
				) : null}
			</div>
		</BaseDialog>
	);
};
