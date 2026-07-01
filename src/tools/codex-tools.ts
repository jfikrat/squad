import { sendCodexPrompt } from "../agents/codex";
import { type AgentType, resolveAgentConfig } from "../core/agent-presets";

export const codexTool = {
	name: "codex",
	description:
		"Codex (gpt-5.5) for technical analysis, code review, debugging, and implementation. model MUST be 'medium' or 'xhigh' (reasoning effort). medium = quick tasks, xhigh = deep analysis with parallel agent orchestration. Always pass pwd as workDir.",
	inputSchema: {
		type: "object",
		properties: {
			message: {
				type: "string",
				description: "The question or analysis request",
			},
			workDir: {
				type: "string",
				description:
					"Working directory for Codex to access project files. Always pass your current pwd.",
			},
			allowFileEdits: {
				type: "boolean",
				description:
					"Allow the agent to create, modify, and delete files. Must be explicitly set.",
			},
			waitForResponse: {
				type: "boolean",
				description:
					"Whether to block until the full response is ready. Default: true. Set false to return immediately and collect the result via poll_events/wait_for_event.",
			},
			model: {
				type: "string",
				enum: ["medium", "xhigh"],
				description:
					"Reasoning effort preset (all on gpt-5.5): 'medium' = fast everyday tasks, 'xhigh' = deep reasoning with parallel agent orchestration.",
			},
		},
		required: ["message", "workDir", "allowFileEdits", "model"],
	},
};

const REASONING_PRESETS: Record<string, string> = {
	medium: "medium",
	xhigh: "xhigh",
};

const XHIGH_ORCHESTRATION_PREFIX = `[ORCHESTRATION DIRECTIVE]
You are an orchestrator. Break this task into independent subtasks and run them in parallel using your available agents/tools. For each subtask:
1. Identify which parts can run independently (no dependency between them)
2. Dispatch independent subtasks to parallel agents simultaneously
3. For dependent subtasks, wait for prerequisites before dispatching
4. Collect all results and synthesize a unified answer

Do NOT execute everything sequentially in a single thread. Maximize parallelism.
[/ORCHESTRATION DIRECTIVE]

`;

export async function handleCodex(args: {
	message: string;
	workDir: string;
	allowFileEdits: boolean;
	model: string;
	waitForResponse?: boolean;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const reasoning = REASONING_PRESETS[args.model];
	if (!reasoning) {
		return {
			content: [
				{
					type: "text",
					text: `Error: Unknown model preset '${args.model}'. Valid options: ${Object.keys(REASONING_PRESETS).join(", ")}`,
				},
			],
		};
	}
	// Komut kurulumu TEK otoriteden: resolveAgentConfig hem model/reasoning
	// arg'larini hem de izole CODEX_HOME env prefix'ini ekler. Burada elle
	// komut kurmak, izolasyonun bypass edilmesine yol acmisti.
	const config = resolveAgentConfig(`codex_${args.model}` as AgentType);
	if (!config) {
		return {
			content: [
				{
					type: "text",
					text: `Error: Could not resolve agent config for codex_${args.model}`,
				},
			],
		};
	}

	const message =
		args.model === "xhigh"
			? XHIGH_ORCHESTRATION_PREFIX + args.message
			: args.message;

	const result = await sendCodexPrompt(
		config,
		args.workDir,
		message,
		args.allowFileEdits,
		{ waitForResponse: args.waitForResponse },
	);

	if (result.success) {
		if (result.queued) {
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								success: true,
								queued: true,
								agent: config.name,
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
				{
					type: "text",
					text: result.response || "No response received",
				},
			],
		};
	}

	return {
		content: [
			{
				type: "text",
				text: `Error: ${result.error}`,
			},
		],
	};
}
