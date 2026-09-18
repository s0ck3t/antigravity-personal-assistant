#!/usr/bin/env python3
"""
Trello 21-Column GTD Rolling Board Bootstrapper

Creates a complete, production-ready GTD Two-Week Rolling Board on Trello
with 7 GTD pipeline lists, 14 calendar day lists, and standard context labels.

Usage:
    python scripts/bootstrap-trello-board.py [--name "Personal2Weeks"] [--dry-run]
"""

import os
import sys
import json
import argparse
import urllib.request
import urllib.parse
from pathlib import Path

LIST_DEFINITIONS = [
    # GTD Pipeline (Columns 1-7)
    "Sometime maybe",
    "Projects",
    "In Progress Projects",
    "On hold",
    "To Do",
    "Waiting on others",
    "To Do high priority",
    # Week 1 Execution Horizon (Columns 8-14)
    "Monday (Week 1)",
    "Tuesday (Week 1)",
    "Wednesday (Week 1)",
    "Thursday (Week 1)",
    "Friday (Week 1)",
    "Saturday (Week 1)",
    "Sunday (Week 1)",
    # Week 2 Execution Horizon (Columns 15-21)
    "Monday (Week 2)",
    "Tuesday (Week 2)",
    "Wednesday (Week 2)",
    "Thursday (Week 2)",
    "Friday (Week 2)",
    "Saturday (Week 2)",
    "Sunday (Week 2)",
]

DEFAULT_LABELS = [
    {"name": "Home", "color": "green"},
    {"name": "Online/Admin", "color": "blue"},
    {"name": "Finance", "color": "yellow"},
    {"name": "Call", "color": "orange"},
    {"name": "Waiting", "color": "purple"},
    {"name": "High Priority", "color": "red"},
]


def load_credentials(config_path=None):
    """Load Trello API credentials from ~/.trello/config.json or environment."""
    key = os.environ.get("TRELLO_API_KEY")
    token = os.environ.get("TRELLO_API_TOKEN")

    if not key or not token:
        if config_path is None:
            config_path = Path.home() / ".trello" / "config.json"
        else:
            config_path = Path(config_path)

        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    key = key or data.get("key") or data.get("apiKey")
                    token = token or data.get("token") or data.get("apiToken")
            except Exception as e:
                print(f"Error reading credentials file {config_path}: {e}", file=sys.stderr)

    if not key or not token:
        print("Error: Trello API credentials not found!", file=sys.stderr)
        print("Please configure credentials in ~/.trello/config.json:", file=sys.stderr)
        print('  {\n    "key": "YOUR_TRELLO_API_KEY",\n    "token": "YOUR_TRELLO_API_TOKEN"\n  }', file=sys.stderr)
        print("Or set environment variables TRELLO_API_KEY and TRELLO_API_TOKEN.", file=sys.stderr)
        sys.exit(1)

    return key, token


def make_request(url, method="GET", data=None):
    """Perform an HTTP request against the Trello REST API."""
    headers = {
        "Accept": "application/json",
        "User-Agent": "Antigravity-GTD-Bootstrapper/1.0"
    }
    encoded_data = None
    if data:
        encoded_data = urllib.parse.urlencode(data).encode("utf-8")

    req = urllib.request.Request(url, data=encoded_data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"API Error ({e.code}): {err_body}", file=sys.stderr)
        raise


def bootstrap_board(board_name, dry_run=False, output_file=None):
    """Create the board, 21 lists, and standard labels."""
    print(f"==================================================")
    print(f" Bootstrapping GTD Two-Week Rolling Board: '{board_name}'")
    print(f"==================================================")

    if dry_run:
        print("[DRY-RUN] Simulating board creation:")
        for idx, list_name in enumerate(LIST_DEFINITIONS, start=1):
            print(f"  Column {idx:02d}: {list_name}")
        print("\nDefault labels to create:")
        for lbl in DEFAULT_LABELS:
            print(f"  Label: {lbl['name']} ({lbl['color']})")
        return

    key, token = load_credentials()

    # 1. Create Board (with defaultLists=false so Trello doesn't make To Do / Doing / Done)
    create_board_url = "https://api.trello.com/1/boards"
    board_payload = {
        "name": board_name,
        "defaultLists": "false",
        "defaultLabels": "false",
        "key": key,
        "token": token
    }
    print(f"Creating board '{board_name}'...")
    board_data = make_request(create_board_url, method="POST", data=board_payload)
    board_id = board_data["id"]
    board_url = board_data["shortUrl"]
    print(f" Board created successfully!")
    print(f"  Board ID:  {board_id}")
    print(f"  Board URL: {board_url}\n")

    # 2. Create the 21 columns in sequence
    lists_output = []
    create_list_url = f"https://api.trello.com/1/boards/{board_id}/lists"
    print("Creating 21 GTD & Calendar lists...")
    for idx, list_name in enumerate(LIST_DEFINITIONS, start=1):
        list_payload = {
            "name": list_name,
            "pos": idx * 1000,
            "key": key,
            "token": token
        }
        res = make_request(create_list_url, method="POST", data=list_payload)
        lists_output.append({
            "index": idx,
            "name": list_name,
            "id": res["id"]
        })
        print(f"  [{idx:02d}/21] Created list: '{list_name}' ({res['id']})")

    # 3. Create Default Context Labels
    print("\nCreating default GTD context labels...")
    create_label_url = f"https://api.trello.com/1/boards/{board_id}/labels"
    labels_output = []
    for lbl in DEFAULT_LABELS:
        label_payload = {
            "name": lbl["name"],
            "color": lbl["color"],
            "key": key,
            "token": token
        }
        res = make_request(create_label_url, method="POST", data=label_payload)
        labels_output.append({
            "name": lbl["name"],
            "color": lbl["color"],
            "id": res["id"]
        })
        print(f"  Created label: '{lbl['name']}' ({lbl['color']})")

    # 4. Save metadata summary
    summary = {
        "board_name": board_name,
        "board_id": board_id,
        "board_url": board_url,
        "lists": lists_output,
        "labels": labels_output
    }

    if output_file is None:
        output_file = Path.home() / ".trello" / "gtd_board_config.json"
    else:
        output_file = Path(output_file)

    try:
        output_file.parent.mkdir(parents=True, exist_ok=True)
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2)
        print(f"\n Board configuration saved to: {output_file}")
    except Exception as e:
        print(f"\nWarning: Could not save configuration to {output_file}: {e}", file=sys.stderr)

    print("\n==================================================")
    print(" GTD Two-Week Rolling Board Setup Complete!")
    print(f" Open your board at: {board_url}")
    print(f" Your Board ID:      {board_id}")
    print("==================================================")


def main():
    parser = argparse.ArgumentParser(description="Bootstrap a 21-column GTD Two-Week Rolling Board in Trello.")
    parser.add_argument("--name", default="Personal2Weeks", help="Name of the new Trello board (default: Personal2Weeks)")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without creating resources in Trello")
    parser.add_argument("--output", default=None, help="Path to save output JSON configuration (default: ~/.trello/gtd_board_config.json)")
    args = parser.parse_args()

    bootstrap_board(board_name=args.name, dry_run=args.dry_run, output_file=args.output)


if __name__ == "__main__":
    main()
