import {
	consumeEvent as consumeClaudeEvent,
	getClaudeStatus,
	pollEvents as pollClaudeEvents,
} from "../agents/claude";
import {
	consumeEvent as consumeCodexEvent,
	getCodexStatus,
	pollEvents as pollCodexEvents,
} from "../agents/codex";
import {
	consumeEvent as consumeGeminiEvent,
	getGeminiStatus,
	pollEvents as pollGeminiEvents,
} from "../agents/gemini";
import type { AgentConfig } from "../config/agents";
import { CLAUDE_MODEL, CODEX_MODEL, GEMINI_MODEL } from "../config/agents";
import {
	AVAILABLE_AGENTS,
	type AgentType,
	type EventType,
	resolveAgentConfig,
} from "../core/agent-presets";
import { summarizeAgentOutput } from "../core/agent-state";
import { INSTANCE_ID } from "../core/instance";
import { capturePane, getAllSessions, killSession } from "../core/tmux-manager";

function getAgentEvents(agent: AgentType, peek = false) {
	if (agent.startsWith("codex_")) {
		return pollCodexEvents(agent, peek);
	}
	if (agent.startsWith("claude_")) {
		return pollClaudeEvents(agent, peek);
	}
	return pollGeminiEvents(agent, peek);
}

function consumeAgentEvent(agent: AgentType, eventType?: EventType) {
	if (agent.startsWith("codex_")) {
		return consumeCodexEvent(agent, eventType);
	}
	if (agent.startsWith("claude_")) {
		return consumeClaudeEvent(agent, eventType);
	}
	return consumeGeminiEvent(agent, eventType);
}

function getAgentStatusSnapshot(agent: AgentType, config: AgentConfig) {
	if (agent.startsWith("codex_")) {
		return getCodexStatus(config);
	}
	if (agent.startsWith("claude_")) {
		return getClaudeStatus(config);
	}
	return getGeminiStatus(config);
}

export const pollEventsTool = {
	name: "poll_events",
	description:
		"Poll for pending events from a specific agent. Returns tool completions, session idle, errors, etc.",
	inputSchema: {
		type: "object",
		properties: {
			agent: {
				type: "string",
				enum: [...AVAILABLE_AGENTS],
				description: "Which agent to poll events from",
			},
			peek: {
				type: "boolean",
				description:
					"If true, don't consume events (just look). Default: false",
			},
		},
		required: ["agent"],
	},
};

export const waitForEventTool = {
	name: "wait_for_event",
	description:
		"Wait for a specific event type from an agent (blocking call with timeout).",
	inputSchema: {
		type: "object",
		properties: {
			agent: {
				type: "string",
				enum: [...AVAILABLE_AGENTS],
				description: "Which agent to wait for",
			},
			eventType: {
				type: "string",
				enum: ["tool_complete", "session_idle", "message_complete", "error"],
				description: "Event type to wait for",
			},
			timeoutMs: {
				type: "number",
				description: "Timeout in milliseconds. Default: 60000",
			},
			pollIntervalMs: {
				type: "number",
				description: "Poll interval in milliseconds. Default: 500",
			},
		},
		required: ["agent", "eventType"],
	},
};

export const cleanupTool = {
	name: "cleanup",
	description:
		"Kill all agent sessions belonging to this instance. Safe to use - only kills sessions owned by this MCP server, never touches other instances' sessions.",
	inputSchema: {
		type: "object",
		properties: {},
	},
};

export const getAgentStatusTool = {
	name: "get_agent_status",
	description:
		"Get the current status of a specific agent (connection state, tmux session, last activity, pending events).",
	inputSchema: {
		type: "object",
		properties: {
			agent: {
				type: "string",
				enum: [...AVAILABLE_AGENTS],
				description: "Which agent to check status for",
			},
		},
		required: ["agent"],
	},
};

export const listAgentsTool = {
	name: "list_agents",
	description:
		"List all available agent presets with live connection state, pending events, and effective command/model details.",
	inputSchema: {
		type: "object",
		properties: {},
	},
};

