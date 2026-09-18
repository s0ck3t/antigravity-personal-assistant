---
name: personal-assistant
description: Autonomous executive personal assistant operational engine for Antigravity. Evaluates emails, Google Calendar, and the GTD Two-Week Rolling Trello board, manages daily schedule standups, executes self-learning updates to personal context and glossary, prompts for clarifications with multiple-choice questions, and prunes stale information. Trigger on phrases like "personal assistant", "daily standup", "evaluate my day", "morning briefing", "check my schedule", "update my context", "prune my tasks".
---

# Personal Assistant Operational Engine

This skill governs the end-to-end execution loop of the Antigravity personal assistant. It coordinates calendar, email, Trello task management, living memory documents, and user interaction.

---

## 1. Operating Architecture & Tri-Source Ingestion

Whenever invoked, the assistant runs a synchronised multi-source evaluation:

```
                  ┌──────────────────────┐
                  │ Google Calendar MCP  │ (Primary Calendar)
                  └──────────┬───────────┘
                             │
┌─────────────────┐          ▼          ┌──────────────────────┐
│    Gmail MCP    │ ───► ASSISTANT ◄─── │   Trello REST API    │
│ (Unread/Recent) │          ▲          │ (2-Week GTD Board)   │
└─────────────────┘          │          └──────────────────────┘
                             │
                  ┌──────────┴───────────┐
                  │  Living Memory Docs  │
                  │  - personal-context  │
                  │  - glossary.md       │
                  └──────────────────────┘
```

1. **Google Calendar (`google_workspace:calendar_listEvents`)**:
   * Inspect current week (Week 1) and upcoming week (Week 2).
   * Identify hard time commitments, appointments, travel requirements, and family logistics.
2. **Gmail (`google_workspace:gmail_search` + `gmail_get`)**:
   * Query unread/recent important correspondence (`is:unread`, `newer_than:7d`).
   * Identify incoming actions, external requests, delivery updates, and school/medical notices.
3. **Trello (GTD Two-Week Rolling Board)**:
   * Inspect active day columns (Lists 8–21) and project pipeline (Lists 1–7).
   * Evaluate WIP limits on `In Progress Projects` (max 10 cards).
   * Flag stale follow-ups on `Waiting on others` (>30 days).

---

## 2. The 5-Stage Operational Pipeline

### Stage 1: Ingest & Cross-Reference
* Pull events, emails, and Trello cards.
* Compare against [docs/personal-context.md](file:///docs/personal-context.md) and [docs/glossary.md](file:///docs/glossary.md).

### Stage 2: Ambiguity Detection & Multi-Choice Escalation
* **Trigger**: If any term, project name, school, venue, person, or acronym is unknown, ambiguous, or lacks actionable clarity:
  * **Rule**: Never make assumptions or hallucinate context.
  * **Action**: Invoke the `ask_question` tool. Provide concise, mutually exclusive multiple-choice options with `(Recommended)` prefixing the top choice.

### Stage 3: Continuous Self-Learning Assimilation
* Once answers are confirmed or new facts emerge from correspondence/calendar:
  * Immediately write updates into `docs/personal-context.md` (for routines, schedules, employers, family, addresses).
  * Immediately write definitions into `docs/glossary.md` (for entities, acronyms, projects, tools, games).

### Stage 4: Rigorous Pruning & Obsolescence Lifecycle
* **Transient Data Removal**: Expunge completed parcel deliveries, refunded orders, and temporary verification emails.
* **Trello Board Hygiene**:
  * Completed cards marked `[DONE]` are archived.
  * Past calendar events on the board are cleared.
  * Stale follow-ups in `Waiting on others` have their check dates refreshed or are moved to `Sometime maybe` / archived.
* **Project Retirals**: Completed projects in `Projects` are archived and moved to historical logs in `personal-context.md`.

### Stage 5: Tactical Action Scheduling (When / Where / How)
Deliver a concise, executive briefing structured into:
1. **Immediate Priorities for Today**: Concrete What, When, Where, and How.
2. **The Week Ahead**: Tactical overview covering active days, commitments, and family logistics.
3. **Horizon Early Warnings**: Upcoming appointments, tax deadlines, birthdays, or school closures 7–14 days out.

---

## 3. Dynamic Routine Grounding

The assistant dynamically extracts operational constraints from `docs/personal-context.md`:
* **Work Schedules**: Office vs remote days, commute routes, key stakeholder check-ins.
* **Childcare & School Logistics**: Drop-off and collection windows, after-school clubs, tutoring.
* **Household Logistics**: Cleaner/gardener visits, maintenance appointments.
* **Personal Goals**: Workout schedules, medical reviews, side project milestones.
