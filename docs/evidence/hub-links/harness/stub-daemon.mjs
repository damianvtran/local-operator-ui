/**
 * A stand-in for `local_operator serve`, for the hub-links frames.
 *
 * WHY THIS EXISTS. The desktop hub surface (`hub.links` inventory, its
 * policy controls, its skill library and its explicit source confirmation on a
 * legacy unknown-origin row) is being built against the FROZEN wire receipt
 * (`b-wire-receipt-definition-cas-and-adopt.md`), and the core route that will
 * serve it is still being extended to that shape. So there is no daemon on this
 * machine that answers `/v1/desktop/hub/links` yet, and a scene that drives the
 * panel needs one. This is that daemon: it answers the FROZEN receipt's shapes
 * and nothing else.
 *
 * WHAT IT IS NOT. Not a backend: no real hub, no store beyond what its routes
 * mutate, no merges. It fixture-covers the states the panel draws - a healthy
 * public agent link, an org team link, a skill link, and one legacy
 * unknown-origin row the explicit source confirmation is for. Every op it has no
 * answer for is answered 503 and named on stderr, so a scene that needs one shows
 * up as a missing route rather than as a screen that quietly did not paint.
 *
 * THE SKILLS LIBRARY (2026-10-15, `--scene hub-skills`): the `org_skills.list` /
 * `org_skill.get` radient ops and the public `/v1/skills` routes this file now
 * answers exist for that scene; its variant flags (`--skills-remote-empty`,
 * `--skills-unsupported`, `--skills-latency-ms`, `--pull-outcome`,
 * `--publish-outcome`) are read from this stub's argv, and each frame's README
 * row names the variant that produced it.
 *
 * IT IS STATEFUL, deliberately (the policy PATCH and the resolve arm mutate
 * `links`), so give each launch its own process - `--records` is per process.
 *
 * Usage: node stub-daemon.mjs --port <n> --records <dir>
 *
 * `--records` is the directory the DRIVER copies into the app's own
 * `<config>/run/serve`, which is how `discovery.ts` admits a daemon at all: a
 * record, a live pid, and a `/health` answer naming the same `instance_id`.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const arg = (name, fallback = null) => {
	const at = process.argv.indexOf(`--${name}`);
	return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
};

const PORT = Number(arg("port", "18234"));
/*
 * Whether this run pretends a Radient account is signed in. Default ON, because
 * the org destination and the empty scope chooser are both signed-in states; a
 * `--signed-out` run photographs the sign-in-to-publish affordance instead.
 */
const SIGNED_OUT = process.argv.includes("--signed-out");
// Explicit fixture version is read by MAIN from /health, never inferred from a
// capability or from the app build. The default remains an unknown dev stamp.
const CORE_VERSION = arg("core-version", "0.0.0-stub");
/** Signed in, but no org membership: no org chip, so the public scope is the only one. */
const SKILLS_SCOPE_PUBLIC = process.argv.includes("--skills-scope-public");
/** Positive-only future-adapter fixture. Released core does not advertise it. */
const SKILLS_ADAPTER = process.argv.includes("--skills-adapter");
let skillsAdapterAvailable = SKILLS_ADAPTER;
const SKILLS_REMOTE_EMPTY = process.argv.includes("--skills-remote-empty");
const SKILLS_UNSUPPORTED = process.argv.includes("--skills-unsupported");
const SKILLS_LATENCY_MS = Number(arg("skills-latency-ms", "0"));
const PULL_LATENCY_MS = Number(arg("pull-latency-ms", "0"));
/** The one answer shape both #1461 routes return; core adds no inventory to it. */
const hubSleep = () =>
	HUB_LATENCY_MS > 0
		? new Promise((resolve) => setTimeout(resolve, HUB_LATENCY_MS))
		: Promise.resolve();

const hubStatus = () => ({
	generated_at: new Date().toISOString(),
	credential: "ok",
	settings: { auto_agents: true, auto_teams: true, interval_min: 15 },
	counts: {},
	items: [],
});

/** One item's report, addressed the way the request addressed it. */
const hubReport = (body, outcome) => {
	const row =
		links.find(
			(link) =>
				link.kind === body?.kind &&
				((body?.local_id && link.local_id === body.local_id) ||
					(body?.name && link.name === body.name)),
		) ?? links[0];
	return {
		kind: row.kind,
		local_id: row.local_id,
		name: row.name,
		hub_id: row.hub_id,
		outcome,
		applied: false,
		backup: null,
		error_class: outcome === "needs-review" ? "model-unavailable" : null,
		message: HUB_MESSAGE,
		warnings: [],
		replaced: {},
		fields: [],
		classification: "remote-only",
		skipped_reason: null,
	};
};

const PULL_OUTCOME = arg("pull-outcome", "ok");
/*
 * THE #1461 DESIGN-ROUND-1 STATES (`--scene hub-links-actions`). Core's answer to
 * a dry run is what the incoming preview is built from, and the panel's pending
 * state is only visible while an answer is outstanding - neither is on the wire
 * this stub served before. A run that names none of these keeps the 503 the
 * other scenes expect.
 *
 * `--hub-outcome` is one of core's `ItemOutcome` classes (`would-merge`,
 * `needs-review`, `up-to-date`); `--hub-message` is core's own sentence for the
 * row (`report.py` `ItemMergeReport.message`), which the panel shows verbatim
 * BESIDE its own conclusion line; `--hub-latency-ms` holds the answer so a
 * capture can photograph the row WHILE the press is running.
 */
