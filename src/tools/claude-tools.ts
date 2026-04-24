import { sendClaudePrompt } from "../agents/claude";
import { AGENTS } from "../config/agents";

export const claudeTool = {
	name: "claude",
	description:
		"Claude Code for deep analysis, architecture review, and debugging. model MUST be 'opus' or 'sonnet' (do NOT use raw model names). Always pass pwd as workDir.",
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
					"Working directory for Claude to access project files and load CLAUDE.md. Always pass your current pwd.",
			},
			allowFileEdits: {
				type: "boolean",
				description:
					"Allow the agent to create, modify, and delete files. Must be explicitly set.",
			},
			waitForResponse: {
				type: "boolean",
				description:
					"Whether to block until the full response is ready. Default: true. Set false to return immediately — result will be written to outputFile if provided.",
			},
			outputFile: {
				type: "string",
				description:
					"Absolute path to write the result when the worker finishes. Used with waitForResponse: false for file-based async handoff. The directory will be created if needed.",
			},
			model: {
				type: "string",
				enum: ["opus", "sonnet"],
				description:
					"Model preset (MUST be exactly one of the enum values, do NOT enter raw model names): 'opus' = most capable for deep analysis, 'sonnet' = faster for most coding tasks.",
			},
		},
		required: ["message", "workDir", "allowFileEdits", "model"],
	},
};

const CLAUDE_MODEL_PRESETS: Record<string, string> = {
	opus: "claude-opus-4-6",
	sonnet: "claude-sonnet-4-6",
};

export async function handleClaude(args: {
	message: string;
	workDir: string;
	allowFileEdits: boolean;
	model: string;
	waitForResponse?: boolean;
	outputFile?: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const effectiveModel = CLAUDE_MODEL_PRESETS[args.model];
	if (!effectiveModel) {
		return {
			content: [
				{
					type: "text",
					text: `Error: Unknown model preset '${args.model}'. Valid options: ${Object.keys(CLAUDE_MODEL_PRESETS).join(", ")}`,
				},
			],
		};
	}
	const shortName = args.model;

	const config = {
		...AGENTS.claude,
		name: `claude_${shortName}`,
		command: [...AGENTS.claude.command, "--model", effectiveModel],
	};

	const result = await sendClaudePrompt(
		config,
		args.workDir,
		args.message,
		args.allowFileEdits,
		{ waitForResponse: args.waitForResponse, outputFile: args.outputFile },
	);

	if (result.success) {
		if (result.queued) {
			const info: Record<string, unknown> = {
				status: "dispatched",
				agent: config.name,
				requestId: result.requestId,
				outputFile: result.outputFile,
				nextStep: `Result will be written to ${result.outputFile} when complete.`,
			};
			return {
				content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
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
