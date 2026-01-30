import { getCodexStatus, pollEvents as pollCodexEvents } from "../agents/codex";
import {
	getGeminiStatus,
	pollEvents as pollGeminiEvents,
} from "../agents/gemini";
import { AGENTS } from "../config/agents";

type AgentType = "codex_xhigh" | "codex_medium" | "gemini_flash" | "gemini_pro";

export const pollEventsTool = {
	name: "poll_events",
	description:
		"Poll for pending events from a specific agent. Returns tool completions, session idle, errors, etc.",
	inputSchema: {
		type: "object",
		properties: {
			agent: {
				type: "string",
				enum: ["codex_xhigh", "codex_medium", "gemini_flash", "gemini_pro"],
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
				enum: ["codex_xhigh", "codex_medium", "gemini_flash", "gemini_pro"],
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

export const getAgentStatusTool = {
	name: "get_agent_status",
	description:
		"Get the current status of a specific agent (connection state, tmux session, last activity, pending events).",
	inputSchema: {
		type: "object",
		properties: {
			agent: {
				type: "string",
				enum: ["codex_xhigh", "codex_medium", "gemini_flash", "gemini_pro"],
				description: "Which agent to check status for",
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

	let events: Array<{
		type: string;
		timestamp: Date;
		data?: string;
	}>;

	if (agent.startsWith("codex_")) {
		events = pollCodexEvents(agent, peek);
	} else {
		events = pollGeminiEvents(agent, peek);
	}

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
	eventType: string;
	timeoutMs?: number;
	pollIntervalMs?: number;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const { agent, eventType, timeoutMs = 60000, pollIntervalMs = 500 } = args;

	const startTime = Date.now();

	while (Date.now() - startTime < timeoutMs) {
		let events: Array<{
			type: string;
			timestamp: Date;
			data?: string;
		}>;

		if (agent.startsWith("codex_")) {
			events = pollCodexEvents(agent, true); // peek mode
		} else {
			events = pollGeminiEvents(agent, true);
		}

		const matchingEvent = events.find((e) => e.type === eventType);

		if (matchingEvent) {
			// Event'i consume et
			if (agent.startsWith("codex_")) {
				pollCodexEvents(agent, false);
			} else {
				pollGeminiEvents(agent, false);
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								success: true,
								event: {
									type: matchingEvent.type,
									timestamp: matchingEvent.timestamp.toISOString(),
									data: matchingEvent.data,
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
	const config = AGENTS[agent];

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

	let status: {
		connected: boolean;
		sessionName: string;
		lastActivity?: Date;
		pendingEvents: number;
	};

	if (agent.startsWith("codex_")) {
		status = getCodexStatus(config);
	} else {
		status = getGeminiStatus(config);
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
						config: {
							command: config.command.join(" "),
							timeout: config.timeout,
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
