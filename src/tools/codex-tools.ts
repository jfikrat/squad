import { sendCodexPrompt } from "../agents/codex";
import { AGENTS } from "../config/agents";

export const codexTool = {
	name: "codex",
	description:
		"Codex for deep technical analysis, architecture review, debugging, and code review. model MUST be 'spark' or 'smart' (do NOT use raw model names). Always pass pwd as workDir.",
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
			model: {
				type: "string",
				enum: ["spark", "smart"],
				description:
					"Model preset (MUST be exactly one of the enum values, do NOT enter raw model names): 'spark' = ultra-fast text-only for quick tasks, 'smart' = deep reasoning for analysis and debugging.",
			},
		},
		required: ["message", "workDir", "allowFileEdits", "model"],
	},
};

const MODEL_PRESETS: Record<string, string> = {
	spark: "gpt-5.3-codex-spark",
	smart: "gpt-5.4",
};

export async function handleCodex(args: {
	message: string;
	workDir: string;
	allowFileEdits: boolean;
	model: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const effectiveModel = MODEL_PRESETS[args.model];
	if (!effectiveModel) {
		return {
			content: [
				{
					type: "text",
					text: `Error: Unknown model preset '${args.model}'. Valid options: ${Object.keys(MODEL_PRESETS).join(", ")}`,
				},
			],
		};
	}
	const reasoning = args.model === "spark" ? "xhigh" : "high";
	const command = [...AGENTS.codex.command, "-m", effectiveModel];
	command.push("-c", `model_reasoning_effort="${reasoning}"`);

	const config = {
		...AGENTS.codex,
		name: `codex_${args.model}`,
		command,
	};

	const result = await sendCodexPrompt(
		config,
		args.workDir,
		args.message,
		args.allowFileEdits,
	);

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