const HUB_OUTCOME = arg("hub-outcome", null);
const HUB_MESSAGE = arg("hub-message", "");
const HUB_LATENCY_MS = Number(arg("hub-latency-ms", "0"));
/*
 * A SECOND dry-run class in the SAME boot: a row whose baseline is unknown
 * answers `needs-review`, and a boot with one outcome could not photograph both
 * the would-merge row and the unknown-baseline row - two different sentences in
 * the same dialogue.
 */
const HUB_OUTCOME_SECOND = arg("hub-outcome-second", null);
/** Counted per DRY RUN only: a check must not consume the second answer. */
let dryRuns = 0;
/*
 * A second origin on the agent row, in the two states #1461's design round
 * photographed: a FAILED pull whose retry has no scheduled time, and an
 * UNKNOWN BASELINE (the legacy state a dry run answers `needs-review` for).
 */
const ORIGIN2_FAILED = process.argv.includes("--origin2-failed");
const ORIGIN2_UNKNOWN = process.argv.includes("--origin2-unknown");
const PUBLISH_OUTCOME = arg("publish-outcome", "complete");
const skillsSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const RECORDS = arg("records", null);
const INSTANCE_ID = randomUUID();
const startedAt = Date.now() / 1000;

/** One approved, credential-free source. The panel contributes exactly this. */
/**
 * The hub source the fixture's links name. Default keeps the historic value;
 * the Skills scene passes the same loopback base the app is built against, so
 * its links JOIN the catalogue rows instead of reading as a foreign origin.
 */
const SOURCE = arg("source", "https://hub.radient.local");
const TENANT_ID = "org-minerva";
const TENANT_NAME = "Minerva";

/** A direction status whose shape is the receipt's rich `HubDirectionStatus`. */
const direction = (overrides = {}) => ({
	state: "idle",
	classification: null,
	enabled: true,
	last_checked_at: null,
	last_success_at: null,
	attempts: 0,
	next_retry_at: null,
	error_class: null,
	error_subclass: null,
	safe_message: null,
	operation_id: null,
	model_used: null,
	summary: null,
	backup_receipt: null,
	...overrides,
});

/**
 * The fixture rows, in the wire's own field names, one per state the panel draws.
 * `revision` is policy CAS: the PATCH below compares it so a concurrent edit is
 * refused rather than silently overwritten.
 */
const links = [
	{
		link_id: "link-public-agent",
		kind: "agent",
		local_id: "agent-1",
		name: "reviewer",
		hub_id: "hub-agent-reviewer",
		hub_source: SOURCE,
		visibility: "public",
		tenant_id: null,
		tenant_name: null,
		policy: { subscribe: true, auto_push: false, revision: "rev-agens-1" },
		eligibility: { can_auto_push: true, reason: null },
		baseline_state: "pull",
		remote_revision: "rev-remote-1",
		auto_will_apply: true,
		auto_will_push: false,
		pull: direction({
			state: "idle",
			last_success_at: "2026-10-13T10:00:00Z",
		}),
		push: direction({ state: "idle", enabled: false }),
	},
	{
		link_id: "link-org-team",
		kind: "team",
		local_id: "team-1",
		name: "lopdev",
		hub_id: "hub-team-lopdev",
		hub_source: SOURCE,
		visibility: "org",
		tenant_id: TENANT_ID,
		tenant_name: TENANT_NAME,
		policy: { subscribe: false, auto_push: false, revision: "rev-team-1" },
		eligibility: {
			can_auto_push: false,
			reason: "auto-push is not enabled for this destination",
		},
		baseline_state: "adopt-unknown",
		remote_revision: null,
		auto_will_apply: false,
		auto_will_push: false,
		pull: direction({
			state: "failed",
			error_class: "hub-error/transport",
			attempts: 3,
			next_retry_at: "2026-10-13T11:00:00Z",
		}),
		push: direction({ state: "idle", enabled: false }),
	},
	{
		/*
		 * A SINGLE-origin healthy link for another agent, so the sidebar draws the
		 * ordinary quiet mark (one fixed 24px slot) beside the aggregate mark on the
		 * multi-origin `reviewer` row.
		 */
		link_id: "link-public-coder",
		kind: "agent",
		local_id: "agent-2",
		name: "coder",
		hub_id: "hub-agent-coder",
		hub_source: SOURCE,
		visibility: "public",
		tenant_id: null,
		tenant_name: null,
		policy: { subscribe: true, auto_push: false, revision: "rev-coder-1" },
		eligibility: { can_auto_push: true, reason: null },
		baseline_state: "pull",
		remote_revision: "rev-remote-coder",
		auto_will_apply: true,
		auto_will_push: false,
		pull: direction({ state: "idle" }),
		push: direction({ state: "idle", enabled: false }),
	},
	{
		/*
		 * A SECOND origin for the SAME local agent (`reviewer`), so the sidebar
		 * draws the AGGREGATE mark (design §Sidebar line 48, CODE MAJOR-2): an item
		 * with two destinations has no single editable policy, so the row shows one
		 * mark that opens detail rather than silently picking the first source.
		 */
		link_id: "link-public-agent-2",
		kind: "agent",
		local_id: "agent-1",
		name: "reviewer",
		hub_id: "hub-agent-reviewer-2",
		hub_source: SOURCE,
		visibility: "org",
		tenant_id: TENANT_ID,
		tenant_name: TENANT_NAME,
		policy: { subscribe: false, auto_push: false, revision: "rev-agens-2" },
		eligibility: {
			can_auto_push: false,
			reason: "auto-push is not enabled for this destination",
		},
		baseline_state: "pull",
		remote_revision: null,
		auto_will_apply: false,
		auto_will_push: false,
		pull: direction({ state: "idle" }),
		push: direction({ state: "idle", enabled: false }),
	},
	{
		link_id: "link-skill",
		kind: "skill",
		local_id: "skill-1",
		name: "release-notes",
		hub_id: "hub-skill-release-notes",
		hub_source: SOURCE,
		visibility: "public",
		tenant_id: null,
		tenant_name: null,
		policy: { subscribe: true, auto_push: true, revision: "rev-skill-1" },
		eligibility: { can_auto_push: true, reason: null },
		baseline_state: "pull",
		remote_revision: "rev-remote-skill",
		auto_will_apply: true,
		auto_will_push: true,
		pull: direction(),
		push: direction({ state: "idle", operation_id: "op-push-1" }),
	},
];

