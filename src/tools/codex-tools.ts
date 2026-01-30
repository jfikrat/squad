import { sendCodexPrompt } from "../agents/codex";
import type { AgentConfig } from "../config/agents";
import { AGENTS } from "../config/agents";

export type ReasoningEffort = "xhigh" | "high" | "medium" | "low";

export const codexTool = {
	name: "codex",
	description:
		"GPT-5.2 Codex for deep technical analysis, architecture review, debugging, and code review. IMPORTANT: Always pass your current working directory (pwd) as workDir so Codex can access project files.",
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
			reasoning_effort: {
				type: "string",
				enum: ["xhigh", "high", "medium", "low"],
				description:
					"Reasoning effort level. xhigh for complex problems, medium for balanced analysis. Default: xhigh",
			},
		},
		required: ["message", "workDir"],
	},
};

function getCodexConfig(effort: ReasoningEffort): AgentConfig {
	const base = AGENTS.codex;
	return {
		...base,
		name: `codex_${effort}`,
		command: [...base.command, "-c", `model_reasoning_effort="${effort}"`],
	};
}

export async function handleCodex(args: {
	message: string;
	workDir: string;
	reasoning_effort?: ReasoningEffort;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const effort = args.reasoning_effort || "xhigh";
	const config = getCodexConfig(effort);
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
