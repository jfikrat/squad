import { $ } from "bun";
import {
	DISPLAY_MODE,
	TERMINAL_EMULATOR,
	TERMINAL_EXEC_ARGS,
} from "../config/agents";

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

	// Agent session'ını görsel olarak aç (display mode'a göre)
	if (DISPLAY_MODE === "pane") {
		// Mevcut tmux session'da pane olarak aç (ızgara layout)
		// TMUX env var unset edilmeli - nested tmux attach için gerekli
		// Trap yok: session lifecycle squad tarafından yönetilir (timeout + killSession)
		const paneAttachCmd = `TMUX='' exec tmux attach -t ${name}`;
		try {
			const paneListResult =
				await $`tmux list-panes -F '#{pane_index} #{pane_width} #{pane_height}'`.quiet();
			const panes = paneListResult.stdout
				.toString()
				.trim()
				.split("\n")
				.map((line) => {
					const [index, width, height] = line.trim().split(" ").map(Number);
					return { index, width, height, area: width * height };
				});

			if (panes.length <= 1) {
				// Sadece CC var, sağa %60 ile ilk agent pane'ini aç
				await $`tmux split-window -h -l 60% sh -c ${paneAttachCmd}`.quiet();
			} else {
				// Agent pane'leri arasından en büyük alanı olanı bul (pane 0 = CC, hariç tut)
				const agentPanes = panes.filter((p) => p.index > 0);
				const targetPane = agentPanes.reduce(
					(max, p) => (p.area > max.area ? p : max),
					agentPanes[0],
				);
				// Karakter aspect ratio (~2.5:1): width > height*2.5 ise yatay, değilse dikey böl
				const splitFlag =
					targetPane.width > targetPane.height * 2.5 ? "-h" : "-v";
				await $`tmux split-window ${splitFlag} -t ${targetPane.index} sh -c ${paneAttachCmd}`.quiet();
			}
		} catch {
			// tmux içinde değilsek fallback: terminal aç
			const attachCmd = `trap 'tmux kill-session -t ${name} 2>/dev/null' EXIT; tmux attach -t ${name}`;
			const execArgs = TERMINAL_EXEC_ARGS[TERMINAL_EMULATOR] || ["-e"];
			Bun.spawn([TERMINAL_EMULATOR, ...execArgs, "sh", "-c", attachCmd], {
				stdout: "ignore",
				stderr: "ignore",
			});
		}
	} else if (DISPLAY_MODE === "terminal") {
		// Yeni terminal penceresi aç (eski davranış)
		const attachCmd = `trap 'tmux kill-session -t ${name} 2>/dev/null' EXIT; tmux attach -t ${name}`;
		const execArgs = TERMINAL_EXEC_ARGS[TERMINAL_EMULATOR] || ["-e"];
		Bun.spawn([TERMINAL_EMULATOR, ...execArgs, "sh", "-c", attachCmd], {
			stdout: "ignore",
			stderr: "ignore",
		});
	}
	// "none" modunda hiçbir görsel UI açılmaz

	return session;
}

export async function sendEscape(session: string): Promise<void> {
	if (!(await hasSession(session))) {
		throw new Error(`Session ${session} not found`);
	}
	await $`tmux send-keys -t ${session} Escape`.quiet();
}

export async function sendCtrlC(session: string): Promise<void> {
	if (!(await hasSession(session))) {
		throw new Error(`Session ${session} not found`);
	}
	await $`tmux send-keys -t ${session} C-c`.quiet();
}

export async function sendKeys(session: string, text: string): Promise<void> {
	if (!(await hasSession(session))) {
		throw new Error(`Session ${session} not found`);
	}

	// Tek satır metinler için send-keys kullan
	const textResult = await $`tmux send-keys -t ${session} -l ${text}`.nothrow();
	if (textResult.exitCode !== 0) {
		throw new Error(`Failed to send text: ${textResult.stderr}`);
	}

	await Bun.sleep(50); // Enter'ın düzgün alınması için kısa bekleme

	const enterResult = await $`tmux send-keys -t ${session} Enter`.nothrow();
	if (enterResult.exitCode !== 0) {
		throw new Error(`Failed to send Enter: ${enterResult.stderr}`);
	}

	const s = activeSessions.get(session);
	if (s) {
		s.lastActivity = new Date();
	}
}

export async function sendBuffer(session: string, text: string): Promise<void> {
	if (!(await hasSession(session))) {
		throw new Error(`Session ${session} not found`);
	}

	// tmux buffer kullan (platform bağımsız)
	const bufferName = `buf_${Date.now()}`;
	const tempFile = `/tmp/${bufferName}.txt`;

	await Bun.write(tempFile, text);

	const loadResult =
		await $`tmux load-buffer -b ${bufferName} ${tempFile}`.nothrow();
	if (loadResult.exitCode !== 0) {
		await $`rm -f ${tempFile}`.nothrow();
		throw new Error(`Failed to load buffer: ${loadResult.stderr}`);
	}

	// -p = bracketed paste (uygulama paste'i tek input olarak algılar)
	const pasteResult =
		await $`tmux paste-buffer -p -b ${bufferName} -t ${session}`.nothrow();

	// Cleanup
	await $`tmux delete-buffer -b ${bufferName}`.nothrow();
	await $`rm -f ${tempFile}`.nothrow();

	if (pasteResult.exitCode !== 0) {
		throw new Error(`Failed to paste buffer: ${pasteResult.stderr}`);
	}

	await Bun.sleep(100);

	// Enter gönder
	const enterResult = await $`tmux send-keys -t ${session} Enter`.nothrow();
	if (enterResult.exitCode !== 0) {
		throw new Error(`Failed to send Enter: ${enterResult.stderr}`);
	}

	const s = activeSessions.get(session);
	if (s) {
		s.lastActivity = new Date();
	}
}

/**
 * Chunked send-keys ile metin gönder (paste detection bypass)
 * Claude Code gibi TUI'lar büyük paste'leri algılayıp [Pasted text #N] moduna girer
 * ve Enter submit yerine newline ekler. Küçük chunk'lar (50 char) halinde
 * send-keys -l kullanarak "hızlı typing" simüle ederiz.
 */
export async function sendBufferNoBracket(
	session: string,
	text: string,
): Promise<void> {
	if (!(await hasSession(session))) {
		throw new Error(`Session ${session} not found`);
	}

	// Chunk boyutu: 50 karakter — paste detection eşiğinin altında
	const CHUNK_SIZE = 50;
	const CHUNK_DELAY = 10; // ms arası bekleme

	for (let i = 0; i < text.length; i += CHUNK_SIZE) {
		const chunk = text.slice(i, i + CHUNK_SIZE);
		const result = await $`tmux send-keys -t ${session} -l -- ${chunk}`.nothrow();
		if (result.exitCode !== 0) {
			throw new Error(`Failed to send chunk at offset ${i}: ${result.stderr}`);
		}
		if (i + CHUNK_SIZE < text.length) {
			await Bun.sleep(CHUNK_DELAY);
		}
	}

	await Bun.sleep(100);

	// Enter gönder (submit)
	const enterResult = await $`tmux send-keys -t ${session} Enter`.nothrow();
	if (enterResult.exitCode !== 0) {
		throw new Error(`Failed to send Enter: ${enterResult.stderr}`);
	}

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

export function updateLastActivity(name: string): void {
	const session = activeSessions.get(name);
	if (session) {
		session.lastActivity = new Date();
	}
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
