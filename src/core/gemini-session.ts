import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface GeminiMessage {
	type: "user" | "gemini";
	content: string;
	thoughts?: unknown[];
	tokens?: unknown;
}

interface GeminiSession {
	sessionId: string;
	messages: GeminiMessage[];
}

/**
 * workDir için SHA256 hash hesapla
 * Gemini bu hash'i session klasörü için kullanıyor
 */
export function getProjectHash(workDir: string): string {
	return createHash("sha256").update(workDir).digest("hex");
}

/**
 * Gemini session klasörünü bul
 * ~/.gemini/tmp/{hash}/chats/
 */
export function getSessionDir(workDir: string): string {
	const hash = getProjectHash(workDir);
	return join(homedir(), ".gemini", "tmp", hash, "chats");
}

/**
 * En son session dosyasını bul
 * session-{timestamp}.json formatında
 */
export function getLatestSessionFile(sessionDir: string): string | null {
	if (!existsSync(sessionDir)) {
		return null;
	}

	try {
		const files = readdirSync(sessionDir)
			.filter((f) => f.startsWith("session-") && f.endsWith(".json"))
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
 * Session JSON'dan request ID ile yanıtı bul
 * [ANS-xxxxxxxx] marker'ını arar
 */
export function findResponseByRequestId(
	sessionPath: string,
	requestId: string,
): string | null {
	try {
		const content = readFileSync(sessionPath, "utf-8");
		const session: GeminiSession = JSON.parse(content);

		const ansMarker = `[ANS-${requestId}]`;

		// Son mesajdan geriye doğru ara
		for (let i = session.messages.length - 1; i >= 0; i--) {
			const msg = session.messages[i];
			if (msg.type === "gemini" && msg.content.includes(ansMarker)) {
				// Yanıtı temizle
				return cleanResponse(msg.content, requestId);
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
function cleanResponse(content: string, requestId: string): string {
	return content
		.replace(new RegExp(`\\[ANS-${requestId}\\]`, "g"), "")
		.replace(/◆END◆/g, "")
		.trim();
}

/**
 * Request ID üret (UUID ilk 8 karakter)
 */
export function generateRequestId(): string {
	return crypto.randomUUID().slice(0, 8);
}
