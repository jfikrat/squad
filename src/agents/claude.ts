import type { AgentConfig } from "../config/agents";
import {
	findClaudeResponseByRequestId,
	generateClaudeRequestId,
	getClaudeSessionDir,
	getRecentClaudeSessionFiles,
} from "../core/claude-session";
import { getSessionName } from "../core/instance";
import {
	capturePane,
	createSession,
	getSession,
	hasSession,
	killSession,
	sendBufferNoBracket,
	updateLastActivity,
} from "../core/tmux-manager";

export interface ClaudeResult {
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

export async function initClaudeSession(
	config: AgentConfig,
	workDir: string,
): Promise<string> {
	const sessionName = getSessionName(config.name);

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
				await Bun.sleep(500);
				return;
			}
		}

		await Bun.sleep(200);
	}

	throw new Error(`Claude session ready timeout after ${timeout}ms`);
}

export async function sendClaudePrompt(
	config: AgentConfig,
	workDir: string,
	prompt: string,
	allowFileEdits: boolean,
): Promise<ClaudeResult> {
	const sessionName = getSessionName(config.name);

	try {
		// Session yoksa oluştur
		if (!(await hasSession(sessionName))) {
			await initClaudeSession(config, workDir);
		}

		// Request ID üret
		const requestId = generateClaudeRequestId();

		// Prompt'a request ID ve ANS talimatı ekle
		// Newline'ları kaldır: Claude Code multiline paste'te Enter submit yerine newline ekler
		const sanitizedPrompt = prompt.replace(/\n+/g, " ").trim();
		const fileConstraint = allowFileEdits ? "" : " --- IMPORTANT: Do NOT create, modify, or delete any files. Only analyze and respond.";
		const fullPrompt = `[RQ-${requestId}] ${sanitizedPrompt}${fileConstraint} End your response with "[ANS-${requestId}]"`;

		// Chunked send-keys ile gönder (paste detection bypass)
		await sendBufferNoBracket(sessionName, fullPrompt);

		// Response bekle (JSONL parsing)
		const response = await waitForClaudeResponse(
			requestId,
			config.timeout,
			sessionName,
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

async function waitForClaudeResponse(
	requestId: string,
	timeout: number,
	sessionName: string,
	workDir: string,
): Promise<string> {
	const startTime = Date.now();
	const sessionDir = getClaudeSessionDir(workDir);

	while (Date.now() - startTime < timeout) {
		// Session hala var mı kontrol et (kullanıcı manuel kapatmış olabilir)
		if (!(await hasSession(sessionName))) {
			throw new Error(
				`Claude session terminated by user (requestId: ${requestId})`,
			);
		}

		// Tüm recent session JSONL'lerden yanıt ara
		// (aynı workDir'de birden fazla Claude instance olabilir)
		const recentFiles = getRecentClaudeSessionFiles(sessionDir, startTime);
		for (const file of recentFiles) {
			const response = findClaudeResponseByRequestId(file, requestId);
			if (response) {
				return response;
			}
		}

		await Bun.sleep(500);
	}

	throw new Error(
		`Claude response timeout after ${timeout}ms (requestId: ${requestId})`,
	);
}

export async function stopClaudeSession(config: AgentConfig): Promise<void> {
	const sessionName = getSessionName(config.name);
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

export function getClaudeStatus(config: AgentConfig): {
	connected: boolean;
	sessionName: string;
	lastActivity?: Date;
	pendingEvents: number;
} {
	const sessionName = getSessionName(config.name);
	const session = getSession(sessionName);

	return {
		connected: session !== undefined,
		sessionName,
		lastActivity: session?.lastActivity,
		pendingEvents: pendingEvents.get(config.name)?.length || 0,
	};
}
