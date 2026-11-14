/**
 * SETTINGS → PHONE ACCESS → "USING YOUR OWN TUNNEL?" → Show phone password
 * (pairing design v2 §4.1 / D10; core local-operator #3963,
 * `features.mobile_password_read`, `GET /v1/desktop/mobile/password`).
 *
 * WHY IT EXISTS. A person who brings their own tunnel signs the phone in with
 * this computer's phone password - the value `lop mobile password` prints. Until
 * now the desktop could only send them to a terminal for it. Most people reach
 * their computer through their Radient account and never need it, so it sits
 * behind a collapsed disclosure.
 *
 * WHY IT IS SHAPED LIKE THIS - it is a secret, and each rule is load-bearing:
 *
 * - READ ON CLICK ONLY. Opening the disclosure reads nothing; the request goes
 *   out when the person presses "Show phone password", and at no other time. It
 *   is a plain call, not a React Query query or mutation, so the value never
 *   sits in a cache that outlives this view (a mutation keeps its last `data`
 *   until garbage collection).
 * - MASKED BY DEFAULT. After the read the value is drawn as a fixed run of dots
 *   (not one per character, so its length is not shown either) until the person
 *   presses Show; Copy works without revealing it.
 * - CLEARED FROM MEMORY when the disclosure collapses or the view unmounts. The
 *   app's `Disclosure` unmounts its content while closed, so the panel and the
 *   state holding the value are gone with it (the test collapses and asserts the
 *   panel left the tree); the `mounted` guard below stops a reply that lands
 *   after the collapse from being stored anywhere.
 * - NEVER LOGGED, in the renderer or in main: nothing here writes to the
 *   console, the transport logs no bodies, and `scripts/phone-pairing.test.mjs`
 *   asserts the value appears in no console call across a successful read.
 * - 404 `mobile_password_unset` is a plain "No phone password is set", not an
 *   error; any other failure is a keyed retry line, never a raw message.
 * - Without the capability the disclosure is not rendered at all (the caller
 *   checks `features.mobile_password_read`), and the route is never called.
 */

