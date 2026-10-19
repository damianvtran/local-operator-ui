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
import { useState } from "react";
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
 */
export const TeamBridgeCreateDialog: FC<{
	open: boolean;
	onClose: () => void;
	onCreate: (input: {
		kind: "dm" | "group" | "channel";
		name?: string;
		visibility?: "private" | "tenant";
		agentCapable?: boolean;
		members: TeamBridgeMemberInput[];
	}) => void;
	pending?: boolean;
}> = ({ open, onClose, onCreate, pending = false }) => {
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
								className="h-8 rounded-md border border-border bg-surface px-1 text-[13px]"
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
