import { sendCodexPrompt } from "../agents/codex";
import { AGENTS } from "../config/agents";

export const codexXhighTool = {
	name: "codex_xhigh",
	description:
		"GPT-5.2 Codex with xhigh reasoning effort. Deep technical analysis, architecture review, debugging, code review. Use for complex problems requiring extensive reasoning. IMPORTANT: Always pass your current working directory (pwd) as workDir so Codex can access project files.",
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

export const codexMediumTool = {
	name: "codex_medium",
	description:
		"GPT-5.2 Codex with medium reasoning effort. Balanced analysis for moderately complex questions. Good default choice. IMPORTANT: Always pass your current working directory (pwd) as workDir so Codex can access project files.",
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

export async function handleCodexXhigh(args: {
	message: string;
	workDir: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const config = AGENTS.codex_xhigh;
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

export async function handleCodexMedium(args: {
	message: string;
	workDir: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const config = AGENTS.codex_medium;
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
