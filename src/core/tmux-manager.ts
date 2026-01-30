import { $ } from "bun";
import { TERMINAL_EMULATOR, TERMINAL_EXEC_ARGS } from "../config/agents";

export interface TmuxSession {
	name: string;
	workDir: string;
	createdAt: Date;
	lastActivity: Date;
}

const activeSessions = new Map<string, TmuxSession>();

export async function hasSession(name: string): Promise<boolean> {
	try {
		const result = await $`tmux has-session -t ${name} 2>/dev/null`.quiet();
		return result.exitCode === 0;
	} catch {
		return false;
	}
}

export async function createSession(
	name: string,
	workDir: string,
	command: string[],
): Promise<TmuxSession> {
	// Mevcut session varsa öldür
	if (await hasSession(name)) {
		await killSession(name);
	}

	// Yeni session oluştur
	await $`tmux new-session -d -s ${name} -c ${workDir}`.quiet();

	// Komutu gönder
	const cmdString = command.join(" ");
	await $`tmux send-keys -t ${name} ${cmdString} Enter`.quiet();

	const session: TmuxSession = {
		name,
		workDir,
		createdAt: new Date(),
		lastActivity: new Date(),
	};

	activeSessions.set(name, session);

	// Terminal emülatör ile session'a attach et (arka planda)
	// Terminal kapandığında session'ı da öldür (trap ile SIGHUP/EXIT yakala)
	const execArgs = TERMINAL_EXEC_ARGS[TERMINAL_EMULATOR] || ["-e"];
	const attachCmd = `trap 'tmux kill-session -t ${name} 2>/dev/null' EXIT; tmux attach -t ${name}`;
	Bun.spawn([TERMINAL_EMULATOR, ...execArgs, "sh", "-c", attachCmd], {
		stdout: "ignore",
		stderr: "ignore",
	});

	return session;
}

export async function sendEscape(session: string): Promise<void> {
	if (!(await hasSession(session))) {
		throw new Error(`Session ${session} not found`);
	}
	await $`tmux send-keys -t ${session} Escape`.quiet();
}

export async function sendKeys(session: string, text: string): Promise<void> {
	if (!(await hasSession(session))) {
		throw new Error(`Session ${session} not found`);
	}

	// Tek satır metinler için send-keys kullan
	await $`tmux send-keys -t ${session} -l ${text}`.quiet();
	await Bun.sleep(50); // Enter'ın düzgün alınması için kısa bekleme
	await $`tmux send-keys -t ${session} Enter`.quiet();

	const s = activeSessions.get(session);
	if (s) {
		s.lastActivity = new Date();
	}
}

export async function sendBuffer(session: string, text: string): Promise<void> {
	if (!(await hasSession(session))) {
		throw new Error(`Session ${session} not found`);
	}

	// Multiline metinler için buffer kullan
	const bufferName = `buffer_${session}_${Date.now()}`;

	// Geçici dosyaya yaz ve buffer'a yükle
	const tempFile = `/tmp/${bufferName}.txt`;
	await Bun.write(tempFile, text);

	await $`tmux load-buffer -b ${bufferName} ${tempFile}`.quiet();
	await $`tmux paste-buffer -b ${bufferName} -t ${session}`.quiet();
	await $`tmux delete-buffer -b ${bufferName}`.quiet();
	await $`rm -f ${tempFile}`.quiet();

	// Paste sonrası metin uzunluğuna göre bekle, sonra Enter gönder
	// Her 500 karakter için +50ms, minimum 150ms
	const waitTime = Math.max(150, Math.ceil(text.length / 500) * 50 + 100);
	await Bun.sleep(waitTime);
	await $`tmux send-keys -t ${session} Enter`.quiet();

	const s = activeSessions.get(session);
	if (s) {
		s.lastActivity = new Date();
	}
}

export async function capturePane(
	session: string,
	lines = 1000,
): Promise<string> {
	if (!(await hasSession(session))) {
		throw new Error(`Session ${session} not found`);
	}

	const result =
		await $`tmux capture-pane -t ${session} -p -S -${lines}`.quiet();
	return result.stdout.toString();
}

export async function killSession(session: string): Promise<void> {
	if (await hasSession(session)) {
		await $`tmux kill-session -t ${session}`.quiet();
	}
	activeSessions.delete(session);
}

export function getSession(name: string): TmuxSession | undefined {
	return activeSessions.get(name);
}

export function getAllSessions(): TmuxSession[] {
	return Array.from(activeSessions.values());
}

export async function cleanupInactiveSessions(
	timeoutMs: number,
): Promise<void> {
	const now = Date.now();
	for (const [name, session] of activeSessions) {
		if (now - session.lastActivity.getTime() > timeoutMs) {
			await killSession(name);
		}
	}
}
