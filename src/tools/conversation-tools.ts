import { sendClaudePrompt } from "../agents/claude";
import { sendCodexPrompt } from "../agents/codex";
import { sendGeminiPrompt } from "../agents/gemini";
import {
	AVAILABLE_AGENTS,
	type AgentType,
	resolveAgentConfig,
} from "../core/agent-presets";
import { getSessionName } from "../core/instance";
import { getSession, hasSession } from "../core/tmux-manager";

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
		},
		required: ["agent", "message", "allowFileEdits"],
	},
};

export async function handleContinueAgent(args: {
	agent: AgentType;
	message: string;
	allowFileEdits: boolean;
	waitForResponse?: boolean;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const config = resolveAgentConfig(args.agent);
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
	const liveSession = getSessionName(config.name);
	if (!(await hasSession(liveSession))) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							success: false,
							error: `Agent session is not running: ${args.agent}`,
							sessionName: liveSession,
						},
						null,
						2,
					),
				},
			],
		};
	}

	const tmuxSession = getSession(liveSession);
	if (!tmuxSession) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							success: false,
							error:
								"Agent tmux session exists but is not tracked by this MCP instance",
							sessionName: liveSession,
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
			tmuxSession.workDir,
			args.message,
			args.allowFileEdits,
			{ waitForResponse: args.waitForResponse },
		);
		return formatAgentResult(config.name, result);
	}

	if (args.agent.startsWith("claude_")) {
		const result = await sendClaudePrompt(
			config,
			tmuxSession.workDir,
			args.message,
			args.allowFileEdits,
			{ waitForResponse: args.waitForResponse },
		);
		return formatAgentResult(config.name, result);
	}

	const result = await sendGeminiPrompt(
		config,
		tmuxSession.workDir,
		args.message,
		{
			waitForResponse: args.waitForResponse,
		},
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
