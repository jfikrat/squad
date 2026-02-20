import { sendGeminiPrompt } from "../agents/gemini";
import type { AgentConfig } from "../config/agents";
import { AGENTS } from "../config/agents";

export const geminiTool = {
	name: "gemini",
	description:
		"Gemini 3 for fast code generation and creative analysis. Uses native Gemini CLI in visible tmux session. IMPORTANT: Always pass your current working directory (pwd) as workDir so Gemini can access project files.",
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
					"Working directory for Gemini to access project files. Always pass your current pwd.",
			},
			model: {
				type: "string",
				enum: ["flash", "pro"],
				description:
					"Model preset: 'flash' (ultra-fast, creative, best for quick tasks and code generation) or 'pro' (deeper analysis, more capable — best for complex problems).",
			},
			allowFileEdits: {
				type: "boolean",
				description:
					"Allow the agent to create, modify, and delete files. Must be explicitly set.",
			},
		},
		required: ["message", "workDir", "allowFileEdits", "model"],
	},
};

const GEMINI_MODEL_PRESETS: Record<string, string> = {
	flash: "gemini-3-flash-preview",
	pro: "gemini-3-pro-preview",
};

function getGeminiConfig(model: string): AgentConfig {
	const base = AGENTS.gemini;
	const shortName = model.includes("flash") ? "flash" : model.includes("pro") ? "pro" : model;
	return {
		...base,
		name: `gemini_${shortName}`,
		command: [
			...base.command.slice(0, 1),
			"-m",
			model,
			...base.command.slice(1),
		],
	};
}

export async function handleGemini(args: {
	message: string;
	workDir: string;
	model: string;
	allowFileEdits: boolean;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const model = GEMINI_MODEL_PRESETS[args.model];
	if (!model) {
		return { content: [{ type: "text", text: `Error: Unknown model preset '${args.model}'. Valid options: ${Object.keys(GEMINI_MODEL_PRESETS).join(", ")}` }] };
	}
	const config = getGeminiConfig(model);
	const result = await sendGeminiPrompt(config, args.workDir, args.message);

	if (result.success) {
		return {
			content: [{ type: "text", text: result.response || "No response received" }],
		};
	}

	return {
		content: [{ type: "text", text: `Error: ${result.error}` }],
	};
}
