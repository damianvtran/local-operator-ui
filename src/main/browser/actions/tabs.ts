import { BrowserHostError } from "../errors";
import {
	MAX_AGENT_TABS,
	type TabRecord,
	redactToken,
	surfaceToken,
} from "../registry";
import { safeHttpUrl } from "../vendor/driver/origin-policy";
import {
	type BrowserActionContext,
	requesterOf,
	sessionIdOf,
	stringParam,
} from "./context";
import { navigateView, pageOf } from "./gate";

/**
 * The tab-level actions: `open`, `goto`, `close`, `tabs`, `status`, `retitle`.
 * Design: docs/design/ui-browser-tab.md 4 (the matrix), 6.2-6.5, 7.3, 10.1.
 *
 * The two rules that shape this file:
 *
 * - An agent `open` NEVER changes which tab the user is looking at (§11.4). The
 *   new tab is appended and marked; the user's current tab stays active. This is
 *   the extension's `chrome.tabs.create({active: false})` equivalent and it is a
 *   focus-safety property, not a preference.
 * - An unhanded tab cannot be driven, and a handle with a wrong nonce is refused
 *   identically to a missing tab (§6.3): the nonce is the capability, so a
 *   refusal must not confirm that the tab exists.
 */

/** What `open` returns, and what `goto` echoes: the handle plus the page that is
 * actually showing. */
function openResult(
	record: TabRecord,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	const token = surfaceToken(record);
	const page = pageOf(record.view);
	return {
		tab: token ?? "",
		url: page.url,
		title: page.title,
		owner: record.owner,
		restored: record.restored,
		...extra,
	};
}

/**
 * `open`: a NEW tab, or the resume of one whose handle the caller already holds.
 *
 * Two explicit modes, decided by the caller's `tab` param, exactly as the
 * extension does it:
 * - no `tab` → a brand-new tab and surface. Never reuses an existing one: the old
 *   "reuse whatever surface exists" behaviour meant a second session's `open`
 *   silently stole the first session's tab mid-task.
 * - `tab` → resume that tab (design 4: "a pinned `ui:` handle resumes its tab").
 *   This is also how a hand-over is taken: the user hands a tab to a session, the
 *   session's `tabs` listing then shows it with a full handle, and the session
 *   calls `open` with that handle.
 *
 * A `url` is OPTIONAL in both modes. Absent means "do not navigate": the tab is
 * resumed where it stands, which is what taking a handed-over tab means. It is
 * deliberately NOT implemented as "navigate to about:blank" — that is not an
 * http(s) URL, so the scheme rule refuses it, and blanking a document the user is
 * looking at would be a surprising side effect of a read-only intent.
 */
