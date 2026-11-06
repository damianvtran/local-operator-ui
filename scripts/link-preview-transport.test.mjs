import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The seam, exercised rather than asserted about: main's real desktop transports,
 * with only the network stubbed.
 *
 * Why this file exists beside the service cases. Those drive a transport double,
 * so they prove the DECISIONS but not the WIRING - that the resolve op reaches
 * `/v1/desktop/team-bridge/link-preview/resolve` as a POST with the receipt in
 * the body, that the artifact op carries `X-Link-Preview-Account` as a HEADER and
 * never in the query string, and that a 429 from the real transport lands on the
 * delay mapping. A double that returned crafted answers would hide a wrong path.
 */
const out = await build({
	stdin: {
		contents: [
			"export * from './src/shared/desktop-contract';",
			"export * from './src/main/desktop-media';",
			"export * from './src/main/link-preview/service';",
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	desktopEndpoint,
	desktopRequestSchema,
	requestDesktopMediaOutcome,
	createLinkPreviewService,
} = await import(
	`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString(
		"base64",
	)}`
);

const transportModule = await import(
	`data:text/javascript;base64,${Buffer.from(
		(
			await build({
				stdin: {
					contents: "export * from './src/main/desktop-transport';",
					resolveDir: process.cwd(),
				},
				bundle: true,
				format: "esm",
				platform: "node",
				write: false,
			})
		).outputFiles[0].text,
	).toString("base64")}`
);
const { requestDesktop } = transportModule;

const BACKEND = "http://127.0.0.1:9";
const TOKEN = "test-bearer";
const ACCOUNT = "acc_01HZZZZZZZZZZZZZZZZZZZZZZZ";
const IMAGE_ID = "fedcba9876543210fedcba9876543210";
const ORIGIN = ["ht", "tps", "://", "example", ".test"].join("");
const REQUEST_URL = `${ORIGIN}/a?q=preview`;

/** Answer the next `fetch` and record what main actually sent. */
function stubFetch(respond) {
	const real = globalThis.fetch;
	const seen = [];
	globalThis.fetch = async (url, init) => {
		seen.push({
			url: String(url),
			method: init?.method,
			headers: init?.headers ?? {},
			body: init?.body ?? null,
		});
		return respond(seen.length);
	};
	return {
		seen,
		restore: () => {
			globalThis.fetch = real;
		},
	};
}

test("the resolve op is a POST to core's route with the receipt in the body", () => {
	const parsed = desktopRequestSchema.safeParse({
		op: "team_bridge.link_preview.resolve",
		url: REQUEST_URL,
		index: 2,
		expectedAccountId: ACCOUNT,
	});
	assert.equal(parsed.success, true);
	// Strict: a client built against a different contract is refused, not guessed at.
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "team_bridge.link_preview.resolve",
			url: REQUEST_URL,
			index: 0,
			expectedAccountId: ACCOUNT,
			tenantId: "t1",
		}).success,
		false,
	);
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "team_bridge.link_preview.resolve",
			url: "x".repeat(5000),
			index: 0,
			expectedAccountId: ACCOUNT,
		}).success,
		false,
	);
	const target = desktopEndpoint(parsed.data);
	assert.equal(target.path, "/v1/desktop/team-bridge/link-preview/resolve");
	assert.equal(target.method, "POST");
	assert.deepEqual(target.body, {
		url: REQUEST_URL,
		index: 2,
		expected_account_id: ACCOUNT,
	});
});

