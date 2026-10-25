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
	const count = t("ui.mesh.mesh_list.revoked_count", { count: revoked.length });
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
			/*
			 * THE CHEVRON IS THE ONE RESTING CUE (design review round 1, D1). The shared
			 * slot paints `ink-disabled`, which is right where a chevron annotates a trace
			 * that is always there - but here it is the only mark that says "2 revoked" is
			 * a control, and on the canvas it measured 2.37:1, under the 3:1 floor for a
			 * non-text mark. `ink-dim` is read from the same role scale (6.24:1 on canvas
			 * and 6.24:1 in the list) and the slot appends this class last, so the
			 * override cannot leak into the disclosures that rely on the dim default.
			 */
			chevronClassName="text-ink-dim"
			/*
			 * THE MEASUREMENT IS NOT THE TRIGGER'S BOX (design review round 1, D5). The
			 * shared row is `min-h-6` with `py-0.5`, so an inline trigger in the census
			 * sentence grew that line 6px (canvas well 177 to 183). `min-h-auto` plus
			 * zero vertical padding drops the row to the line's own height; the fixed 2px
			 * of padding is what a line box had already absorbed, so no other disclosure
			 * (a real row, not an inline fragment) changes.
			 */
			rowClassName="min-h-auto py-0"
			triggerClassName="inline-flex w-auto items-center gap-1 align-baseline text-meta text-ink-dim hover:text-ink"
			triggerData={{ "data-mesh-revoked-toggle": "" }}
			/*
			 * AN ACCESSIBLE NAME THAT IS NOT A COUNT (design review round 1, D3). The
			 * visible text is "2 revoked"; read alone that names a number of devices,
			 * which is exactly the misreading this change exists to end. The label says
			 * what the disclosure holds, so the visible count stays short.
			 */
			triggerLabel={t("ui.mesh.mesh_list.revoked_toggle_label")}
			/*
			 * THE SEPARATOR IS A BOX, NOT A LEADING SPACE (design review round 1, D2).
			 * The first fix trimmed the fragment's leading space and left the separator to the
			 * trigger's `gap-1`; measured on the rebuilt frame, that gap opened between the
			 * full stop and the chevron at the END of the count, not between the device name
			 * and the count, so the band still read `compute.internal· 2 revoked`. The
			 * fragment no longer carries a leading space at all (`revoked_count` is now the
			 * bare count in every catalogue) and the call site writes ` · ` as markup in front
			 * of the count, so the separation comes from the line's own glyph instead of a
			 * leading space inside the flex item. THE SEPARATOR IS A BOX OF ITS OWN: the
			 * census line is `display: flex`, and this disclosure is `display: contents`, so
			 * the trigger's own `<button>` is a direct flex item of that line. A flex item
			 * drops a leading space it cannot fit (flexbox `hasLeadingSpace`), which is why
			 * neither a bare `{" · "}` text node nor three separate string expressions
			 * survived - measured on the rebuilt frame, the button's first text node held the
			 * space and `getClientRects()` returned zero rects for it, so the band still read
			 * `compute.internal· 2 revoked`. The separator is therefore a `whitespace-pre`
			 * `inline-block` that is NOT the flex item's own edge: the box carries its own
			 * width. It is `aria-hidden`, because the accessible name is the audit-only
			 * label below, not a reading of the separator. The trigger keeps `gap-1` between
			 * the count and its chevron.
			 */
			summary={
				<>
					<span aria-hidden="true" className="inline-block whitespace-pre">
						{" · "}
					</span>
					{count}
				</>
			}
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
				{revoked.map((member) => {
					/*
					 * THE BURNED ID LEADS, AND CARRIES THE INK (design review round 1, D4).
					 * A tombstone's two rows share a recorded name (a device renamed and
					 * re-paired leaves two rows called `cloud-node-1`), so leading with the
					 * name painted the identical word at `text-ink` 14.03:1 and the differing
					 * id at `ink-dim` 6.24:1: the rows scanned as duplicates. The id is the
					 * only field the rows are told apart by, so it leads and keeps the
					 * heading ink; the name follows in the muted ink a secondary field wears.
					 */
					return (
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
							{/*
							 * THE ID IS MACHINE VOICE and stays monospace: it is the burned
							 * identity an operator needs when they compare this screen with the
							 * relay's own records, which is the one thing a tombstone is for.
							 */}
							<span className="font-mono text-body-sm text-ink">
								{member.deviceId}
							</span>
							<span className="text-body-sm text-ink-muted">
								{member.label}
							</span>
							<span>
								{member.role ? `${member.role} · ` : ""}
								{t("ui.mesh.mesh_graph.revoked_membership")}
							</span>
						</li>
					);
				})}
			</ul>
		</Disclosure>
	);
};
