import type { AgentConfig } from "../config/agents";
import { AGENTS } from "../config/agents";
import { ensureCodexHomeForSlot } from "./codex-home";

export const AVAILABLE_AGENTS = [
	"codex_medium",
	"codex_xhigh",
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

const CLAUDE_PRESETS: Record<
	"sonnet" | "opus",
	{ model: string; effort?: string }
> = {
	sonnet: { model: "claude-sonnet-4-6" },
	opus: { model: "claude-opus-4-7", effort: "xhigh" },
};

export function resolveAgentConfig(agentName: AgentType): AgentConfig | null {
	if (agentName.startsWith("codex_")) {
		const preset = agentName.replace("codex_", "") as "medium" | "xhigh";
		const resolved = CODEX_PRESETS[preset];
		if (!resolved) return null;
		const base = AGENTS.codex;
		// Slot başına izole CODEX_HOME: paylaşılan ~/.codex sqlite kilit
		// çekişmesini ("another Codex process is using its local data") önler.
		const codexHome = ensureCodexHomeForSlot(agentName);
		return {
			...base,
			name: agentName,
			command: [
				"env",
				`CODEX_HOME=${codexHome}`,
				...base.command,
				"-m",
				resolved.model,
				"-c",
				`model_reasoning_effort="${resolved.reasoning}"`,
			],
		};
	}

	if (agentName.startsWith("claude_")) {
		const preset = agentName.replace("claude_", "") as "sonnet" | "opus";
		const resolved = CLAUDE_PRESETS[preset];
		if (!resolved) return null;
		const base = AGENTS.claude;
		const command = [...base.command, "--model", resolved.model];
		if (resolved.effort) command.push("--effort", resolved.effort);
		return {
			...base,
			name: agentName,
			command,
		};
	}

	return null;
}
