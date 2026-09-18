#!/usr/bin/env node
/**
 * @file tasks.mjs
 * @description Pure Node.js ESM execution engine for Google Tasks integration.
 * Handles local loopback OAuth 2.0 authentication, token refreshing, task CRUD
 * operations, and one-way synchronisation of Google Assistant tasks into Trello.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { URL, URLSearchParams } from 'node:url';

const CONFIG_DIR = path.join(os.homedir(), '.google-tasks');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'client_secret.json');
const TOKEN_FILE = path.join(CONFIG_DIR, 'token.json');
const SYNC_STATE_FILE = path.join(CONFIG_DIR, 'sync_state.json');
const TRELLO_CONFIG_FILE = path.join(os.homedir(), '.trello', 'config.json');
const TRELLO_BOARD_CONFIG_FILE = path.join(os.homedir(), '.trello', 'gtd_board_config.json');

const DEFAULT_OAUTH_PORT = 8085;

/**
 * Ensures the configuration directory exists.
 */
async function ensureConfigDir() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

/**
 * Safely parses JSON string, stripping UTF-8 BOM if present.
 */
function safeJsonParse(raw) {
  return JSON.parse(raw.replace(/^\uFEFF/, '').trim());
}

/**
 * Loads OAuth 2.0 client credentials from ~/.google-tasks/client_secret.json.
 */
export async function loadCredentials() {
  try {
    const raw = await fs.readFile(CREDENTIALS_FILE, 'utf-8');
    const parsed = safeJsonParse(raw);
    if (parsed.installed) {
      return {
        clientId: parsed.installed.client_id,
        clientSecret: parsed.installed.client_secret,
        redirectUris: parsed.installed.redirect_uris || [],
      };
    }
    if (parsed.web) {
      return {
        clientId: parsed.web.client_id,
        clientSecret: parsed.web.client_secret,
        redirectUris: parsed.web.redirect_uris || [],
      };
    }
    if (parsed.client_id && parsed.client_secret) {
      return {
        clientId: parsed.client_id,
        clientSecret: parsed.client_secret,
      };
    }
    throw new Error('Unrecognised credentials format in client_secret.json.');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Google Tasks credentials not found at ${CREDENTIALS_FILE}.\n` +
          'Please place your downloaded OAuth Desktop Client JSON file at that path.'
      );
    }
    throw error;
  }
}

/**
 * Loads cached OAuth 2.0 tokens from ~/.google-tasks/token.json.
 */
export async function loadTokens() {
  try {
    const raw = await fs.readFile(TOKEN_FILE, 'utf-8');
    return safeJsonParse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Saves OAuth 2.0 tokens to ~/.google-tasks/token.json.
 */
export async function saveTokens(tokens) {
  await ensureConfigDir();
  await fs.writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf-8');
}

/**
 * Loads Trello credentials from ~/.trello/config.json or environment variables.
 */
export async function loadTrelloConfig() {
  let key = process.env.TRELLO_API_KEY || null;
  let token = process.env.TRELLO_API_TOKEN || null;

  try {
    const raw = await fs.readFile(TRELLO_CONFIG_FILE, 'utf-8');
    const parsed = safeJsonParse(raw);
    key = key || parsed.key || parsed.apiKey || parsed.api_key;
    token = token || parsed.token || parsed.apiToken;
  } catch {
    // Config file not present, rely on environment if available
  }

  if (key && token) {
    return { api_key: key, token };
  }
  return null;
}

/**
 * Dynamically resolves the target Trello 'To Do' list ID from:
 * 1. Explicit argument
 * 2. Environment variable TRELLO_TODO_LIST_ID
 * 3. Local GTD board config ~/.trello/gtd_board_config.json
 */
export async function resolveTrelloTodoListId(explicitId) {
  if (explicitId) {
    return explicitId;
  }
  if (process.env.TRELLO_TODO_LIST_ID) {
    return process.env.TRELLO_TODO_LIST_ID;
  }
  try {
    const raw = await fs.readFile(TRELLO_BOARD_CONFIG_FILE, 'utf-8');
    const boardConfig = safeJsonParse(raw);
    if (boardConfig && Array.isArray(boardConfig.lists)) {
      const todoList = boardConfig.lists.find(
        (l) => l.name && l.name.trim().toLowerCase() === 'to do'
      );
      if (todoList && todoList.id) {
        return todoList.id;
      }
    }
  } catch {
    // Board config not present or unreadable
  }
  return null;
}

/**
 * Loads synchronisation state from ~/.google-tasks/sync_state.json.
 */
export async function loadSyncState() {
  try {
    const raw = await fs.readFile(SYNC_STATE_FILE, 'utf-8');
    return safeJsonParse(raw);
  } catch {
    return { syncedTaskIds: [], lastSyncedAt: null };
  }
}

/**
 * Saves synchronisation state to ~/.google-tasks/sync_state.json.
 */
export async function saveSyncState(state) {
  await ensureConfigDir();
  await fs.writeFile(SYNC_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Obtains a valid access token, automatically refreshing if close to expiry.
 */
export async function getValidAccessToken() {
  const credentials = await loadCredentials();
  const tokens = await loadTokens();

  if (!tokens || !tokens.refresh_token) {
    throw new Error(
      'Not authenticated with Google Tasks. Please run `node tasks.mjs auth` to log in.'
    );
  }

  const now = Date.now();
  const bufferMs = 5 * 60 * 1000; // 5 minutes buffer
  const isExpiring = !tokens.expiry_date || tokens.expiry_date - bufferMs <= now;

  if (!isExpiring && tokens.access_token) {
    return tokens.access_token;
  }

  // Refresh access token
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to refresh Google Tasks access token: ${errorBody}`);
  }

  const newTokens = await response.json();
  const updated = {
    ...tokens,
    access_token: newTokens.access_token,
    expiry_date: Date.now() + (newTokens.expires_in || 3600) * 1000,
  };

  await saveTokens(updated);
  return updated.access_token;
}

