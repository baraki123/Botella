# State Machine Map — Layla conversations

Last audited: 2026-05-20.

Companion doc to `spec.md` (product behavior) and `context.md` (current handoff). This file owns the rubric — every Layla path scored on **context / delight / helpful** (1–5 each). When a path drops below 14/15, it's a Lift candidate.

---

## State machine

```
                              ┌───────────────────┐
                              │   sign-in         │
                              │ Apple / anon JWT  │
                              └─────────┬─────────┘
                                        │
                  ┌─────────────────────┼──────────────────────┐
              fresh user            chart exists        chart + sections
                  │                     │                      │
                  ▼                     ▼                      ▼
        ┌─────────────────┐    ┌─────────────────┐    ┌────────────────┐
        │ ONBOARDING flow │    │  free_chat      │    │ emit_first_map │
        │  lang→name→     │    │  (returning)    │    │ (resume gate)  │
        │  gender→date→   │    └─────────┬───────┘    └─────────┬──────┘
        │  time→place→    │              │                      │
        │  astro_depth    │              │ ┌────────────────────┘
        └────────┬────────┘              │ │
                 ▼                       ▼ ▼
   ┌─────────────────────────┐  ┌────────────────────────┐
   │ build_first_map         │  │     FREE CHAT          │
   │  · "Reading your chart" │  │  (LLM, system prompt + │
   │  · headline + going-deep│  │   astro depth + map +  │
   │  ▼                      │  │   moment + orbit ctx)  │
   │ first_map_brewing       │  └──┬─────────────────────┘
   │  · ⌛ ~90s LLM           │     │
   │  · reassurance lines    │     │ user input dispatch
   │  ▼                      │     │
   │ emit_first_map          │     ▼
   │  · paginated_read event │  ┌────────────────────────────────────────┐
   │    (9 sections + chips  │  │ /newchart           wipes + onboarding │
   │     + post-text +       │  │ /map                re-emits full read │
   │     doorway_options)    │  │ /addperson          → add_person flow  │
   │  · Done()               │  │ __doorway_person    → add_person flow  │
   └─────────────────────────┘  │ __doorway_question  → static reply +   │
                                │                       active flag      │
                                │ __doorway_situation │ static reply     │
                                │ __doorway_reflect   │ static reply     │
                                │ __focus_person:<id> → focus block      │
                                │                       prepended →      │
                                │                       LLM reply        │
                                │ person mention rgx  → orbit-pending    │
                                │                       chip "Add Maya?" │
                                │ "yes" / "no"        → handle_orbit_*   │
                                │ all else            → LLM reply        │
                                └──────────────────┬─────────────────────┘
                                                   │
                                                   ▼
                                       ┌──────────────────────┐
                                       │  add_person flow     │
                                       │  ask_name→rel→gender │
                                       │ →know_details?→date  │
                                       │ →time→place→notes→   │
                                       │  save_person→        │
                                       │  emit_snapshot LLM→  │
                                       │  emit_compat LLM →   │
                                       │  CTA chips (✦ talk) │
                                       └──────────┬───────────┘
                                                  │
                                                  ▼
                                          back to FREE CHAT
                                          (focused on new person if
                                           user taps "Talk about X")
```

---

## Path rubric

Score 1–5 each. **Target: every shipped path at 14/15 or 15/15.**

| Path | Context | Delight | Helpful | Total | Status |
|---|---:|---:|---:|---:|---|
| **A. Fresh user EN → full onboarding → read** | 5 | 5 | 4 | 14 | At bar |
| **B. Fresh user HE → full onboarding → read** | 5 | 5 | 5 | **15** | ✓ Lift 6 — strengthened directive + post-process safety net for English-title drift; token cap 8000 |
| **C. Returning user, "tell me about my career"** | 5 | 4 | 5 | 14 | At bar |
| **D. Returning user mentions "my friend Maya" (no chart)** | 5 | 5 | 5 | **15** | ✓ Lift 4 — chip pair "✦ Add Maya / Not now"; tap starts add_person flow with pre-filled name+role |
| **E. /addperson → full Q&A → save → snapshot + compat** | 5 | 5 | 5 | **15** | ✓ Lift 5 — emit_person_brewing state between snapshot + compat ("Reading the dynamic now…") |
| **F. "Talk to Layla about Maya" from Orbit** | 5 | 4 | 5 | 14 | At bar |
| **G. Doorway chip: __doorway_question** | 5 | 5 | 5 | **15** | ✓ Lift 3 — opener references the user's living_map shadow_pattern / core_signature |
| **H. Doorway chip: __doorway_reflect** | 5 | 5 | 4 | **14** | ✓ Lift 1 — next free_chat turn opens with a quiet check-in via reflect doorway hint |
| **I. /newchart wipe → re-onboard** | 5 | 3 | 5 | 13 | Debug-only — out of scope |
| **J. WS drop mid-read** | 5 | 4 | 5 | **14** | ✓ Lift 2 — paginated buffer persisted to AsyncStorage; survives WS drop + app kill |

