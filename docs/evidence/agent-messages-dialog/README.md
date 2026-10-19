# Agent messages dialog — design round 1

PR: https://github.com/damianvtran/local-operator-ui/pull/1208
Reviewed head: 59ae07343175672667bf781c86fbfdccb9c59b06
Reviewer: designer / openai/gpt-6.1-sol (quota fallback from anthropic/claude-sonnet-5-5).

- before-operator.png: supplied by the operator; original 1024×722 screenshot. Not a reviewer reproduction and not a like-for-like palette comparison.
- after-dark.png and after-light.png: captured independently through the harness browser tool from Storybook DEV on port 6007. A scratch same-origin proxy served a 1024×673 iframe; these PNGs crop precisely the iframe's native 2× pixels (2048×1346), without rescaling or modifying dialog content.
- failure-initial.png: the Refused Storybook fixture mounted initially with canEnable:true. This frame does NOT show failure arriving after an Enable request. Its alert is below the scrollport (y668.07..708.97; dialog y16..657); initial autofocus may supersede initial scrollIntoView. No dynamic-flow failure is inferred from this fixture.

Browser measured dark/light dialog: x128 y16 w768 h641; hero h269.1953 CSS px (40% of 673px); heading20px/26px; consent12px/17.4px. Consent text DOM comparison to scripts/fixtures/agent-messages-status.json returned true.

No dependency installation or production build was run. Storybook DEV and the scratch proxy were stopped; the browser tab was closed. Resource hold stopped further captures when df showed4.7GiB available.

## Post-remediation failure arrival (head 58f3244210)

The failure block was moved above the button row at head `58f3244210349094a2f8179e172cee8236a81395`; these frames are the post-remediation layout, not a mount-time fixture inference.

- `failure-arrival-dark-1024x576.png` / `failure-arrival-light-1024x576.png`: captured from Storybook DEV on port 6007, story `agent-messages-onboarding--refused` with `canEnable:true`, themes `localOperatorDark` and `localOperatorLight`, through the harness browser tool. The browser host viewport is 1024×576, shorter than the design round's 1024×673 lease; the alert and the re-enabled Enable/Not now row are both visible above the dialog's bottom edge, so this is a conservative (harsher-height) check, not a 1:1 replacement of the 673 frame.
- The alert reads the generic failure copy plus the specific refusal; the consent remains byte-exact fine print above it. Storybook DEV was stopped and the browser tab closed after capture; no app build or install was run.
