import { CLAUDE_MODEL, CODEX_MODEL } from "../config/agents";
import {
	consumeEvent,
	eventKeysForSlot,
	pendingCount,
	pollEvents,
} from "../core/agent-events";
import {
	AVAILABLE_AGENTS,
	type AgentType,
	type EventType,
	resolveAgentConfig,
} from "../core/agent-presets";
import { summarizeAgentOutput } from "../core/agent-state";
import { INSTANCE_ID } from "../core/instance";
import { getRoomsForSlot, resolveRoom, roomKey } from "../core/rooms";
import {
	capturePane,
	getAllSessions,
	getSession,
	killSession,
} from "../core/tmux-manager";

/**
 * Event kuyruğu anahtarını çöz.
 * - workDir verildiyse: deterministik oda anahtarı.
 * - Verilmediyse: slot'un bilinen kuyrukları + canlı odaları taranır; tek aday
 *   varsa o, hiç yoksa null (boş sonuç), birden fazlaysa belirsizlik hatası.
 */
function resolveEventKey(
	agent: AgentType,
	workDir?: string,
): { ok: true; key: string | null } | { ok: false; error: string } {
	if (workDir) {
		return { ok: true, key: roomKey(agent, workDir) };
	}

	const candidates = new Set(eventKeysForSlot(agent));
	const liveRooms = getRoomsForSlot(agent);
	for (const room of liveRooms) {
		candidates.add(roomKey(agent, room.workDir));
	}

	if (candidates.size === 0) {
		return { ok: true, key: null };
	}
	if (candidates.size === 1) {
		const [key] = candidates;
		return { ok: true, key };
	}
	return {
		ok: false,
		error: `Multiple ${agent} sessions/queues exist (one per workDir). Pass workDir to disambiguate. Live workDirs: ${
			liveRooms.map((r) => r.workDir).join(", ") || "(none tracked)"
		}`,
	};
}

const WORKDIR_PARAM = {
	type: "string",
	description:
		"Target session's workDir. Required when multiple projects share this squad server; optional if only one session exists for this agent.",
};

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
			workDir: WORKDIR_PARAM,
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
			workDir: WORKDIR_PARAM,
		},
		required: ["agent", "eventType"],
	},
};

export const cleanupTool = {
	name: "cleanup",
	description:
		"Kill agent sessions belonging to this squad server. Pass workDir to only clean sessions of that project; WITHOUT workDir it kills ALL sessions of this server — on a shared (gateway) server that includes other clients' sessions, so prefer passing workDir.",
	inputSchema: {
		type: "object",
		properties: {
			workDir: {
				type: "string",
				description:
					"Only kill sessions whose workDir matches this path. Omit to kill all sessions of this server.",
			},
		},
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
			workDir: WORKDIR_PARAM,
		},
		required: ["agent"],
	},
};

export const listAgentsTool = {
	name: "list_agents",
	description:
		"List all available agent presets with live sessions (one per workDir), pending events, and effective command/model details.",
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
			workDir: WORKDIR_PARAM,
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
			workDir: WORKDIR_PARAM,
		},
		required: ["agent"],
	},
};