export const listSessionsTool = {
	name: "list_sessions",
	description:
		"List active tmux sessions owned by this MCP instance with workDir and activity timestamps.",
	inputSchema: {
		type: "object",
		properties: {},
	},
};

export const getAgentStateTool = {
	name: "get_agent_state",
	description:
		"Summarize an agent's live tmux pane into a semantic state such as awaiting confirmation, responding, or ready for input.",
	inputSchema: {
		type: "object",
		properties: {
			agent: {
				type: "string",
				enum: [...AVAILABLE_AGENTS],
				description: "Which agent to summarize",
			},
			lines: {
				type: "number",
				description: "How many recent pane lines to inspect. Default: 120",
			},
		},
		required: ["agent"],
	},
};

export const getAgentOutputTool = {
	name: "get_agent_output",
	description:
		"Capture the recent tmux pane output for an agent to debug readiness prompts, stalls, or unexpected UI state.",
	inputSchema: {
		type: "object",
		properties: {
			agent: {
				type: "string",
				enum: [...AVAILABLE_AGENTS],
				description: "Which agent to inspect",
			},
			lines: {
				type: "number",
				description: "How many recent pane lines to capture. Default: 200",
			},
		},
		required: ["agent"],
	},
};

export async function handlePollEvents(args: {
	agent: AgentType;
	peek?: boolean;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const { agent, peek = false } = args;
	const events = getAgentEvents(agent, peek);

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					{
						agent,
						eventCount: events.length,
						events: events.map((e) => ({
							type: e.type,
							timestamp: e.timestamp.toISOString(),
							data: e.data,
						})),
					},
					null,
					2,
				),
			},
		],
	};
}

export async function handleWaitForEvent(args: {
	agent: AgentType;
	eventType: EventType;
	timeoutMs?: number;
	pollIntervalMs?: number;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const { agent, eventType, timeoutMs = 60000, pollIntervalMs = 500 } = args;

	const startTime = Date.now();

	while (Date.now() - startTime < timeoutMs) {
		const events = getAgentEvents(agent, true);

		const matchingEvent = events.find((e) => e.type === eventType);

		if (matchingEvent) {
			const consumedEvent =
				consumeAgentEvent(agent, eventType) || matchingEvent;

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								success: true,
								event: {
									type: consumedEvent.type,
									timestamp: consumedEvent.timestamp.toISOString(),
									data: consumedEvent.data,
								},
							},
							null,
							2,
						),
					},
				],
			};
		}

		await Bun.sleep(pollIntervalMs);
	}

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					{
						success: false,
						error: `Timeout waiting for ${eventType} event after ${timeoutMs}ms`,
					},
					null,
					2,
				),
			},
		],
	};
}

export async function handleGetAgentStatus(args: {
	agent: AgentType;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const { agent } = args;
	const config = resolveAgentConfig(agent);

	if (!config) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({ error: `Unknown agent: ${agent}` }, null, 2),
				},
			],
		};
	}

	const status = getAgentStatusSnapshot(agent, config);
	let state = null;
	if (status.connected) {
		const output = await capturePane(status.sessionName, 120);
		state = summarizeAgentOutput(agent, output);
	}

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					{
						agent,
						connected: status.connected,
						sessionName: status.sessionName,
						lastActivity: status.lastActivity?.toISOString() || null,
						pendingEvents: status.pendingEvents,
						state,
						config: {
							command: config.command.join(" "),
							responseDetection: config.responseDetection,
						},
					},
					null,
					2,
				),
			},
		],
	};
}

