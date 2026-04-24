import { $ } from "bun";
import type { AgentType } from "./agent-presets";

type AutoDismissKey = "Enter" | "Escape";

interface AutoDismissRule {
	patterns: string[];
	key: AutoDismissKey;
	reason: string;
}

const AUTO_DISMISS_RULES: AutoDismissRule[] = [
	{
		patterns: [
			"Do you trust the contents of this directory?",
			"Press enter to continue",
			"press enter to confirm",
			"Use ↑/↓ to move",
			"Choose how you'd like",
			"Try new model",
			"1. Yes, continue",
		],
		key: "Enter",
		reason: "confirmation_prompt",
	},
];

const lastActionAt = new Map<string, number>();
const ACTION_COOLDOWN_MS = 1500;

export async function handleAutoDismiss(
	agent: AgentType,
	sessionName: string,
	output: string,
): Promise<{ acted: boolean; reason?: string }> {
	for (const rule of AUTO_DISMISS_RULES) {
		if (!rule.patterns.some((pattern) => output.includes(pattern))) {
			continue;
		}

		const throttleKey = `${sessionName}:${rule.reason}:${rule.key}`;
		const now = Date.now();
		const lastTime = lastActionAt.get(throttleKey) ?? 0;
		if (now - lastTime < ACTION_COOLDOWN_MS) {
			return { acted: false, reason: `${rule.reason}_cooldown` };
		}

		if (rule.key === "Enter") {
			await $`tmux send-keys -t ${sessionName} Enter`.quiet();
		} else {
			await $`tmux send-keys -t ${sessionName} Escape`.quiet();
		}

		lastActionAt.set(throttleKey, now);
		return { acted: true, reason: `${agent}:${rule.reason}` };
	}

	return { acted: false };
}