if (ORIGIN2_UNKNOWN) links[3].baseline_state = "adopt-unknown";
if (ORIGIN2_FAILED) {
	/*
	 * SUBSCRIBED, because the panel draws a direction's status only where that
	 * direction is live: with Subscribe off it states that incoming updates are
	 * off and draws no column, so a failed row behind an unsubscribed link is a
	 * state no reader can see.
	 */
	links[3].policy.subscribe = true;
	links[3].pull = direction({
		state: "failed",
		error_class: "hub-error/transport",
		attempts: 2,
		// ONE metadata line, so the Retry control's position in the column is
		// readable: below the check time in the base tree, above it after D4.
		last_checked_at: "2026-10-13T10:30:00Z",
		// NO next_retry_at: this is the state QA r1 photographed, where the row
		// says a retry is scheduled and shows no time for it.
		next_retry_at: null,
	});
}

/**
 * The legacy unknown-origin row: a link whose source was never confirmed, so the
 * panel draws the source-confirmation control instead of a healthy row. It is a
 * DIAGNOSTIC and not a link - it carries no policy, no link_id and no origin.
 * Once the resolve arm below is pressed it leaves this list and a real link
 * appears in `links`, which is the transition the scene photographs.
 */
const unresolved = [
	{
		kind: "agent",
		local_id: "agent-legacy",
		name: "legacy-helper",
		hub_id: "hub-agent-legacy",
		reason: "source-unresolved",
	},
	/*
	 * The TEAM half of the same legacy shape. The resolve arm's domain is
	 * `agent|team` (core `HubApply.kind`), and until this fixture existed NO row
	 * exercised the team half - so the confirmation card was never photographed
	 * on a team pane, where the block describes a TEAM rather than an agent.
	 */
	{
		kind: "team",
		local_id: "team-legacy",
		name: "legacy-team",
		hub_id: "hub-team-legacy",
		reason: "source-unresolved",
	},
	/*
	 * An unresolved-only item (no row in `links`): the roster must show the
	 * "source not confirmed" affordance for it (CODE MAJOR-B).
	 */
	{
		kind: "agent",
		local_id: "agent-legacy-solo",
		name: "legacy-solo",
		hub_id: "hub-agent-legacy-solo",
		reason: "source-unresolved",
	},
];

/** v1 vs unsupported: the library reads capability off the response contract. */
const skillContract = () =>
	SKILLS_UNSUPPORTED
		? { revision_cas: 0, skills: 0 }
		: { revision_cas: 1, skills: 1 };
