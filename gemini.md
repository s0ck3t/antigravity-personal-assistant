# GEMINI.md: Project Instructions & Global Context

## 1. Security & Privacy Policy (Strict)

- **Credentials and API keys must never be saved in git and are strictly private.**
- Under no circumstances should API keys, access tokens, webhook secrets, passwords, or personal authorisation data be committed to the repository or exposed in git history.
- Credentials must strictly be maintained in local user profiles (e.g. `~/.trello/config.json`) or in local environment files ignored by `.gitignore` (e.g. `.env`).
- Always check that `.gitignore` prevents secret files from accidental staging before committing.

## 2. Language & Spelling Conventions

- All documentation, briefings, guides, code comments, and explanations must strictly and consistently use **British English spellings** (e.g. *specialise*, *standardise*, *authorise*, *personalise*, *optimise*, *organise*, *prioritise*, *categorise*, *centre*, *behaviour*, *colour*, *instalment*, *favour*).

---

## 3. GTD Two-Week Rolling Board Briefing (Personal Planner)

- **Full Operational Specification**: [docs/gtd-board-system.md](file:///docs/gtd-board-system.md)
- **Philosophy**: The board functions as the user's primary operational command centre and personal planner. It synthesises David Allen's **Getting Things Done (GTD)** methodology with an explicit **two-week rolling calendar horizon**.

### Structural Architecture
1. **GTD Project & Action Pipeline** (Columns 1–7):
   - `Sometime maybe`: Someday/Maybe ideas incubator.
   - `Projects`: Master catalogue of all multi-step outcomes.
   - `In Progress Projects`: Active WIP-limited focus projects (strict limit: max 10 cards).
   - `On hold`: Paused or temporarily blocked projects.
   - `To Do`: Actionable next actions backlog ready to be scheduled.
   - `Waiting on others`: External dependencies & delegations, formatted with target check dates: `[Entity] to [Action] (check [Date])`.
   - `To Do high priority`: Critical or urgent actions needing rapid scheduling.

2. **The Two-Week Rolling Execution Horizon** (Columns 8–21):
   - **Week 1 (Active Week)**: Monday through Sunday. Represents the current operating week.
   - **Week 2 (Horizon Week)**: Monday through Sunday. Represents the upcoming week.

### Key Operational Conventions
- **Decomposition**: Active projects in `In Progress Projects` are broken down into discrete, verb-led next action cards which either sit in `To Do` or go onto a specific day in Week 1 or Week 2.
- **Weekly Review & Rollover**:
  - Completed cards remain on the day lists during the week for accountability and are archived in bulk at the end-of-week review.
  - Incomplete tasks from Week 1 roll forward to the next week or return to `To Do` / `Waiting on others`.
  - Week 2 cards shift forward into their corresponding Week 1 day columns.
- **Context Over Colour**: Card titles must be self-contained and descriptive. Context prefixes are preferred in text (e.g. `[Home]`, `[Call]`, `[Admin]`, `[Finance]`) and specific appointments start with the time (e.g. `10:30am Dentist`, `7:30pm Strategy Session`).

### Google Assistant Voice Capture & Google Tasks Integration
- **Full Operational Specification**: [docs/google-tasks.md](file:///docs/google-tasks.md)
- **Voice Ingestion**: Quick tasks captured on-the-go via Google Assistant (smartphones/smart speakers) flow into Google Tasks (`@default`).
- **Sync Routine**: During morning reviews, execute `node .agents/skills/google-tasks/scripts/tasks.mjs sync-trello` (or the `tasks_syncToTrello` MCP tool) to mirror new tasks into the board's `To Do` list as `[Google Assistant] <Task>`.
- **Dual-Presence Persistence**: Tasks are **not deleted** from Google Tasks upon import so that smartphone lock-screen notifications, wearable alerts, and Google Home audible alarms remain functional.
- **Deduplication**: Ingested IDs are tracked in `~/.google-tasks/sync_state.json` to prevent duplicates across recurring review sessions.

---

## 4. Personal Context, Glossary & Continuous Self-Learning Protocol

### A. Living Source of Truth Documents
Every personal assistant interaction must strictly reference and actively maintain the two canonical markdown context repositories:
1. **[docs/personal-context.md](file:///docs/personal-context.md)**: Master operating profile containing executive work patterns, hybrid working arrangements, family schedules, school run routines, household services, and health/wellness commitments.
2. **[docs/glossary.md](file:///docs/glossary.md)**: Fully cross-referenced dictionary of corporate entities, schools/clubs, geographic hubs, active software ventures, legal/administrative acronyms, and hobbies.

### B. Self-Learning & Continuous Fact Ingestion
- At the start of every review session, cross-check incoming signals from Google Calendar, Gmail, and Trello against `docs/personal-context.md` and `docs/glossary.md`.
- When new entities, habits, schools, companies, project details, or family requirements appear, immediately assimilate them into both documents.
- Keep all references concrete: include locations, times, days, and cross-references.

### C. Active Ambiguity Resolution Protocol
- If any project name, acronym, document reference, or entity is ambiguous, unrecognised, or lacks sufficient technical or logistical clarity:
  - **Never guess or invent facts.**
  - **Immediately prompt the user** using the `ask_question` tool.
  - Formulate structured multiple-choice options with a sensible `(Recommended)` choice listed first.
  - Encode the confirmed answer directly back into `docs/personal-context.md` and `docs/glossary.md` upon receipt.

### D. Information Pruning & Obsolescence Lifecycle
To prevent context drift and stale token accumulation, the assistant must rigorously prune out-of-date information:
1. **Transient Logistics Pruning**: Routine delivery notices, refunded returns, one-off service bookings, and temporary tracking numbers must be expunged from memory and living documents once completed.
2. **Past One-Off Events**: Calendar events that have concluded must be archived from Trello and not retained in the active operating profile.
3. **Project Retirement**: When projects reach completion, archive their Trello cards and move them from active project sections in `personal-context.md` to historical reference summaries.
4. **Stale Dependency Auditing**: Routinely audit `Waiting on others`. Any item exceeding 30 days without an update must be challenged for archiving or date refresh.

---

## 5. Onboarding New Users

When the user asks to be onboarded (e.g. *"onboard me as my personal assistant"* or *"setup personal assistant"*), activate the `assistant-onboarding` skill:
1. Verify Trello credentials and execute `scripts/bootstrap-trello-board.py`.
2. Configure the Google Workspace MCP server via `scripts/setup-workspace-mcp.py`.
3. (Optional) Configure Google Tasks & Assistant voice capture via `docs/google-tasks.md`.
4. Interactively interview the user to replace the template/showcase context with their real operational profile in `docs/personal-context.md` and `docs/glossary.md`.
5. Provide tailored Scheduled Tasks prompts for the Antigravity desktop app sidebar.
