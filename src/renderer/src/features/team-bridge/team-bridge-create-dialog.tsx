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
import type { FC } from "react";
import { useEffect, useId, useState } from "react";
import type { TeamBridgeMemberInput } from "../../../../shared/team-bridge-contract";
import { TeamBridgeComposeBar } from "./team-bridge-compose-bar";
import {
	type TeamBridgeRecipient,
	recipientMemberInput,
} from "./team-bridge-model";

/**
 * Create a CHANNEL: a name, an optional topic, and who to add.
 *
 * WHY CHANNEL-ONLY (review round 1, R1-7). DMs and groups are no longer made
 * in a form: a person's row, a chief of staff's row and the To: compose bar
 * address a draft, and the FIRST SEND creates it (find-or-create for a DM).
 * The dialog used to offer all three kinds and defaulted to DM, which made it a
 * second, unreviewed create path with the wrong default. A channel is the one
 * conversation that has a name and exists before anyone writes in it, so it is
 * the one that keeps a form.
 *
 * MEMBERS COME FROM THE DIRECTORY, NOT FROM TYPED IDS. The previous form asked
 * for raw account ids and a free-text label because the app had no roster;
 * it has one now, and the To: picker the compose bar uses resolves people and
 * chiefs of staff by name, so the label that crosses the wire is the
 * directory's. The creator is added by the server and is not listed here.
 * Members are optional: a channel is `tenant`-visible, so anyone in the
 * organization can find and join it; adding people is an invitation.
 */
const WHITESPACE_RUN = /\s+/g;
const LEADING_HASHES = /^#+/;

/** "QA coordination" / "#qa coordination" → "qa-coordination". */
function channelSlug(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(WHITESPACE_RUN, "-")
		.replace(LEADING_HASHES, "");
}

export const TeamBridgeCreateDialog: FC<{
	open: boolean;
	onClose: () => void;
	/** Who the picker offers: the organization's people and chiefs of staff. */
	candidates: readonly TeamBridgeRecipient[];
	onCreate: (input: {
		kind: "channel";
		name: string;
		topic?: string;
		visibility: "tenant";
		agentCapable: boolean;
		members: TeamBridgeMemberInput[];
	}) => void;
	pending?: boolean;
	error?: string;
}> = ({ open, onClose, candidates, onCreate, pending = false, error }) => {
	useI18nLocale();
	const nameId = useId();
	const topicId = useId();
	const [name, setName] = useState("");
	const [topic, setTopic] = useState("");
	const [members, setMembers] = useState<TeamBridgeRecipient[]>([]);
	/*
	 * EVERY OPEN STARTS A FRESH FORM: a half-typed channel that was cancelled
	 * must not reappear on the next open.
	 */
	useEffect(() => {
		if (!open) return;
		setName("");
		setTopic("");
		setMembers([]);
	}, [open]);

	/*
	 * A channel name is a slug, Slack-style: lower case, spaces to hyphens, so
	 * "#qa coordination" and "#qa-coordination" cannot both exist by accident.
	 * The server stores what it is sent; normalising here keeps the rail's `#`
	 * names consistent without a server rule.
	 */
	const slug = channelSlug(name);
	const valid = slug.length > 0;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent className="gap-4">
				<DialogTitle>{t("ui.teamBridge.create.title")}</DialogTitle>
				<DialogDescription className="text-[13px] text-ink-muted">
					{t("ui.teamBridge.create.channel_description")}
				</DialogDescription>

				<label
					htmlFor={nameId}
					className="flex flex-col gap-1 text-[13px] text-ink-muted"
				>
					{t("ui.teamBridge.create.name")}
					<Input
						id={nameId}
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder={t("ui.teamBridge.create.name_placeholder")}
						maxLength={80}
						autoFocus
					/>
				</label>

				<label
					htmlFor={topicId}
					className="flex flex-col gap-1 text-[13px] text-ink-muted"
				>
					{t("ui.teamBridge.create.topic")}
					<Input
						id={topicId}
						value={topic}
						onChange={(event) => setTopic(event.target.value)}
						maxLength={512}
					/>
				</label>

				<div className="flex flex-col gap-1 text-[13px] text-ink-muted">
					<span>{t("ui.teamBridge.create.members")}</span>
					<div className="relative -mx-5">
						<TeamBridgeComposeBar
							recipients={members}
							candidates={candidates}
							onChange={setMembers}
							autoFocus={false}
						/>
					</div>
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
								kind: "channel",
								name: slug,
								...(topic.trim() ? { topic: topic.trim() } : {}),
								visibility: "tenant",
								// A channel is agent-capable by definition on the server; the
								// flag is stated so the request reads the same as it is stored.
								agentCapable: true,
								members: members.map(recipientMemberInput),
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