const ORG_SKILLS = [
	{
		id: "skill-minerva-deploy",
		name: "minerva-deploy",
		description: "Open and track a Minerva deploy request.",
		document_version: 1,
		visibility: "org",
		tenant_id: TENANT_ID,
		content_revision: 3,
		revision: '"rev-org-3"',
		sync_contract: { revision_cas: 1, skills: 1 },
	},
	{
		id: "skill-invoice-check",
		name: "invoice-check",
		description: "Reconcile supplier invoices against the ledger.",
		document_version: 1,
		visibility: "org",
		tenant_id: TENANT_ID,
		content_revision: 1,
		revision: '"rev-org-1"',
		sync_contract: { revision_cas: 1, skills: 1 },
	},
];
const PUBLIC_SKILLS = [
	{
		id: "skill-release-notes",
		name: "release-notes",
		description: "Draft release notes from a merged PR list.",
		document_version: 1,
		visibility: "public",
		content_revision: 5,
		revision: '"rev-pub-5"',
		sync_contract: { revision_cas: 1, skills: 1 },
	},
	{
		id: "skill-transcript-audit",
		name: "transcript-audit",
		description: "Audit a transcript for policy contradictions.",
		document_version: 1,
		visibility: "public",
		content_revision: 2,
		revision: '"rev-pub-2"',
		sync_contract: { revision_cas: 1, skills: 1 },
	},
];
const skillDetail = (row) => ({
	...row,
	files: [
		{
			path: "SKILL.md",
			content: `# ${row.name}\n\nStub skill body for the evidence run.\n`,
		},
		{ path: "scripts/run.sh", content: "#!/bin/sh\necho stub\n" },
	],
});
const publicOk = (result) => ({ status: 200, body: { msg: "ok", result } });
const skillLink = (plan) => ({
	link_id: plan.linkId,
	kind: "skill",
	local_id: plan.alias,
	name: plan.alias,
	hub_id: plan.hubId,
	hub_source: SOURCE,
	visibility: plan.visibility,
	tenant_id: plan.tenantId,
	tenant_name: plan.visibility === "org" ? TENANT_NAME : null,
	policy: {
		subscribe: plan.subscribe,
		auto_push: plan.autoPush,
		revision: "rev-policy-skill-1",
	},
	eligibility: { can_auto_push: true, reason: null },
	baseline_state: "pull",
	remote_revision: "rev-remote-1",
	auto_will_apply: true,
	auto_will_push: false,
	pull: direction({ state: "idle", last_success_at: "2026-10-14T22:00:00Z" }),
	push: direction({ state: "idle", enabled: false }),
});
const ok = (result) => ({ status: 200, body: { result } });

