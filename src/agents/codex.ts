import type { AgentConfig } from "../config/agents";
import {
	findCodexResponseInRecentSessions,
	generateCodexRequestId,
} from "../core/codex-session";
import { getSessionName } from "../core/instance";
import {
	capturePane,
	createSession,
	getSession,
	hasSession,
	killSession,
	sendBuffer,
	sendKeys,
	updateLastActivity,
} from "../core/tmux-manager";

export interface CodexResult {
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

export async function initCodexSession(
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

// Interactive prompts that need auto-dismiss (Enter to accept default)
const AUTO_DISMISS_PATTERNS = [
	"Use ↑/↓ to move",
	"press enter to confirm",
	"Choose how you'd like",
	"Try new model",
];

async function waitForReady(
	sessionName: string,
	patterns: string[],
	timeout: number,
): Promise<void> {
	const startTime = Date.now();

	while (Date.now() - startTime < timeout) {
		const output = await capturePane(sessionName);

		// Auto-dismiss interactive prompts (e.g. model upgrade)
		for (const dismissPattern of AUTO_DISMISS_PATTERNS) {
			if (output.includes(dismissPattern)) {
				const { $ } = await import("bun");
				await $`tmux send-keys -t ${sessionName} Enter`.quiet();
				await Bun.sleep(1000);
				break;
			}
		}

		for (const pattern of patterns) {
			if (output.includes(pattern)) {
				await Bun.sleep(500);
				return;
			}
		}

		await Bun.sleep(200);
	}

	throw new Error(`Codex session ready timeout after ${timeout}ms`);
}

export async function sendCodexPrompt(
	config: AgentConfig,
	workDir: string,
	prompt: string,
	allowFileEdits: boolean,
): Promise<CodexResult> {
	const sessionName = getSessionName(config.name);

	try {
		// Session yoksa oluştur
		if (!(await hasSession(sessionName))) {
			await initCodexSession(config, workDir);
		}

		// Request ID üret
		const requestId = generateCodexRequestId();

		// Prompt'a request ID ve ANS talimatı ekle
		const fileConstraint = allowFileEdits
			? ""
			: "\n\nIMPORTANT: Do NOT create, modify, or delete any files. Only analyze and respond.";
		const fullPrompt = `[RQ-${requestId}] ${prompt}${fileConstraint}\nIMPORTANT: End your response with "[ANS-${requestId}]"`;

		// Prompt gönder (her zaman buffer kullan - daha güvenilir)
		await sendBuffer(sessionName, fullPrompt);

		// Response bekle (JSON parsing)
		const response = await waitForCodexResponse(
			requestId,
			config.timeout,
			sessionName,
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

async function waitForCodexResponse(
	requestId: string,
	timeout: number,
	sessionName: string,
): Promise<string> {
	const startTime = Date.now();

	while (Date.now() - startTime < timeout) {
		// Session hala var mı kontrol et (kullanıcı manuel kapatmış olabilir)
		if (!(await hasSession(sessionName))) {
			throw new Error(
				`Codex session terminated by user (requestId: ${requestId})`,
			);
		}

		// Birden fazla Codex session dosyasında yanıtı ara.
		const response = findCodexResponseInRecentSessions(requestId, 30);
		if (response) {
			return response;
		}

		await Bun.sleep(500);
	}

	throw new Error(
		`Codex response timeout after ${timeout}ms (requestId: ${requestId})`,
	);
}

export async function stopCodexSession(config: AgentConfig): Promise<void> {
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

export function getCodexStatus(config: AgentConfig): {
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