export async function open(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
	requestId: string,
): Promise<Record<string, unknown>> {
	const requester = requesterOf(params, requestId);
	const handle = stringParam(params, "tab");
	const rawUrl = stringParam(params, "url");
	// NO URL IS A REAL REQUEST, not a missing argument: it is how a handed-over tab
	// is taken (design 6.3) and how a session resumes a tab it already holds without
	// moving it. The tab's own `about:blank` pre-navigation document is supplied by
	// the driver when it needs one, so what is decided here is whether to NAVIGATE —
	// and that must not be answered by pointing the tab at `about:blank`, which is
	// not an http(s) URL and would be refused by the scheme rule.
	const url = rawUrl ? safeHttpUrl(rawUrl) : null;
	// Admission is decided ONCE, here, before the page is touched. A grant consumed
	// at entry is spent; the gate below must not consult the grant map again or a
	// TTL lapse mid-command could turn a granted navigation into a refusal.
	const admission = url ? ctx.approvals.admit(url, requester) : null;
	const approved =
		admission?.approved ??
		((candidate: URL) => ctx.approvals.originAllowed(candidate));

	if (handle) {
		const record = ctx.registry.requireSurface(handle);
		record.allocationId =
			stringParam(params, "allocation_id") || record.allocationId;
		if (!url) {
			const current = safeHttpUrl(record.view.webContents.getURL());
			if (!current)
				throw new BrowserHostError(
					"origin_not_allowed",
					"the handed-over tab has no approved HTTP document",
				);
			const token = surfaceToken(record) ?? "";
			if (
				!ctx.approvals.documentAllowed(token, current, requester, record.epoch)
			) {
				const permission = ctx.approvals.admit(current, requester);
				ctx.approvals.rememberDocument(
					token,
					current,
					requester,
					record.documentEpoch,
					permission.approved,
				);
			}
		}
		await ctx.cdp.attach(record.view.webContents);
		const page = url
			? await navigateView(ctx, record.view, url, requester, approved)
			: pageOf(record.view);
		if (url)
			ctx.approvals.rememberDocument(
				surfaceToken(record) ?? "",
				new URL(page.url),
				requester,
				record.documentEpoch,
				approved,
			);
		ctx.registry.touch(record);
		ctx.onChanged();
		return openResult(record, {
			...page,
			...(admission
				? { via: admission.viaOnceGrant ? "once_grant" : "stored_grant" }
				: { resumed: true }),
		});
	}

	const record = ctx.registry.create({
		owner: "agent",
		sessionId: sessionIdOf(requester) || requester,
		allocationId: stringParam(params, "allocation_id"),
	});
	// Publish the capability before the first await so failure/recovery sees the
	// actual allocation, never an empty reservation hiding a live view.
	ctx.ownership.recordAllocation(
		params,
		surfaceToken(record) ?? "",
		"allocated",
	);
	try {
		await ctx.cdp.attach(record.view.webContents);
		const page = url
			? await navigateView(ctx, record.view, url, requester, approved)
			: pageOf(record.view);
		if (url)
			ctx.approvals.rememberDocument(
				surfaceToken(record) ?? "",
				new URL(page.url),
				requester,
				record.documentEpoch,
				approved,
			);
		ctx.registry.touch(record);
		ctx.onChanged();
		return openResult(record, {
			...page,
			limit: MAX_AGENT_TABS,
		});
	} catch (error) {
		// A tab that could not be navigated must not be left behind: the agent has
		// no handle for it (the `open` failed), so nothing could ever close it.
		ctx.registry.destroy(record.tabId);
		ctx.ownership.recordAllocation(params, "", "closed");
		throw error;
	}
}

/**
 * `goto`: navigate a tab the caller already holds.
 *
 * Gated on the way in, and the gate reports the failure with the origin it
 * refused. An unapproved origin is refused BEFORE the navigation — the design's
 * early `origin_not_allowed`, so the agent can run `request_access` → notify →
 * `await_access` rather than blocking on a prompt nobody is watching.
 */
export async function goto(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
	requestId: string,
): Promise<Record<string, unknown>> {
	const requester = requesterOf(params, requestId);
	const record = ctx.registry.requireSurface(params.tab);
	const url = safeHttpUrl(stringParam(params, "url"));
	const admission = ctx.approvals.admit(url, requester);
	const approved = admission.approved;
	await ctx.cdp.attach(record.view.webContents);
	const page = await navigateView(ctx, record.view, url, requester, approved);
	ctx.approvals.rememberDocument(
		surfaceToken(record) ?? "",
		new URL(page.url),
		requester,
		record.documentEpoch,
		approved,
	);
	ctx.registry.touch(record);
	ctx.onChanged();
	return {
		...page,
		tab: surfaceToken(record) ?? "",
		via: admission.viaOnceGrant ? "once_grant" : "stored_grant",
	};
}

/**
 * `close`: destroy a tab.
 *
 * With a handle, exactly that tab. Without one, the sole tab if there is exactly
 * one; with several, `tab_ambiguous` naming them by REDACTED handle — guessing
 * which tab another session still needs is precisely the hijack the per-tab model
 * removes, and naming full handles here would let any session close any tab.
 */