const route = async (method, pathname, query, body) => {
	// Fixture-only lifecycle control: exercise the app's real capability watch,
	// not an invented cache setter. Never present on a released-core backend.
	if (
		SKILLS_ADAPTER &&
		method === "POST" &&
		pathname === "/__fixture/skills/withdraw"
	) {
		skillsAdapterAvailable = false;
		return ok({ hub_skills: 0 });
	}
	if (method === "GET" && pathname === "/health") {
		return ok({
			status: "ok",
			/*
			 * `pid` is REQUIRED, not decoration: `discovery.ts` matches the answering
			 * process's pid against the serve record's and REJECTS the record as
			 * `identity-mismatch` when it is absent ("The answering PID does not match
			 * the record."), so a daemon that answers without it is never admitted and
			 * the app stays offline. Measured: the first run of this scene answered
			 * `/health` without `pid` and the driver logged `no valid daemon among 1
			 * record(s)`.
			 */
			pid: process.pid,
			instance_id: INSTANCE_ID,
			version: CORE_VERSION,
			prefix: process.cwd(),
			install_kind: "stub",
		});
	}
	/* The claim handshake, without which the app shows an "unattached" banner. */
	if (method === "POST" && pathname === "/v1/desktop/claim") {
		return ok({ claimed: true });
	}
	/*
	 * The app's ATTACH PROBE: `backend-service.ts` probes the daemon with a
	 * one-row session list before it attaches, and a 503 here reads as "answered
	 * this app's desktop read with HTTP 503" — the app then refuses to attach and
	 * every surface shows "Server is offline", which is what the first run of this
	 * scene measured. An EMPTY list is the honest answer (this fixture has no
	 * sessions; the hub frames are about a rule's policy, not a transcript), and
	 * it answers the probe the way a real daemon with no sessions would.
	 */
	if (method === "GET" && pathname === "/v1/desktop/sessions") {
		return ok({ sessions: [], truncated: false });
	}
	if (method === "GET" && pathname === "/v1/capabilities") {
		return ok({
			desktop_contract: 1,
			desktop_available: true,
			desktop_auth: "bearer",
			features: {
				auth: 1,
				settings: 1,
				commands: 1,
				catalogues: 1,
				lifecycle: 1,
				mcp: 1,
				radient: 1,
				profile_catalogue: 1,
				team_catalogue: 1,
				/*
				 * 2, not 1: the CHAT SIDEBAR (where the hub marks live, design
				 * §Sidebar line 48) gates its entity list on `session_catalogue >= 2`
				 * (`desktopFeatureState(capabilities.data, "session_catalogue", 2)`),
				 * and a 1 there draws the "Update the backend" notice instead of the
				 * rows - so the marks this scene is for would never mount.
				 */
				session_catalogue: 2,
				/*
				 * THE CAPABILITY THIS SCENE IS OF. A daemon that does not advertise
				 * `hub_links` leaves the panel unmounted entirely (`enabled` is
				 * `desktopFeatureEnabled(capabilities.data, "hub_links")`), so the
				 * capability and the route below describe one another.
				 */
				hub_links: 1,
				skill_catalogue: 1,
				...(skillsAdapterAvailable ? { hub_skills: 1 } : {}),
				/*
				 * The agent-hub page draws its scope chips (public | org) only on a daemon that
				 * advertises `radient_org`; without it the row is replaced by a notice and the
				 * hub-skills scene has no org scope to press.
				 */
				radient_org: 1,
			},
		});
	}
	if (method === "GET" && pathname === "/v1/desktop/hub/links") {
		/*
		 * The FROZEN receipt's inventory shape: `links` (healthy rows) and
		 * `unresolved` (legacy unknown-origin diagnostics). `?kind=` filters, and
		 * a filtered read still carries the full `unresolved` list the panel
		 * narrows itself - the route does not decide for the caller.
		 */
		const kind = query.get("kind");
		return ok({
			links: kind ? links.filter((row) => row.kind === kind) : links,
			unresolved,
		});
	}
	/*
	 * The two catalogues the agents page reads before it draws the detail pane
	 * the hub panel rides in. The linked rows' `local_id`s name these records, so
	 * the panel's `linksForLocalItem` filter resolves them here.
	 */
	/*
	 * THE RADIENT PROXY (`POST /v1/desktop/radient`), which the app's auth hook
	 * and membership selector read. Two operations matter here: `account` (the
	 * signed-in probe — a stored credential's account read) and `memberships.list`
	 * (the caller's own orgs). A signed-OUT run answers `account` with a 409,
	 * which `isSignedOut` reads as the answer "no credential" rather than a fault,
	 * so the app lands unauthenticated and draws the affordance.
	 */
	if (method === "POST" && pathname === "/v1/desktop/radient") {
		const operation = body?.operation;
		if (operation === "account") {
			if (SIGNED_OUT) {
				return {
					status: 409,
					body: {
						detail: {
							code: "radient-not-authenticated",
							message: "no Radient credential is stored",
						},
					},
				};
			}
			/*
			 * THE DOUBLY-NESTED ENVELOPE: the radient proxy unwraps `body.result`
			 * (desktopResult) and then reads `envelope.result` (radientProxy), so a
			 * Radient answer is `{result: {data: {msg, result: <payload>}}}`. A bare
			 * `{result: <payload>}` parses to `undefined` and the app reads signed-out.
			 */
			return ok({
				data: {
					msg: "ok",
					result: {
						account: {
							id: "acct-stub",
							tenant_id: TENANT_ID,
							email: "stub@example.invalid",
							name: "Stub Operator",
							role: "owner",
							status: "active",
							created_at: "2026-01-01T00:00:00Z",
							updated_at: "2026-01-01T00:00:00Z",
						},
						identity: {
							email: "stub@example.invalid",
							provider: "google",
							provider_id: "stub-provider-id",
						},
					},
				},
			});
		}
		if (operation === "memberships.list") {
			if (SIGNED_OUT) {
				return {
					status: 409,
					body: { detail: { code: "radient-not-authenticated" } },
				};
			}
			if (SKILLS_SCOPE_PUBLIC)
				return ok({ data: { msg: "ok", result: { memberships: [] } } });
			return ok({
				data: {
					msg: "ok",
					result: {
						memberships: [
							{
								tenant_id: TENANT_ID,
								tenant_name: TENANT_NAME,
								role: "owner",
								status: "active",
								is_home: true,
								plan: { status: "active", seats: 5 },
							},
						],
					},
				},
			});
		}
		if (operation === "org_skills.list") {
			if (SIGNED_OUT)
				return {
					status: 409,
					body: { detail: { code: "radient-not-authenticated" } },
				};
			await skillsSleep(SKILLS_LATENCY_MS);
			return ok({
				data: {
					msg: "ok",
					result: {
						skills: SKILLS_REMOTE_EMPTY ? [] : ORG_SKILLS,
						sync_contract: skillContract(),
					},
				},
			});
		}
		if (operation === "org_skill.get") {
			if (SIGNED_OUT)
				return {
					status: 409,
					body: { detail: { code: "radient-not-authenticated" } },
				};
			await skillsSleep(SKILLS_LATENCY_MS);
			const row = ORG_SKILLS.find((entry) => entry.id === body?.skill_id);
			return row
				? ok({ data: { msg: "ok", result: skillDetail(row) } })
				: { status: 404, body: { detail: { code: "skill-not-found" } } };
		}
		if (operation === "org_teams.list") {
			if (SIGNED_OUT)
				return {
					status: 409,
					body: { detail: { code: "radient-not-authenticated" } },
				};
			return ok({ data: { msg: "ok", result: { teams: [] } } });
		}
		if (operation === "org_agents.list") {
			if (SIGNED_OUT)
				return {
					status: 409,
					body: { detail: { code: "radient-not-authenticated" } },
				};
			return ok({
				data: {
					msg: "ok",
					result: {
						records: [],
						total_records: 0,
						page: 1,
						per_page: 20,
						total_pages: 1,
					},
				},
			});
		}
		return {
			status: 503,
			body: { detail: `the stub has no answer for radient op ${operation}` },
		};
	}
	if (method === "GET" && pathname === "/v1/desktop/profiles") {
		return ok({
			profiles: [
				{ name: "reviewer", source: "custom", description: "" },
				{ name: "coder", source: "custom", description: "" },
				/*
				 * The LEGACY unknown-origin item, listed so its own detail page can be
				 * opened: the panel narrows `unresolved` to the CURRENT item by local id, so
				 * the confirm-source control only renders on this item's page, not on a
				 * healthy sibling's.
				 */
				{ name: "legacy-helper", source: "custom", description: "" },
				/*
				 * An item present ONLY in `unresolved` (no healthy link row): the roster
				 * affordance (CODE MAJOR-B) is for exactly this case.
				 */
				{ name: "legacy-solo", source: "custom", description: "" },
				/*
				 * A record with NO hub presence at all: no link row and no
				 * unresolved diagnostic, so the panel has nothing to say about it
				 * and must say NOTHING rather than draw a "not linked" line.
				 */
				{ name: "loner", source: "custom", description: "" },
			],
		});
	}
	if (method === "GET" && pathname === "/v1/desktop/teams") {
		return ok({
			teams: [
				{ name: "lopdev", description: "" },
				{ name: "legacy-team", description: "" },
			],
		});
	}
	const profileMatch = pathname.match(/^\/v1\/desktop\/profiles\/([^/]+)$/);
	if (method === "GET" && profileMatch) {
		const name = decodeURIComponent(profileMatch[1]);
		return ok({
			name,
			kind: "role",
			source: "custom",
			/*
			 * A STABLE id per name, so the pane's own local id matches the inventory row
			 * (`linksForLocalItem` / the unresolved filter compare on it). The legacy
			 * item's id is the one its unresolved diagnostic carries.
			 */
			agent_id:
				name === "reviewer"
					? "agent-1"
					: name === "legacy-helper"
						? "agent-legacy"
						: name === "legacy-solo"
							? "agent-legacy-solo"
							: name === "loner"
								? "agent-loner"
								: "agent-2",
			description: "",
			instructions: "",
			tools: [],
			effort: null,
			delegate: false,
			definition_revision: "def-rev-1",
		});
	}
	const teamMatch = pathname.match(/^\/v1\/desktop\/teams\/([^/]+)$/);
	if (method === "GET" && teamMatch) {
		const name = decodeURIComponent(teamMatch[1]);
		return ok({
			name,
			// The legacy team carries its own id: the panel narrows `unresolved`
			// to the CURRENT record by local id, so a second team needs a second id.
			id: name === "legacy-team" ? "team-legacy" : "team-1",
			description: "",
			manager: "manager",
			members: [],
			aliases: [],
			instructions: "",
			project: "",
			definition_revision: "def-rev-2",
		});
	}
	/* Policy PATCH: CAS on the captured policy revision, per the receipt. */
	const policyMatch = pathname.match(/^\/v1\/desktop\/hub\/links\/([^/]+)$/);
	if (method === "PATCH" && policyMatch) {
		const link = links.find((row) => row.link_id === policyMatch[1]);
		if (!link) return { status: 404, body: { detail: "no such link" } };
		if (
			typeof body?.expected_policy_revision === "string" &&
			body.expected_policy_revision !== link.policy.revision
		) {
			return {
				status: 409,
				body: {
					detail: {
						code: "policy-revision-changed",
						message: "the policy changed since it was read",
					},
				},
			};
		}
		if (typeof body?.subscribe === "boolean")
			link.policy.subscribe = body.subscribe;
		if (typeof body?.auto_push === "boolean")
			link.policy.auto_push = body.auto_push;
		link.policy.revision = `rev-${randomUUID().slice(0, 8)}`;
		/* Return the whole row, which is what the client writes back into cache. */
		return ok({ link });
	}
	/*
	 * The source-resolution arm, on the EXISTING apply route. Only the fields the
	 * desktop transport sends are read: a request that names a resolve and carries
	 * the frozen shape succeeds; anything else falls through to the 503 below.
	 */
	/*
	 * THE DRY RUN, and the check that applies nothing: core reports per ITEM
	 * (`report.py` `ItemMergeReport.to_json`), so a row carries `kind`/`local_id`/
	 * `name` and NO `link_id` or `direction` - which is exactly what the panel's
	 * incoming preview reads.
	 */
	if (method === "POST" && pathname === "/v1/desktop/hub/updates/check") {
		if (HUB_OUTCOME === null) {
			return { status: 503, body: { detail: "the stub has no check answer" } };
		}
		await hubSleep();
		return ok({
			reports: links.map((row) =>
				hubReport({ kind: row.kind, local_id: row.local_id }, HUB_OUTCOME),
			),
			status: hubStatus(),
		});
	}
	if (method === "POST" && pathname === "/v1/desktop/hub/updates/apply") {
		if (
			HUB_OUTCOME !== null &&
			body?.dry_run === true &&
			body?.resolve_source !== true
		) {
			await hubSleep();
			const outcome =
				dryRuns++ > 0 && HUB_OUTCOME_SECOND ? HUB_OUTCOME_SECOND : HUB_OUTCOME;
			return ok({ reports: [hubReport(body, outcome)], status: hubStatus() });
		}
		if (body?.resolve_source === true) {
			const row = unresolved.find(
				(candidate) =>
					candidate.kind === body.kind && candidate.name === body.name,
			);
			if (!row) {
				return { status: 404, body: { detail: "no such unresolved row" } };
			}
			/*
			 * A PUBLIC resolution must not name an organization, and an ORG one must.
			 * The service owns this check; the stub states it so the scene can drive
			 * the refusal branch by choosing a destination.
			 */
			if (body.visibility === "org" && !body.tenant_id) {
				return {
					status: 422,
					body: { detail: "an org source resolution needs tenant_id" },
				};
			}
			if (body.visibility === "public" && body.tenant_id) {
				return {
					status: 422,
					body: {
						detail: "a public source resolution must not name an organization",
					},
				};
			}
			// The solo fixture represents a stored, conflicting scope. Refusal must
			// leave inventory untouched so the UI can keep its recovery controls.
			if (row.name === "legacy-solo") {
				return { status: 409, body: { detail: { code: "origin-conflict" } } };
			}
			const isOrg = body.visibility === "org";
			const adopted = {
				link_id: `link-${row.local_id}`,
				kind: row.kind,
				local_id: row.local_id,
				name: row.name,
				hub_id: row.hub_id,
				hub_source: body.hub_source,
				visibility: body.visibility,
				tenant_id: isOrg ? body.tenant_id : null,
				tenant_name: isOrg ? TENANT_NAME : null,
				policy: { subscribe: false, auto_push: false, revision: "rev-new" },
				eligibility: {
					can_auto_push: false,
					reason: "a newly adopted source has no auto-push grant yet",
				},
				baseline_state: "adopt",
				remote_revision: null,
				auto_will_apply: false,
				auto_will_push: false,
				pull: direction({ state: "idle" }),
				push: direction({ state: "idle", enabled: false }),
			};
			// Confirming one record cannot erase another record's outstanding
			// diagnostic. Keep the team/error fixtures available after agent success.
			unresolved.splice(unresolved.indexOf(row), 1);
			links.push(adopted);
			return ok({
				reports: [],
				/*
				 * `HubLinkActionResponse`: the full inventory under `links` and a
				 * `status` in the legacy `HubUpdates` shape, which is what the caller
				 * writes into each cache. A bare `{links,unresolved}` here would set
				 * the WRONG key and leave the panel reading a stale row.
				 */
				links: { links, unresolved },
				status: {
					generated_at: new Date().toISOString(),
					credential: "ok",
					settings: { auto_agents: true, auto_teams: true, interval_min: 15 },
					counts: {},
					items: [],
				},
				link: adopted,
				resolved: {
					source: adopted.hub_source,
					visibility: adopted.visibility,
					tenant_id: adopted.tenant_id,
					/*
					 * THE RESOLVE ARM ALWAYS RECORDS `adopt-unknown` (core
					 * `service.py` `resolve_source`), never the receipt's earlier
					 * shorthand `adopted`. The key is `baseline_state`.
					 */
					baseline_state: "adopt-unknown",
					scope_known: true,
				},
			});
		}
	}
	if (method === "GET" && pathname === "/v1/desktop/skills") {
		return ok({
			data: {
				skills: [
					{
						name: "release-notes",
						description: "Draft release notes from a merged PR list.",
					},
					{
						name: "transcript-audit",
						description: "Audit a transcript for policy contradictions.",
					},
				],
			},
		});
	}
	/*
	 * The PUBLIC hub routes this build dials (VITE_RADIENT_SERVER_BASE_URL at
	 * build time; the README says a bare `pnpm build` tree must never drive the
	 * scene). Their envelope is the hub's own bare `{msg, result}`, NOT the
	 * daemon's `{result}` wrapper.
	 */
	if (method === "GET" && pathname === "/v1/agents") {
		return publicOk({
			page: 1,
			per_page: 12,
			total_pages: 1,
			total_records: 0,
			records: [],
		});
	}
	if (method === "GET" && pathname === "/v1/teams") {
		return publicOk({
			page: 1,
			per_page: 12,
			total_pages: 1,
			total_records: 0,
			records: [],
		});
	}
	if (method === "GET" && pathname === "/v1/skills") {
		await skillsSleep(SKILLS_LATENCY_MS);
		const records = SKILLS_REMOTE_EMPTY ? [] : PUBLIC_SKILLS;
		return publicOk({
			page: 1,
			per_page: 20,
			total_pages: 1,
			total_records: records.length,
			records,
			sync_contract: skillContract(),
		});
	}
	const publicSkillMatch = pathname.match(/^\/v1\/skills\/([^/]+)$/);
	if (method === "GET" && publicSkillMatch) {
		await skillsSleep(SKILLS_LATENCY_MS);
		const row = PUBLIC_SKILLS.find(
			(entry) => entry.id === decodeURIComponent(publicSkillMatch[1]),
		);
		return row
			? publicOk(skillDetail(row))
			: { status: 404, body: { msg: "not found" } };
	}
	if (method === "POST" && pathname === "/v1/desktop/hub/skills/pull") {
		await skillsSleep(PULL_LATENCY_MS);
		// A public read/copy is not an opt-in to future automatic publication.
		// Refuse only the actual unsafe policy enablement, before inventory writes.
		if (
			body?.visibility === "public" &&
			body?.auto_push === true &&
			body?.confirm_public_egress !== true
		)
			return {
				status: 422,
				body: {
					detail: {
						code: "unsafe-publication",
						message: "explicit future public publication consent is required",
					},
				},
			};
		if (PULL_OUTCOME === "refuse") {
			return {
				status: 502,
				body: { detail: "the stub refuses this pull (--pull-outcome=refuse)" },
			};
		}
		const alias = body?.local_alias ?? "skill-copy";
		const created = skillLink({
			linkId: `link-skill-${alias}`,
			alias,
			hubId: body?.hub_id ?? "hub-skill-stub",
			visibility: body?.visibility ?? "org",
			tenantId: body?.tenant_id ?? null,
			subscribe: body?.subscribe ?? true,
			autoPush: body?.auto_push ?? false,
		});
		links.push(created);
		return ok({
			reports: [
				{
					kind: "skill",
					link_id: created.link_id,
					direction: "pull",
					operation_id: "op-skill-pull-1",
					remote_revision: "rev-remote-1",
					model_used: null,
					applied: true,
					outcome: "applied",
				},
			],
			link: created,
			links: { links, unresolved },
		});
	}
	if (method === "POST" && pathname === "/v1/desktop/hub/skills/publish") {
		if (body?.dry_run === true) {
			return ok({
				preview: {
					preview_receipt: "receipt-stub-1",
					kind: "skill",
					direction: "push",
					publication: "create",
					source_skill: body?.source_skill ?? "release-notes",
					local_alias: body?.local_alias ?? "release-notes-copy",
					hub_source: SOURCE,
					visibility: body?.visibility ?? "org",
					tenant_id: body?.tenant_id ?? null,
					local_fingerprint: "fp-local-1",
					draft_fingerprint: "fp-draft-1",
					proposal_fingerprint: "fp-proposal-1",
					expires_at: new Date(Date.now() + 600_000).toISOString(),
					policy: {
						subscribe: body?.subscribe === true,
						auto_push: body?.auto_push === true,
						confirm_public_egress: body?.confirm_public_egress === true,
					},
					proposal: {
						kind: "skill",
						fields: {
							document_version: 1,
							name: body?.local_alias ?? "release-notes-copy",
							description: "Stub skill for the evidence run.",
							files: [{ path: "SKILL.md", content: "# stub\n" }],
						},
					},
					warnings: [],
					can_confirm: true,
					reason: null,
				},
				link: null,
				local_link_receipt: null,
				publication: null,
			});
		}
		// Preview above is side-effect-free and may explain an unconsented draft.
		// Confirmation that enables future public auto-push must carry consent.
		if (
			body?.visibility === "public" &&
			body?.auto_push === true &&
			body?.confirm_public_egress !== true
		)
			return {
				status: 422,
				body: {
					detail: {
						code: "unsafe-publication",
						message: "explicit future public publication consent is required",
					},
				},
			};
		if (PUBLISH_OUTCOME === "pending") {
			return ok({
				preview: null,
				link: null,
				local_link_receipt: {
					state: "pending-reconciliation",
					operation_id: "op-publish-pending-1",
					link_id: null,
					safe_message: "local reconciliation pending (stub)",
				},
				publication: null,
			});
		}
		const alias = body?.local_alias ?? "release-notes-copy";
		const created = skillLink({
			linkId: `link-skill-pub-${alias}`,
			alias,
			hubId: "hub-skill-pub-stub",
			visibility: body?.visibility ?? "org",
			tenantId: body?.tenant_id ?? null,
			subscribe: body?.subscribe === true,
			autoPush: body?.auto_push === true,
		});
		links.push(created);
		return ok({
			preview: null,
			link: created,
			local_link_receipt: {
				state: "complete",
				operation_id: "op-publish-1",
				link_id: created.link_id,
				safe_message: null,
			},
			publication: {
				skill: { id: "skill-pub-1", name: alias },
				accepted_document: {
					document_version: 1,
					name: alias,
					description: "Stub skill for the evidence run.",
					files: [{ path: "SKILL.md", content: "# stub\n" }],
				},
				revision: '"rev-pub-1"',
				content_revision: 1,
				operation_id: "op-publish-1",
				sync_contract: { revision_cas: 1, skills: 1 },
			},
		});
	}
	return {
		status: 503,
		body: { detail: `the stub has no answer for ${method} ${pathname}` },
	};
};

