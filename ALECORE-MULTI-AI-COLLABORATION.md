# AleCore AI — Multi-AI Collaboration

## Purpose

AleCore Local is the primary conversation model and final synthesizer. The desktop coordinator can request independent reviews from ChatGPT and GitHub Copilot, then optionally run the existing Specialist Agent Hub through NARA's Goal/Task lifecycle.

The coordinator does not claim a provider participated unless its call or specialist pipeline actually completed.

## Conversation flow

1. Validate the desktop chat payload.
2. Check that AleCore Local is configured and available. If it is not ready, fail closed; do not silently switch to a cloud model.
3. Ask AleCore Local for the first draft.
4. Choose collaborators according to the selected mode and request complexity.
5. When permission is granted, send bounded review prompts to eligible external providers.
6. In FULL TEAM, or for complex coding requests in AUTO, optionally run the read-only Specialist Agent Hub when a Git checkout and at least two structured executors are ready.
7. Ask AleCore Local to synthesize the available reviews.
8. Return the answer with participant states and a collaboration summary.

The specialist pipeline uses the NARA Agent Coordinator and the existing Planner → Worker → Reviewer workflow in analysis mode. Its prompts explicitly prohibit edits, shell/write actions, commits, pushes, merges, and publishing.

## Modes

| Mode | Behavior |
| --- | --- |
| AUTO COLLABORATION | AleCore Local handles ordinary questions. Complex coding requests can request Copilot and ChatGPT reviews and a read-only specialist analysis when the selected checkout is ready. Other complex requests can request ChatGPT review. |
| FULL TEAM | Requests ChatGPT and Copilot reviews, then attempts the Specialist Agent Hub when its prerequisites are met. |
| LOCAL ONLY | Uses AleCore Local only. No cloud collaborators or Developer Agent Hub project work. |
| Manual | Calls only the provider selected in the UI. External providers require the per-message cloud permission. |

Complexity routing is heuristic. It is deliberately conservative and should be refined with real usage tests.

## Data and consent boundaries

- The cloud-permission checkbox is unchecked by default and consumed by one submitted message.
- AUTO and FULL TEAM reviewers receive only the bounded user request and the bounded AleCore Local draft. Raw chat history, the structured memory packet, and image attachments are not passed directly to those reviewers.
- The local draft can contain information inferred from the current context. The permission notice therefore explicitly covers sharing the draft.
- The Specialist Agent Hub receives a bounded request, local draft, and bounded review notes. It is only invoked after the same per-message permission is granted.
- Images remain local in AUTO and FULL TEAM; cloud collaboration is skipped for image-bearing requests.
- Manual mode sends data to the provider the user selected. Depending on that provider's capabilities, the message, history, memory context, and supported image attachments may be sent. The same explicit permission is required for a cloud provider.
- Explicit Developer Agent project-work requests also require the per-message permission. LOCAL ONLY blocks that route.
- Provider failures and missing prerequisites are reported as unavailable or failed; they are never labeled as completed.

## Provider readiness

- AleCore Local: Ollama must be running on loopback and the configured model must be installed.
- ChatGPT: this desktop integration uses the existing ChatGPT/Codex CLI bridge and its login status; it is not a ChatGPT API-key connection.
- GitHub Copilot: the CLI must be installed and its login must be verified in the current desktop session. Installation alone is not enough for team routing.
- Specialist Agent Hub: a Git checkout must be selected and at least two structured executors must be available. The existing pool is Codex, GitHub Copilot, Cursor, and Claude Code. Only executors actually detected by the local Agent Hub can participate.

The local model and any CLI tools remain separate installations; this feature does not bundle model weights or grant provider subscriptions.

## Existing project-work route

Explicit project edits continue through the existing Developer Agent Hub maintenance transaction. It is separate from read-only conversation analysis because it can change files. That route retains its change-set checks, rollback handling, and independent Reviewer VERDICT: PASS requirement. It is not silently triggered by an ordinary conversation.

## Current scope and limitations

- This phase connects the desktop conversation flow to AleCore Local, ChatGPT, Copilot, and the existing NARA Specialist Agent Hub.
- The many other Agent Hub catalog entries are not all executable integrations. The runtime only reports actual available executors.
- Android does not yet connect to a Windows-hosted Ollama service. Do not expose Ollama's raw port to the LAN; a separate authenticated bridge is required before mobile collaboration can be tested.
- No Windows installer, EXE, or APK is considered validated until the branch is synchronized and its tests/builds run on the target environment.

## Verification

Run these commands from the repository root after fetching this branch:

    node --test tests/multi-ai-coordinator.test.mjs
    node --test tests/assistant.test.mjs tests/alecore-local-provider.test.mjs tests/multi-ai-coordinator.test.mjs
    npm run verify

Also perform a Windows desktop smoke test with AleCore Local available, then separately test each provider's login and failure behavior. Mobile testing remains blocked on the authenticated Android-to-host bridge.