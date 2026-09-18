#!/usr/bin/env python3
r"""
Public Release Sync & Security Audit Gate

Automates synchronisation from your working repository to a clean,
public GitHub repository (default: E:\Development\antigravity-personal-assistant-public).

Enforces an aggressive security audit that halts execution if any credentials,
API keys, access tokens, private keys, or personal identifying data (PII) are detected.

Usage:
    python scripts/sync-to-public.py [--audit-only] [--dest PATH] [--commit] [--dry-run]
"""

import os
import sys
import re
import json
import shutil
import argparse
import subprocess
from pathlib import Path

# Ensure UTF-8 output on Windows console
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Files and directory trees to synchronise
SYNC_TARGETS = [
    ".agents/skills",
    ".agents/plugins/google-workspace/plugin.json",
    ".agents/plugins/google-workspace/mcp_config.example.json",
    ".agents/plugins/google-tasks/plugin.json",
    ".agents/plugins/google-tasks/mcp_config.example.json",
    "docs",
    "scripts/bootstrap-trello-board.py",
    "scripts/setup-workspace-mcp.py",
    "scripts/sync-to-public.py",
    ".gitignore",
    "gemini.md",
    "README.md",
    "LICENSE",
]

# Universal Credential & Security Patterns
UNIVERSAL_SECRET_PATTERNS = [
    (r"AIza[0-9A-Za-z-_]{35}", "Google API Key"),
    (r"sk-[a-zA-Z0-9]{20,}", "OpenAI API Key"),
    (r"sk-ant-[a-zA-Z0-9]{20,}", "Anthropic API Key"),
    (r"AKIA[0-9A-Z]{16}", "AWS Access Key"),
    (r"ghp_[a-zA-Z0-9]{36}", "GitHub Personal Access Token"),
    (r"github_pat_[a-zA-Z0-9_]{40,}", "GitHub Fine-Grained Token"),
    (r"-----BEGIN[ A-Z_-]*PRIVATE KEY-----", "Private Key Header"),
    (r"https://hooks\.slack\.com/services/[A-Za-z0-9+/]{44,}", "Slack Webhook URL"),
    (r"https://discord\.com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+", "Discord Webhook URL"),
    (r"(?:api[_-]?key|api[_-]?token|client[_-]?secret|auth[_-]?token)\s*[:=]\s*['\"][a-zA-Z0-9_\-\.]{16,}['\"]", "Hardcoded Secret Token"),
    (r"(?:password|passwd)\s*[:=]\s*['\"][^'\"]{8,}['\"]", "Hardcoded Password Assignment"),
]


def load_pii_patterns(src_root, custom_blocklist_path=None):
    """Load universal security rules and merge any local custom blocklists."""
    patterns = [(re.compile(p, re.IGNORECASE), desc) for p, desc in UNIVERSAL_SECRET_PATTERNS]

    # Search for local user-specific blocklists (strictly ignored by .gitignore)
    candidate_paths = []
    if custom_blocklist_path:
        candidate_paths.append(Path(custom_blocklist_path))
    candidate_paths.append(src_root / ".pii-blocklist.local.json")
    candidate_paths.append(Path.home() / ".antigravity" / "pii-blocklist.json")

    loaded_custom = 0
    for pth in candidate_paths:
        if pth.exists():
            try:
                with open(pth, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    rules = data.get("prohibited_patterns", [])
                    for r in rules:
                        pat_str = r.get("pattern")
                        desc = r.get("description", "Custom Local PII Rule")
                        if pat_str:
                            patterns.append((re.compile(pat_str, re.IGNORECASE), desc))
                            loaded_custom += 1
                print(f"Loaded {loaded_custom} custom PII rule(s) from {pth}")
                break
            except Exception as e:
                print(f"Warning: Failed reading custom blocklist {pth}: {e}", file=sys.stderr)

    return patterns


def collect_source_files(src_root):
    """Resolve all files to be synchronised."""
    files_to_sync = []
    for target in SYNC_TARGETS:
        target_path = src_root / target
        if target_path.is_file():
            files_to_sync.append(target_path)
        elif target_path.is_dir():
            for root, _, files in os.walk(target_path):
                for f in files:
                    full_p = Path(root) / f
                    # Skip git, cache, and local ignore artifacts
                    if ".git" in full_p.parts or "__pycache__" in full_p.parts:
                        continue
                    if full_p.name.endswith(".local.json"):
                        continue
                    files_to_sync.append(full_p)
    return sorted(list(set(files_to_sync)))


def audit_file_for_secrets_and_pii(file_path, compiled_patterns):
    """Scan a single file for credentials or prohibited patterns."""
    violations = []
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            for line_idx, line in enumerate(f, start=1):
                line_str = line.strip()
                # Skip placeholder syntax examples in documentation
                if "YOUR_" in line_str or "<YOUR_" in line_str:
                    continue

                for pattern_re, desc in compiled_patterns:
                    # Ignore the scanner's own definitions
                    if file_path.name == "sync-to-public.py" and "UNIVERSAL_SECRET_PATTERNS" in line_str:
                        continue

                    if pattern_re.search(line):
                        violations.append({
                            "file": file_path,
                            "line": line_idx,
                            "desc": desc,
                            "snippet": line_str
                        })
    except Exception as e:
        violations.append({
            "file": file_path,
            "line": 0,
            "desc": f"Read error: {e}",
            "snippet": ""
        })
    return violations


def run_security_audit(files, compiled_patterns):
    """Scan all candidate files and report any credential or PII violations."""
    print("==================================================")
    print(" Running Rigorous Security & PII Audit")
    print("==================================================")
    all_violations = []

    for f in files:
        violations = audit_file_for_secrets_and_pii(f, compiled_patterns)
        if violations:
            all_violations.extend(violations)

    if all_violations:
        print(f"\n[FAIL] AUDIT FAILED! Found {len(all_violations)} violation(s):\n")
        for v in all_violations:
            print(f"  [VIOLATION] {v['file']}:{v['line']}")
            print(f"              Type:    {v['desc']}")
            print(f"              Snippet: {v['snippet']}")
            print("-" * 50)
        print("\nAborting synchronisation. Please scrub credentials and PII before publishing.")
        return False

    print(f" All {len(files)} files passed security audit with zero violations!\n")
    return True


def copy_files(src_root, dest_root, files, dry_run=False):
    """Copy validated files to target repository maintaining relative structure."""
    print(f"==================================================")
    print(f" Synchronising files to {dest_root}")
    print(f"==================================================")

    copied_count = 0
    for src_file in files:
        rel_path = src_file.relative_to(src_root)
        dest_file = dest_root / rel_path

        if dry_run:
            print(f"  [DRY-RUN] Would copy: {rel_path}")
            copied_count += 1
            continue

        dest_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_file, dest_file)
        print(f"  Copied: {rel_path}")
        copied_count += 1

    print(f"\nSuccessfully synchronised {copied_count} file(s).")