const server = createServer((request, response) => {
	const chunks = [];
	request.on("data", (chunk) => chunks.push(chunk));
	request.on("end", async () => {
		const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
		let body = null;
		if (chunks.length > 0) {
			try {
				body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			} catch {
				body = null;
			}
		}
		const answer = await route(
			request.method ?? "GET",
			url.pathname,
			url.searchParams,
			body,
		);
		process.stderr.write(
			`stub ${request.method} ${url.pathname}${url.search} -> ${answer.status}\n`,
		);
		response.writeHead(answer.status, { "content-type": "application/json" });
		response.end(JSON.stringify(answer.body));
	});
});

server.listen(PORT, "127.0.0.1", () => {
	process.stderr.write(`stub daemon listening on 127.0.0.1:${PORT}\n`);
	if (RECORDS) {
		mkdirSync(RECORDS, { recursive: true });
		const recordPath = join(RECORDS, `${process.pid}.json`);
		const write = () => {
			const now = Date.now() / 1000;
			writeFileSync(
				recordPath,
				JSON.stringify({
					pid: process.pid,
					host: "127.0.0.1",
					port: PORT,
					instance_id: INSTANCE_ID,
					version: CORE_VERSION,
					source_ref: "hub-links-desktop",
					prefix: process.cwd(),
					install_kind: "stub",
					desktop: true,
					claim_key: "stub",
					started_at: startedAt,
					heartbeat_at: now,
				}),
			);
		};
		write();
		/*
		 * The heartbeat is not decoration: `discovery.ts` calls a record with a live
		 * pid and a STOPPED heartbeat `wedged`, and the app then shows a banner over
		 * the very surface these frames are of.
		 */
		setInterval(write, 5_000).unref();
		process.stderr.write(`serve record written to ${RECORDS}\n`);
	}
});
