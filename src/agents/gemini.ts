import type { AgentConfig } from "../config/agents";
import {
	findResponseByRequestId,
	generateRequestId,
	getLatestSessionFile,
	getSessionDir,
} from "../core/gemini-session";
import {
	capturePane,
	createSession,
	getSession,
	hasSession,
	killSession,
	sendBuffer,
	sendEscape,
	updateLastActivity,
} from "../core/tmux-manager";

export interface GeminiResult {
	success: boolean;
	response?: string;
	error?: string;
	sessionName: string;
}

interface PendingEvent {
	type: "tool_complete" | "session_idle" | "message_complete" | "error";
	timestamp: Date;
	data?: string;
}

const pendingEvents = new Map<string, PendingEvent[]>();

export async function initGeminiSession(
	config: AgentConfig,
	workDir: string,
): Promise<string> {
	const sessionName = `agents_${config.name}`;

	// Session zaten varsa kullan
	if (await hasSession(sessionName)) {
		return sessionName;
	}

	// Yeni session oluştur
	await createSession(sessionName, workDir, config.command);

	// Ready olana kadar bekle
	await waitForReady(sessionName, config.readyPatterns, config.timeout);

	return sessionName;
}

async function waitForReady(
	sessionName: string,
	patterns: string[],
	timeout: number,
): Promise<void> {
	const startTime = Date.now();

	while (Date.now() - startTime < timeout) {
		const output = await capturePane(sessionName);

		for (const pattern of patterns) {
			if (output.includes(pattern)) {
				// Biraz daha bekle, tamamen hazır olsun
				await Bun.sleep(500);
				return;
			}
		}

		await Bun.sleep(200);
	}

	throw new Error(`Gemini session ready timeout after ${timeout}ms`);
}

export async function sendGeminiPrompt(
	config: AgentConfig,
	workDir: string,
	prompt: string,
): Promise<GeminiResult> {
	const sessionName = `agents_${config.name}`;

	try {
		// Session yoksa oluştur
		if (!(await hasSession(sessionName))) {
			await initGeminiSession(config, workDir);
		}

		// Request ID üret
		const requestId = generateRequestId();

		// Safe prefix ekle (slash command koruması)
		const safePrompt = config.safePrefix
			? `${config.safePrefix}${prompt}`
			: prompt;

		// Prompt'a request ID ve marker ekle
		const marker = config.responseMarker || "◆END◆";
		const fullPrompt = `[RQ-${requestId}] ${safePrompt}\n\nYanıtının sonuna "[ANS-${requestId}]" yaz.`;

		// Shell mode'dan çık
		await sendEscape(sessionName);
		await Bun.sleep(100);

		// Bracketed paste ile gönder (request ID sistemi her zaman multiline)
		await sendBuffer(sessionName, fullPrompt);

		// Response bekle (önce JSON, fallback tmux)
		const response = await waitForResponse(
			sessionName,
			marker,
			config.timeout,
			requestId,
			workDir,
		);

		// Cevap alındı, lastActivity güncelle
		updateLastActivity(sessionName);

		// Event ekle
		addEvent(config.name, {
			type: "message_complete",
			timestamp: new Date(),
			data: response,
		});

		return {
			success: true,
			response,
			sessionName,
		};
	} catch (err) {
		const error = err as Error;

		addEvent(config.name, {
			type: "error",
			timestamp: new Date(),
			data: error.message,
		});

		return {
			success: false,
			error: error.message,
			sessionName,
		};
	}
}

async function waitForResponse(
	sessionName: string,
	marker: string,
	timeout: number,
	requestId: string,
	workDir: string,
): Promise<string> {
	const startTime = Date.now();
	const sessionDir = getSessionDir(workDir);

	while (Date.now() - startTime < timeout) {
		// Session hala var mı kontrol et (kullanıcı manuel kapatmış olabilir)
		if (!(await hasSession(sessionName))) {
			throw new Error(
				`Gemini session terminated by user (requestId: ${requestId})`,
			);
		}

		// Session JSON'dan yanıt ara (güvenilir yöntem)
		const latestFile = getLatestSessionFile(sessionDir);
		if (latestFile) {
			const jsonResponse = findResponseByRequestId(latestFile, requestId);
			if (jsonResponse) {
				return jsonResponse;
			}
		}

		await Bun.sleep(500);
	}

	throw new Error(
		`Gemini response timeout after ${timeout}ms (requestId: ${requestId})`,
	);
}

export async function stopGeminiSession(config: AgentConfig): Promise<void> {
	const sessionName = `agents_${config.name}`;
	await killSession(sessionName);
	pendingEvents.delete(config.name);
}

function addEvent(agentName: string, event: PendingEvent): void {
	if (!pendingEvents.has(agentName)) {
		pendingEvents.set(agentName, []);
	}
	pendingEvents.get(agentName)?.push(event);
}

export function pollEvents(agentName: string, peek = false): PendingEvent[] {
	const events = pendingEvents.get(agentName) || [];
	if (!peek) {
		pendingEvents.set(agentName, []);
	}
	return events;
}

export function getGeminiStatus(config: AgentConfig): {
	connected: boolean;
	sessionName: string;
	lastActivity?: Date;
	pendingEvents: number;
} {
	const sessionName = `agents_${config.name}`;
	const session = getSession(sessionName);

	return {
		connected: session !== undefined,
		sessionName,
		lastActivity: session?.lastActivity,
		pendingEvents: pendingEvents.get(config.name)?.length || 0,
	};
}
