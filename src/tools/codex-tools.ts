import { sendCodexPrompt } from "../agents/codex";
import { AGENTS, CODEX_MODEL, CODEX_REASONING } from "../config/agents";

export const codexTool = {
	name: "codex",
	description:
		"Codex for deep technical analysis, architecture review, debugging, and code review. IMPORTANT: Always pass your current working directory (pwd) as workDir so Codex can access project files.",
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
		},
		required: ["message", "workDir"],
	},
};

export async function handleCodex(args: {
	message: string;
	workDir: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	// Model ve reasoning settings'den
	const config = {
		...AGENTS.codex,
		name: `codex_${CODEX_REASONING}`,
		command: [
			...AGENTS.codex.command,
			"-m",
			CODEX_MODEL,
			"-c",
			`model_reasoning_effort="${CODEX_REASONING}"`,
		],
	};

	const result = await sendCodexPrompt(config, args.workDir, args.message);

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
