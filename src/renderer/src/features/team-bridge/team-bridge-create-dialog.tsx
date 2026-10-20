import { Button } from "@shared/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { Input } from "@shared/components/ui/input";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { Plus, X } from "lucide-react";
import type { FC } from "react";
import { useEffect, useState } from "react";
import type { TeamBridgeMemberInput } from "../../../../shared/team-bridge-contract";

/**
 * Start a conversation: a DM, a group or a channel.
 *
 * DELIBERATELY SMALL. The server takes member ids because the desktop app has
 * no directory view of the organization yet; a picker that guessed at names
 * would be a second source of identity truth. The form therefore asks for the
 * account id the person already knows from their org admin, plus a display
 * label the other members will see — the label is the ONLY name that crosses
 * the wire, so it is required rather than derived.
 *
 * AGENTS ARE A SEPARATE ROW KIND. A member row may be a person or an agent; an
 * agent row names its endpoint (the agent's bridge endpoint in this tenant) and
 * stays invited until its owner consents. The dialog does not attempt that
 * consent: it belongs to the owner's machine and is a separate, explicit act.
 *
 * A SEEDED OPEN comes from the rail's People section: clicking a reachable
 * person with no existing DM opens this dialog already addressed to them. The
 * seed is read on every OPEN, not only at mount — the dialog stays mounted
 * behind the page, and a second person clicked after a cancelled first attempt
 * must not inherit the first person's row.
 */
export const TeamBridgeCreateDialog: FC<{
	open: boolean;
	/** Prefill a DM with this person when the dialog opens. */
	seed?: { accountId: string; displayLabel: string } | null;
	onClose: () => void;
	onCreate: (input: {
		kind: "dm" | "group" | "channel";
		name?: string;
		visibility?: "private" | "tenant";
		agentCapable?: boolean;
		members: TeamBridgeMemberInput[];
	}) => void;
	pending?: boolean;
	error?: string;
}> = ({ open, seed, onClose, onCreate, pending = false, error }) => {
	useI18nLocale();
	const [kind, setKind] = useState<"dm" | "group" | "channel">("dm");
	const [name, setName] = useState("");
	const [members, setMembers] = useState<
		Array<TeamBridgeMemberInput & { rowId: string }>
	>([
		{
			account_id: "",
			kind: "human",
			display_label: "",
			rowId: crypto.randomUUID(),
		},
	]);
	const seedAccountId = seed?.accountId ?? "";
	const seedDisplayLabel = seed?.displayLabel ?? "";

	/*
	 * EVERY OPEN STARTS A FRESH FORM. A half-typed group that was cancelled must
	 * not reappear under a person's name, and a seeded DM must be addressed to
	 * the person clicked THIS time. The effect runs on close too (the early
	 * return), which keeps the behind-the-page mount clean for the next open.
	 * The deps are `seed`'s primitive identity: the object itself is rebuilt by
	 * the page on every render, so depending on it would reset a typed form.
	 */
	useEffect(() => {
		if (!open) return;
		setKind("dm");
		setName("");
		setMembers([
			{
				account_id: seedAccountId,
				kind: "human",
				display_label: seedDisplayLabel,
				rowId: crypto.randomUUID(),
			},
		]);
	}, [open, seedAccountId, seedDisplayLabel]);

	const update = (index: number, patch: Partial<TeamBridgeMemberInput>) => {
		setMembers((current) =>
			current.map((member, at) =>
				at === index ? { ...member, ...patch } : member,
			),
		);
	};
	const valid =
		members.some(
			(member) => member.account_id.trim() && member.display_label.trim(),
		) &&
		(kind === "dm" || name.trim().length > 0 || kind === "group");

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent className="gap-4">
				<DialogTitle>{t("ui.teamBridge.create.title")}</DialogTitle>
				<DialogDescription className="sr-only">
					{t("ui.teamBridge.page.subtitle")}
				</DialogDescription>

				<fieldset className="flex gap-1">
					<legend className="sr-only">{t("ui.teamBridge.create.title")}</legend>
					{(["dm", "group", "channel"] as const).map((option) => (
						<Button
							key={option}
							type="button"
							size="sm"
							variant={kind === option ? "primary" : "ghost"}
							onClick={() => setKind(option)}
						>
							{t(`ui.teamBridge.kind.${option}`)}
						</Button>
					))}
				</fieldset>

				{kind !== "dm" && (
					<span className="flex flex-col gap-1 text-[13px] text-ink-muted">
						{t("ui.teamBridge.create.name")}
						<Input
							value={name}
							onChange={(event) => setName(event.target.value)}
							aria-label={t("ui.teamBridge.create.name")}
							maxLength={128}
						/>
					</span>
				)}

				<div className="flex flex-col gap-2">
					<span className="text-[13px] text-ink-muted">
						{t("ui.teamBridge.create.members")}
					</span>
					{members.map((member, index) => (
						<div key={member.rowId} className="flex items-center gap-2">
							<Input
								value={member.account_id}
								onChange={(event) =>
									update(index, { account_id: event.target.value })
								}
								placeholder={t("ui.teamBridge.create.account_placeholder")}
								aria-label={t("ui.teamBridge.create.member_account")}
								className="flex-1"
							/>
							<Input
								value={member.display_label}
								onChange={(event) =>
									update(index, { display_label: event.target.value })
								}
								placeholder={t("ui.teamBridge.create.member_name")}
								aria-label={t("ui.teamBridge.create.member_name")}
								maxLength={64}
								className="flex-1"
							/>
							<select
								value={member.kind}
								onChange={(event) =>
									update(index, {
										kind: event.target.value as "human" | "agent",
									})
								}
								aria-label={t("ui.teamBridge.create.member_kind")}
								className="h-8 rounded-md border border-hairline bg-surface px-1 text-[13px]"
							>
								<option value="human">
									{t("ui.teamBridge.create.member_person")}
								</option>
								<option value="agent">
									{t("ui.teamBridge.create.member_agent")}
								</option>
							</select>
							<Button
								type="button"
								size="icon-sm"
								variant="ghost"
								aria-label={t("ui.teamBridge.create.remove_member")}
								onClick={() =>
									setMembers((current) =>
										current.filter((_, at) => at !== index),
									)
								}
							>
								<X size={14} />
							</Button>
						</div>
					))}
					<Button
						type="button"
						size="sm"
						variant="ghost"
						onClick={() =>
							setMembers((current) => [
								...current,
								{
									account_id: "",
									kind: "human",
									display_label: "",
									rowId: crypto.randomUUID(),
								},
							])
						}
					>
						<Plus size={14} />
						{t("ui.teamBridge.create.add_member")}
					</Button>
				</div>

				{error && (
					<p role="alert" className="text-[13px] text-danger">
						{error}
					</p>
				)}

				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" onClick={onClose}>
						{t("ui.teamBridge.create.cancel")}
					</Button>
					<Button
						type="button"
						variant="primary"
						disabled={!valid || pending}
						onClick={() =>
							onCreate({
								kind,
								...(name.trim() ? { name: name.trim() } : {}),
								visibility: kind === "channel" ? "tenant" : "private",
								agentCapable: members.some((member) => member.kind === "agent"),
								members: members.filter(
									(member) =>
										member.account_id.trim() && member.display_label.trim(),
								),
							})
						}
					>
						{t("ui.teamBridge.create.confirm")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
};
