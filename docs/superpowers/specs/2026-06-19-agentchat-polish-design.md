# AgentChat polish — cancel, tool grouping, persisted history

**Date:** 2026-06-19
**Scope:** `web/src/components/AgentChat.tsx`, `web/src/api.ts`, `web/src/styles.css`

## Goal

Three production-polish improvements to the assistant chat, none touching the
agent protocol or the human-merge invariant:

1. **Cancel** a running agent turn from the UI.
2. **Group consecutive tool steps** so a long run reads as one tidy block.
3. **Persist chat history** per workspace across tab switches and page reloads.

## 1. Cancel

- `api.agentStream(ws, prompt, onEvent, signal?)` gains an optional
  `signal: AbortSignal`, forwarded to `fetch`. On abort, `reader.read()` rejects
  with an `AbortError`.
- `AgentChat` holds `abortRef = useRef<AbortController | null>`. While `busy`,
  the **Gửi** button becomes **Dừng**; clicking it calls `abort()`.
- `AbortError` is caught separately (NOT routed through `friendlyError`) and adds
  a new line kind `'cancelled'` rendering a neutral grey line
  *"Đã dừng theo yêu cầu."* — completed steps stay visible.

**Known limitation:** the abort is client-side only. The server-side agent keeps
running to completion; its result is simply discarded. True server cancellation
needs backend support and is out of scope.

## 2. Group consecutive tool steps

- Keep the flat `Line[]` model. At render time, fold runs of consecutive
  `kind: 'tool'` lines into one `.chatmsg.steps` container (vertical list with a
  hairline guide) instead of one card per tool. No expand/collapse — purely a
  visual tidy-up. The live "đang làm việc…" busy row is unchanged.

## 3. Persist history (localStorage)

- Storage key `commons.chat.<ws>`, value is `Line[]` as JSON.
- `AgentChat` loads history for the current `ws` on mount (covers both tab
  switches — component unmounts — and full reloads with one mechanism) and writes
  back whenever `lines` changes.
- Cap at the **200 most recent lines** to bound storage growth.
- All reads/writes wrapped in try/catch (storage may be unavailable, blocked, or
  full); failures degrade to in-memory behaviour.

## Out of scope (YAGNI)

- Lifting chat state into `App` (localStorage-per-ws already covers tab switch).
- A "clear history" button (can be added later if asked).
- Server-side cancellation.

## Testing

- Build (`npm run build:web`) and existing web tests stay green.
- Manual: start a run, press Dừng → neutral cancelled line; switch tabs and back
  → history restored; reload → history restored; consecutive tools render as one
  block.