export async function close(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const handle = stringParam(params, "tab");
	if (handle) {
		const record = ctx.registry.requireSurface(handle);
		const closed = surfaceToken(record) ?? handle;
		ctx.approvals.forgetDocument(closed);
		ctx.registry.destroy(record.tabId);
		ctx.onChanged();
		return { closed };
	}
	const tabs = ctx.registry.list();
	if (tabs.length === 0) {
		throw new BrowserHostError("tab_closed", "no browser tab is open");
	}
	if (tabs.length > 1) {
		const redacted = tabs
			.map((record) => {
				const token = surfaceToken(record);
				return token ? redactToken(token) : `ui:${record.tabId}:no-handle`;
			})
			.join(", ");
		throw new BrowserHostError(
			"tab_ambiguous",
			`several tabs are open (${redacted}) — pass the handle of the one to close`,
			{ tabs: tabs.length },
		);
	}
	const [record] = tabs;
	if (!record)
		throw new BrowserHostError("tab_closed", "no browser tab is open");
	const closed = surfaceToken(record) ?? "";
	ctx.registry.destroy(record.tabId);
	ctx.onChanged();
	return { closed };
}

/**
 * `tabs`: the registry, as the agent may see it.
 *
 * Every tab is listed — the user's too — because awareness is the point: a
 * session hitting the agent-tab cap needs to see what is open. Handles are
 * REDACTED per the existing rule, with one exception: a tab this calling session
 * already holds (its own, or one handed to it) is shown in FULL, because that is
 * the handle `open` takes and hiding it would make the hand-over unusable. The
 * full handle is never sent for anyone else's tab, which is what keeps the
 * listing awareness-only.
 */
export async function tabs(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
	requestId: string,
): Promise<Record<string, unknown>> {
	const requester = requesterOf(params, requestId);
	const sessionId = sessionIdOf(requester);
	const entries = ctx.registry.list().map((record) => {
		const token = surfaceToken(record);
		const mine = !!token && ctx.registry.mayDrive(record, sessionId);
		const page = pageOf(record.view);
		return {
			tab: mine ? (token as string) : token ? redactToken(token) : "",
			url: page.url,
			title: page.title,
			lastUsedAt: record.lastUsedAt,
			createdAt: record.createdAt,
			// Additive fields the tool ignores today; they are what PR 2's copy
			// change reads to say "(handed to you)" instead of guessing from a
			// prefix. Sending them now costs nothing and saves a second wire change.
			owner: record.owner,
			active: ctx.registry.activeTab?.tabId === record.tabId,
			handed_to_you: record.handedTo !== null && record.handedTo === sessionId,
			restored: record.restored,
		};
	});
	return {
		tabs: entries,
		limit: MAX_AGENT_TABS,
		agent_tabs: ctx.registry.agentTabCount(),
		total: entries.length,
	};
}

/**
 * `status`: the host's own state, for `lop browser status` and for QA.
 *
 * `profile_dir` is the resolved `ses.getStoragePath()`, published so "where are
 * my logins kept" is one command rather than a document (design 5.3), and
 * `domain_scope` exists so "why is there no broad-domain option" has an answer
 * instead of being an unexplained absence (see `vendor/driver/origin-policy.ts`).
 */
export async function status(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
	requestId: string,
): Promise<Record<string, unknown>> {
	const requester = requesterOf(params, requestId);
	const sessionId = sessionIdOf(requester);
	const facts = ctx.facts();
	return {
		proto: facts.proto,
		host: "ui",
		app_version: facts.appVersion,
		profile_dir: facts.profileDir,
		profile_persistent: facts.profilePersistent,
		tabs: ctx.registry.count(),
		agent_tabs: ctx.registry.agentTabCount(),
		agent_limit: MAX_AGENT_TABS,
		user_agent: facts.userAgent,
		domain_scope: facts.domainScope,
		approvals: ctx.approvals.describe(),
		ownership: ctx.ownership.describe(),
		surfaces: ctx.registry.snapshot().map((entry) => ({
			tab: entry.handle,
			url: entry.url,
			title: entry.title,
			owner: entry.owner,
			active: entry.active,
			restored: entry.restored,
			handed_to_you: entry.handedTo === sessionId,
		})),
	};
}

/**
 * `retitle`: served as a no-op, never called.
 *
 * The UI host has no tab GROUPS, so there is nothing to retitle: the tab's label
 * is the page title, which is strictly more informative than a session title
 * (design 4). Answered rather than refused so a session that sends it anyway does
 * not read an error for a method the wire advertises.
 */
export function retitle(): Record<string, unknown> {
	return {
		state: "noop",
		reason: "the browser tab is labelled with the page title",
	};
}
