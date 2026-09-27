/**
 * The mesh's four writes, each behind its own dialog: every one of them changes
 * something another device can see, so none of them is a bare button.
 *
 * WHY THESE ARE DIALOGS AND NOT INLINE CONTROLS, one reason per write:
 *
 *   - **The move** deletes the source's copy once the handoff commits
 *     (`source_retired = (mode == "move")`), and it may take minutes. The dialog is
 *     where the resulting operation is named, where the loss is stated, and where
 *     the reversible alternative (`--keep`, which forks with a new id and leaves the
 *     source running) is offered. A drop that performed it silently would be a
 *     destructive act with no statement of what it does.
 *   - **The invite** mints a token WRITTEN WHERE THIS APP CANNOT READ IT and creates
 *     no membership at all: the receipt is a path the user has to carry to the other
 *     machine, so it has to be shown rather than toasted away.
 *   - **The member removal** is the one act that changes OTHER devices' state -
 *     every peer rekeyed, the removed device locked out on its next handshake - so
 *     the route demands the network's name, typed, and this is the field that
 *     produces it.
 *   - **The undo** for a `keep` copy erases the copy that was made. It is an erasure,
 *     so it is offered as an explicit action with the id it will remove, never as a
 *     silent reversal.
 *
 * WHAT IS DELIBERATELY MISSING: no optimistic ownership anywhere. The gesture is
 * optimistic (a chip says `moving…` the moment the drop lands); the OUTCOME is a
 * receipt or a refusal, and the reads are re-fetched either way.
 */

