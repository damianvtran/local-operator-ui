/**
 * The card's join rule, pinned without React: a catalogue row and a local link
 * are two facts from two services, and every displayed state is a function of
 * them plus the updates store. No renderer, no transport, no hub.
 *
 * What this does NOT prove: the server's own admission (core refuses a foreign
 * row before bytes), a real link's wire shape, or anything about how the state
 * is drawn. `hub-skills-capability.test.mjs` covers the mounted hooks and QA owns
 * the rendered surface.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundled = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/agent-hub/hub-skill-state"; export {hubLinkContentState} from "./src/renderer/src/shared/api/local-operator/hub-links"; export {hubSourceAddress} from "./src/renderer/src/shared/api/radient/hub-source";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	write: false,
	format: "esm",
	platform: "node",
	logLevel: "silent",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
});
const {
	hubSkillKey,
	hubSkillLinkIndex,
	hubSkillState,
	hubLinkContentState,
	hubSourceAddress,
	skillPullRequestKey,
	skillRowInScope,
	skillSubscribeAct,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const ORIGIN = "https://hub.example";

const link = (over = {}) => ({
	link_id: "link-1",
	kind: "skill",
	local_id: "example-skill",
	name: "example-skill",
	hub_id: "skill-1",
	hub_source: ORIGIN,
	visibility: "public",
	tenant_id: null,
	tenant_name: null,
	policy: { subscribe: true, auto_push: false, revision: "r1" },
	eligibility: { can_auto_push: false, reason: null },
	baseline_state: "pull",
	remote_revision: "rev-1",
	content_state: "present",
	local_path: "/home/person/.local/share/local-operator/skills/example-skill",
	auto_will_apply: false,
	auto_will_push: false,
	pull: { state: "idle" },
	push: { state: "idle" },
	...over,
});

test("a catalogue row is in scope only under its own visibility and tenant", () => {
	const publicScope = { visibility: "public", tenantId: null };
	const orgScope = { visibility: "org", tenantId: "org-minerva" };
	assert.equal(
		skillRowInScope({ id: "a", visibility: "public" }, publicScope),
		true,
	);
	assert.equal(
		skillRowInScope(
			{ id: "a", visibility: "public", tenant_id: "org-minerva" },
			publicScope,
		),
		false,
		"a public row naming a tenant is not a public row",
	);
	assert.equal(
		skillRowInScope(
			{ id: "a", visibility: "org", tenant_id: "org-minerva" },
			orgScope,
		),
		true,
	);
	assert.equal(
		skillRowInScope(
			{ id: "a", visibility: "org", tenant_id: "org-other" },
			orgScope,
		),
		false,
		"another tenant's row never renders in this scope",
	);
	assert.equal(
		skillRowInScope({ id: "a", visibility: "public" }, orgScope),
		false,
		"a public row never fills an org-scope card",
	);
});

test("identity is hub id plus source scope, never the id alone", () => {
	const a = hubSkillKey({
		id: "skill-1",
		visibility: "public",
		tenantId: null,
	});
	const b = hubSkillKey({
		id: "skill-1",
		visibility: "org",
		tenantId: "org-minerva",
	});
	const c = hubSkillKey({
		id: "skill-1",
		visibility: "org",
		tenantId: "org-other",
	});
	assert.notEqual(a, b);
	assert.notEqual(b, c);
	assert.equal(
		a,
		hubSkillKey({ hub_id: "skill-1", visibility: "public", tenant_id: null }),
		"the wire spelling joins the catalogue spelling",
	);
});

test("the link index admits one kind and one source, and normalizes a trailing slash", () => {
	const index = hubSkillLinkIndex(
		[
			link(),
			link({ link_id: "agent-link", kind: "agent" }),
			link({ link_id: "other-source", hub_source: "https://other.example" }),
			link({ link_id: "org-link", visibility: "org", tenant_id: "org-x" }),
		],
		`${ORIGIN}/`,
	);
	assert.deepEqual([...index.keys()].sort(), [
		hubSkillKey({
			id: "skill-1",
			visibility: "org",
			tenantId: "org-x",
		}),
		hubSkillKey({ id: "skill-1", visibility: "public", tenantId: null }),
	]);
	assert.equal(index.values().next().value.link_id, "link-1");
	assert.equal(
		hubSkillLinkIndex(undefined, ORIGIN).size,
		0,
		"an old core that lists no skill links yields no links, not a guess",
	);
});

test("a row without content_state reads as present, which is core's own default", () => {
	assert.equal(hubLinkContentState({}), "present");
	assert.equal(hubLinkContentState({ content_state: "present" }), "present");
	assert.equal(hubLinkContentState({ content_state: "absent" }), "absent");
	assert.equal(
		hubLinkContentState({ content_state: "future-state" }),
		"present",
		"an unknown future state is not silently 'uninstalled'",
	);
});

test("the five displayed states derive from link presence, copy presence and subscription", () => {
	assert.deepEqual(hubSkillState(undefined, undefined), {
		kind: "not-present",
	});
	assert.deepEqual(hubSkillState(link(), undefined), {
		kind: "pulled",
		link: link(),
	});
	assert.deepEqual(
		hubSkillState(link({ policy: { subscribe: false } }), undefined),
		{ kind: "manual", link: link({ policy: { subscribe: false } }) },
	);
	assert.deepEqual(
		hubSkillState(
			link({
				content_state: "absent",
				local_path: null,
				policy: { subscribe: true },
			}),
			undefined,
		),
		{
			kind: "subscribed",
			link: link({
				content_state: "absent",
				local_path: null,
				policy: { subscribe: true },
			}),
		},
	);
	assert.deepEqual(
		hubSkillState(
			link({
				content_state: "absent",
				local_path: null,
				policy: { subscribe: false },
			}),
			undefined,
		),
		{
			kind: "detached",
			link: link({
				content_state: "absent",
				local_path: null,
				policy: { subscribe: false },
			}),
		},
	);
});

test("an update outranks the presence states, and only for a copy that exists", () => {
	const waiting = link({ pull: { state: "available" } });
	assert.deepEqual(hubSkillState(waiting, undefined), {
		kind: "update",
		link: waiting,
		automatic: false,
	});
	assert.equal(
		hubSkillState(
			link({ pull: { state: "available" }, auto_will_apply: true }),
			{
				kind: "skill",
				name: "example-skill",
				state: "available",
				auto_will_apply: true,
			},
		).automatic,
		true,
		"the backend's own answer decides whether it applies itself",
	);
	assert.equal(
		hubSkillState(link(), {
			kind: "skill",
			name: "example-skill",
			state: "available",
		}).kind,
		"update",
		"the updates store can report the waiting revision too",
	);
	assert.equal(
		hubSkillState(
			link({
				content_state: "absent",
				local_path: null,
				pull: { state: "available" },
			}),
			{ kind: "skill", name: "example-skill", state: "available" },
		).kind,
		"subscribed",
		"nothing is installed, so nothing is 'update available': the next act is a download",
	);
	assert.equal(
		hubSkillState(link(), {
			kind: "skill",
			name: "example-skill",
			state: "applied",
			error_class: null,
		}).kind,
		"pulled",
		"an applied update is a finished fact, not a waiting one",
	);
});

test("an unanswered inventory is unknown, never not-present", () => {
	/*
	 * Review round 1, minor 5: while the links read is loading or has refused,
	 * "no link" is not a fact, so an installed skill must not read "Not
	 * downloaded" and offer a Download the server would refuse.
	 */
	assert.deepEqual(hubSkillState(undefined, undefined, false), {
		kind: "unknown",
	});
	assert.deepEqual(hubSkillState(link(), undefined, false), {
		kind: "unknown",
	});
	assert.deepEqual(hubSkillState(undefined, undefined, true), {
		kind: "not-present",
	});
});