---

## Lift plan — bring all (non-debug) paths to 14/15

Ordered by leverage (size of delta × user impact). `/newchart` (I) excluded — debug only.

### Lift 1 — Path H (10 → 14/15)
**Reflect doorway saves an anchor + follows up next session.**

When user taps "Just let me sit with this", we drop them. Brand-on opposite: Layla *remembers* that they paused. Save the most recent map theme as an `anchor_question`, set `reflect_pending_at`, and on the next free_chat turn open with a quiet check-in ("How did sitting with [theme] land for you?"). This turns the reflect chip into a continuity moment.

**Files**: `botella_manifest.py` (doorway handler — set reflect_pending + extract latest read theme), `services/laila_state.py` (`reflect_pending_directive`), `services/laila_chat.py` (use directive when reflect_pending_at within 7 days).

### Lift 2 — Path J (10 → 14/15)
**Persist the paginated read to AsyncStorage.**

iOS `paginatedReadRef` is RAM-only. WS drop mid-section 3 = sections 4–9 are gone forever (or until /newchart). Stash the buffered sections + chip labels + post text + doorways under `paginated_read_buffer_<userId>` in AsyncStorage when the `paginated_read` event arrives; clear it when the user finishes section 9 OR taps any non-paginated chip; rehydrate on app open if the buffer exists and has unread sections.

**Files**: `layla-app/src/chat/ChatScreen.tsx` (persist + restore around `paginatedReadRef`), maybe a small `paginated_read_storage.ts` helper.

### Lift 3 — Path G (11 → 14/15)
**Question doorway references the read.**

Static "What question keeps returning?" is fine but generic. Use `record["first_map_read_text"]` + `record["living_map"]` to ask in the right key — e.g., if the user's "shadow_pattern" was self-erasure, the question doorway opens with *"What question keeps returning — the one that lives near the self-erasure pattern we named?"*. Single LLM call (cheap — short input, short output), behind the same active_doorway = "question" flag.

**Files**: `services/laila_chat.py:doorway_first_reply` becomes async + accepts the user record so it can call a small `generate_question_doorway_opener` LLM, OR a new function in `services/claude_service.py`.

### Lift 4 — Path D (11 → 14/15)
**Soft entry for unknown-name person mention.**

When `detect_person_mention` fires with no Orbit match, we currently dump the user into an orbit-pending Q&A inside chat. That's a form interruption. Instead, after the short LLM reply, surface a chip pair: `✦ Add them properly` + `Not now`. Tapping the chip enters the structured `add_person` flow (with name + role pre-filled if the regex caught them). Skips `ask_name`/`ask_rel` when pre-fill is available.

**Files**: `botella_manifest.py` free_chat (the orbit-pending block), `services/laila_chat.py:handle_orbit_pending_turn` (route through `add_person` flow Start with init_data), `flows/people.py` (skip ask_name when init_data has name+role).

### Lift 5 — Path E (14 → 15)
**Brewing reassurance between snapshot + compat.**

Two ~15s LLM waits stacked, silent typing dot between. Port the brewing pattern from `first_map_brewing` — emit a quiet line at the snapshot→compat boundary ("Reading the dynamic now…" / "מסתכלת על הדינמיקה…"). One state addition: between `emit_person_snapshot` and `emit_person_compatibility`, a quick `emit_person_brewing` state that yields `[text("Reading the dynamic now…"), typing()]` + Goto.

**Files**: `flows/people.py` (one new state).

### Lift 6 — Path B (13 → 15)
**Hebrew title drift + token cap verification.**

We added the Hebrew section-title directive (`c660e9d`) and bumped tokens to 8000 (`3822a1e`). Verify on a live Hebrew test: do titles consistently land in Hebrew? Does Mature Expression complete? If drift persists, strengthen the directive ("If you write `## Deep Realization` instead of `## תובנה עמוקה`, your response is incorrect and will be rejected"). If cut persists on dense charts, bump tokens further to 9500.

**Files**: `services/claude_service.py:_first_map_messages` (directive reinforcement if needed) + token cap. Mostly verification, not new code.

---

## Out of scope (the 14s — already at bar)

- **A** — "exit ramp" feel of the post-read doorway chips is real but minor; the chips themselves were just redesigned (coin & tag) and shipping a behavioral change on top isn't load-bearing yet.
- **C** — career-context free_chat is strong; no clear lever.
- **F** — focused chat just shipped (`50a79fc`); first iteration deserves a real-world soak before iterating.

---

## When to re-audit

Re-run this rubric whenever any of the following ships:
- A new doorway / flow that adds a path letter.
- A change to `system_extras` composition (focus block, doorway directives, anchor question threading).
- A copy change to the four doorway first-replies in `services/laila_chat.py:doorway_first_reply`.
- A change to the post-save sequence in `flows/people.py`.

Update the rubric table inline. If a path drops below 14, open a Lift entry above and ship it before the next product step.
