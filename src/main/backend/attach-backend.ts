/**
 * The harness affordance that points this app at a backend it did not launch.
 *
 * WHY THIS EXISTS. The desktop app owns and installs its own runtime: with no
 * usable managed environment it boots `out/renderer/installer.html` and runs
 * `BackendInstaller.prepareAndInstall`, which needs a network download. There
 * was therefore no supported way to point the compiled app at a backend that is
 * already serving, and that left a whole class of headless QA unmeasurable - a
 * real blocking-ask state, for instance, could not be photographed in the real
 * app at all, only in Storybook. This module is the smallest thing that makes
 * the app attachable: two facts from the launch, and the decision below.
 *
 * WHAT IS DELIBERATELY NOT HERE. `docs/design/any-daemon-attach.md` is the full
 * contract - a pairing verb, version-skew negotiation, "manage my server"
 * rework - and it states its own status as "design contract, implementation not
 * included". None of that is implemented by this module, and its presence in the
 * tree is not a licence to read this as a step towards it: this attaches to an
 * ALREADY-PAIRED backend named by an environment variable, and it does not
 * discover, claim, pair, upgrade or repair anything.
 *
 * REMOVE IT when the attach path has a first-class home. The exit condition is
 * named rather than left to taste: when `docs/design/any-daemon-attach.md` is
 * implemented, a user-facing attach target exists, and a harness sets that
 * instead of an environment variable. Until then the two variables are the only
 * thing standing between the real app and a state a rig cannot reach.
 *
 * WHY THE NAMES. `LOCAL_OPERATOR_UI_*` is this app's own namespace, not core's:
 * `LOCAL_OPERATOR_UI_WINDOW_MODE`, `LOCAL_OPERATOR_UI_SMOKE_TEST` and
 * `LOCAL_OPERATOR_UI_TELEMETRY` are already launch facts that only the desktop
 * app reads, while `LOCAL_OPERATOR_CONFIG_DIR` and `LOCAL_OPERATOR_DESKTOP_TOKEN`
 * are read by core as well. A name in the `UI_` family says which side of that
 * line it falls on, and `ATTACH_BACKEND` says what it is for without promising
 * that it is a supported switch. The credential is deliberately NOT a new name:
 * `LOCAL_OPERATOR_DESKTOP_TOKEN` is the token this app already authenticates
 * with (`backend-service.ts`, `desktopToken`), so an attach reuses it rather
 * than becoming a second credential for the same handshake.
 */
import { launchEnv } from "./launch-env";

/**
 * The backend to attach to, e.g. `http://127.0.0.1:4711`.
 *
 * Read from `launchEnv` rather than `process.env`, and that is load-bearing:
 * `backend/config.ts` folds a `.env` from the working directory into
 * `process.env` with `override: true`, so a checkout's own `.env` would decide
 * where the operator's real app connects. This is a launch fact - "the operator
 * or a rig said this" - which is exactly the class `launchEnv` exists for.
 */
export const ATTACH_BACKEND_URL_VARIABLE =
	"LOCAL_OPERATOR_UI_ATTACH_BACKEND_URL";

/**
 * The credential the attach uses. Spelled once here so the module that reads it
 * and this decision cannot drift.
 */
export const ATTACH_BACKEND_TOKEN_VARIABLE = "LOCAL_OPERATOR_DESKTOP_TOKEN";

export type BackendAttach =
	/** Nothing asked to attach: the managed-runtime path, byte for byte. */
	| { kind: "managed" }
	/** Attach to `baseUrl` with the desktop token this app already holds. */
	| { kind: "attach"; baseUrl: string }
	/**
	 * A launch that asked to attach and cannot be honoured. Never resolved by
	 * installing a runtime instead: a rig that silently got a *managed* backend
	 * where it named a specific one is measuring something it did not choose, and
	 * its evidence would be about the wrong daemon.
	 */
	| {
			kind: "incomplete";
			reason: "token-missing" | "url-invalid";
			/** One sentence a person can act on. Never contains the token. */
			detail: string;
	  };

/**
 * Decide what this launch does about its backend, from the launch environment.
 *
 * THE URL IS THE OPT-IN, and the asymmetry with the token is deliberate rather
 * than an oversight: `LOCAL_OPERATOR_DESKTOP_TOKEN` alone is an EXISTING legal
 * configuration - it is how an externally paired app is launched, and the
 * existing rigs set it with no URL at all (`scripts/renderer-driver.mjs`,
 * `scripts/sidebar-layout-scene.mjs`). Treating a lone token as "half-set" would
 * refuse every one of those launches. A URL with no token is the opposite case:
 * something asked for a specific backend and the credential that opens it is
 * missing, which is a configuration error this app cannot guess its way out of.
 *
 * The result carries NO token value - only whether one is present - so a caller
 * that logs the decision, or a test that asserts on it, cannot leak the
 * credential into a log, a renderer, or an evidence fixture.
 */
export function resolveBackendAttach(
	env: Record<string, string | undefined>,
): BackendAttach {
	const rawUrl = env[ATTACH_BACKEND_URL_VARIABLE]?.trim();
	if (!rawUrl) return { kind: "managed" };
	const token = env[ATTACH_BACKEND_TOKEN_VARIABLE]?.trim();
	if (!token) {
		return {
			kind: "incomplete",
			reason: "token-missing",
			detail: `${ATTACH_BACKEND_URL_VARIABLE} names a backend to attach to, but ${ATTACH_BACKEND_TOKEN_VARIABLE} is not set, so this app has no credential for it.`,
		};
	}
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		return {
			kind: "incomplete",
			reason: "url-invalid",
			detail: `${ATTACH_BACKEND_URL_VARIABLE} is not a URL (${rawUrl}); expected an origin such as http://127.0.0.1:1111.`,
		};
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return {
			kind: "incomplete",
			reason: "url-invalid",
			detail: `${ATTACH_BACKEND_URL_VARIABLE} must be http or https, not ${parsed.protocol.replace(":", "")}.`,
		};
	}
	/*
	 * An ORIGIN, not a link to somewhere inside the daemon. Every request this
	 * app makes resolves its own path against the base (`/v1/desktop`, `/health`,
	 * the SSE relay), so a path here would be silently dropped by most call sites
	 * and honoured by none - refusing it names the mistake instead of shipping a
	 * base URL that means two things.
	 */
	if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
		return {
			kind: "incomplete",
			reason: "url-invalid",
			detail: `${ATTACH_BACKEND_URL_VARIABLE} must be an origin with no path or query (${rawUrl}); expected e.g. http://127.0.0.1:1111.`,
		};
	}
	return { kind: "attach", baseUrl: parsed.origin };
}

/** This launch's decision, from the environment it was LAUNCHED with. */
export function resolveBackendAttachForThisProcess(): BackendAttach {
	return resolveBackendAttach(launchEnv);
}
