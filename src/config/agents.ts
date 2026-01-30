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
		readyPatterns: ["? for shortcuts", "context left", "How can I help"],
		sessionPath: "~/.codex/sessions",
		responseDetection: "jsonl",
		timeout: 3600000, // 60 dakika
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
