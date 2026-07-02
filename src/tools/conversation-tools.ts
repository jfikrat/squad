import { sendClaudePrompt } from "../agents/claude";
import { sendCodexPrompt } from "../agents/codex";
import {
	AVAILABLE_AGENTS,
	type AgentType,
	resolveAgentConfig,
} from "../core/agent-presets";
import { resolveRoom } from "../core/rooms";
import { hasSession } from "../core/tmux-manager";

export const continueAgentTool = {
	name: "continue_agent",
	description:
		"Send a follow-up message to an already running agent session without reselecting the provider-specific tool.",
	inputSchema: {
		type: "object",
		properties: {
			agent: {
				type: "string",
				enum: [...AVAILABLE_AGENTS],
				description: "Which running agent session to continue",
			},
			message: {
				type: "string",
				description: "Follow-up message to send to the existing agent session",
			},
			allowFileEdits: {
				type: "boolean",
				description:
					"Allow the agent to create, modify, and delete files. Must be explicitly set.",
			},
			waitForResponse: {
				type: "boolean",
				description:
					"Whether to block until the full response is ready. Default: true. Set false to queue the request and collect the result later.",
			},
			workDir: {
				type: "string",
				description:
					"Which session to continue when multiple projects share this squad server (sessions are per workDir). Optional if only one session is running for this agent.",
			},
		},
		required: ["agent", "message", "allowFileEdits"],
	},
};

export async function handleContinueAgent(args: {
	agent: AgentType;
	message: string;
	allowFileEdits: boolean;
	waitForResponse?: boolean;
	workDir?: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	// Oda çözümlemesi: workDir verildiyse deterministik, verilmediyse tek canlı
	// oda olmalı — birden fazlaysa asla tahmin etme (cross-client karışma riski).
	const room = resolveRoom(args.agent, args.workDir);
	if (!room.ok) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({ success: false, error: room.error }, null, 2),
				},
			],
		};
	}

	const config = resolveAgentConfig(args.agent, room.workDir);
	if (!config) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{ success: false, error: `Unknown agent: ${args.agent}` },
						null,
						2,
					),
				},
			],
		};
	}

	if (!(await hasSession(room.sessionName))) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							success: false,
							error: `Agent session is not running: ${args.agent} (workDir: ${room.workDir})`,
							sessionName: room.sessionName,
						},
						null,
						2,
					),
				},
			],
		};
	}

	if (args.agent.startsWith("codex_")) {
		const result = await sendCodexPrompt(
			config,
			room.workDir,
			args.message,
			args.allowFileEdits,
			{ waitForResponse: args.waitForResponse },
		);
		return formatAgentResult(config.name, result);
	}

	const result = await sendClaudePrompt(
		config,
		room.workDir,
		args.message,
		args.allowFileEdits,
		{ waitForResponse: args.waitForResponse },
	);
	return formatAgentResult(config.name, result);
}

function formatAgentResult(
	agent: string,
	result: {
		success: boolean;
		response?: string;
		error?: string;
		sessionName: string;
		requestId?: string;
		queued?: boolean;
	},
): { content: Array<{ type: string; text: string }> } {
	if (!result.success) {
		return {
			content: [{ type: "text", text: `Error: ${result.error}` }],
		};
	}

	if (result.queued) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							success: true,
							queued: true,
							agent,
							sessionName: result.sessionName,
							requestId: result.requestId,
							nextStep:
								"Use wait_for_event(agent, 'message_complete') or poll_events(agent) to collect the response.",
						},
						null,
						2,
					),
				},
			],
		};
	}

	return {
		content: [
			{ type: "text", text: result.response || "No response received" },
		],
	};
}
