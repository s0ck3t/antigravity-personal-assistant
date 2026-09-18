#!/usr/bin/env python3
"""
Google Workspace MCP Installer & Setup Helper

Clones the official Google Workspace MCP server repository (gemini-cli-extensions/workspace),
installs dependencies, compiles the TypeScript project, generates the Antigravity
mcp_config.json configuration, and triggers OAuth browser authentication.

Usage:
    python scripts/setup-workspace-mcp.py [--tools-dir tools/google-workspace-mcp] [--skip-login] [--dry-run]
"""

import os
import sys
import shutil
import subprocess
import argparse
import json
from pathlib import Path

DEFAULT_REPO_URL = "https://github.com/gemini-cli-extensions/workspace.git"


def check_command(cmd_name):
    """Verify an external command is present in the system PATH."""
    path = shutil.which(cmd_name)
    if not path:
        print(f"Error: '{cmd_name}' is not installed or not found in your PATH.", file=sys.stderr)
        return False
    return True


def run_cmd(cmd_list, cwd=None, dry_run=False):
    """Execute a system command with real-time output streaming."""
    cmd_str = " ".join(cmd_list)
    print(f"--> Executing: {cmd_str} (in {cwd or '.'})")
    if dry_run:
        return True

    res = subprocess.run(cmd_list, cwd=cwd)
    if res.returncode != 0:
        print(f"Command failed with return code {res.returncode}: {cmd_str}", file=sys.stderr)
        return False
    return True


def setup_workspace(tools_dir, repo_url=DEFAULT_REPO_URL, skip_login=False, dry_run=False):
    print("==================================================")
    print(" Setting up Google Workspace MCP (Calendar & Gmail)")
    print("==================================================")

    # 1. Check prerequisites
    if not check_command("git") or not check_command("node") or not check_command("npm"):
        print("Please install Git and Node.js (with npm) before proceeding.", file=sys.stderr)
        sys.exit(1)

    repo_root = Path(__file__).resolve().parent.parent
    target_dir = repo_root / tools_dir

    # 2. Clone or update repository
    if not target_dir.exists():
        print(f"\n1. Cloning Google Workspace MCP server into {target_dir}...")
        success = run_cmd(["git", "clone", repo_url, str(target_dir)], cwd=str(repo_root), dry_run=dry_run)
        if not success:
            sys.exit(1)
    else:
        print(f"\n1. Target directory already exists: {target_dir}")

    # 3. Install dependencies and build
    print("\n2. Installing npm packages and building project...")
    if not run_cmd(["npm", "install"], cwd=str(target_dir), dry_run=dry_run):
        sys.exit(1)

    if not run_cmd(["npm", "run", "build"], cwd=str(target_dir), dry_run=dry_run):
        sys.exit(1)

    # 4. Generate mcp_config.json
    print("\n3. Generating Antigravity MCP plugin configuration...")
    plugin_dir = repo_root / ".agents" / "plugins" / "google-workspace"
    plugin_dir.mkdir(parents=True, exist_ok=True)
    mcp_config_file = plugin_dir / "mcp_config.json"

    server_entrypoint = target_dir / "workspace-server" / "dist" / "index.js"
    # Fallback check if upstream restructured
    if not server_entrypoint.exists() and not dry_run:
        alt_entry = target_dir / "dist" / "index.js"
        if alt_entry.exists():
            server_entrypoint = alt_entry

    config_payload = {
        "mcpServers": {
            "google_workspace": {
                "command": "node",
                "args": [
                    str(server_entrypoint.resolve())
                ],
                "env": {
                    "WORKSPACE_FEATURE_OVERRIDES": "gmail.send:off,calendar.deleteEvent:off"
                }
            }
        }
    }

    if not dry_run:
        with open(mcp_config_file, "w", encoding="utf-8") as f:
            json.dump(config_payload, f, indent=2)
        print(f" Generated configuration saved to: {mcp_config_file}")
    else:
        print(f" [DRY-RUN] Would write config to: {mcp_config_file}")
        print(json.dumps(config_payload, indent=2))

    # 5. Authorise via OAuth
    if not skip_login:
        print("\n4. Launching Google OAuth authorisation...")
        print(" A browser window will open. Please sign in and grant access for Calendar and Gmail.")
        run_cmd(["npm", "run", "auth-utils", "--", "login"], cwd=str(target_dir), dry_run=dry_run)
    else:
        print("\n4. Skipping OAuth login as requested (--skip-login).")
        print(" When ready, run the login utility:")
        print(f"   cd {target_dir} && npm run auth-utils -- login")

    print("\n==================================================")
    print(" Google Workspace MCP Setup Complete!")
    print(" Calendar and Gmail tools are now enabled in Antigravity.")
    print("==================================================")


def main():
    parser = argparse.ArgumentParser(description="Set up and configure Google Workspace MCP server.")
    parser.add_argument("--tools-dir", default="tools/google-workspace-mcp", help="Directory to clone and build MCP server")
    parser.add_argument("--skip-login", action="store_true", help="Skip the browser OAuth login step")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without executing commands or writing files")
    args = parser.parse_args()

    setup_workspace(tools_dir=args.tools_dir, skip_login=args.skip_login, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