def init_git_repo(dest_root, dry_run=False):
    """Ensure destination directory is an independent Git repository with main branch."""
    git_dir = dest_root / ".git"
    if not git_dir.exists():
        print(f"\nInitialising clean Git repository in {dest_root}...")
        if not dry_run:
            subprocess.run(["git", "init", "-b", "main"], cwd=str(dest_root), check=True)
            print(" Pristine Git repository initialised.")
    else:
        print(f"\nGit repository already initialised in {dest_root}.")


def git_commit_changes(dest_root, commit_message):
    """Stage all changes and commit in the public repository."""
    print(f"\nStaging and committing in {dest_root}...")
    subprocess.run(["git", "add", "-A"], cwd=str(dest_root), check=True)
    res = subprocess.run(["git", "status", "--porcelain"], cwd=str(dest_root), capture_output=True, text=True)
    if res.stdout.strip():
        subprocess.run(["git", "commit", "-m", commit_message], cwd=str(dest_root), check=True)
        print(" Changes committed cleanly.")
        # Deep prune git reflog and loose objects to guarantee zero stale blobs
        subprocess.run(["git", "reflog", "expire", "--expire=now", "--all"], cwd=str(dest_root), check=True)
        subprocess.run(["git", "gc", "--prune=now"], cwd=str(dest_root), check=True)
        print(" Git repository deep-pruned (reflogs expired, loose objects vacuumed).")
    else:
        print(" No changes to commit (working tree clean).")


def main():
    parser = argparse.ArgumentParser(description="Synchronise clean, PII-audited files to public repository.")
    parser.add_argument("--src", default=None, help="Source workspace root (default: current repository root)")
    parser.add_argument("--dest", default=r"E:\Development\antigravity-personal-assistant-public", help="Destination public repository directory")
    parser.add_argument("--blocklist", default=None, help="Path to custom JSON file with prohibited PII patterns")
    parser.add_argument("--audit-only", action="store_true", help="Only run security audit without synchronising files")
    parser.add_argument("--commit", action="store_true", help="Automatically commit changes in destination repository")
    parser.add_argument("--commit-msg", default="feat: initial public release of Antigravity Personal Assistant", help="Commit message for --commit")
    parser.add_argument("--dry-run", action="store_true", help="Simulate actions without modifying filesystem")
    args = parser.parse_args()

    src_root = Path(args.src).resolve() if args.src else Path(__file__).resolve().parent.parent
    dest_root = Path(args.dest).resolve()

    compiled_patterns = load_pii_patterns(src_root, args.blocklist)
    files = collect_source_files(src_root)
    if not files:
        print("Warning: No candidate files found to audit or sync!", file=sys.stderr)
        sys.exit(1)

    # 1. Enforce Security & PII Audit
    audit_passed = run_security_audit(files, compiled_patterns)
    if not audit_passed or args.audit_only:
        sys.exit(0 if audit_passed else 1)

    # 2. Prepare Destination & Git Repo
    if not dest_root.exists() and not args.dry_run:
        dest_root.mkdir(parents=True, exist_ok=True)

    init_git_repo(dest_root, dry_run=args.dry_run)

    # 3. Synchronise Files
    copy_files(src_root, dest_root, files, dry_run=args.dry_run)

    # 4. Optional Git Commit
    if args.commit and not args.dry_run:
        git_commit_changes(dest_root, args.commit_msg)

    print("\n==================================================")
    print(" Synchronisation Completed Successfully!")
    print(f" Clean Public Repo: {dest_root}")
    print("==================================================")


if __name__ == "__main__":
    main()
