import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface ClaudeMessage {
	role: "user" | "assistant";
	content: Array<{
		type: string;
		text?: string;
	}>;
	stop_reason?: string | null;
}

interface ClaudeEvent {
	type: string;
	uuid: string;
	sessionId: string;
	timestamp: string;
	message?: ClaudeMessage;
}

/**
 * workDir'i Claude projects dizin ismine çevir
 * /home/fekrat/project -> -home-fekrat-project
 * /home/fekrat/.claude -> -home-fekrat--claude
 */
function encodeWorkDir(workDir: string): string {
	return workDir.replace(/[/.]/g, "-");
}

/**
 * Claude session dizinini döndür
 * ~/.claude/projects/{encoded-workDir}/
 */
export function getClaudeSessionDir(workDir: string): string {
	const encoded = encodeWorkDir(workDir);
	return join(homedir(), ".claude", "projects", encoded);
}

/**
 * Belirli zamandan sonra değişen Claude session dosyalarını döndür
 * Aynı workDir'de birden fazla Claude instance olabilir (örn: ana CC + agent)
 * Bu yüzden sadece en yeni dosya değil, tüm recent dosyalar kontrol edilmeli
 */
export function getRecentClaudeSessionFiles(
	sessionDir: string,
	sinceMs: number,
): string[] {
	if (!existsSync(sessionDir)) {
		return [];
	}

	try {
		return readdirSync(sessionDir)
			.filter((f) => f.endsWith(".jsonl") && !f.includes("subagent"))
			.map((f) => ({
				path: join(sessionDir, f),
				mtime: statSync(join(sessionDir, f)).mtimeMs,
			}))
			.filter((f) => f.mtime >= sinceMs)
			.sort((a, b) => b.mtime - a.mtime)
			.map((f) => f.path);
	} catch {
		return [];
	}
}

/**
 * JSONL dosyasından request ID ile yanıtı bul
 * assistant mesajlarında [ANS-xxx] arar, stop_reason: "end_turn" kontrol eder
 */
export function findClaudeResponseByRequestId(
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
				const event: ClaudeEvent = JSON.parse(line);

				// assistant mesajında ANS marker'ı ara
				// Not: Claude Code streaming yapar, stop_reason genelde null kalır
				// ANS marker'ı yeterli - unique request ID ile korunuyor
				if (event.type === "assistant" && event.message?.role === "assistant") {
					// Text content'lerden ANS marker'ı içereni bul
					const textParts = event.message.content
						.filter((c) => c.type === "text" && c.text)
						.map((c) => c.text as string);

					const fullText = textParts.join("\n");

					if (fullText.includes(ansMarker)) {
						return cleanClaudeResponse(fullText, requestId);
					}
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
function cleanClaudeResponse(content: string, requestId: string): string {
	return content.replace(new RegExp(`\\[ANS-${requestId}\\]`, "g"), "").trim();
}

/**
 * Request ID üret (UUID ilk 8 karakter)
 */
export function generateClaudeRequestId(): string {
	return crypto.randomUUID().slice(0, 8);
}