export async function handlePollEvents(args: {
	agent: AgentType;
	peek?: boolean;
	workDir?: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const { agent, peek = false, workDir } = args;

	const resolution = resolveEventKey(agent, workDir);
	if (!resolution.ok) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({ agent, error: resolution.error }, null, 2),
				},
			],
		};
	}

	const events = resolution.key ? pollEvents(resolution.key, peek) : [];

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
	workDir?: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const {
		agent,
		eventType,
		timeoutMs = 60000,
		pollIntervalMs = 500,
		workDir,
	} = args;

	const startTime = Date.now();

	while (Date.now() - startTime < timeoutMs) {
		// Her turda yeniden çöz: async dispatch'in kuyruğu bekleme sırasında
		// oluşabilir. Belirsizlik (birden fazla oda) anında hata döner.
		const resolution = resolveEventKey(agent, workDir);
		if (!resolution.ok) {
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{ success: false, error: resolution.error },
							null,
							2,
						),
					},
				],
			};
		}

		if (resolution.key) {
			const events = pollEvents(resolution.key, true);
			const matchingEvent = events.find((e) => e.type === eventType);

			if (matchingEvent) {
				const consumedEvent =
					consumeEvent(resolution.key, eventType) || matchingEvent;

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
	workDir?: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const { agent, workDir } = args;

	const room = resolveRoom(agent, workDir);
	if (!room.ok) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{ agent, connected: false, error: room.error },
						null,
						2,
					),
				},
			],
		};
	}

	const config = resolveAgentConfig(agent, room.workDir);
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

	const session = getSession(room.sessionName);
	const connected = session !== undefined;
	let state = null;
	if (connected) {
		const output = await capturePane(room.sessionName, 120);
		state = summarizeAgentOutput(agent, output);
	}

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					{
						agent,
						connected,
						sessionName: room.sessionName,
						workDir: room.workDir,
						lastActivity: session?.lastActivity?.toISOString() || null,
						pendingEvents: pendingCount(roomKey(agent, room.workDir)),
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

		const shared = {
			command: config.command.join(" "),
			responseDetection: config.responseDetection,
			configuredDefaultModel: agent.startsWith("codex_")
				? CODEX_MODEL
				: CLAUDE_MODEL,
			defaultModel: agent.startsWith("codex_")
				? config.command[config.command.indexOf("-m") + 1]
				: config.command[config.command.indexOf("--model") + 1],
		};

		const rooms = getRoomsForSlot(agent);
		if (rooms.length === 0) {
			agents.push({
				agent,
				connected: false,
				sessionName: null,
				workDir: null,
				lastActivity: null,
				pendingEvents: 0,
				statePhase: null,
				stateSummary: null,
				...shared,
			});
			continue;
		}

		// Oda başına bir satır: aynı slot farklı projelerde ayrı session'lardır
		for (const room of rooms) {
			const output = await capturePane(room.name, 80);
			const state = summarizeAgentOutput(agent, output);
			agents.push({
				agent,
				connected: true,
				sessionName: room.name,
				workDir: room.workDir,
				lastActivity: room.lastActivity.toISOString(),
				pendingEvents: pendingCount(roomKey(agent, room.workDir)),
				statePhase: state?.phase || null,
				stateSummary: state?.summary || null,
				...shared,
			});
		}
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

async function inspectAgentPane(
	args: { agent: AgentType; lines?: number; workDir?: string },
	defaultLines: number,
	includeRawOutput: boolean,
): Promise<{ content: Array<{ type: string; text: string }> }> {
	const { agent, lines = defaultLines, workDir } = args;

	const room = resolveRoom(agent, workDir);
	if (!room.ok) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{ agent, connected: false, error: room.error },
						null,
						2,
					),
				},
			],
		};
	}

	const session = getSession(room.sessionName);
	if (!session) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							agent,
							connected: false,
							sessionName: room.sessionName,
							workDir: room.workDir,
							error: "Agent session is not currently connected",
						},
						null,
						2,
					),
				},
			],
		};
	}

	const output = await capturePane(room.sessionName, lines);
	const state = summarizeAgentOutput(agent, output);

	const payload: Record<string, unknown> = {
		agent,
		sessionName: room.sessionName,
		workDir: room.workDir,
		lastActivity: session.lastActivity.toISOString(),
		lines,
		state,
	};
	if (includeRawOutput) {
		payload.output = output;
	}

	return {
		content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
	};
}

export async function handleGetAgentState(args: {
	agent: AgentType;
	lines?: number;
	workDir?: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	return inspectAgentPane(args, 120, false);
}

export async function handleGetAgentOutput(args: {
	agent: AgentType;
	lines?: number;
	workDir?: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	return inspectAgentPane(args, 200, true);
}

export async function handleCleanup(args?: { workDir?: string }): Promise<{
	content: Array<{ type: string; text: string }>;
}> {
	const workDir = args?.workDir;
	const sessions = getAllSessions().filter(
		(session) => !workDir || session.workDir === workDir,
	);
	const killed: string[] = [];

	for (const session of sessions) {
		await killSession(session.name);
		killed.push(session.name);
	}

	const scope = workDir ? ` (workDir: ${workDir})` : "";
	return {
		content: [
			{
				type: "text",
				text: `Cleaned up ${killed.length} session(s) for instance ${INSTANCE_ID}${scope}:\n${killed.length > 0 ? killed.map((s) => `  - ${s}`).join("\n") : "  (no active sessions)"}`,
			},
		],
	};
}
