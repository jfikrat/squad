// Gemini response parsing
export interface GeminiMessage {
	type: "user" | "gemini";
	content: string;
	timestamp?: string;
}

export interface GeminiSession {
	id: string;
	messages: GeminiMessage[];
	lastUpdated: string;
}

export function parseGeminiResponse(
	sessionJson: string,
	marker = "◆END◆",
): string | null {
	try {
		const session: GeminiSession = JSON.parse(sessionJson);

		// Son gemini mesajını bul
		const geminiMessages = session.messages.filter((m) => m.type === "gemini");
		if (geminiMessages.length === 0) return null;

		const lastMessage = geminiMessages[geminiMessages.length - 1];

		// Marker kontrolü
		if (!lastMessage.content.includes(marker)) {
			return null; // Henüz tamamlanmamış
		}

		// Marker'ı temizle ve döndür
		return lastMessage.content.replace(new RegExp(marker, "g"), "").trim();
	} catch {
		return null;
	}
}

export function isGeminiResponseComplete(
	sessionJson: string,
	marker = "◆END◆",
): boolean {
	try {
		const session: GeminiSession = JSON.parse(sessionJson);
		const geminiMessages = session.messages.filter((m) => m.type === "gemini");
		if (geminiMessages.length === 0) return false;

		const lastMessage = geminiMessages[geminiMessages.length - 1];
		return lastMessage.content.includes(marker);
	} catch {
		return false;
	}
}

// Codex response parsing
export interface CodexEvent {
	type: string;
	payload?: {
		type?: string;
		message?: string;
		content?: string;
	};
}

export function parseCodexResponse(jsonlContent: string): string | null {
	try {
		const lines = jsonlContent.trim().split("\n");
		const events: CodexEvent[] = [];

		for (const line of lines) {
			if (line.trim()) {
				try {
					events.push(JSON.parse(line));
				} catch {
					// Satır parse edilemedi, devam et
				}
			}
		}

		// agent_message event'lerini filtrele
		const agentMessages = events.filter(
			(e) => e.type === "event_msg" && e.payload?.type === "agent_message",
		);

		if (agentMessages.length === 0) return null;

		const lastMessage = agentMessages[agentMessages.length - 1];
		return lastMessage.payload?.message || null;
	} catch {
		return null;
	}
}

export function isCodexSessionComplete(jsonlContent: string): boolean {
	try {
		const lines = jsonlContent.trim().split("\n");

		for (const line of lines) {
			if (line.trim()) {
				try {
					const event = JSON.parse(line);
					// task_complete veya session_end event'i var mı kontrol et
					if (
						event.type === "task_complete" ||
						event.type === "session_end" ||
						(event.type === "event_msg" &&
							event.payload?.type === "task_complete")
					) {
						return true;
					}
				} catch {
					// Devam et
				}
			}
		}
		return false;
	} catch {
		return false;
	}
}

// tmux output'tan response çıkar
export function parseFromTmuxOutput(
	output: string,
	marker = "◆END◆",
): string | null {
	const markerIndex = output.lastIndexOf(marker);
	if (markerIndex === -1) return null;

	// Marker'dan önceki içeriği al
	// Son prompt'tan itibaren başla
	const lines = output.substring(0, markerIndex).split("\n");

	// "Soru:" veya prompt'u bul ve sonrasını al
	let startIndex = -1;
	for (let i = lines.length - 1; i >= 0; i--) {
		if (
			lines[i].includes("Soru:") ||
			lines[i].includes(">>>") ||
			lines[i].includes("Model:")
		) {
			startIndex = i + 1;
			break;
		}
	}

	if (startIndex === -1 || startIndex >= lines.length) {
		// Prompt bulunamadı, son 50 satırı al
		startIndex = Math.max(0, lines.length - 50);
	}

	const response = lines.slice(startIndex).join("\n").trim();
	return response || null;
}
