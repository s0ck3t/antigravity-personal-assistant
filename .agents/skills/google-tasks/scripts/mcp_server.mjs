#!/usr/bin/env node
/**
 * @file mcp_server.mjs
 * @description Lightweight, zero-dependency Model Context Protocol (MCP) server
 * for Google Tasks over stdio. Exposes Google Tasks tools and one-way Trello syncing.
 */

import readline from 'node:readline';
import {
  listTaskLists,
  listTasks,
  createTask,
  completeTask,
  deleteTask,
  syncToTrello,
} from './tasks.mjs';

const TOOLS = [
  {
    name: 'tasks_listLists',
    description: 'List all task lists in the authenticated Google account.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tasks_list',
    description: 'List active tasks from a Google Task list.',
    inputSchema: {
      type: 'object',
      properties: {
        listId: {
          type: 'string',
          description: 'The ID of the task list (defaults to "@default" for primary list).',
        },
        showCompleted: {
          type: 'boolean',
          description: 'Whether to include completed tasks.',
        },
      },
    },
  },
  {
    name: 'tasks_create',
    description: 'Create a new task in Google Tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The title/summary of the task.',
        },
        notes: {
          type: 'string',
          description: 'Optional detailed notes for the task.',
        },
        due: {
          type: 'string',
          description: 'Optional due date in RFC 3339 or ISO 8601 format (e.g. YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ).',
        },
        listId: {
          type: 'string',
          description: 'The task list ID (defaults to "@default").',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'tasks_complete',
    description: 'Mark a task as completed in Google Tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task to complete.',
        },
        listId: {
          type: 'string',
          description: 'The task list ID (defaults to "@default").',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'tasks_delete',
    description: 'Permanently delete a task from Google Tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The ID of the task to delete.',
        },
        listId: {
          type: 'string',
          description: 'The task list ID (defaults to "@default").',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'tasks_syncToTrello',
    description: 'Import new Google Tasks captured via Google Assistant into the GTD Two-Week Rolling Trello board.',
    inputSchema: {
      type: 'object',
      properties: {
        targetListId: {
          type: 'string',
          description: 'Target Trello list ID (defaults to To Do list resolved dynamically from local GTD board config or environment).',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, previews tasks to import without creating Trello cards.',
        },
      },
    },
  },
];

function sendResponse(id, result) {
  const payload = {
    jsonrpc: '2.0',
    id,
    result,
  };
  process.stdout.write(JSON.stringify(payload) + '\n');
}

function sendError(id, code, message) {
  const payload = {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
    },
  };
  process.stdout.write(JSON.stringify(payload) + '\n');
}

async function handleRequest(request) {
  const { id, method, params } = request;

  try {
    switch (method) {
      case 'initialize': {
        sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'google-tasks-mcp',
            version: '1.0.0',
          },
        });
        break;
      }

      case 'notifications/initialized': {
        // No response needed for notifications
        break;
      }

      case 'ping': {
        sendResponse(id, {});
        break;
      }

      case 'tools/list': {
        sendResponse(id, { tools: TOOLS });
        break;
      }

      case 'tools/call': {
        const { name, arguments: args = {} } = params || {};
        let toolResult = null;

        switch (name) {
          case 'tasks_listLists': {
            toolResult = await listTaskLists();
            break;
          }

          case 'tasks_list': {
            toolResult = await listTasks(args.listId || '@default', {
              showCompleted: args.showCompleted,
            });
            break;
          }

          case 'tasks_create': {
            toolResult = await createTask(args.title, {
              notes: args.notes,
              due: args.due,
              listId: args.listId,
            });
            break;
          }

          case 'tasks_complete': {
            toolResult = await completeTask(args.taskId, args.listId);
            break;
          }

          case 'tasks_delete': {
            toolResult = await deleteTask(args.taskId, args.listId);
            break;
          }

          case 'tasks_syncToTrello': {
            toolResult = await syncToTrello({
              targetListId: args.targetListId,
              dryRun: args.dryRun,
            });
            break;
          }

          default: {
            sendError(id, -32601, `Unknown tool: ${name}`);
            return;
          }
        }

        sendResponse(id, {
          content: [
            {
              type: 'text',
              text: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2),
            },
          ],
        });
        break;
      }

      default: {
        sendError(id, -32601, `Method not supported: ${method}`);
        break;
      }
    }
  } catch (error) {
    sendResponse(id, {
      content: [
        {
          type: 'text',
          text: `Error executing tool: ${error.message}`,
        },
      ],
      isError: true,
    });
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const parsed = JSON.parse(trimmed);
    handleRequest(parsed);
  } catch (e) {
    console.error('Invalid JSON received on stdio:', e);
  }
});
