/**
 * SETTINGS → PHONE ACCESS → PAIRED PHONES, and the "Turn on phone approvals" row
 * (pairing design v2 §4.2 "Settings"; core #3949 `features.phone_pairing`,
 * #3950 `features.operator_setup`). Mounted beside `PhoneAccessBlock`.
 *
 * WHAT REMOVING A PHONE DOES, SAID BEFORE IT HAPPENS (D9, U7). Core's revoke runs
 * in phases: the phone stops approving and stops getting notifications at once;
 * the last step - taking it off the computer's privileged operator list - needs
 * the computer's admin prompt. A cancelled prompt leaves the row `removing`
 * (derived by core from the certificate store, so it survives a refresh) with a
 * Finish removing action, which is the same idempotent DELETE. The dialog also
 * says what removal does NOT do: the phone's Radient sign-in still opens chats.
 *
 * Phone names are what the phone sent: plain text in a `<bdi>`, never markup.
 * Every read here is behind its capability; with it absent nothing renders and
 * nothing is requested, so Settings is exactly today's.
 */

import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@shared/components/ui";
import { formatDate, t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { Smartphone } from "lucide-react";
import { type FC, useState } from "react";
import type { PairedPhone } from "./pairing-model";
import {
	type OperatorSetupState,
	useOperatorSetup,
	useOperatorSetupRun,
	usePairedPhones,
	useRemovePhone,
} from "./use-phone-pairing";

const PLATFORM_KEYS = {
	ios: "ui.phone_pairing.platform.ios",
	android: "ui.phone_pairing.platform.android",
	web: "ui.phone_pairing.platform.web",
} as const;

function platformLabel(platform: string): string {
	return t(
		PLATFORM_KEYS[platform as keyof typeof PLATFORM_KEYS] ??
			"ui.phone_pairing.platform.unknown",
	);
}

function dateOf(seconds: number): string {
	return formatDate(seconds * 1000, { dateStyle: "medium" });
}

/** What the last remove press said about one row, until the list catches up. */
export type RemoveNotice = "still_removing" | "not_found" | "error";

export type PairedPhonesViewProps = {
	phones: readonly PairedPhone[] | undefined;
	loading?: boolean;
	loadFailed?: boolean;
	/** The device whose removal is in flight. */
	removing?: string | null;
	notices?: Readonly<Record<string, RemoveNotice>>;
	onRemove: (deviceId: string) => void;
	onRetryLoad?: () => void;
	/** Opens the dialog on this row from the start (stories only). */
	initialConfirm?: string | null;
};

const NOTICE_KEYS = {
	still_removing: "ui.phone_pairing.phones.still_removing",
	not_found: "ui.phone_pairing.phones.not_found",
	error: "ui.phone_pairing.phones.error",
} as const;

export const PairedPhonesView: FC<PairedPhonesViewProps> = ({
	phones,
	loading = false,
	loadFailed = false,
	removing = null,
	notices = {},
	onRemove,
	onRetryLoad,
	initialConfirm = null,
}) => {
	const [confirming, setConfirming] = useState<string | null>(initialConfirm);
	const target = phones?.find((phone) => phone.deviceId === confirming) ?? null;
	return (
		<section className="flex flex-col gap-3" data-testid="paired-phones">
			<div className="flex flex-col gap-1">
				<h3 className="font-medium text-body text-ink">
					{t("ui.phone_pairing.phones.title")}
				</h3>
				<p className="text-body-sm text-ink-muted">
					{t("ui.phone_pairing.phones.subtitle")}
				</p>
			</div>
			{loadFailed ? (
				<div className="flex flex-wrap items-center gap-2">
					<p className="text-body-sm text-danger" role="alert">
						{t("ui.phone_pairing.phones.load_error")}
					</p>
					{onRetryLoad ? (
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={onRetryLoad}
						>
							{t("ui.phone_pairing.phones.retry")}
						</Button>
					) : null}
				</div>
			) : loading || !phones ? null : phones.length === 0 ? (
				<p
					className="text-body-sm text-ink-muted"
					data-testid="paired-phones-empty"
				>
					{t("ui.phone_pairing.phones.empty")}
				</p>
			) : (
				<ul className="flex flex-col divide-y divide-hairline rounded-md border border-hairline">
					{phones.map((phone) => {
						const notice = notices[phone.deviceId];
						const busy = removing === phone.deviceId;
						return (
							<li
								key={phone.deviceId}
								className="flex items-start gap-3 p-3"
								data-testid="paired-phone-row"
								data-state={phone.state}
							>
								<Smartphone
									className="mt-0.5 size-4 shrink-0 text-ink-muted"
									aria-hidden="true"
								/>
								<div className="flex min-w-0 grow flex-col gap-0.5">
									<bdi
										className="truncate font-medium text-body-sm text-ink"
										title={phone.name}
									>
										{phone.name}
									</bdi>
									<span className="text-meta text-ink-muted">
										{[
											platformLabel(phone.platform),
											phone.pairedAt
												? t("ui.phone_pairing.phones.paired_at", {
														date: dateOf(phone.pairedAt),
													})
												: null,
											phone.lastSeen
												? t("ui.phone_pairing.phones.last_seen", {
														date: dateOf(phone.lastSeen),
													})
												: null,
										]
											.filter(Boolean)
											.join(" · ")}
									</span>
									{phone.state === "unconfirmed" ? (
										<span className="text-meta text-ink-muted">
											{t("ui.phone_pairing.phones.unconfirmed")}
										</span>
									) : null}
									{phone.state === "removing" ? (
										<span className="text-meta text-ink">
											{t("ui.phone_pairing.phones.removing")}
										</span>
									) : null}
									{notice ? (
										<span
											className="text-meta text-danger"
											role="alert"
											data-testid="paired-phone-notice"
										>
											{t(NOTICE_KEYS[notice])}
										</span>
									) : null}
								</div>
								{phone.state === "removing" ? (
									<Button
										type="button"
										variant="secondary"
										size="sm"
										disabled={busy}
										onClick={() => onRemove(phone.deviceId)}
										data-testid="paired-phone-finish"
									>
										{t("ui.phone_pairing.phones.finish_removing")}
									</Button>
								) : (
									<Button
										type="button"
										variant="danger"
										size="sm"
										disabled={busy}
										aria-label={t("ui.phone_pairing.phones.remove_aria", {
											name: phone.name,
										})}
										onClick={() => setConfirming(phone.deviceId)}
										data-testid="paired-phone-remove"
									>
										{t("ui.phone_pairing.phones.remove")}
									</Button>
								)}
							</li>
						);
					})}
				</ul>
			)}
			<Dialog
				open={target !== null}
				onOpenChange={(open) => {
					if (!open) setConfirming(null);
				}}
			>
				<DialogContent data-testid="paired-phone-dialog">
					<DialogHeader>
						<DialogTitle>
							{t("ui.phone_pairing.phones.dialog_title")}
						</DialogTitle>
						<DialogDescription>
							<bdi className="font-medium text-ink">{target?.name}</bdi>
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-2 text-body-sm text-ink">
						<p>{t("ui.phone_pairing.phones.dialog_body")}</p>
						<p>{t("ui.phone_pairing.phones.dialog_again")}</p>
						<p className="text-ink-muted">
							{t("ui.phone_pairing.phones.dialog_gesture")}
						</p>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="secondary"
							size="md"
							onClick={() => setConfirming(null)}
						>
							{t("ui.phone_pairing.phones.cancel")}
						</Button>
						<Button
							type="button"
							variant="danger"
							size="md"
							data-testid="paired-phone-confirm-remove"
							onClick={() => {
								if (target) onRemove(target.deviceId);
								setConfirming(null);
							}}
						>
							{t("ui.phone_pairing.phones.remove")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
};

export type PhoneApprovalsSetupViewProps = {
	state: OperatorSetupState;
	running?: boolean;
	/** Core's sentence for the press just made (success or refusal). */
	message?: string | null;
	failed?: boolean;
	onTurnOn: () => void;
};

/** "Let phones approve requests on this computer" - only while it is not on. */
export const PhoneApprovalsSetupView: FC<PhoneApprovalsSetupViewProps> = ({
	state,
	running = false,
	message = null,
	failed = false,
	onTurnOn,
}) => {
	if (state.state === "on") {
		// Quiet when on; the confirmation line only right after the person's press.
		return message ? (
			<output className="block text-body-sm text-ink">
				{t("ui.phone_pairing.setup.on")}
			</output>
		) : null;
	}
	const busy = running || state.inProgress;
	return (
		<section
			className="flex flex-col gap-2 rounded-md border border-hairline p-3"
			data-testid="phone-approvals-setup"
		>
			<h3 className="font-medium text-body-sm text-ink">
				{t("ui.phone_pairing.setup.title")}
			</h3>
			{state.canPrompt ? (
				<p className="text-meta text-ink-muted">
					{t("ui.phone_pairing.setup.body")}
				</p>
			) : state.message ? (
				// U18: core's own plain sentence for why no prompt can appear here.
				<p className="text-meta text-ink-muted">{state.message}</p>
			) : null}
			{state.fileOnlyNotice ? (
				<p className="text-meta text-ink-muted">{state.fileOnlyNotice}</p>
			) : null}
			{busy ? (
				<output className="block text-meta text-ink">
					{t("ui.phone_pairing.setup.working")}
				</output>
			) : null}
			{message ? (
				<output className="block text-meta text-ink">{message}</output>
			) : failed ? (
				<p className="text-meta text-danger" role="alert">
					{t("ui.phone_pairing.setup.error")}
				</p>
			) : null}
			{state.canPrompt ? (
				<div>
					<Button
						type="button"
						variant="primary"
						size="sm"
						disabled={busy}
						onClick={onTurnOn}
						data-testid="phone-approvals-turn-on"
					>
						{state.state === "finish_setup"
							? t("ui.phone_pairing.setup.finish")
							: t("ui.phone_pairing.setup.turn_on")}
					</Button>
				</div>
			) : null}
		</section>
	);
};

const PhoneApprovalsSetup: FC = () => {
	const setup = useOperatorSetup(true);
	const run = useOperatorSetupRun();
	const [message, setMessage] = useState<string | null>(null);
	if (!setup.data) return null;
	return (
		<PhoneApprovalsSetupView
			state={setup.data}
			running={run.isPending}
			message={message}
			failed={run.isError && !message}
			onTurnOn={() =>
				run.mutate(undefined, {
					onSuccess: (text) => setMessage(text),
					// A host refusal is a 409 whose sentence is core's own (keyed
					// server-side); anything else falls back to the generic line.
					onError: (failure) =>
						setMessage(
							failure instanceof DesktopControlError && failure.status === 409
								? failure.message
								: null,
						),
				})
			}
		/>
	);
};

const PairedPhones: FC = () => {
	const phones = usePairedPhones(true);
	const remove = useRemovePhone();
	const [notices, setNotices] = useState<Record<string, RemoveNotice>>({});
	const note = (deviceId: string, notice: RemoveNotice | null) =>
		setNotices((current) => {
			const next = { ...current };
			if (notice) next[deviceId] = notice;
			else delete next[deviceId];
			return next;
		});
	return (
		<PairedPhonesView
			phones={phones.data}
			loading={phones.isLoading}
			loadFailed={phones.isError}
			onRetryLoad={() => void phones.refetch()}
			removing={remove.isPending ? (remove.variables ?? null) : null}
			notices={notices}
			onRemove={(deviceId) => {
				note(deviceId, null);
				remove.mutate(deviceId, {
					// A cancelled admin prompt is a 200 with `state: removing`, not an
					// error: phases 1-2 took effect and the row must say so.
					onSuccess: (result) =>
						note(
							deviceId,
							result.state === "removing" ? "still_removing" : null,
						),
					onError: (failure) =>
						note(
							deviceId,
							failure instanceof DesktopControlError && failure.status === 404
								? "not_found"
								: "error",
						),
				});
			}}
		/>
	);
};

/**
 * The Settings mount: the setup row (`operator_setup`) above the Paired-phones
 * list (`phone_pairing`). Either half renders only with its own capability.
 */
export const PhonePairingSettings: FC<{ className?: string }> = ({
	className,
}) => {
	const capabilities = useDesktopCapabilities();
	const pairing = desktopFeatureEnabled(capabilities.data, "phone_pairing");
	const setup = desktopFeatureEnabled(capabilities.data, "operator_setup");
	if (!pairing && !setup) return null;
	return (
		<div
			className={cn("flex flex-col gap-4", className)}
			data-testid="phone-pairing-settings"
		>
			{setup ? <PhoneApprovalsSetup /> : null}
			{pairing ? <PairedPhones /> : null}
		</div>
	);
};
