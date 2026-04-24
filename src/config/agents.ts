import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Settings dosyasını oku (config/settings.json)
interface Settings {
	codex?: { model?: string; reasoning?: string };
	claude?: { model?: string };
	terminal?: string;
	display?: string;
}

function loadSettings(): Settings {
	const settingsPath = resolve(__dirname, "../../config/settings.json");
	if (existsSync(settingsPath)) {
		try {
			return JSON.parse(readFileSync(settingsPath, "utf-8"));
		} catch {
			return {};
		}
	}
	return {};
}

const settings = loadSettings();

export interface AgentConfig {
	name: string;
	command: string[];
	safePrefix: string | null;
	responseMarker?: string;
	readyPatterns: string[];
	sessionPath?: string;
	responseDetection: "marker" | "jsonl";
}

export const AGENTS: Record<string, AgentConfig> = {
	codex: {
		name: "codex",
		command: ["codex", "--dangerously-bypass-approvals-and-sandbox"],
		safePrefix: null,
		readyPatterns: [
			"model:",
			"directory:",
			"% left",
			"? for shortcuts",
			"context left",
			"How can I help",
		],
		sessionPath: "~/.codex/sessions",
		responseDetection: "jsonl",
	},
	claude: {
		name: "claude",
		command: ["claude", "--dangerously-skip-permissions"],
		safePrefix: null,
		readyPatterns: ["bypass permissions", "Claude Code"],
		sessionPath: "~/.claude/projects",
		responseDetection: "jsonl",
	},
};

export const MAX_PARALLEL_SEARCH = 5;

// Codex model ve reasoning effort
// Öncelik: ENV > settings.json > default
export const CODEX_MODEL =
	process.env.SQUAD_CODEX_MODEL || settings.codex?.model || "gpt-5.5";

export type ReasoningEffort = "xhigh" | "high" | "medium" | "low";
export const CODEX_REASONING: ReasoningEffort =
	(process.env.SQUAD_CODEX_REASONING as ReasoningEffort) ||
	(settings.codex?.reasoning as ReasoningEffort) ||
	"xhigh";

// Claude model
// Öncelik: ENV > settings.json > default
export const CLAUDE_MODEL =
	process.env.SQUAD_CLAUDE_MODEL || settings.claude?.model || "claude-opus-4-7";

// Terminal emülatör ayarı
// Öncelik: ENV > settings.json > default
// Desteklenen: alacritty, urxvtc, kitty, wezterm, gnome-terminal, xterm
export const TERMINAL_EMULATOR =
	process.env.SQUAD_TERMINAL || settings.terminal || "alacritty";

// Terminal komut argümanları (her terminal farklı)
export const TERMINAL_EXEC_ARGS: Record<string, string[]> = {
	alacritty: ["-e"],
	urxvtc: ["-e"],
	kitty: ["-e"],
	wezterm: ["start", "--"],
	"gnome-terminal": ["--"],
	xterm: ["-e"],
};

// Display modu: agent session'larının nasıl gösterileceği
// "terminal" = yeni terminal penceresi aç (default)
// "pane" = mevcut tmux session'da pane olarak aç
// "none" = görsel UI açma, sadece session oluştur
export type DisplayMode = "terminal" | "pane" | "none";
export const DISPLAY_MODE: DisplayMode =
	(process.env.SQUAD_DISPLAY as DisplayMode) ||
	(settings.display as DisplayMode) ||
	"terminal";
