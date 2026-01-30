import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface CodexEvent {
	timestamp: string;
	type: string;
	payload?: {
		type?: string;
		message?: string;
		text?: string;
	};
}

/**
 * Bugünün Codex session dizinini döndür
 */
export function getCodexSessionDir(): string {
	const now = new Date();
	const year = now.getFullYear().toString();
	const month = (now.getMonth() + 1).toString().padStart(2, "0");
	const day = now.getDate().toString().padStart(2, "0");

	return join(homedir(), ".codex", "sessions", year, month, day);
}

/**
 * En son Codex session dosyasını bul
 */
export function getLatestCodexSessionFile(): string | null {
	const sessionDir = getCodexSessionDir();

	try {
		const files = readdirSync(sessionDir)
			.filter((f) => f.startsWith("rollout-") && f.endsWith(".jsonl"))
			.map((f) => ({
				name: f,
				path: join(sessionDir, f),
				mtime: statSync(join(sessionDir, f)).mtimeMs,
			}))
			.sort((a, b) => b.mtime - a.mtime);

		return files.length > 0 ? files[0].path : null;
	} catch {
		return null;
	}
}

/**
 * JSONL dosyasından request ID ile yanıtı bul
 * agent_message içinde [ANS-xxx] arar ve yanıtı döndürür
 */
export function findCodexResponseByRequestId(
	sessionPath: string,
	requestId: string,
): string | null {
	try {
		const content = readFileSync(sessionPath, "utf-8");
		const lines = content.trim().split("\n");

		const ansMarker = `[ANS-${requestId}]`;

		// Sondan başa doğru ara (en son yanıtı bul)
		for (let i = lines.length - 1; i >= 0; i--) {
			const line = lines[i];
			if (!line.trim()) continue;

			try {
				const event: CodexEvent = JSON.parse(line);

				// agent_message içinde ANS marker'ı ara
				if (
					event.type === "event_msg" &&
					event.payload?.type === "agent_message" &&
					event.payload?.message?.includes(ansMarker)
				) {
					// Yanıtı temizle ve döndür
					return cleanCodexResponse(event.payload.message, requestId);
				}
			} catch {
				// Parse hatası, devam et
			}
		}

		return null;
	} catch {
		return null;
	}
}

/**
 * Yanıttan marker'ları temizle
 */
function cleanCodexResponse(content: string, requestId: string): string {
	return content.replace(new RegExp(`\\[ANS-${requestId}\\]`, "g"), "").trim();
}

/**
 * Request ID üret (UUID ilk 8 karakter)
 */
export function generateCodexRequestId(): string {
	return crypto.randomUUID().slice(0, 8);
}