test("the hub source mirrors core's normalisation", () => {
	/*
	 * Review round 1, minor 6: the real export, not a test-local copy. Core
	 * completes a BARE origin with /v1 and leaves a path-bearing base alone.
	 */
	assert.equal(
		hubSourceAddress("http://127.0.0.1:8127"),
		"http://127.0.0.1:8127/v1",
	);
	assert.equal(
		hubSourceAddress("http://127.0.0.1:8127/"),
		"http://127.0.0.1:8127/v1",
	);
	assert.equal(
		hubSourceAddress("https://api.radienthq.com/v1"),
		"https://api.radienthq.com/v1",
	);
	assert.equal(
		hubSourceAddress("https://api.radienthq.com/v1/"),
		"https://api.radienthq.com/v1",
	);
	assert.equal(
		hubSourceAddress("https://gateway.example/hub/radient"),
		"https://gateway.example/hub/radient",
	);
});

test("subscribe takes the policy form when a link exists", () => {
	/* Review round 1, major 1: the create route leaves an existing policy alone. */
	assert.equal(skillSubscribeAct(undefined), "create");
	assert.equal(skillSubscribeAct(link()), "policy");
});

test("the pull request key covers every body-changing field", () => {
	/* Review round 1, major 3: a body change must mint a new id. */
	const base = {
		selected: "skill-1",
		scope: { visibility: "public", tenantId: null },
		localAlias: "release-notes",
		subscribe: false,
		autoPush: false,
		consent: false,
	};
	const key = skillPullRequestKey(base);
	assert.equal(key, skillPullRequestKey({ ...base }));
	assert.notEqual(key, skillPullRequestKey({ ...base, subscribe: true }));
	assert.notEqual(key, skillPullRequestKey({ ...base, autoPush: true }));
	assert.notEqual(key, skillPullRequestKey({ ...base, consent: true }));
	assert.notEqual(key, skillPullRequestKey({ ...base, localAlias: "other" }));
});

test("the scope filter is fail-closed on the public row shape", () => {
	const publicScope = { visibility: "public", tenantId: null };
	assert.equal(
		skillRowInScope(
			{ id: "a", visibility: "public", tenant_id: null },
			publicScope,
		),
		true,
	);
	// The sibling-list convention (publisher tenant, no visibility) is OUT of the
	// public scope: rendering it would be the cross-tenant leak the filter exists
	// to stop, and the server stays authoritative for admission.
	assert.equal(
		skillRowInScope(
			{ id: "b", visibility: "public", tenant_id: "org-1" },
			publicScope,
		),
		false,
	);
	assert.equal(
		skillRowInScope(
			{ id: "c", visibility: undefined, tenant_id: null },
			publicScope,
		),
		false,
	);
	const orgScope = { visibility: "org", tenantId: "org-1" };
	assert.equal(
		skillRowInScope(
			{ id: "d", visibility: "org", tenant_id: "org-1" },
			orgScope,
		),
		true,
	);
	assert.equal(
		skillRowInScope(
			{ id: "e", visibility: "org", tenant_id: "org-2" },
			orgScope,
		),
		false,
	);
});
