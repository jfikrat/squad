#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { SESSION_TIMEOUT } from "./config/agents";
import {
	cleanupInactiveSessions,
	getAllSessions,
	killSession,
} from "./core/tmux-manager";

// Tool definitions
import { claudeTool, handleClaude } from "./tools/claude-tools";
import { codexTool, handleCodex } from "./tools/codex-tools";
import {
	codexGeminiTool,
	geminiTool,
	handleCodexGemini,
	handleGemini,
	handleParallelSearch,
	parallelSearchTool,
} from "./tools/gemini-tools";
import {
	cleanupTool,
	getAgentStatusTool,
	handleCleanup,
	handleGetAgentStatus,
	handlePollEvents,
	handleWaitForEvent,
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
			geminiTool,
			claudeTool,
			codexGeminiTool,
			parallelSearchTool,
			pollEventsTool,
			waitForEventTool,
			getAgentStatusTool,
			cleanupTool,
		],
	};
});

// Tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;

	switch (name) {
		case "codex":
			return handleCodex(args as { message: string; workDir: string; allowFileEdits: boolean; model: string });

		case "claude":
			return handleClaude(args as { message: string; workDir: string; allowFileEdits: boolean; model: string });

		case "gemini":
			return handleGemini(
				args as { message: string; workDir: string; model?: string; allowFileEdits: boolean },
			);

		case "codex_gemini":
			return handleCodexGemini(
				args as {
					message: string;
					workDir: string;
					gemini_model?: string;
					allowFileEdits: boolean;
				},
			);

		case "parallel_search":
			return handleParallelSearch(
				args as { queries: string[]; workDir: string },
			);

		case "poll_events":
			return handlePollEvents(
				args as {
					agent:
						| "codex_xhigh"
						| "codex_high"
						| "codex_medium"
						| "codex_low"
						| "gemini_flash"
						| "gemini_pro"
						| "claude_sonnet"
						| "claude_opus"
						| "claude_haiku";
					peek?: boolean;
				},
			);

		case "wait_for_event":
			return handleWaitForEvent(
				args as {
					agent:
						| "codex_xhigh"
						| "codex_high"
						| "codex_medium"
						| "codex_low"
						| "gemini_flash"
						| "gemini_pro"
						| "claude_sonnet"
						| "claude_opus"
						| "claude_haiku";
					eventType: string;
					timeoutMs?: number;
					pollIntervalMs?: number;
				},
			);

		case "get_agent_status":
			return handleGetAgentStatus(
				args as {
					agent:
						| "codex_xhigh"
						| "codex_high"
						| "codex_medium"
						| "codex_low"
						| "gemini_flash"
						| "gemini_pro"
						| "claude_sonnet"
						| "claude_opus"
						| "claude_haiku";
				},
			);

		case "cleanup":
			return handleCleanup();

		default:
			throw new Error(`Unknown tool: ${name}`);
	}
});

// Inaktif session cleanup (her dakika)
setInterval(() => {
	cleanupInactiveSessions(SESSION_TIMEOUT).catch(console.error);
}, 60000);

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
