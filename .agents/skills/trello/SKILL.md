---
name: trello
description: Manage Trello boards, lists, and cards via the Trello REST API. Trigger on phrases like "trello", "my boards", "create card", "move card", "sort cards", "label card".
---

# Trello Board Management

Manage Trello boards, lists, and cards via the Trello REST API using the bundled helper scripts.

## Core Convention - ALWAYS Categorise Every Card

**Every card must carry a category label. No exceptions.** Whenever you create a card, sort/order, or organise a board, ensure EVERY card on the affected list(s) has a label — not just the top few you reordered. "Order the backlog" or "align with the roadmap" means **categorise the whole list**, then order it — never leave a flat, unlabelled tail.

- Read the board's existing labels first (`GET /1/boards/{boardId}/labels`); reuse them, do not invent a parallel taxonomy.
- `scripts/trello-cards.sh` reads **and** writes labels: `labels` to display them, `label-add <card-id> <label-id>` and `label-remove` to modify them. Label IDs come from `scripts/trello-boards.sh labels <board-id>`. Credentials stay inside `~/.trello/config.json`, so no key or token reaches the command line.
- When you create a card, label it in the same pass.
- After any board organisation task, verify zero unlabelled cards remain on the lists you touched.

## Prerequisites

- Credentials configured in `~/.trello/config.json`
- `jq` and `curl` installed

## Setup

If not configured, run the setup script:
```bash
.agents/skills/trello/scripts/trello-setup.sh
```

## Board & List Operations

```bash
# List all boards
.agents/skills/trello/scripts/trello-boards.sh boards

# Find board by name
.agents/skills/trello/scripts/trello-boards.sh find "Personal2Weeks"

# Get board details
.agents/skills/trello/scripts/trello-boards.sh board <board-id>

# List all lists in a board
.agents/skills/trello/scripts/trello-boards.sh lists <board-id>

# Get list details
.agents/skills/trello/scripts/trello-boards.sh list <list-id>
```

## Card Operations

### Listing Cards

```bash
# List cards in a list
.agents/skills/trello/scripts/trello-cards.sh list <list-id>

# List up to 100 cards
.agents/skills/trello/scripts/trello-cards.sh list <list-id> 100

# Get JSON output (for scripting/sorting)
.agents/skills/trello/scripts/trello-cards.sh list-json <list-id>

# Read full card details
.agents/skills/trello/scripts/trello-cards.sh read <card-id>
```

### Creating & Updating Cards

```bash
# Create a card
.agents/skills/trello/scripts/trello-cards.sh create <list-id> "Card title" "Optional description"

# Update card field (name, desc, due, closed)
.agents/skills/trello/scripts/trello-cards.sh update <card-id> name "New title"

# Move card to another list
.agents/skills/trello/scripts/trello-cards.sh move <card-id> <list-id>
```

### Positioning Cards

```bash
# Move card to top of list
.agents/skills/trello/scripts/trello-cards.sh top <card-id>

# Move card to bottom of list
.agents/skills/trello/scripts/trello-cards.sh bottom <card-id>

# Set specific numeric position
.agents/skills/trello/scripts/trello-cards.sh position <card-id> 12345
```

### Comments

```bash
# Add comment
.agents/skills/trello/scripts/trello-cards.sh comment <card-id> "Comment text"

# List comments
.agents/skills/trello/scripts/trello-cards.sh comments <card-id>
```

### Archive & Delete

```bash
# Archive card
.agents/skills/trello/scripts/trello-cards.sh archive <card-id>

# Restore archived card
.agents/skills/trello/scripts/trello-cards.sh unarchive <card-id>

# Delete permanently (use with caution)
.agents/skills/trello/scripts/trello-cards.sh delete <card-id>
```

### Card Details

```bash
# Show labels
.agents/skills/trello/scripts/trello-cards.sh labels <card-id>

# Show assigned members
.agents/skills/trello/scripts/trello-cards.sh members <card-id>

# Show checklists
.agents/skills/trello/scripts/trello-cards.sh checklist <card-id>
```

## Adding Items Safely

Always confirm before creating:
1. Parse the request for: target list, card title, and optional description.
2. Find the appropriate board/list if not explicitly specified.
3. Show the proposed card details to the user.
4. Create the card only after explicit approval.

## Error Handling

- **Invalid credentials**: Re-run `trello-setup.sh` or verify `~/.trello/config.json`.
- **Board/list not found**: Check ID or use `find` command.
- **Rate limited**: Wait a few seconds and retry (Trello allows 300 requests per 10 seconds per API key).
