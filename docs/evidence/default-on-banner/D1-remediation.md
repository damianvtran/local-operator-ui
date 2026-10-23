# D1/D2 remediation — real-container RED, source fix, GREEN

## Scope and reproduction

This closes the evidence gap with the **real `TeamBridgePage` container**, real renderer API parsing/mutations, and real query observer/invalidation. Only `window.api.desktop.request` is replaced by the stateful fixture. This is browser-rendered integration evidence over a mocked runtime adapter, **not a live hub or native Electron claim**.

Before any product edit, the exact sequence was recorded in `d1-red-requests.json`:

1. GET `/v1/desktop/team-bridge/status?boundary=surface_open` => C, local enabled true.
2. Click the actual banner Turn off button.
3. Exactly one PUT `/v1/desktop/team-bridge/settings` with `{expected_account_id:"acct_self",tenant_id:"tnt_1",state:"disabled"}` => disabled endpoint.
4. Invalidation triggers another status GET => **E, local.enabled=false, read_only=false**.
5. Actual query cache is **idle, with one mounted observer**, yet composer and Send remain. `d1-red-cache.json`, `d1-red.snapshot.txt`, and ignored `d1-red-off-light.png` preserve this RED result.

The runtime contract was traced rather than made convenient: #2790 `5d254286fe` `client.py:surface_projection` sets read_only only for F. The desktop route forwards it. A fixture returning read_only=true after member opt-out would have hidden the bug.

## Minimal D1 source fix

`teamBridgeEligibility` now returns a plain `off` gate for E, or C/D with an explicit local.enabled=false. Missing local fields do not imply opt-out. F keeps retained readonly history; paused D with the local switch on stays usable. The existing container already gates downstream reads and passes eligibility to the view, so this fixes the owning gate rather than adding a banner-local workaround.

The gate renders the existing audited Settings off title/body and no composer, Send, Enable, or re-enrolment action. The plan-marketing paragraph is omitted for off. No new strings or translations, and no changed runtime flag.

The **same real flow is GREEN in light and dark**: E/enabled=false/read_only=false remains unchanged, cache is idle with an active observer, and the visible page is Turned off with no textbox/Send/dialog. Full request/cache JSON, accessibility snapshots, and initial/settled frames are named `d1-green-off-<theme>*`. Story assertions verify the post-PUT GET and cache completion before checking the UI, preventing a banner-only disappearance from passing.

## D2 narrow follow-up and source fix

The current main page uses a flex-1 root, so the fixture was corrected to mirror the app's **flex column shell**, not a block wrapper. Measurements below are from that corrected host. The supported minimum is **800×600**, pinned in `src/main/window-mode.ts`.

The full 2035-byte disclosure genuinely overflowed at that size: banner height **809.5 CSS px**, disclosure **667.5 px**, composer y **861.5**, in a 600px-tall page. `d2-red-minimum.geometry.json` and ignored `d2-red-minimum-expanded-light-settled.png` are the retained RED proof. Earlier exploratory narrow captures with an incorrectly sized host were discarded, not presented as product evidence.

Only under the existing `@max-[1024px]/bridge` named container, the disclosure now has `max-height:35dvh; overflow-y:auto`. Actions remain above it. The final block is a labelled semantic section; native Chromium scroll-container keyboard focus uses the existing accent outline roles. At the captured viewport the disclosure is **252px**, the banner **394px**, and the composer y **508**, inside the 800×600 page. The native viewport at 600px height yields an even smaller 210px disclosure cap. The old approved desktop width is above the container breakpoint and its disclosure is not capped.

Eight GREEN minimum-size boards cover expanded/off in light/dark plus French long actions and Urdu RTL. Production locale/direction resolution is used; the served legal text remains the exact English v2 bytes. The disclosure-end story scrolls the actual overflow element to its bottom and asserts nonzero scrollTop; both-theme frames visibly include the final clause while actions/composer stay reachable. Browser scroll requests alone did not move the targeted element, so those attempts are not cited as successful end-of-text evidence.

Desktop expanded light/dark controls were recaptured to check the existing uncapped presentation. All final matrices were actually viewed (`d1-final-contact.jpg`, `d2-green-contact.jpg`, ignored). Larger OS text/display scaling is still not claimed; this follow-up covers the actual minimum layout box and translations.

## Evidence storage and reliability

- All image bytes live only in ignored `docs/evidence-frames/default-on-banner/`; never force-added. `frame-index.json` records original reviewed-head URLs plus hashes for new local captures. No published attachment URL is claimed for new local-only images.
- Original genuine historical main-source artifacts remain byte-identical. The original before/after record is retained, with its earlier PageView limitation explicitly superseded by this full-container proof.
- Initial/settled geometry is paired for final states. Permission-check hiccups were handled through browser request_access, which reported the origin already allowed; failed calls were not treated as successful screenshots. Final state/frame identities were inspected.
- After captures the browser was closed, exact server group 34046 reaped, original Storybook config restored. No simulator, Electron, installation, production write, release or flag change.
- The source-only lint cleanup after capture changed the disclosure's labelled div/role-region to semantic section and removed explicit tabindex; CSS/layout/text are unchanged. No new geometry is claimed for that semantic-only change.

## Verification

- `node --test --test-concurrency=1 scripts/default-on-banner.test.mjs scripts/team-bridge-directory.test.mjs`: **68 passed**, including existing 26 banner cases and new gate/render negative controls for v1/v2 active, paused, disabled, local-off, and F readonly.
- Renderer typecheck passed before the final semantic lint cleanup; the normal pre-push typecheck will recheck the frozen head.
- The original CI failures have one owned cause: force-added PNG/JPG files. They are now untracked and byte-preserved in the correct ignored tree. A local structure run over this partial frame corpus also reports full-corpus count mismatches, which is not fixed by falsifying the release manifest. CI-equivalent structure and entry-point checks are run in a clean linked-dependency checkout without ignored frames; results will be appended after execution.

Independent code/QA/design review remains required. This record is implementer evidence, not reviewer sign-off.