export async function handleListAgents(): Promise<{
	content: Array<{ type: string; text: string }>;
}> {
	const agents = [];
	for (const agent of AVAILABLE_AGENTS) {
		const config = resolveAgentConfig(agent);
		if (!config) {
			agents.push({
				agent,
				error: "Missing config",
			});
			continue;
		}

		const status = getAgentStatusSnapshot(agent, config);
		let state = null;
		if (status.connected) {
			const output = await capturePane(status.sessionName, 80);
			state = summarizeAgentOutput(agent, output);
		}
		agents.push({
			agent,
			connected: status.connected,
			sessionName: status.sessionName,
			lastActivity: status.lastActivity?.toISOString() || null,
			pendingEvents: status.pendingEvents,
			statePhase: state?.phase || null,
			stateSummary: state?.summary || null,
			command: config.command.join(" "),
			responseDetection: config.responseDetection,
			configuredDefaultModel: agent.startsWith("codex_")
				? CODEX_MODEL
				: agent.startsWith("gemini_")
					? GEMINI_MODEL
					: CLAUDE_MODEL,
			defaultModel: agent.startsWith("codex_")
				? config.command[config.command.indexOf("-m") + 1]
				: agent.startsWith("gemini_")
					? config.command[config.command.indexOf("-m") + 1]
					: config.command[config.command.indexOf("--model") + 1],
		});
	}

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					{
						instanceId: INSTANCE_ID,
						agentCount: agents.length,
						agents,
					},
					null,
					2,
				),
			},
		],
	};
}

export async function handleListSessions(): Promise<{
	content: Array<{ type: string; text: string }>;
}> {
	const sessions = getAllSessions().map((session) => ({
		name: session.name,
		workDir: session.workDir,
		createdAt: session.createdAt.toISOString(),
		lastActivity: session.lastActivity.toISOString(),
	}));

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					{
						instanceId: INSTANCE_ID,
						sessionCount: sessions.length,
						sessions,
					},
					null,
					2,
				),
			},
		],
	};
}

export async function handleGetAgentState(args: {
	agent: AgentType;
	lines?: number;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const { agent, lines = 120 } = args;
	const config = resolveAgentConfig(agent);

	if (!config) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({ error: `Unknown agent: ${agent}` }, null, 2),
				},
			],
		};
	}

	const status = getAgentStatusSnapshot(agent, config);
	if (!status.connected) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							agent,
							connected: false,
							sessionName: status.sessionName,
							error: "Agent session is not currently connected",
						},
						null,
						2,
					),
				},
			],
		};
	}

	const output = await capturePane(status.sessionName, lines);
	const state = summarizeAgentOutput(agent, output);

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					{
						agent,
						sessionName: status.sessionName,
						lastActivity: status.lastActivity?.toISOString() || null,
						lines,
						state,
					},
					null,
					2,
				),
			},
		],
	};
}

export async function handleGetAgentOutput(args: {
	agent: AgentType;
	lines?: number;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const { agent, lines = 200 } = args;
	const config = resolveAgentConfig(agent);

	if (!config) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({ error: `Unknown agent: ${agent}` }, null, 2),
				},
			],
		};
	}

	const status = getAgentStatusSnapshot(agent, config);
	if (!status.connected) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							agent,
							connected: false,
							sessionName: status.sessionName,
							error: "Agent session is not currently connected",
						},
						null,
						2,
					),
				},
			],
		};
	}

	const output = await capturePane(status.sessionName, lines);
	const state = summarizeAgentOutput(agent, output);
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					{
						agent,
						sessionName: status.sessionName,
						lines,
						lastActivity: status.lastActivity?.toISOString() || null,
						state,
						output,
					},
					null,
					2,
				),
			},
		],
	};
}

export async function handleCleanup(): Promise<{
	content: Array<{ type: string; text: string }>;
}> {
	const sessions = getAllSessions();
	const killed: string[] = [];

	for (const session of sessions) {
		await killSession(session.name);
		killed.push(session.name);
	}

	return {
		content: [
			{
				type: "text",
				text: `Cleaned up ${killed.length} session(s) for instance ${INSTANCE_ID}:\n${killed.length > 0 ? killed.map((s) => `  - ${s}`).join("\n") : "  (no active sessions)"}`,
			},
		],
	};
}