import {
	DesktopControlError,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import { Button } from "@shared/components/ui";
import { Disclosure } from "@shared/components/ui/disclosure";
import { t } from "@shared/i18n";
import { type FC, useEffect, useRef, useState } from "react";

/** Core's stable refusal code for "no password set" (`PASSWORD_UNSET`). */
const PASSWORD_UNSET = "mobile_password_unset";

/** The masked rendering: fixed length, so the dots say nothing about the value. */
const MASK = "••••••••••••";

/** How long "Copied" replaces "Copy" before the button reads Copy again. */
const COPIED_FOR_MS = 2_000;

/** The password, or null when core says none is set. Throws on anything else. */
export type PhonePasswordReader = () => Promise<string | null>;

/** The real read: `GET /v1/desktop/mobile/password`, on demand only. */
export const readPhonePassword: PhonePasswordReader = async () => {
	try {
		const result = await desktopResult<{ password?: unknown }>({
			op: "mobile.password",
		});
		const password = result?.password;
		if (typeof password !== "string" || !password) return null;
		return password;
	} catch (failure) {
		if (
			failure instanceof DesktopControlError &&
			failure.code === PASSWORD_UNSET
		)
			return null;
		throw failure;
	}
};

type ReadState =
	| { kind: "idle" }
	| { kind: "reading" }
	| { kind: "unset" }
	| { kind: "error" }
	| { kind: "read"; password: string };

/** A pinned starting state, for stories only - the app always starts unread. */
export type PhonePasswordInitial = {
	password?: string;
	revealed?: boolean;
	state?: "unset" | "error";
};

function initialState(initial: PhonePasswordInitial | undefined): ReadState {
	if (initial?.password) return { kind: "read", password: initial.password };
	if (initial?.state) return { kind: initial.state };
	return { kind: "idle" };
}

/** The disclosure's content: mounted only while open, so collapsing drops it. */
const PhonePasswordPanel: FC<{
	read: PhonePasswordReader;
	initial?: PhonePasswordInitial;
}> = ({ read, initial }) => {
	const [state, setState] = useState<ReadState>(() => initialState(initial));
	const [revealed, setRevealed] = useState(Boolean(initial?.revealed));
	const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			// A reply that lands after the collapse is dropped, never stored.
			mounted.current = false;
		};
	}, []);
	useEffect(() => {
		if (copy !== "copied") return;
		const timer = setTimeout(() => setCopy("idle"), COPIED_FOR_MS);
		return () => clearTimeout(timer);
	}, [copy]);

	const onRead = () => {
		setState({ kind: "reading" });
		setRevealed(false);
		setCopy("idle");
		read().then(
			(password) => {
				if (!mounted.current) return;
				setState(password ? { kind: "read", password } : { kind: "unset" });
			},
			() => {
				if (mounted.current) setState({ kind: "error" });
			},
		);
	};

	const onCopy = (password: string) => {
		setCopy("idle");
		Promise.resolve()
			.then(() => navigator.clipboard.writeText(password))
			.then(
				() => mounted.current && setCopy("copied"),
				() => mounted.current && setCopy("failed"),
			);
	};

	return (
		<div className="flex flex-col gap-2" data-testid="phone-password-panel">
			<p className="text-meta text-ink-muted">
				{t("ui.phone_pairing.password.body")}
			</p>
			{state.kind === "read" ? (
				<div className="flex flex-col gap-1">
					<span className="text-meta text-ink">
						{t("ui.phone_pairing.password.label")}
					</span>
					<div className="flex flex-wrap items-center gap-2">
						{revealed ? (
							<code
								// A password is a left-to-right token whatever the interface
								// language; isolated so an RTL sentence cannot reorder it.
								dir="ltr"
								style={{ unicodeBidi: "isolate" }}
								className="break-all rounded-sm bg-sunken px-2 py-1 font-mono text-body-sm text-ink"
								data-testid="phone-password-value"
							>
								{state.password}
							</code>
						) : (
							<span
								role="img"
								aria-label={t("ui.phone_pairing.password.masked_aria")}
								className="rounded-sm bg-sunken px-2 py-1 font-mono text-body-sm text-ink"
								data-testid="phone-password-masked"
							>
								{MASK}
							</span>
						)}
						<Button
							type="button"
							variant="secondary"
							size="sm"
							aria-pressed={revealed}
							onClick={() => setRevealed((value) => !value)}
							data-testid="phone-password-toggle"
						>
							{revealed
								? t("ui.phone_pairing.password.hide")
								: t("ui.phone_pairing.password.show")}
						</Button>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => onCopy(state.password)}
							data-testid="phone-password-copy"
						>
							{copy === "copied"
								? t("ui.phone_pairing.password.copied")
								: t("ui.phone_pairing.password.copy")}
						</Button>
					</div>
					{copy === "failed" ? (
						<p className="text-meta text-danger" role="alert">
							{t("ui.phone_pairing.password.copy_failed")}
						</p>
					) : null}
				</div>
			) : (
				<div className="flex flex-col items-start gap-2">
					<Button
						type="button"
						variant="secondary"
						size="sm"
						disabled={state.kind === "reading"}
						onClick={onRead}
						data-testid="phone-password-read"
					>
						{t("ui.phone_pairing.password.read")}
					</Button>
					{state.kind === "unset" ? (
						<output
							className="block text-meta text-ink-muted"
							data-testid="phone-password-unset"
						>
							{t("ui.phone_pairing.password.unset")}
						</output>
					) : state.kind === "error" ? (
						<p
							className="text-meta text-danger"
							role="alert"
							data-testid="phone-password-error"
						>
							{t("ui.phone_pairing.password.error")}
						</p>
					) : null}
				</div>
			)}
		</div>
	);
};

export type PhonePasswordDisclosureProps = {
	/** Injected by stories and tests; the real read otherwise. */
	read?: PhonePasswordReader;
	/** Open from the start (stories only); the app always starts collapsed. */
	defaultOpen?: boolean;
	/** A pinned panel state (stories only). */
	initial?: PhonePasswordInitial;
};

/** "Using your own tunnel?" - collapsed by default, the password behind a click. */
export const PhonePasswordDisclosure: FC<PhonePasswordDisclosureProps> = ({
	read = readPhonePassword,
	defaultOpen = false,
	initial,
}) => (
	<div data-testid="phone-password-disclosure">
		<Disclosure
			summary={t("ui.phone_pairing.password.disclosure")}
			defaultOpen={defaultOpen}
		>
			<PhonePasswordPanel read={read} initial={initial} />
		</Disclosure>
	</div>
);