test("a ready answer travels the real resolve transport end to end", async () => {
	const payload = {
		status: 200,
		message: "Link preview.",
		result: {
			kind: "ready",
			preview: {
				url: REQUEST_URL,
				title: "A title",
				siteName: "Example",
				image: { id: IMAGE_ID, mime: "image/jpeg", width: 10, height: 20 },
			},
		},
	};
	const stub = stubFetch(
		() =>
			new Response(JSON.stringify(payload), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
	);
	try {
		const service = createLinkPreviewService({
			transport: {
				request: (input) => requestDesktop(input, BACKEND, TOKEN),
				media: () => assert.fail("no media call belongs in a resolve"),
			},
		});
		const result = await service.resolve({
			url: REQUEST_URL,
			index: 0,
			expectedAccountId: ACCOUNT,
		});
		assert.equal(seen(stub).length, 1);
		const sent = seen(stub)[0];
		assert.equal(
			sent.url,
			`${BACKEND}/v1/desktop/team-bridge/link-preview/resolve`,
		);
		assert.equal(sent.method, "POST");
		assert.equal(sent.headers.Authorization, `Bearer ${TOKEN}`);
		assert.deepEqual(JSON.parse(sent.body), {
			url: REQUEST_URL,
			index: 0,
			expected_account_id: ACCOUNT,
		});
		assert.deepEqual(result, {
			kind: "ready",
			preview: {
				url: REQUEST_URL,
				title: "A title",
				description: null,
				siteName: "Example",
				favicon: null,
				image: { id: IMAGE_ID, mime: "image/jpeg", width: 10, height: 20 },
			},
		});
	} finally {
		stub.restore();
	}
});

function seen(stub) {
	return stub.seen;
}

test("a 429 on the real transport keeps its delay", async () => {
	const stub = stubFetch(
		() =>
			new Response(
				JSON.stringify({
					detail: {
						code: "rate_limited",
						message: "too many",
						retryable: true,
						retry_after_seconds: 3,
					},
				}),
				{ status: 429, headers: { "content-type": "application/json" } },
			),
	);
	try {
		const service = createLinkPreviewService({
			transport: {
				request: (input) => requestDesktop(input, BACKEND, TOKEN),
				media: () => assert.fail("unused"),
			},
		});
		assert.deepEqual(
			await service.resolve({
				url: REQUEST_URL,
				index: 0,
				expectedAccountId: ACCOUNT,
			}),
			{ kind: "error", retryable: true, retryAfterMs: 3000 },
		);
	} finally {
		stub.restore();
	}
});

test("the artifact op sends the account as a header and takes the bytes", async () => {
	const bytes = new Uint8Array([1, 2, 3, 4]);
	const stub = stubFetch(
		() =>
			new Response(bytes, {
				status: 200,
				headers: { "content-type": "image/png" },
			}),
	);
	try {
		const response = await requestDesktopMediaOutcome(
			{
				op: "team_bridge.link_preview.artifact",
				id: IMAGE_ID,
				expectedAccountId: ACCOUNT,
			},
			null,
			BACKEND,
			TOKEN,
		);
		assert.equal(response.answered, true);
		assert.equal(response.response.kind, "bytes");
		assert.equal(response.response.mimeType, "image/png");
		assert.equal(response.response.data.byteLength, 4);

		const sent = seen(stub)[0];
		assert.equal(
			sent.url,
			`${BACKEND}/v1/desktop/team-bridge/link-preview/artifact/${IMAGE_ID}`,
		);
		assert.equal(sent.method, "GET");
		// A HEADER, never a query parameter: a GET's URL is what every intermediary
		// between this process and the daemon writes down.
		assert.equal(sent.headers["X-Link-Preview-Account"], ACCOUNT);
		assert.ok(!sent.url.includes(ACCOUNT));
		assert.ok(!sent.url.includes("expected_account_id"));
		assert.equal(sent.body, null);
	} finally {
		stub.restore();
	}
});

test("a malformed artifact id never reaches the network", async () => {
	const stub = stubFetch(() => assert.fail("no request may leave main"));
	try {
		const response = await requestDesktopMediaOutcome(
			{
				op: "team_bridge.link_preview.artifact",
				id: "../../etc/passwd",
				expectedAccountId: ACCOUNT,
			},
			null,
			BACKEND,
			TOKEN,
		);
		assert.equal(response.answered, false);
		assert.equal(response.response.kind, "error");
		assert.equal(response.response.status, 422);
		assert.equal(seen(stub).length, 0);
	} finally {
		stub.restore();
	}
});

test("core's 404 for an id this scope does not own stays a 404", async () => {
	const stub = stubFetch(
		() =>
			new Response(JSON.stringify({ detail: "not found" }), {
				status: 404,
				headers: { "content-type": "application/json" },
			}),
	);
	try {
		const response = await requestDesktopMediaOutcome(
			{
				op: "team_bridge.link_preview.artifact",
				id: IMAGE_ID,
				expectedAccountId: ACCOUNT,
			},
			null,
			BACKEND,
			TOKEN,
		);
		assert.equal(response.response.kind, "error");
		assert.equal(response.response.status, 404);
	} finally {
		stub.restore();
	}
});

test("an SVG response is refused before it can reach the renderer", async () => {
	// Core's sniffer never emits SVG, but these bytes cross IPC as bare bytes and
	// the sandbox headers that made them safe do not survive that hop — so the
	// reader allowlists core's raster set rather than accepting `image/*`.
	const stub = stubFetch(
		() =>
			new Response(new Uint8Array([60, 115, 118, 103]), {
				status: 200,
				headers: { "content-type": "image/svg+xml" },
			}),
	);
	try {
		const response = await requestDesktopMediaOutcome(
			{
				op: "team_bridge.link_preview.artifact",
				id: IMAGE_ID,
				expectedAccountId: ACCOUNT,
			},
			null,
			BACKEND,
			TOKEN,
		);
		assert.equal(response.response.kind, "error");
		assert.equal(response.response.status, 422);
	} finally {
		stub.restore();
	}
});

test("the two 404s are distinguishable by the body core sends", async () => {
	const routeNotFound = stubFetch(
		() =>
			new Response(JSON.stringify({ detail: { code: "artifact_not_found" } }), {
				status: 404,
				headers: { "content-type": "application/json" },
			}),
	);
	try {
		const response = await requestDesktopMediaOutcome(
			{
				op: "team_bridge.link_preview.artifact",
				id: IMAGE_ID,
				expectedAccountId: ACCOUNT,
			},
			null,
			BACKEND,
			TOKEN,
		);
		assert.equal(response.response.kind, "error");
		assert.equal(response.response.refusal?.code, "artifact_not_found");
	} finally {
		routeNotFound.restore();
	}

	// A desktop backend that predates the route answers the router's plain-string
	// 404. It carries no code, which is what keeps the card alive.
	const routerNotFound = stubFetch(
		() =>
			new Response(JSON.stringify({ detail: "Not Found" }), {
				status: 404,
				headers: { "content-type": "application/json" },
			}),
	);
	try {
		const response = await requestDesktopMediaOutcome(
			{
				op: "team_bridge.link_preview.artifact",
				id: IMAGE_ID,
				expectedAccountId: ACCOUNT,
			},
			null,
			BACKEND,
			TOKEN,
		);
		assert.equal(response.response.kind, "error");
		assert.equal(response.response.refusal, undefined);
	} finally {
		routerNotFound.restore();
	}
});
