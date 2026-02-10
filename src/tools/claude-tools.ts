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
		},
		required: ["message", "workDir"],
	},
};

export async function handleClaude(args: {
	message: string;
	workDir: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	// Model isminden kısa isim çıkar
	const shortName = CLAUDE_MODEL.includes("sonnet")
		? "sonnet"
		: CLAUDE_MODEL.includes("opus")
			? "opus"
			: CLAUDE_MODEL.includes("haiku")
				? "haiku"
				: "default";

	const config = {
		...AGENTS.claude,
		name: `claude_${shortName}`,
		command: [...AGENTS.claude.command, "--model", CLAUDE_MODEL],
	};

	const result = await sendClaudePrompt(config, args.workDir, args.message);

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