import {
	Alert,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { ArrowRight, Check, Copy, Loader2 } from "lucide-react";
import { type FC, useEffect, useId, useState } from "react";
import type { MovePlan } from "./mesh-drop";
import { planConfirm } from "./mesh-drop";
import { INVITE_ROLES, type InviteRole } from "./mesh-store";
import type { MeshRefusal } from "./mesh-types";

/**
 * The move confirmation: the operation, the loss, and the reversible alternative.
 *
 * THE DIALOG IS THE CONFIRMATION for every destructive move, and `risky` decides its
 * EMPHASIS rather than whether it appears: a session with a live runtime leads with
 * what is lost and puts the copy first, while a quiet one leads with the move. The
 * alternative is always present, because the decision is the user's - and because
 * `--keep` is what makes "undo" honest rather than a claim that a deleted copy came
 * back.
 */
export const MoveConfirmDialog: FC<{
	open: boolean;
	plan: MovePlan;
	alternatives: readonly MovePlan[];
	risky: boolean;
	busy: boolean;
	onCancel: () => void;
	onChoose: (plan: MovePlan) => void;
}> = ({ open, plan, alternatives, risky, busy, onCancel, onChoose }) => {
	const confirm = planConfirm(plan, risky);
	const [chosen, setChosen] = useState<MovePlan>(plan);
	// The chosen plan is re-seeded when the dialog opens for a DIFFERENT drop: a
	// stale choice would send the previous target's verb while the body describes
	// this one, which is the class of bug a dialog that never reset would hide.
	useEffect(() => {
		if (open) setChosen(plan);
	}, [open, plan]);
	const effective = alternatives.some((alt) => alt.keep === chosen.keep)
		? chosen
		: plan;
	const isCopy = effective.keep;
	return (
		<Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{effective.verb}</DialogTitle>
					<DialogDescription>
						{isCopy
							? `A copy is made on the destination with a new id, and ${effective.to === "local" ? "the other device keeps" : "this device keeps"} its own. The copy can be erased again from the session list.`
							: (confirm?.body ?? "This moves the conversation.")}
					</DialogDescription>
				</DialogHeader>
				{alternatives.length > 0 && (
					/*
					 * THE ALTERNATIVE IS A RADIO-LIKE PAIR OF BUTTONS RATHER THAN A SECOND
					 * PRIMARY: one of the two is what the drop meant, the other is what the
					 * user may prefer, and a dialog with two equally-weighted primaries makes
					 * the reader pick the one it cannot tell apart from the safe one.
					 */
					<fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
						<legend className="sr-only">Which operation</legend>
						{[plan, ...alternatives].map((option) => (
							<label
								key={option.keep ? "copy" : "move"}
								className={cn(
									"flex cursor-pointer items-start gap-2 rounded-md border border-control px-3 py-2",
									"hover:bg-row-hover",
									effective.keep === option.keep &&
										"border-ink bg-row-selected",
								)}
							>
								<input
									type="radio"
									name="mesh-move-mode"
									className="mt-1"
									checked={effective.keep === option.keep}
									onChange={() => setChosen(option)}
								/>
								<span className="min-w-0 flex-1">
									<span className="flex items-center gap-2 text-body-sm text-ink">
										{option.keep ? (
											<Copy aria-hidden="true" className="size-3.5" />
										) : (
											<ArrowRight aria-hidden="true" className="size-3.5" />
										)}
										{option.verb}
									</span>
									{/*
									 * THE DESTINATION IS NAMED, not counted: "Move to devon-laptop" and not
									 * "Move to the other device", because the whole point of the affordance is
									 * that the user can see where their work is going.
									 */}
									<span className="mt-0.5 block text-meta text-ink-dim">
										{option.keep
											? "the original stays where it is"
											: "the copy here is deleted once it arrives"}
									</span>
								</span>
							</label>
						))}
					</fieldset>
				)}
				{risky && (
					<Alert variant="warning" className="text-meta">
						{effective.keep
							? "It is open on the other end, and the copy does not interrupt it."
							: "It is open elsewhere right now: whatever that runtime is holding is not carried across."}
					</Alert>
				)}
				<DialogFooter>
					<Button variant="ghost" onClick={onCancel} disabled={busy}>
						Cancel
					</Button>
					<Button
						onClick={() => onChoose(effective)}
						disabled={busy}
						variant={isCopy ? "secondary" : "primary"}
					>
						{busy && (
							<Loader2
								aria-hidden="true"
								className="mr-2 size-3.5 animate-spin"
							/>
						)}
						{effective.verb}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

/**
 * Mint an invite for a network.
 *
 * THE RECEIPT IS THE POINT OF THE DIALOG and it stays on screen: the token is
 * written to a path only the machine that will redeem it can read, and no
 * membership exists until the other device redeems it. So this surface says what it
 * did — "invited; the device appears once it redeems this" — rather than closing on
 * a success that changed nothing.
 */
export const InviteDialog: FC<{
	open: boolean;
	/**
	 * The networks this invite may name, ALREADY FILTERED by the caller to the ones
	 * the device is not an active member of: a network it is already in would be an
	 * invitation to join something it has joined, and a BURNED id is never admitted
	 * again, so `mesh-page.tsx` does that arithmetic where the graph is in hand.
	 */
	options: readonly { id: string; label: string }[];
	/** The device this invite is bound to, when it was started from a node. */
	deviceLabel: string | null;
	onClose: () => void;
	onInvite: (ask: {
		networkId: string;
		role: InviteRole;
		deviceId?: string;
	}) => void;
	pending: boolean;
	/** The receipt, once the route has answered. */
	receipt: { token_path: string; expires_at: number | null } | null;
	refusal: MeshRefusal | null;
	deviceId?: string;
}> = ({
	open,
	options,
	deviceLabel,
	onClose,
	onInvite,
	pending,
	receipt,
	refusal,
	deviceId,
}) => {
	const [role, setRole] = useState<InviteRole>("drive");
	const [chosenNetwork, setChosenNetwork] = useState<string | null>(null);
	const chosen =
		options.find((option) => option.id === chosenNetwork)?.id ??
		options[0]?.id ??
		null;
	const roleId = useId();
	const networkFieldId = useId();
	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Invite to a network…</DialogTitle>
					<DialogDescription>
						{/*
						 * THE PROTOCOL'S OWN LIMIT, stated where a user would otherwise expect
						 * "add": admission is two-sided (the joining device proves the SAS), so
						 * there is no act that makes a device a member from here.
						 */}
						Admission is two-sided, so this mints a single-use token instead of
						adding anything: {deviceLabel ?? "the device"} proves the short
						authentication string when it redeems the token, and only then does
						it appear as a member.
					</DialogDescription>
				</DialogHeader>
				{receipt ? (
					<div className="flex flex-col gap-2 rounded-md border border-control bg-sunken px-3 py-2">
						<span className="text-body-sm text-ink">
							Invited — the device appears once it redeems this.
						</span>
						<span className="text-meta text-ink-dim">
							The token was written here, and this app never reads it:
						</span>
						<code className="break-all font-mono text-meta text-ink">
							{receipt.token_path || "(the route did not name a path)"}
						</code>
					</div>
				) : (
					<div className="flex flex-col gap-1">
						{/*
						 * WHICH NETWORK, asked when there is a choice. A device can be in one
						 * network and invited to another, so "invite this device" is not a complete
						 * instruction until the network is named - and the list is the caller's
						 * (already filtered to the ones this device is not an active member of).
						 */}
						{options.length > 1 && (
							<>
								<Label htmlFor={networkFieldId}>Network to invite it to</Label>
								<Select
									value={chosen ?? undefined}
									onValueChange={(next) => setChosenNetwork(next)}
								>
									<SelectTrigger id={networkFieldId} className="w-56">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{options.map((option) => (
											<SelectItem key={option.id} value={option.id}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</>
						)}
						{options.length === 1 && (
							<span className="text-meta text-ink-dim">
								Inviting to {options[0]?.label}
							</span>
						)}
						<Label htmlFor={roleId}>Role the device will have</Label>
						<Select
							value={role}
							onValueChange={(next) => setRole(next as InviteRole)}
						>
							<SelectTrigger id={roleId} className="w-48">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{INVITE_ROLES.map((option) => (
									<SelectItem key={option} value={option}>
										{option}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<span className="text-meta text-ink-dim">
							read sees sessions, drive may ask this device for one, admin may
							also change the membership.
						</span>
					</div>
				)}
				{refusal && (
					<Alert variant="warning" className="text-meta">
						{refusal.sentence}
					</Alert>
				)}
				<DialogFooter>
					<Button variant="ghost" onClick={onClose}>
						{receipt ? "Close" : "Cancel"}
					</Button>
					{!receipt && (
						<Button
							disabled={pending || chosen === null}
							onClick={() =>
								chosen && onInvite({ networkId: chosen, role, deviceId })
							}
						>
							{pending && (
								<Loader2
									aria-hidden="true"
									className="mr-2 size-3.5 animate-spin"
								/>
							)}
							Mint the token
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

/**
 * Revoke a membership: the typed confirmation, and why it is typed.
 *
 * THE ROUTE COMPARES THE NETWORK'S NAME EXACTLY, and it does so because this is the
 * one act in the mesh that changes other devices' state. A bool would be something
 * a stray retry could also send; a name is something only a person who read the
 * dialog can produce. This field therefore passes what was typed through unchanged —
 * no trimming, no case folding — because a near miss is a refusal the user can read
 * and "repairing" it here would defeat the check the route performs.
 */
export const RemoveMemberDialog: FC<{
	open: boolean;
	networkLabel: string;
	deviceLabel: string;
	onClose: () => void;
	onConfirm: (typed: string) => void;
	pending: boolean;
	refusal: MeshRefusal | null;
	removed: { epoch: number } | null;
}> = ({
	open,
	networkLabel,
	deviceLabel,
	onClose,
	onConfirm,
	pending,
	refusal,
	removed,
}) => {
	const [typed, setTyped] = useState("");
	const fieldId = useId();
	useEffect(() => {
		if (open) setTyped("");
	}, [open]);
	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>
						Remove {deviceLabel} from {networkLabel}?
					</DialogTitle>
					<DialogDescription>
						Every device in the network is rekeyed and {deviceLabel} is locked
						out on its next handshake. A removed device id is never admitted
						again.
					</DialogDescription>
				</DialogHeader>
				{removed ? (
					<p className="text-body-sm text-ink">
						Removed. The membership epoch is now {removed.epoch}.
					</p>
				) : (
					<div className="flex flex-col gap-1">
						<Label htmlFor={fieldId}>
							Type the network's name to confirm: {networkLabel}
						</Label>
						<Input
							id={fieldId}
							value={typed}
							onChange={(event) => setTyped(event.target.value)}
							autoComplete="off"
							spellCheck={false}
						/>
					</div>
				)}
				{refusal && (
					<Alert variant="warning" className="text-meta">
						{refusal.sentence}
					</Alert>
				)}
				<DialogFooter>
					<Button variant="ghost" onClick={onClose}>
						{removed ? "Close" : "Cancel"}
					</Button>
					{!removed && (
						<Button
							variant="danger"
							disabled={pending || typed.length === 0}
							onClick={() => onConfirm(typed)}
						>
							{pending && (
								<Loader2
									aria-hidden="true"
									className="mr-2 size-3.5 animate-spin"
								/>
							)}
							Remove the device
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

/**
 * What happened to the last move, and the one action it leaves.
 *
 * A REFUSAL IS RENDERED FROM THE RECEIPT RATHER THAN FROM COPY WRITTEN HERE: the
 * route's own sentence is what the user reads, with the code beside it so a support
 * conversation and a log agree. The remedies are the two the refusal can actually
 * support — re-read (reachability is a fact only a read can settle) and wait for the
 * turn to finish (a `busy` refusal with the route's own `wait_s` ceiling) — and
 * neither of them is a retry of the same request, which is the one action that is
 * wrong for an unconfirmed outcome.
 */
export const MoveNotice: FC<{
	receipt: { verb: string; detail: string; undo: MovePlan | null } | null;
	refusal: MeshRefusal | null;
	onWait: () => void;
	onRecheck: () => void;
	onUndo: () => void;
	onDismiss: () => void;
	pending: boolean;
}> = ({ receipt, refusal, onWait, onRecheck, onUndo, onDismiss, pending }) => {
	if (!receipt && !refusal) return null;
	return (
		/*
		 * `<output>` IS the semantic element for a status region - it carries the implicit
		 * `role="status"` - so this reports the outcome of something the user just asked
		 * for without a redundant role attribute, and it is deliberately not an `alert`:
		 * nothing here was found by the app on its own.
		 */
		<output
			data-mesh-notice={
				receipt ? "moved" : refusal?.unconfirmed ? "unconfirmed" : "refused"
			}
			className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-sunken px-3 py-2"
		>
			{receipt ? (
				<Check aria-hidden="true" className="size-3.5 text-ink-muted" />
			) : null}
			<span className="min-w-0 flex-1 text-body-sm text-ink">
				{receipt ? receipt.verb : refusal?.sentence}
			</span>
			{receipt ? (
				<span className="text-meta text-ink-dim">{receipt.detail}</span>
			) : (
				<span className="font-mono text-meta text-ink-dim">
					{refusal?.code}
				</span>
			)}
			{refusal?.code === "busy" && (
				<Button
					size="sm"
					variant="secondary"
					onClick={onWait}
					disabled={pending}
				>
					Wait for the turn to finish
				</Button>
			)}
			{(refusal?.unconfirmed || refusal?.code === "unreachable") && (
				<Button
					size="sm"
					variant="secondary"
					onClick={onRecheck}
					disabled={pending}
				>
					Check again
				</Button>
			)}
			{receipt?.undo && (
				<Button
					size="sm"
					variant="secondary"
					onClick={onUndo}
					disabled={pending}
				>
					{/*
					 * THE LABEL IS THE PLAN'S OWN VERB (agent review round 1, F3 / UX U4). It used
					 * to read "Erase the copy" while the request it sent was a recall that leaves
					 * this device holding a SECOND copy of the conversation - two names for one
					 * action, and the wrong one on the button. The plan is built next to the
					 * sentence that describes the loss (`mesh-page.tsx`), so the button cannot
					 * drift from what pressing it does.
					 */}
					{receipt.undo.verb}
				</Button>
			)}
			<Button size="sm" variant="ghost" onClick={onDismiss}>
				Dismiss
			</Button>
		</output>
	);
};
