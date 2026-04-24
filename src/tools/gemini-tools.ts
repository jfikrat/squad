import { sendGeminiPrompt } from "../agents/gemini";
import type { AgentConfig } from "../config/agents";
import { AGENTS } from "../config/agents";

export const geminiTool = {
	name: "gemini",
	description:
		"Gemini for fast code generation and creative analysis. model MUST be 'flash' or 'pro' (do NOT use raw model names). Always pass pwd as workDir.",
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
					"Model preset (MUST be exactly one of the enum values, do NOT enter raw model names): 'flash' = ultra-fast for quick tasks, 'pro' = deeper analysis for complex problems.",
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
		},
		required: ["message", "workDir", "allowFileEdits", "model"],
	},
};

const GEMINI_MODEL_PRESETS: Record<string, string> = {
	flash: "gemini-3-flash-preview",
	pro: "gemini-3.1-pro-preview",
};

function getGeminiConfig(model: string): AgentConfig {
	const base = AGENTS.gemini;
	const shortName = model.includes("flash")
		? "flash"
		: model.includes("pro")
			? "pro"
			: model;
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
	waitForResponse?: boolean;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const model = GEMINI_MODEL_PRESETS[args.model];
	if (!model) {
		return {
			content: [
				{
					type: "text",
					text: `Error: Unknown model preset '${args.model}'. Valid options: ${Object.keys(GEMINI_MODEL_PRESETS).join(", ")}`,
				},
			],
		};
	}
	const config = getGeminiConfig(model);
	const result = await sendGeminiPrompt(config, args.workDir, args.message, {
		waitForResponse: args.waitForResponse,
	});

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
				{ type: "text", text: result.response || "No response received" },
			],
		};
	}

	return {
		content: [{ type: "text", text: `Error: ${result.error}` }],
	};
}
