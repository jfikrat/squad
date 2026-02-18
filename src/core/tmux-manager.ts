import { basename } from "node:path";
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

interface PaneInfo {
	windowIndex: number;
	paneIndex: number;
	width: number;
	height: number;
	area: number;
}

/**
 * Pane mode hedef tmux session'ını belirle.
 * Öncelik:
 * 1) SQUAD_PANE_TARGET env (manuel override)
 * 2) TMUX_PANE env'den mevcut session (varsa)
 * 3) En son aktif non-agent client session
 */
async function resolvePaneTargetSession(): Promise<string | null> {
	const explicitTarget = process.env.SQUAD_PANE_TARGET?.trim();
	if (explicitTarget) {
		return explicitTarget;
	}

	const tmuxPane = process.env.TMUX_PANE?.trim();
	if (tmuxPane) {
		try {
			const result =
				await $`tmux display-message -p -t ${tmuxPane} '#{session_name}'`.quiet();
			const sessionName = result.stdout.toString().trim();
			if (sessionName) {
				return sessionName;
			}
		} catch {
			// no-op, client list fallback
		}
	}

	// Service'in çalıştığı cwd'nin son dizin adını session adı olarak dene
	// Örn: /home/fekrat/socials/x -> "x"
	const cwdSession = basename(process.cwd());
	if (cwdSession) {
		try {
			const hasSessionResult =
				await $`tmux has-session -t ${cwdSession}`.nothrow();
			if (hasSessionResult.exitCode === 0) {
				const sessionClients =
					await $`tmux list-clients -t ${cwdSession}`.nothrow();
				if (
					sessionClients.exitCode === 0 &&
					sessionClients.stdout.toString().trim()
				) {
					return cwdSession;
				}
			}
		} catch {
			// no-op, client list fallback
		}
	}

	try {
		const result =
			await $`tmux list-clients -F '#{session_name} #{client_activity}'`.quiet();
		const clients = result.stdout
			.toString()
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const [sessionName, activityRaw] = line.trim().split(" ");
				return {
					sessionName,
					activity: Number.parseInt(activityRaw || "0", 10),
				};
			})
			.filter((c) => c.sessionName);

		if (clients.length === 0) {
			return null;
		}

		clients.sort((a, b) => b.activity - a.activity);
		const preferred = clients.find((c) => !c.sessionName.startsWith("agents_"));
		return preferred?.sessionName ?? clients[0]?.sessionName ?? null;
	} catch {
		return null;
	}
}

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
		// Hedef session'da pane olarak aç.
		// TMUX env var unset edilmeli - nested tmux attach için gerekli.
		const paneAttachCmd = `TMUX='' exec tmux attach -t ${name}`;
		try {
			const paneTargetSession = await resolvePaneTargetSession();
			if (!paneTargetSession) {
				throw new Error("No target tmux session for pane mode");
			}

			const paneListResult =
				await $`tmux list-panes -t ${paneTargetSession} -F '#{window_index} #{pane_index} #{pane_width} #{pane_height}'`.quiet();
			const panes = paneListResult.stdout
				.toString()
				.trim()
				.split("\n")
				.map((line) => {
					const [windowIndex, paneIndex, width, height] = line
						.trim()
						.split(" ")
						.map(Number);
					const pane: PaneInfo = {
						windowIndex,
						paneIndex,
						width,
						height,
						area: width * height,
					};
					return pane;
				})
				.filter(
					(p) =>
						Number.isFinite(p.windowIndex) &&
						Number.isFinite(p.paneIndex) &&
						Number.isFinite(p.width) &&
						Number.isFinite(p.height),
				);

			if (panes.length === 0) {
				throw new Error(`No panes in target session: ${paneTargetSession}`);
			}

			// En büyük alanı olan pane'i böl (okunabilir layout).
			const targetPane = panes.reduce(
				(max, p) => (p.area > max.area ? p : max),
				panes[0],
			);
			// Karakter aspect ratio (~2.5:1): width > height*2.5 ise yatay, değilse dikey böl.
			const splitFlag =
				targetPane.width > targetPane.height * 2.5 ? "-h" : "-v";
			const paneTarget = `${paneTargetSession}:${targetPane.windowIndex}.${targetPane.paneIndex}`;

			await $`tmux split-window ${splitFlag} -t ${paneTarget} -l 60% sh -c ${paneAttachCmd}`.quiet();
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
		const result =
			await $`tmux send-keys -t ${session} -l -- ${chunk}`.nothrow();
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
