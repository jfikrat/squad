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
			allowFileEdits: {
				type: "boolean",
				description:
					"Allow the agent to create, modify, and delete files. Must be explicitly set.",
			},
			model: {
				type: "string",
				enum: ["spark", "full"],
				description:
					"Model preset: 'spark' (ultra-fast, 15x speed, text-only — best for quick, surface-level coding tasks) or 'full' (xhigh reasoning, full genius mode — best for deep analysis, architecture, debugging).",
			},
		},
		required: ["message", "workDir", "allowFileEdits", "model"],
	},
};

const MODEL_PRESETS: Record<string, string> = {
	spark: "gpt-5.3-codex-spark",
	full: "gpt-5.3-codex",
};

export async function handleCodex(args: {
	message: string;
	workDir: string;
	allowFileEdits: boolean;
	model: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const effectiveModel = MODEL_PRESETS[args.model];
	if (!effectiveModel) {
		return { content: [{ type: "text", text: `Error: Unknown model preset '${args.model}'. Valid options: ${Object.keys(MODEL_PRESETS).join(", ")}` }] };
	}
	const isSpark = effectiveModel === "gpt-5.3-codex-spark";

	// Spark: text-only, reasoning effort desteklemiyor
	const command = [...AGENTS.codex.command, "-m", effectiveModel];
	if (!isSpark) {
		command.push("-c", `model_reasoning_effort="${CODEX_REASONING}"`);
	}

	const config = {
		...AGENTS.codex,
		name: isSpark ? "codex_spark" : `codex_${CODEX_REASONING}`,
		command,
	};

	const result = await sendCodexPrompt(config, args.workDir, args.message, args.allowFileEdits);

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
