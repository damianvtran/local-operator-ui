# PR1092: phone/tunnel setup evidence

Retained data-only branch. These reviewed PNGs are supporting artifacts for damianvtran/local-operator-ui PR1092. DO NOT merge this branch or its binary assets to main; preserve it after the feature PR merges.

## Provenance and limits
- Baseline product source: a6948abc7, retained through rebase216abda1a using byte/patch compatibility proof.
- Current remediation source: e6315811b888dee8815e154bba4a47e77c87d488.
- Before provider panel: exact origin/main provider-detail source25940fa7f9c96e8cbf9d1206c023ed9bfeba0a29, existing refused-provider story. After uses the feature component with explicit synthetic transport.
- Every identity, account, quote, address, operation and response shown is a FIXTURE. No customer data. Some generic provider stories show an intentionally synthetic provider authorization hostname; no actual provider consent, charge, cloud operation, phone login, or direct-mesh acceptance was executed.
- This work is PHONE/TUNNEL setup only. It does NOT fix direct mesh invitation/trust/access/timeouts, and is NOT a claim that LOH3 as a whole is complete.
- Captured with one reused harness browser against Storybook, not a new browser engine. CSS-viewport widths1280/800 in Dark/Light. Contact sheets contain exact-width story iframes; colored crop boundaries, labels and geometry footer are capture scaffolding, not app UI. First-observed snapshots clone the actual rendered DOM with scripts removed afterward; they are not a second component implementation. A fast first frame may already be a result. Fixture/background-tab timing is not native/cloud performance evidence.
- PNG ancillary metadata removed; original compressed raster chunks retained byte-identical. SHA256SUMS binds the published bytes. No scratch logs, source configuration, SVG metadata, local-private filesystem paths or credentials are published.

## Reading the sets
1. `baseline-matrix-*`: previous full12-state matrix at1280/800 Dark/Light. Retained as BASELINE ONLY. Partial/Connected/Applying/composed-parent states are superseded by the current sets; these old frames are not fresh sign-off on changed pixels.
2. `baseline-transition-*`: baseline Checking/Consent and own-run progress stages.
3. `baseline-before-radient-panel-origin-main.png` / `baseline-after-radient-panel-phone-access.png`: original integration comparison, including the dead-end later fixed.
4. `changed-*`: remediation confirmed-partial / unconfirmed-activation / Connected / actual composed refused-provider; first-observed + settled frames. Confirmed activation+installation failure retains activation receipt. Unconfirmed activation has NO success receipt/reservation claim.
5. `applying-*`: remediation first Applying, first poll and Connected, retaining the selected masked account.
6. `parent-reauth-*`: actual composed ProviderGrid/ProviderDetail recovery action. One explicit second sign-in starts the existing pending flow with no duplicate sign-in button, then completed-but-refused still exposes Sign in again. Browser handoff is intercepted by the fixture (one handoff per explicit start).

## Images

### applying-1280-dark-p1.png

![applying-1280-dark-p1.png](applying-1280-dark-p1.png)

### applying-1280-dark-p2.png

![applying-1280-dark-p2.png](applying-1280-dark-p2.png)

### applying-1280-light-p1.png

![applying-1280-light-p1.png](applying-1280-light-p1.png)

### applying-1280-light-p2.png

![applying-1280-light-p2.png](applying-1280-light-p2.png)

### applying-800-dark-p1.png

![applying-800-dark-p1.png](applying-800-dark-p1.png)

### applying-800-dark-p2.png

![applying-800-dark-p2.png](applying-800-dark-p2.png)

### applying-800-light-p1.png

![applying-800-light-p1.png](applying-800-light-p1.png)

### applying-800-light-p2.png

![applying-800-light-p2.png](applying-800-light-p2.png)

### baseline-after-radient-panel-phone-access.png

![baseline-after-radient-panel-phone-access.png](baseline-after-radient-panel-phone-access.png)

### baseline-before-radient-panel-origin-main.png

![baseline-before-radient-panel-origin-main.png](baseline-before-radient-panel-origin-main.png)

### baseline-matrix-1280-dark-p1.png

![baseline-matrix-1280-dark-p1.png](baseline-matrix-1280-dark-p1.png)

### baseline-matrix-1280-dark-p2.png

![baseline-matrix-1280-dark-p2.png](baseline-matrix-1280-dark-p2.png)

### baseline-matrix-1280-dark-p3.png

