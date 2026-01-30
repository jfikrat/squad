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
	gemini_flash: {
		name: "gemini_flash",
		command: ["gemini", "-m", "gemini-3-flash-preview", "-y"],
		safePrefix: "Soru: ",
		responseMarker: "◆END◆",
		readyPatterns: ["YOLO mode", "Type your message", "Model:"],
		responseDetection: "marker",
		timeout: 120000,
	},
	gemini_pro: {
		name: "gemini_pro",
		command: ["gemini", "-m", "gemini-3-pro-preview", "-y"],
		safePrefix: "Soru: ",
		responseMarker: "◆END◆",
		readyPatterns: ["YOLO mode", "Type your message", "Model:"],
		responseDetection: "marker",
		timeout: 180000,
	},
	codex_xhigh: {
		name: "codex_xhigh",
		command: [
			"codex",
			"--dangerously-bypass-approvals-and-sandbox",
			"-c",
			'model_reasoning_effort="xhigh"',
		],
		safePrefix: null,
		readyPatterns: ["? for shortcuts", "context left", "How can I help"],
		sessionPath: "~/.codex/sessions",
		responseDetection: "jsonl",
		timeout: 300000,
	},
	codex_medium: {
		name: "codex_medium",
		command: [
			"codex",
			"--dangerously-bypass-approvals-and-sandbox",
			"-c",
			'model_reasoning_effort="medium"',
		],
		safePrefix: null,
		readyPatterns: ["? for shortcuts", "context left", "How can I help"],
		sessionPath: "~/.codex/sessions",
		responseDetection: "jsonl",
		timeout: 180000,
	},
};

export const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 dakika inaktivite
export const MAX_PARALLEL_SEARCH = 5;

// Terminal emülatör ayarı (env'den veya default)
// Desteklenen: alacritty, urxvtc, kitty, wezterm, gnome-terminal, xterm
export const TERMINAL_EMULATOR = process.env.SQUAD_TERMINAL || "alacritty";

// Terminal komut argümanları (her terminal farklı)
export const TERMINAL_EXEC_ARGS: Record<string, string[]> = {
	alacritty: ["-e"],
	urxvtc: ["-e"],
	kitty: ["-e"],
	wezterm: ["start", "--"],
	"gnome-terminal": ["--"],
	xterm: ["-e"],
};
