/**
 * The mesh's revoked memberships: one quiet count that opens into the audit rows.
 *
 * THE DEFECT THIS REPLACES. A revoked membership arrives as a member row with
 * `active: false`: the relay keeps it as a tombstone because the device id is
 * burned and the record is the only place that fact survives (it prunes the row
 * after 90 days on its own). The tab used to build a DEVICE NODE for every
 * member row, so a tombstone was drawn beside the live peers, wearing the reach
 * vocabulary of a device that had not answered - `cloud-node-1 · conversations
 * not reported · no answer` - while the wire had not asked it anything. Two
 * cards saying a peer was silent is a claim the backend never made, and the
 * operator read it as two broken devices.
 *
 * WHAT REPLACES IT. The nodes are gone (`meshGraph` draws only live
 * memberships); this is the audit fact's one home, in the tab's census band so
 * both presentations can reach it. The count is the number the lane and the
 * heading already printed, so nothing was quietly dropped - it is now a control
 * that names each tombstone: the network it belonged to, the recorded name, the
 * burned device id and the role the membership held. The relay's later pruning
 * is the only thing that removes a row, and that is worth saying rather than
 * offering a delete that does not exist.
 *
 * WHY A DISCLOSURE AND NOT A SECOND IDIOM. `docs/branding.md` § Disclosure names
 * `@shared/components/ui/disclosure` as the app's one expander; a hand-built
 * toggle here would be the fourth idiom the rule exists to prevent. The count is
 * quiet by design - it is a fact, not a call to action - so the trigger inherits
 * the meta ink of the census line and opens only on request.
 */

import { Disclosure } from "@shared/components/ui/disclosure";
import type { FC } from "react";
import { t } from "../../../../i18n/messages";
import type { RevokedMembership } from "./mesh-graph";

export const MeshRevoked: FC<{
	/** `MeshGraph.revoked`: every tombstone the reads still carry. */
	revoked: readonly RevokedMembership[];
}> = ({ revoked }) => {
	/*
	 * No rows, no control: a count of zero needs no disclosure, and a button that
	 * opens an empty list would be an affordance for nothing.
	 */
	if (revoked.length === 0) return null;
	return (
		<Disclosure
			/*
			 * `contents` IS THE LAYOUT: the census band is one line of text plus this
			 * trigger, and the audit rows open as a block BELOW that line. A block-level
			 * wrapper (the component's default) makes the trigger its own flex item, and
			 * the opened body then grows that item rather than the line - measured: the
			 * rows ran off the column's right edge. With `display: contents` the trigger
			 * is inline in the sentence and the body is a full-width block under it.
			 */
			className="contents"
			/*
			 * A TRAILING CHEVRON, because the trigger continues the census sentence
			 * rather than starting a row: a leading chevron would push the count away
			 * from the words it belongs to. The swap still follows § Disclosure
			 * (`ChevronRight` closed, `ChevronDown` open); only its side moves.
			 */
			chevron="trailing"
			triggerClassName="inline-flex w-auto align-baseline text-meta text-ink-dim hover:text-ink"
			triggerData={{ "data-mesh-revoked-toggle": "" }}
			summary={t("ui.mesh.mesh_list.revoked_count", {
				count: revoked.length,
			})}
		>
			<ul
				data-mesh-revoked=""
				/*
				 * NO ROW GROUND, unlike a device row: these are audit lines under the
				 * census, not devices a reader can open. A filled card would give a
				 * tombstone the same visual weight as the live device rows, which is the
				 * confusion this change removes.
				 */
				className="m-0 flex list-none flex-col gap-1 p-0"
			>
				{revoked.map((member) => (
					<li
						key={`${member.networkId}:${member.deviceId}`}
						data-mesh-revoked-member={member.deviceId}
						className="flex flex-wrap items-baseline gap-x-2 text-meta text-ink-dim"
					>
						{/*
						 * THE NETWORK IS NAMED because this list is the tab's, not one
						 * heading's: a tombstone belongs to a membership, and two networks can
						 * hold two burned ids under the same device name.
						 */}
						<span>{member.networkName}</span>
						<span className="text-body-sm text-ink">{member.label}</span>
						{/*
						 * THE ID IS MACHINE VOICE and stays monospace: it is the burned
						 * identity an operator needs when they compare this screen with the
						 * relay's own records, which is the one thing a tombstone is for.
						 */}
						<span className="font-mono">{member.deviceId}</span>
						<span>
							{member.role ? `${member.role} · ` : ""}
							{t("ui.mesh.mesh_graph.revoked_membership")}
						</span>
					</li>
				))}
			</ul>
		</Disclosure>
	);
};
