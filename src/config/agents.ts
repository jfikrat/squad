import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Settings dosyasını oku (config/settings.json)
interface Settings {
	codex?: { model?: string; reasoning?: string };
	gemini?: { model?: string };
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
	timeout: number;
}

export const AGENTS: Record<string, AgentConfig> = {
	gemini: {
		name: "gemini",
		command: ["gemini", "-y"],
		safePrefix: "Soru: ",
		responseMarker: "◆END◆",
		readyPatterns: ["YOLO mode", "Type your message", "Model:"],
		responseDetection: "marker",
		timeout: 3600000, // 60 dakika
	},
	codex: {
		name: "codex",
		command: ["codex", "--dangerously-bypass-approvals-and-sandbox"],
		safePrefix: null,
		readyPatterns: ["% left", "? for shortcuts", "context left", "How can I help"],
		sessionPath: "~/.codex/sessions",
		responseDetection: "jsonl",
		timeout: 3600000, // 60 dakika
	},
	claude: {
		name: "claude",
		command: ["claude", "--dangerously-skip-permissions"],
		safePrefix: null,
		readyPatterns: ["bypass permissions", "Claude Code"],
		sessionPath: "~/.claude/projects",
		responseDetection: "jsonl",
		timeout: 3600000, // 60 dakika
	},
};

export const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 dakika inaktivite
export const MAX_PARALLEL_SEARCH = 5;

// Codex model ve reasoning effort
// Öncelik: ENV > settings.json > default
export const CODEX_MODEL =
	process.env.SQUAD_CODEX_MODEL || settings.codex?.model || "gpt-5.3-codex";

export type ReasoningEffort = "xhigh" | "high" | "medium" | "low";
export const CODEX_REASONING: ReasoningEffort =
	(process.env.SQUAD_CODEX_REASONING as ReasoningEffort) ||
	(settings.codex?.reasoning as ReasoningEffort) ||
	"xhigh";

// Claude model
// Öncelik: ENV > settings.json > default
export const CLAUDE_MODEL =
	process.env.SQUAD_CLAUDE_MODEL ||
	settings.claude?.model ||
	"claude-opus-4-6";

// Gemini model (tam isim)
// Öncelik: ENV > settings.json > default
export const GEMINI_MODEL =
	process.env.SQUAD_GEMINI_MODEL ||
	settings.gemini?.model ||
	"gemini-3-flash-preview";

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
