#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { getAllSessions, killSession } from "./core/tmux-manager";

// Tool definitions
import { claudeTool, handleClaude } from "./tools/claude-tools";
import { codexTool, handleCodex } from "./tools/codex-tools";
import {
	continueAgentTool,
	handleContinueAgent,
} from "./tools/conversation-tools";
import { handleTaskGraph, taskGraphTool } from "./tools/graph-tools";
import {
	cleanupTool,
	getAgentOutputTool,
	getAgentStateTool,
	getAgentStatusTool,
	handleCleanup,
	handleGetAgentOutput,
	handleGetAgentState,
	handleGetAgentStatus,
	handleListAgents,
	handleListSessions,
	handlePollEvents,
	handleWaitForEvent,
	listAgentsTool,
	listSessionsTool,
	pollEventsTool,
	waitForEventTool,
} from "./tools/status-tools";

const server = new Server(
	{
		name: "agents-mcp",
		version: "4.0.0",
	},
	{
		capabilities: {
			tools: {},
		},
	},
);

// Tool listesi
server.setRequestHandler(ListToolsRequestSchema, async () => {
	return {
		tools: [
			codexTool,
			claudeTool,
			continueAgentTool,
			pollEventsTool,
			waitForEventTool,
			getAgentStatusTool,
			cleanupTool,
			listAgentsTool,
			listSessionsTool,
			getAgentStateTool,
			getAgentOutputTool,
			taskGraphTool,
		],
	};
});

// Tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;

	switch (name) {
		case "codex":
			return handleCodex(
				args as {
					message: string;
					workDir: string;
					allowFileEdits: boolean;
					model: string;
					waitForResponse?: boolean;
				},
			);

		case "claude":
			return handleClaude(
				args as {
					message: string;
					workDir: string;
					allowFileEdits: boolean;
					model: string;
					waitForResponse?: boolean;
				},
			);

		case "continue_agent":
			return handleContinueAgent(
				args as {
					agent:
						| "codex_medium"
						| "codex_xhigh"
						| "claude_sonnet"
						| "claude_opus";
					message: string;
					allowFileEdits: boolean;
					waitForResponse?: boolean;
					workDir?: string;
				},
			);

		case "list_agents":
			return handleListAgents();

		case "list_sessions":
			return handleListSessions();

		case "get_agent_output":
			return handleGetAgentOutput(
				args as {
					agent:
						| "codex_medium"
						| "codex_xhigh"
						| "claude_sonnet"
						| "claude_opus";
					lines?: number;
					workDir?: string;
				},
			);

		case "get_agent_state":
			return handleGetAgentState(
				args as {
					agent:
						| "codex_medium"
						| "codex_xhigh"
						| "claude_sonnet"
						| "claude_opus";
					lines?: number;
					workDir?: string;
				},
			);

		case "poll_events":
			return handlePollEvents(
				args as {
					agent:
						| "codex_medium"
						| "codex_xhigh"
						| "claude_sonnet"
						| "claude_opus";
					peek?: boolean;
					workDir?: string;
				},
			);

		case "wait_for_event":
			return handleWaitForEvent(
				args as {
					agent:
						| "codex_medium"
						| "codex_xhigh"
						| "claude_sonnet"
						| "claude_opus";
					eventType:
						| "tool_complete"
						| "session_idle"
						| "message_complete"
						| "error";
					timeoutMs?: number;
					pollIntervalMs?: number;
					workDir?: string;
				},
			);

		case "get_agent_status":
			return handleGetAgentStatus(
				args as {
					agent:
						| "codex_medium"
						| "codex_xhigh"
						| "claude_sonnet"
						| "claude_opus";
					workDir?: string;
				},
			);

		case "cleanup":
			return handleCleanup(args as { workDir?: string } | undefined);

		case "task_graph":
			return handleTaskGraph(
				args as {
					name: string;
					workDir: string;
					outputFile?: string;
					maxConcurrency?: number;
					tasks: Array<{
						id: string;
						message: string;
						model: "sonnet" | "opus";
						dependsOn: string[];
						allowFileEdits?: boolean;
					}>;
				},
			);

		default:
			throw new Error(`Unknown tool: ${name}`);
	}
});

// Graceful shutdown - tüm tmux session'ları kapat
async function cleanup() {
	console.error("Shutting down, cleaning up tmux sessions...");
	const sessions = getAllSessions();
	for (const session of sessions) {
		await killSession(session.name);
	}
	console.error(`Cleaned up ${sessions.length} session(s)`);
	process.exit(0);
}

// SIGINT (Ctrl+C) ve SIGTERM handler
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Start server
async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("Agents MCP v4.0 started");
}

main().catch(console.error);
