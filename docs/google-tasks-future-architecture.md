# Google Tasks Integration & Future Roadmap

## 1. Context & Current Status

In our Google Workspace integration via `gemini-cli-extensions/workspace`, **Google Calendar** and **Gmail** are fully operational out of the box using Google's default published OAuth client and token exchange endpoint.

However, **Google Tasks** is intentionally marked as experimental and **disabled by default** in the upstream codebase (`workspace-server/src/features/feature-config.ts`):

```typescript
// Tasks (experimental — not in published GCP project)
{
  service: 'tasks',
  group: 'read',
  scopes: scopes('tasks.readonly'),
  tools: ['tasks.listLists', 'tasks.list'],
  defaultEnabled: false,
},
{
  service: 'tasks',
  group: 'write',
  scopes: scopes('tasks'),
  tools: ['tasks.create', 'tasks.update', 'tasks.complete', 'tasks.delete'],
  defaultEnabled: false,
}
```

### Why Google Tasks Cannot Be Enabled with the Default Client
The default client ID bundled with the MCP server points to a published Google Cloud Platform (GCP) project that has only registered OAuth consent for Docs, Drive, Calendar, Chat, Gmail, People, and read-only Sheets.

If you attempt to force Google Tasks on by setting:
```bash
WORKSPACE_FEATURE_OVERRIDES="tasks.read:on,tasks.write:on"
```
the OAuth flow will request `https://www.googleapis.com/auth/tasks` and `https://www.googleapis.com/auth/tasks.readonly`. Because these scopes are not in the approved consent screen of the shared project, Google OAuth will block authorisation with an error (`"This app is blocked"` or `"Unauthorised scope requested"`).

---

## 2. Future Enablement: Creating a Custom GCP Project

If Google Tasks integration becomes necessary in future, you can unlock full read/write support by deploying your own GCP project and proxy Cloud Function.

### Prerequisites
* A Google Cloud Platform (GCP) account with a billing-enabled project.
* Google Cloud CLI (`gcloud`) installed and authenticated on your machine.
* Docker or Node.js to deploy the Cloud Function proxy.

### Step-by-Step Enablement Guide

#### Step 2.1: Enable Required GCP APIs
In your custom GCP project, enable the Google Tasks API alongside Calendar and Gmail:
```bash
gcloud config set project YOUR_CUSTOM_PROJECT_ID
gcloud services enable tasks.googleapis.com calendar-json.googleapis.com gmail.googleapis.com secretmanager.googleapis.com cloudfunctions.googleapis.com cloudbuild.googleapis.com
```

#### Step 2.2: Configure the OAuth Consent Screen
1. Open the **Google Cloud Console** > **APIs & Services** > **OAuth consent screen**.
2. Select **User Type** (External for personal Google accounts, or Internal for Google Workspace domains).
3. Add the following scopes:
   * `https://www.googleapis.com/auth/tasks`
   * `https://www.googleapis.com/auth/tasks.readonly`
   * `https://www.googleapis.com/auth/calendar`
   * `https://www.googleapis.com/auth/calendar.readonly`
   * `https://www.googleapis.com/auth/gmail.modify`
   * `https://www.googleapis.com/auth/gmail.readonly`
4. In **Test Users**, add your personal Google email address.

#### Step 2.3: Deploy the Cloud Function Token Exchange Proxy
The upstream repository provides an automated script in `scripts/setup-gcp.sh` and source in `cloud_function/`. The Cloud Function protects your OAuth `CLIENT_SECRET` in Google Secret Manager so it is never exposed in local code.

Run the setup script from the cloned MCP directory:
```bash
cd path/to/google-workspace-mcp
./scripts/setup-gcp.sh
```
This will:
1. Deploy the Cloud Function to your GCP project.
2. Provide the redirect URI to register on your OAuth client credentials.
3. Prompt for your OAuth Client ID and Client Secret, storing the secret in Secret Manager.

#### Step 2.4: Configure Environment Variables
Once deployed, configure the MCP server environment in `.agents/plugins/google-workspace/mcp_config.json`:
```json
{
  "mcpServers": {
    "google_workspace": {
      "command": "node",
      "args": [
        "/path/to/google-workspace-mcp/workspace-server/dist/index.js"
      ],
      "env": {
        "WORKSPACE_CLIENT_ID": "YOUR_CUSTOM_CLIENT_ID.apps.googleusercontent.com",
        "WORKSPACE_CLOUD_FUNCTION_URL": "https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/exchange-token",
        "WORKSPACE_FEATURE_OVERRIDES": "tasks.read:on,tasks.write:on,gmail.send:off,calendar.deleteEvent:off"
      }
    }
  }
}
```

#### Step 2.5: Re-authenticate
Run the login utility to authorise the new scopes:
```bash
npm run auth-utils -- login
```

---

## 3. Alternative Approaches & Comparative Evaluation

### Alternative: `sanjay3290/ai-skills`
The repository at [sanjay3290/ai-skills](https://github.com/sanjay3290/ai-skills) provides standalone script-based skills (e.g. Python scripts executing against Google APIs).

| Dimension | `gemini-cli-extensions/workspace` (Our Setup) | `sanjay3290/ai-skills` |
| :--- | :--- | :--- |
| **Architecture** | Native Model Context Protocol (MCP) server over `stdio` | Python CLI scripts called via agent bash/PowerShell |
| **Tool Calling** | Direct, typed schema tool calls (`calendar_listEvents`) | Shell command invocation (`python scripts/gcal.py`) |
| **Scope Isolation** | Project-scoped via `.agents/plugins/` | Copied into agent skill directory |
| **Tasks Support** | Disabled by default (requires custom GCP) | Not supported out of the box (requires custom script) |
| **Token Storage** | OS Keychain / Windows Credential Manager (`keytar`) | Local JSON / keyring |

### Workflow Context (GTD & Trello)
Given that our master operational workflow centres around David Allen's Getting Things Done (GTD) methodology hosted on the 21-column GTD Trello board, next actions and projects are already systematically tracked in Trello. 

Having **Google Calendar** (for time-bound landscape commitments) and **Gmail** (for communication triage and drafting) connected via MCP provides an ideal complement to Trello without creating duplicate task lists in Google Tasks.