/**
 * Executes an authenticated API call to Google Tasks.
 */
export async function tasksApi(endpoint, options = {}) {
  const accessToken = await getValidAccessToken();
  const url = endpoint.startsWith('http')
    ? endpoint
    : `https://tasks.googleapis.com/tasks/v1/${endpoint.replace(/^\//, '')}`;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google Tasks API error [${response.status}]: ${errText}`);
  }

  if (response.status === 204) {
    return null;
  }

  return await response.json();
}

/**
 * Launches local HTTP loopback server to execute OAuth 2.0 authorisation.
 */
export async function authenticate() {
  await ensureConfigDir();
  const credentials = await loadCredentials();
  const port = DEFAULT_OAUTH_PORT;
  const redirectUri = `http://localhost:${port}/oauth2callback`;

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', credentials.clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/tasks');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (!req.url?.startsWith('/oauth2callback')) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const reqUrl = new URL(req.url, `http://localhost:${port}`);
        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h3>Authorisation Failed</h3><p>${error}</p>`);
          server.close();
          reject(new Error(`OAuth authorisation denied: ${error}`));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h3>Error</h3><p>Missing authorisation code.</p>');
          server.close();
          reject(new Error('Missing authorisation code from Google callback.'));
          return;
        }

        // Exchange code for tokens
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        });

        if (!tokenRes.ok) {
          const errText = await tokenRes.text();
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h3>Token Exchange Failed</h3><p>${errText}</p>`);
          server.close();
          reject(new Error(`Token exchange failed: ${errText}`));
          return;
        }

        const tokenData = await tokenRes.json();
        const storedTokens = {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          scope: tokenData.scope,
          token_type: tokenData.token_type,
          expiry_date: Date.now() + (tokenData.expires_in || 3600) * 1000,
        };

        await saveTokens(storedTokens);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Google Tasks Authorisation Successful</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .card { background: #1e293b; padding: 2rem 2.5rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; max-width: 420px; border: 1px solid #334155; }
                h2 { color: #38bdf8; margin-top: 0; }
                p { color: #94a3b8; line-height: 1.5; }
                .badge { display: inline-block; background: #065f46; color: #34d399; padding: 0.25rem 0.75rem; border-radius: 9999px; font-weight: 600; font-size: 0.85rem; margin-top: 1rem; }
              </style>
            </head>
            <body>
              <div class="card">
                <h2>Authorisation Complete</h2>
                <p>Google Tasks is now securely connected to your Antigravity Personal Assistant.</p>
                <div class="badge">Active & Ready</div>
                <p style="margin-top: 1.5rem; font-size: 0.85rem;">You may safely close this browser window and return to your terminal.</p>
              </div>
            </body>
          </html>
        `);

        server.close();
        resolve(storedTokens);
      } catch (err) {
        server.close();
        reject(err);
      }
    });

    server.listen(port, () => {
      console.log(`\nLocal authorisation listener started on http://localhost:${port}/`);
      console.log('Opening browser for Google Tasks authorisation...\n');
      console.log(`URL: ${authUrl.toString()}\n`);

      // Open in default browser
      const openCommand =
        process.platform === 'win32'
          ? `start "" "${authUrl.toString()}"`
          : process.platform === 'darwin'
          ? `open "${authUrl.toString()}"`
          : `xdg-open "${authUrl.toString()}"`;

      exec(openCommand, (err) => {
        if (err) {
          console.warn('Could not launch browser automatically. Please open the URL manually.');
        }
      });
    });

    server.on('error', (err) => {
      reject(new Error(`Local server failed to bind to port ${port}: ${err.message}`));
    });
  });
}

