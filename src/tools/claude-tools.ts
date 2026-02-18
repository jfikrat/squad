import { sendClaudePrompt } from "../agents/claude";
import { AGENTS, CLAUDE_MODEL } from "../config/agents";

export const claudeTool = {
	name: "claude",
	description:
		"Claude Code for deep analysis, architecture review, debugging, and code review. Runs Claude in a persistent tmux session with full project context (CLAUDE.md). IMPORTANT: Always pass your current working directory (pwd) as workDir.",
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
			model: {
				type: "string",
				description:
					"Model to use. Options: 'claude-opus-4-6' (default, most capable), 'claude-sonnet-4-6' (faster, efficient). Defaults to configured CLAUDE_MODEL.",
			},
		},
		required: ["message", "workDir", "allowFileEdits", "model"],
	},
};

export async function handleClaude(args: {
	message: string;
	workDir: string;
	allowFileEdits: boolean;
	model: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const effectiveModel = args.model;

	// Model isminden kısa isim çıkar
	const shortName = effectiveModel.includes("sonnet")
		? "sonnet"
		: effectiveModel.includes("opus")
			? "opus"
			: effectiveModel.includes("haiku")
				? "haiku"
				: "default";

	const config = {
		...AGENTS.claude,
		name: `claude_${shortName}`,
		command: [...AGENTS.claude.command, "--model", effectiveModel],
	};

	const result = await sendClaudePrompt(config, args.workDir, args.message, args.allowFileEdits);

	if (result.success) {
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