![baseline-matrix-1280-dark-p3.png](baseline-matrix-1280-dark-p3.png)

### baseline-matrix-1280-dark-p4.png

![baseline-matrix-1280-dark-p4.png](baseline-matrix-1280-dark-p4.png)

### baseline-matrix-1280-light-p1.png

![baseline-matrix-1280-light-p1.png](baseline-matrix-1280-light-p1.png)

### baseline-matrix-1280-light-p2.png

![baseline-matrix-1280-light-p2.png](baseline-matrix-1280-light-p2.png)

### baseline-matrix-1280-light-p3.png

![baseline-matrix-1280-light-p3.png](baseline-matrix-1280-light-p3.png)

### baseline-matrix-1280-light-p4.png

![baseline-matrix-1280-light-p4.png](baseline-matrix-1280-light-p4.png)

### baseline-matrix-800-dark-p1.png

![baseline-matrix-800-dark-p1.png](baseline-matrix-800-dark-p1.png)

### baseline-matrix-800-dark-p2.png

![baseline-matrix-800-dark-p2.png](baseline-matrix-800-dark-p2.png)

### baseline-matrix-800-dark-p3.png

![baseline-matrix-800-dark-p3.png](baseline-matrix-800-dark-p3.png)

### baseline-matrix-800-dark-p4.png

![baseline-matrix-800-dark-p4.png](baseline-matrix-800-dark-p4.png)

### baseline-matrix-800-light-p1.png

![baseline-matrix-800-light-p1.png](baseline-matrix-800-light-p1.png)

### baseline-matrix-800-light-p2.png

![baseline-matrix-800-light-p2.png](baseline-matrix-800-light-p2.png)

### baseline-matrix-800-light-p3.png

![baseline-matrix-800-light-p3.png](baseline-matrix-800-light-p3.png)

### baseline-matrix-800-light-p4.png

![baseline-matrix-800-light-p4.png](baseline-matrix-800-light-p4.png)

### baseline-transition-check-stages-p1.png

![baseline-transition-check-stages-p1.png](baseline-transition-check-stages-p1.png)

### baseline-transition-run-stages-p1.png

![baseline-transition-run-stages-p1.png](baseline-transition-run-stages-p1.png)

### baseline-transition-run-stages-p2.png

![baseline-transition-run-stages-p2.png](baseline-transition-run-stages-p2.png)

### baseline-transition-run-stages-p3.png

![baseline-transition-run-stages-p3.png](baseline-transition-run-stages-p3.png)

### changed-1280-dark-p1.png

![changed-1280-dark-p1.png](changed-1280-dark-p1.png)

### changed-1280-dark-p2.png

![changed-1280-dark-p2.png](changed-1280-dark-p2.png)

### changed-1280-dark-p3.png

![changed-1280-dark-p3.png](changed-1280-dark-p3.png)

### changed-1280-dark-p4.png

![changed-1280-dark-p4.png](changed-1280-dark-p4.png)

### changed-1280-light-p1.png

![changed-1280-light-p1.png](changed-1280-light-p1.png)

### changed-1280-light-p2.png

![changed-1280-light-p2.png](changed-1280-light-p2.png)

### changed-1280-light-p3.png

![changed-1280-light-p3.png](changed-1280-light-p3.png)

### changed-1280-light-p4.png

![changed-1280-light-p4.png](changed-1280-light-p4.png)

### changed-800-dark-p1.png

![changed-800-dark-p1.png](changed-800-dark-p1.png)

### changed-800-dark-p2.png

![changed-800-dark-p2.png](changed-800-dark-p2.png)

### changed-800-dark-p3.png

![changed-800-dark-p3.png](changed-800-dark-p3.png)

### changed-800-dark-p4.png

![changed-800-dark-p4.png](changed-800-dark-p4.png)

### changed-800-light-p1.png

![changed-800-light-p1.png](changed-800-light-p1.png)

### changed-800-light-p2.png

![changed-800-light-p2.png](changed-800-light-p2.png)

### changed-800-light-p3.png

![changed-800-light-p3.png](changed-800-light-p3.png)

### changed-800-light-p4.png

![changed-800-light-p4.png](changed-800-light-p4.png)

### parent-reauth-completed-refused-dark.png

![parent-reauth-completed-refused-dark.png](parent-reauth-completed-refused-dark.png)

### parent-reauth-waiting-dark.png

![parent-reauth-waiting-dark.png](parent-reauth-waiting-dark.png)
