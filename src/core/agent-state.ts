import type { AgentType } from "./agent-presets";

export interface AgentSemanticState {
	phase:
		| "starting"
		| "awaiting_confirmation"
		| "responding"
		| "awaiting_input"
		| "completed"
		| "error"
		| "unknown";
	blocked: boolean;
	ready: boolean;
	needsInput: boolean;
	summary: string;
	suggestedAction: string | null;
	indicators: string[];
	requestIds: string[];
	answerIds: string[];
}

function collectMatches(output: string, regex: RegExp): string[] {
	return [...output.matchAll(regex)].map((match) => match[1]).filter(Boolean);
}

function includesAny(output: string, patterns: string[]): boolean {
	return patterns.some((pattern) => output.includes(pattern));
}

/**
 * Gerçek ANS marker'larını topla. Prompt echo'sundaki talimat satırı
 * ('End your response with "[ANS-xxx]"') cevap sayılmaz: tırnak içindeki
 * ve talimat satırındaki marker'lar filtrelenir.
 */
function collectRealAnswerIds(output: string): string[] {
	const ids: string[] = [];
	for (const line of output.split("\n")) {
		if (line.includes("End your response")) continue;
		for (const match of line.matchAll(/(^|[^"])\[ANS-([a-f0-9]+)\]/g)) {
			if (match[2]) ids.push(match[2]);
		}
	}
	return ids;
}

// TUI'nin gerçekten çizildiğini gösteren işaretler. Bunlar yokken pane'deki
// "❯ " büyük ihtimalle shell prompt'udur (boot aşaması) — input hazır sayılmaz.
const TUI_ALIVE_PATTERNS = [
	"? for shortcuts",
	"context left",
	"% left",
	"bypass permissions",
	"Claude Code",
	"OpenAI Codex",
	"model:",
	"Type your message",
	"How can I help",
	"esc to interrupt",
	"Esc to interrupt",
];

export function summarizeAgentOutput(
	agent: AgentType,
	output: string,
): AgentSemanticState {
	const indicators: string[] = [];
	const requestIds = collectMatches(output, /\[RQ-([a-f0-9]+)\]/g);
	const answerIds = collectRealAnswerIds(output);

	const responding = includesAny(output, [
		"Responding with",
		"esc to cancel",
		"esc to interrupt",
		"dreaming",
		"Thinking",
		"Generating",
		"Running",
		"Working (",
		"Copy the last response to your clipboard",
	]);
	if (responding) {
		indicators.push("responding");
		return {
			phase: "responding",
			blocked: false,
			ready: false,
			needsInput: false,
			summary: `${agent} is actively generating a response`,
			suggestedAction: "Wait for message_complete or poll events",
			indicators,
			requestIds,
			answerIds,
		};
	}

	const starting = includesAny(output, [
		"Waiting for MCP servers to initialize",
		"Claude Code v",
		"OpenAI Codex",
		"Responding with",
		"Type your message",
		"How can I help",
		"directory:",
	]);
	if (starting) {
		indicators.push("startup_or_ready_text");
	}

	const tuiAlive = includesAny(output, TUI_ALIVE_PATTERNS);
	const awaitingInput =
		tuiAlive &&
		includesAny(output, [
			"Type your message",
			"How can I help",
			"Prompt …",
			"Prompt...",
			"❯ ",
		]);
	if (awaitingInput) {
		indicators.push("input_prompt");
		const phase = answerIds.length > 0 ? "completed" : "awaiting_input";
		return {
			phase,
			blocked: false,
			ready: true,
			needsInput: true,
			summary:
				phase === "completed"
					? `${agent} finished its last response and is ready for the next prompt`
					: `${agent} is idle and ready for input`,
			suggestedAction: "Send a new prompt or continue_agent",
			indicators,
			requestIds,
			answerIds,
		};
	}

	const awaitingConfirmation = includesAny(output, [
		"Do you trust the contents of this directory?",
		"Press enter to continue",
		"press enter to confirm",
		"Use ↑/↓ to move",
		"Choose how you'd like",
		"Try new model",
		"1. Yes, continue",
	]);
	if (awaitingConfirmation) {
		indicators.push("confirmation_prompt");
		return {
			phase: "awaiting_confirmation",
			blocked: true,
			ready: false,
			needsInput: false,
			summary: `${agent} is waiting on a confirmation or onboarding prompt`,
			suggestedAction:
				"Auto-dismiss should press Enter; inspect pane if it persists",
			indicators,
			requestIds,
			answerIds,
		};
	}

	const hasCompletionMarker = answerIds.length > 0;
	if (hasCompletionMarker) {
		indicators.push("completion_marker");
		return {
			phase: "completed",
			blocked: false,
			ready: true,
			needsInput: false,
			summary: `${agent} emitted a completion marker`,
			suggestedAction: "Collect the response via wait_for_event or poll_events",
			indicators,
			requestIds,
			answerIds,
		};
	}

	// Error tespiti bilinçli olarak EN SONDA ve sadece pane'in son satırlarında:
	// görevin kendi çıktısındaki (test/build logları) "error"/"failed" kelimeleri
	// yanlış alarm üretmesin. Belirgin UI durumları her zaman önceliklidir.
	const tailLines = output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(-6)
		.join("\n");
	const hasError = includesAny(tailLines, [
		"Error:",
		"session terminated",
		"FATAL",
	]);
	if (hasError) {
		indicators.push("error_text");
		return {
			phase: "error",
			blocked: true,
			ready: false,
			needsInput: false,
			summary: `${agent} error state detected in pane output`,
			suggestedAction: "Inspect get_agent_output and recent events",
			indicators,
			requestIds,
			answerIds,
		};
	}

	return {
		phase: starting ? "starting" : "unknown",
		blocked: false,
		ready: false,
		needsInput: false,
		summary: starting
			? `${agent} appears to be starting up`
			: `${agent} state could not be classified from pane output`,
		suggestedAction: starting
			? "Wait briefly and re-check status"
			: "Inspect get_agent_output for more detail",
		indicators,
		requestIds,
		answerIds,
	};
}
