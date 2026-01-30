import { watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface WatcherCallback {
	onUpdate: (content: string) => void;
	onError: (error: Error) => void;
}

interface ActiveWatcher {
	close: () => void;
	lastContent: string;
}

const watchers = new Map<string, ActiveWatcher>();

// Gemini session dizinini izle
export function watchGeminiSession(
	sessionId: string,
	callback: WatcherCallback,
): () => void {
	const geminiTmpDir = join(homedir(), ".gemini", "tmp");
	const sessionFile = join(geminiTmpDir, `${sessionId}.json`);

	let lastContent = "";

	const checkFile = async () => {
		try {
			const file = Bun.file(sessionFile);
			if (await file.exists()) {
				const content = await file.text();
				if (content !== lastContent) {
					lastContent = content;
					callback.onUpdate(content);
				}
			}
		} catch (err) {
			callback.onError(err as Error);
		}
	};

	// İlk kontrol
	checkFile();

	// Polling ile izle (100ms interval)
	const interval = setInterval(checkFile, 100);

	const cleanup = () => {
		clearInterval(interval);
		watchers.delete(sessionId);
	};

	watchers.set(sessionId, { close: cleanup, lastContent });
	return cleanup;
}

// Codex session dizinini izle
export async function findLatestCodexSession(): Promise<string | null> {
	const codexDir = join(homedir(), ".codex", "sessions");

	try {
		const now = new Date();
		const year = now.getFullYear().toString();
		const month = (now.getMonth() + 1).toString().padStart(2, "0");
		const day = now.getDate().toString().padStart(2, "0");

		const dayDir = join(codexDir, year, month, day);

		const files = await readdir(dayDir);
		const jsonlFiles = files.filter(
			(f) => f.startsWith("rollout-") && f.endsWith(".jsonl"),
		);

		if (jsonlFiles.length === 0) return null;

		// En son değiştirilen dosyayı bul
		let latestFile = "";
		let latestTime = 0;

		for (const file of jsonlFiles) {
			const filePath = join(dayDir, file);
			const stats = await stat(filePath);
			if (stats.mtimeMs > latestTime) {
				latestTime = stats.mtimeMs;
				latestFile = filePath;
			}
		}

		return latestFile;
	} catch {
		return null;
	}
}

export function watchCodexSession(
	sessionFile: string,
	callback: WatcherCallback,
): () => void {
	let lastSize = 0;
	let lastContent = "";

	const checkFile = async () => {
		try {
			const file = Bun.file(sessionFile);
			if (await file.exists()) {
				const stats = await stat(sessionFile);

				// Sadece boyut değiştiyse oku
				if (stats.size !== lastSize) {
					lastSize = stats.size;
					const content = await file.text();
					if (content !== lastContent) {
						lastContent = content;
						callback.onUpdate(content);
					}
				}
			}
		} catch (err) {
			callback.onError(err as Error);
		}
	};

	// İlk kontrol
	checkFile();

	// Polling ile izle (100ms interval)
	const interval = setInterval(checkFile, 100);

	const cleanup = () => {
		clearInterval(interval);
	};

	return cleanup;
}

export function closeAllWatchers(): void {
	for (const watcher of watchers.values()) {
		watcher.close();
	}
	watchers.clear();
}
