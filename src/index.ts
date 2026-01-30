#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { SESSION_TIMEOUT } from "./config/agents";
import { cleanupInactiveSessions } from "./core/tmux-manager";

// Tool definitions
import {
	codexMediumTool,
	codexXhighTool,
	handleCodexMedium,
	handleCodexXhigh,
} from "./tools/codex-tools";
import {
	geminiFlashTool,
	geminiParallelSearchTool,
	geminiProTool,
	handleGeminiFlash,
	handleGeminiParallelSearch,
	handleGeminiPro,
} from "./tools/gemini-tools";
import {
	getAgentStatusTool,
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
			codexXhighTool,
			codexMediumTool,
			geminiFlashTool,
			geminiProTool,
			geminiParallelSearchTool,
			pollEventsTool,
			waitForEventTool,
			getAgentStatusTool,
		],
	};
});

// Tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;

	switch (name) {
		case "codex_xhigh":
			return handleCodexXhigh(args as { message: string; workDir: string });

		case "codex_medium":
			return handleCodexMedium(args as { message: string; workDir: string });

		case "gemini_flash":
			return handleGeminiFlash(args as { message: string; workDir: string });

		case "gemini_pro":
			return handleGeminiPro(args as { message: string; workDir: string });

		case "gemini_parallel_search":
			return handleGeminiParallelSearch(
				args as { queries: string[]; workDir: string; model?: string },
			);

		case "poll_events":
			return handlePollEvents(
				args as {
					agent: "codex_xhigh" | "codex_medium" | "gemini_flash" | "gemini_pro";
					peek?: boolean;
				},
			);

		case "wait_for_event":
			return handleWaitForEvent(
				args as {
					agent: "codex_xhigh" | "codex_medium" | "gemini_flash" | "gemini_pro";
					eventType: string;
					timeoutMs?: number;
					pollIntervalMs?: number;
				},
			);

		case "get_agent_status":
			return handleGetAgentStatus(
				args as {
					agent: "codex_xhigh" | "codex_medium" | "gemini_flash" | "gemini_pro";
				},
			);

		default:
			throw new Error(`Unknown tool: ${name}`);
	}
});

// Inaktif session cleanup (her dakika)
setInterval(() => {
	cleanupInactiveSessions(SESSION_TIMEOUT).catch(console.error);
}, 60000);

// Start server
async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("Agents MCP v4.0 started");
}

main().catch(console.error);
