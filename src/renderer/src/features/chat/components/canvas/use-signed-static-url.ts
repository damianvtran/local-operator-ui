import {
	type StaticRoute,
	fetchSignedStaticUrl,
} from "@shared/api/local-operator/static-api";
import { useEffect, useState } from "react";

/**
 * The src a route-backed preview should load: a SIGNED static URL where the
 * core can mint one, today's plain URL otherwise.
 *
 * WHY THIS EXISTS (file-serving RFC § 4, Phase A adoption). The core's static
 * routes serve the user's files unclamped on loopback, and a later core phase
 * gates that on a per-boot access token these previews cannot carry: a
 * `<video src>` and an `<iframe src>` are GETs with no header. The core mints
 * short-lived signed URLs instead (`POST /v1/static/sign`), and the app's
 * answer is this hook: ask MAIN - which already holds the desktop bearer - for
 * one, and use it as the src. The renderer never reads a serve record and
 * never sees the token.
 *
 * FALLBACK IS THE CONTRACT, not an error path: old cores (the route answers
 * 404), refused credentials, and a dead transport all land on `plainUrl` -
 * byte for byte the URL this preview used before the adoption - so every core
 * this app has ever shipped against keeps working. `null` while the attempt
 * is in flight, so the element is not mounted against a plain URL that an
 * enforcing core would 401.
 *
 * THE WAIT IS BOUNDED AND SHORT. The transport already bounds the request
 * (`desktopRequestTimeoutMs`), but that bound is sized for a control op and a
 * preview should not sit empty behind a wedged main process: past this bound
 * the plain URL is used, which is exactly the behaviour this app had before
 * signed URLs existed.
 */
const SIGNED_URL_WAIT_MS = 3000;

export function useSignedStaticUrl(options: {
	baseUrl: string;
	route: StaticRoute;
	path: string;
	/** Moves when the document's bytes may have; a change re-signs. */
	version: string;
	/** The URL this preview used before signed URLs existed. */
	plainUrl: string;
	/** Seconds the URL must stay valid; omitted asks for the core's default. */
	ttlS?: number;
}): string | null {
	const { baseUrl, route, path, version, plainUrl, ttlS } = options;
	const [src, setSrc] = useState<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the TRIGGER and not a value the body reads - the effect must re-sign when the document's bytes may have moved under a stable path, which is the whole reason this key is threaded in.
	useEffect(() => {
		/*
		 * A RE-SIGN, not merely a re-fetch. The signed URL embeds its own `exp`
		 * and `sig`, so a version change has to mint a NEW URL: the old one
		 * would keep answering from the browser's cache for a re-created
		 * element (the same reason the plain video URL carries `v=`), and its
		 * replay window would keep decaying without this pass refreshing it.
		 */
		let cancelled = false;
		setSrc(null);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const wait = new Promise<null>((resolve) => {
			timer = setTimeout(() => resolve(null), SIGNED_URL_WAIT_MS);
		});
		Promise.race([fetchSignedStaticUrl(baseUrl, route, path, ttlS), wait])
			.then((signed) => {
				if (cancelled) return;
				setSrc(signed?.url ?? plainUrl);
			})
			.finally(() => clearTimeout(timer));
		return () => {
			/*
			 * The late answer's state write is dropped (React would warn, and a
			 * stale URL could otherwise overwrite a newer version's signed one);
			 * the timer is cleared so a fast answer does not leave one pending.
			 */
			cancelled = true;
			clearTimeout(timer);
		};
	}, [baseUrl, route, path, version, plainUrl, ttlS]);
	return src;
}