/**
 * Lists all task lists for the user.
 */
export async function listTaskLists() {
  const data = await tasksApi('users/@me/lists');
  return data.items || [];
}

/**
 * Lists tasks within a task list. Defaults to the primary list '@default'.
 */
export async function listTasks(listId = '@default', options = {}) {
  const params = new URLSearchParams();
  if (options.showCompleted) {
    params.set('showCompleted', 'true');
    params.set('showHidden', 'true');
  } else {
    params.set('showCompleted', 'false');
  }
  if (options.dueMax) {
    params.set('dueMax', new Date(options.dueMax).toISOString());
  }

  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await tasksApi(`lists/${encodeURIComponent(listId)}/tasks${query}`);
  return data.items || [];
}

/**
 * Creates a new task.
 */
export async function createTask(title, options = {}) {
  const listId = options.listId || '@default';
  const body = {
    title,
    notes: options.notes || undefined,
    due: options.due ? new Date(options.due).toISOString() : undefined,
  };

  return await tasksApi(`lists/${encodeURIComponent(listId)}/tasks`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Marks a task as completed.
 */
export async function completeTask(taskId, listId = '@default') {
  const body = {
    id: taskId,
    status: 'completed',
    completed: new Date().toISOString(),
  };

  return await tasksApi(`lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * Deletes a task.
 */
export async function deleteTask(taskId, listId = '@default') {
  return await tasksApi(`lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
  });
}

/**
 * One-way synchronises Google Tasks into the GTD Trello board.
 * Copies new, uncompleted tasks created via Google Assistant into Trello's 'To Do' list,
 * while leaving the Google Task intact so Google reminders remain active.
 */
export async function syncToTrello(options = {}) {
  const trelloConfig = await loadTrelloConfig();
  if (!trelloConfig || !trelloConfig.api_key || !trelloConfig.token) {
    throw new Error(
      `Trello configuration not found at ${TRELLO_CONFIG_FILE}.\nPlease ensure Trello is configured before syncing.`
    );
  }

  const targetListId = await resolveTrelloTodoListId(options.targetListId);
  if (!targetListId) {
    throw new Error(
      'Target Trello list ID could not be resolved.\n' +
      'Please specify --target-list-id <id>, set TRELLO_TODO_LIST_ID in your environment,\n' +
      'or bootstrap your GTD board with `python scripts/bootstrap-trello-board.py`.'
    );
  }

  const dryRun = options.dryRun || false;

  console.log('Ingesting active tasks from Google Tasks (@default)...');
  const tasks = await listTasks('@default', { showCompleted: false });
  const syncState = await loadSyncState();
  const syncedSet = new Set(syncState.syncedTaskIds || []);

  const newTasks = tasks.filter((t) => !syncedSet.has(t.id));

  if (newTasks.length === 0) {
    console.log('No new Google Tasks to synchronise with Trello.');
    return { syncedCount: 0, tasks: [] };
  }

  console.log(`Found ${newTasks.length} new task(s) to import into Trello (Target List: ${targetListId}).`);

  const importedTasks = [];

  for (const task of newTasks) {
    const cardTitle = `[Google Assistant] ${task.title}`;
    let cardDesc = `Imported from Google Tasks\n\n`;
    if (task.notes) cardDesc += `**Notes:**\n${task.notes}\n\n`;
    if (task.due) cardDesc += `**Due Date:** ${task.due}\n`;
    cardDesc += `**Google Task ID:** \`${task.id}\`\n`;
    cardDesc += `**Imported At:** ${new Date().toISOString()}`;

    if (dryRun) {
      console.log(`[DRY RUN] Would create card: "${cardTitle}"`);
      importedTasks.push({ id: task.id, title: task.title, status: 'dry-run' });
      continue;
    }

    const trelloUrl = new URL('https://api.trello.com/1/cards');
    trelloUrl.searchParams.set('key', trelloConfig.api_key);
    trelloUrl.searchParams.set('token', trelloConfig.token);
    trelloUrl.searchParams.set('idList', targetListId);
    trelloUrl.searchParams.set('name', cardTitle);
    trelloUrl.searchParams.set('desc', cardDesc);
    trelloUrl.searchParams.set('pos', 'top');

    const res = await fetch(trelloUrl, { method: 'POST' });
    if (!res.ok) {
      const err = await res.text();
      console.error(`Failed to create Trello card for "${task.title}": ${err}`);
      continue;
    }

    const createdCard = await res.json();
    console.log(`✓ Imported to Trello: "${cardTitle}" (Card ID: ${createdCard.id})`);

    syncedSet.add(task.id);
    importedTasks.push({
      googleTaskId: task.id,
      trelloCardId: createdCard.id,
      title: task.title,
    });
  }

  if (!dryRun) {
    await saveSyncState({
      syncedTaskIds: Array.from(syncedSet),
      lastSyncedAt: new Date().toISOString(),
    });
  }

  return {
    syncedCount: importedTasks.length,
    tasks: importedTasks,
  };
}

/**
 * CLI Entrypoint
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  try {
    switch (command) {
      case 'auth': {
        console.log('Initiating Google Tasks OAuth 2.0 flow...');
        await authenticate();
        console.log('Authentication successful! Tokens stored in ~/.google-tasks/token.json');
        break;
      }

      case 'status': {
        try {
          const creds = await loadCredentials();
          const tokens = await loadTokens();
          console.log('\nGoogle Tasks Integration Status:');
          console.log(`- Credentials file: ${CREDENTIALS_FILE} (Found: Yes)`);
          console.log(`- Client ID: ...${creds.clientId.slice(-8)}`);
          if (tokens && tokens.access_token) {
            const exp = tokens.expiry_date ? new Date(tokens.expiry_date).toLocaleString() : 'Unknown';
            console.log(`- Authentication: Active (Access token expires: ${exp})`);
            console.log(`- Refresh token: Present`);
          } else {
            console.log('- Authentication: Not logged in. Run `node tasks.mjs auth`.');
          }
        } catch (e) {
          console.log(`- Status: Unconfigured (${e.message})`);
        }
        break;
      }

      case 'lists': {
        const lists = await listTaskLists();
        console.log(`\nFound ${lists.length} Task List(s):`);
        lists.forEach((l) => console.log(` - [${l.id}] ${l.title}`));
        break;
      }

      case 'list': {
        let listId = '@default';
        let showCompleted = false;
        let asJson = false;

        for (let i = 1; i < args.length; i++) {
          if (args[i] === '--list-id' && args[i + 1]) listId = args[++i];
          if (args[i] === '--show-completed') showCompleted = true;
          if (args[i] === '--json') asJson = true;
        }

        const tasks = await listTasks(listId, { showCompleted });
        if (asJson) {
          console.log(JSON.stringify(tasks, null, 2));
        } else {
          console.log(`\nTasks in [${listId}] (${tasks.length} active):`);
          if (tasks.length === 0) {
            console.log(' (No active tasks found)');
          } else {
            tasks.forEach((t) => {
              const dueStr = t.due ? ` [Due: ${t.due.split('T')[0]}]` : '';
              console.log(` • [${t.id}] ${t.title}${dueStr}`);
              if (t.notes) console.log(`    Notes: ${t.notes.replace(/\n/g, ' ')}`);
            });
          }
        }
        break;
      }

      case 'add': {
        let title = '';
        let notes = '';
        let due = '';
        let listId = '@default';

        for (let i = 1; i < args.length; i++) {
          if (args[i] === '--title' && args[i + 1]) title = args[++i];
          if (args[i] === '--notes' && args[i + 1]) notes = args[++i];
          if (args[i] === '--due' && args[i + 1]) due = args[++i];
          if (args[i] === '--list-id' && args[i + 1]) listId = args[++i];
        }

        if (!title) {
          console.error('Error: --title is required. Example: node tasks.mjs add --title "Buy milk"');
          process.exit(1);
        }

        const created = await createTask(title, { notes, due, listId });
        console.log(`✓ Task created: "${created.title}" [ID: ${created.id}]`);
        break;
      }

      case 'complete': {
        const taskId = args[1];
        if (!taskId) {
          console.error('Error: Task ID required. Example: node tasks.mjs complete <taskId>');
          process.exit(1);
        }
        await completeTask(taskId);
        console.log(`✓ Task [${taskId}] marked as completed.`);
        break;
      }

      case 'delete': {
        const taskId = args[1];
        if (!taskId) {
          console.error('Error: Task ID required. Example: node tasks.mjs delete <taskId>');
          process.exit(1);
        }
        await deleteTask(taskId);
        console.log(`✓ Task [${taskId}] deleted.`);
        break;
      }

      case 'sync-trello': {
        let targetListId = null;
        let dryRun = false;

        for (let i = 1; i < args.length; i++) {
          if (args[i] === '--target-list-id' && args[i + 1]) targetListId = args[++i];
          if (args[i] === '--dry-run') dryRun = true;
        }

        const result = await syncToTrello({ targetListId, dryRun });
        console.log(`\nSynchronisation complete: ${result.syncedCount} task(s) processed.`);
        break;
      }

      default: {
        console.log(`
Google Tasks CLI Engine for Antigravity Personal Assistant

Commands:
  auth                     Run interactive local OAuth 2.0 login
  status                   Check credentials and active authentication
  lists                    List all Google Task lists
  list [--list-id <id>]    List active tasks in a list (default: @default)
  add --title "<text>"     Create a new task (--notes, --due YYYY-MM-DD)
  complete <taskId>        Mark a task as completed
  delete <taskId>          Delete a task
  sync-trello [--dry-run]  Import new Google Tasks into Trello's To Do list
        `);
      }
    }
  } catch (error) {
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }
}

// Execute if run directly from CLI
if (process.argv[1] && (process.argv[1].endsWith('tasks.mjs') || process.argv[1].includes('tasks.mjs'))) {
  main();
}
