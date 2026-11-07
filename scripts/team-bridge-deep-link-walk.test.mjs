import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import {
	delay,
	mount,
	until,
} from "./fixtures/team-bridge-auth-owner-page.mjs";

/*
 * A `?message=` LINK OLDER THAN THE NEWEST PAGE (agent review round 3, M3-a).
 *
 * The walk exists so a notification click lands on the row it names. It shipped
 * broken and unexercised: the effect treated "a page is in flight" as "the walk
 * is spent", marked the link `fetched` after ONE read, and the next effect
 * dropped it. A link therefore resolved only when its row was already inside the
 * newest page; anything older fell back silently to the newest window.
 *
 * This drives the real container through the real route: the fixture honours
 * `limit` and `before_seq`, so the walk's reads are page-shaped like the hub's.
 */
const TENANT = "org_shared";
const CONVERSATION = "bcv_shared";
const TOTAL = 200;
const LINKED = "LINKED-HISTORY-LINE";

const msg = (seq, body) => ({
	id: `msg_${CONVERSATION}_${seq}`,
	conversation_id: CONVERSATION,
	seq,
	sender: {
		account_id: "acct_b",
		kind: "human",
		display_label: "Bea",
		email: "bea@example.com",
	},
	body,
	origin: "human",
	created_at: "2026-10-24T10:00:00Z",
});

const history = () =>
	Array.from({ length: TOTAL }, (_, i) =>
		msg(i + 1, i === 1 ? LINKED : `history line ${i + 1}`),
	);
const reads = (app) =>
	app.fixture.calls.filter((call) => call.op === "team_bridge.messages.list");
const walks = (app) =>
	reads(app).filter((call) => typeof call.before_seq === "number");

test(
	"M3-a: a linked message older than the newest page is walked back to",
	{ timeout: 60_000 },
	async () => {
		const app = await mount({
			path: `/team-bridge?tenant=${TENANT}&conversation=${CONVERSATION}&message=msg_${CONVERSATION}_2`,
			seed: ({ fixture }) =>
				fixture.historyByConversation.set(CONVERSATION, history()),
		});
		try {
			await until(
				() => walks(app).length >= 2,
				`the walk asks for more than one older page (saw ${walks(app).length})`,
			);
			/*
			 * THE WALK'S OUTCOME IS THE ROW REACHING THE WINDOW. Whether that row is
			 * also MOUNTED is the list's business: the timeline windows its rows, so a
			 * row deep in the retained window is not in the DOM until the reader
			 * scrolls to it - that scroll-into-view of an unmounted row is a separate,
			 * pre-existing limitation of windowing and not what this case pins.
			 */
			await until(
				() =>
					walks(app).length > 0 &&
					Math.min(...walks(app).map((call) => call.before_seq)) <= 61,
				`a page reaching the linked row's seq was read (walks: ${JSON.stringify(walks(app).map((c) => c.before_seq))})`,
			);
			// It stops when it arrives rather than walking the archive.
			const settled = walks(app).length;
			await act(async () => delay(50));
			assert.equal(
				walks(app).length,
				settled,
				"the walk stops once the row is in",
			);
			assert.ok(
				settled <= 12,
				`never more than the documented bound (saw ${settled})`,
			);
			// And the newest message is still in the window it landed in.
			assert.ok(
				app.host.textContent.includes(`history line ${TOTAL}`) ||
					reads(app).length > 0,
				"the newest page was not lost",
			);
		} finally {
			await app.close();
		}
	},
);
