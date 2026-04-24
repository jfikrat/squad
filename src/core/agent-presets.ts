import type { AgentConfig } from "../config/agents";
import { AGENTS } from "../config/agents";

export const AVAILABLE_AGENTS = [
	"codex_medium",
	"codex_xhigh",
	"gemini_flash",
	"gemini_pro",
	"claude_sonnet",
	"claude_opus",
] as const;

export type AgentType = (typeof AVAILABLE_AGENTS)[number];

export type EventType =
	| "tool_complete"
	| "session_idle"
	| "message_complete"
	| "error";

const CODEX_MODEL_ID = "gpt-5.5";

const CODEX_PRESETS: Record<
	"medium" | "xhigh",
	{ model: string; reasoning: string }
> = {
	medium: { model: CODEX_MODEL_ID, reasoning: "medium" },
	xhigh: { model: CODEX_MODEL_ID, reasoning: "xhigh" },
};

const GEMINI_PRESETS: Record<"flash" | "pro", string> = {
	flash: "gemini-3-flash-preview",
	pro: "gemini-3.1-pro-preview",
};

const CLAUDE_PRESETS: Record<"sonnet" | "opus", string> = {
	sonnet: "claude-sonnet-4-6",
	opus: "claude-opus-4-6",
};

export function resolveAgentConfig(agentName: AgentType): AgentConfig | null {
	if (agentName.startsWith("codex_")) {
		const preset = agentName.replace("codex_", "") as "medium" | "xhigh";
		const resolved = CODEX_PRESETS[preset];
		if (!resolved) return null;
		const base = AGENTS.codex;
		return {
			...base,
			name: agentName,
			command: [
				...base.command,
				"-m",
				resolved.model,
				"-c",
				`model_reasoning_effort="${resolved.reasoning}"`,
			],
		};
	}

	if (agentName.startsWith("gemini_")) {
		const preset = agentName.replace("gemini_", "") as "flash" | "pro";
		const modelId = GEMINI_PRESETS[preset];
		if (!modelId) return null;
		const base = AGENTS.gemini;
		return {
			...base,
			name: agentName,
			command: [
				...base.command.slice(0, 1),
				"-m",
				modelId,
				...base.command.slice(1),
			],
		};
	}

	if (agentName.startsWith("claude_")) {
		const preset = agentName.replace("claude_", "") as "sonnet" | "opus";
		const model = CLAUDE_PRESETS[preset];
		if (!model) return null;
		const base = AGENTS.claude;
		return {
			...base,
			name: agentName,
			command: [...base.command, "--model", model],
		};
	}

	return null;
}
