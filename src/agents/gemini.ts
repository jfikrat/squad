import type { AgentConfig } from "../config/agents";
import { handleAutoDismiss } from "../core/agent-ui";
import {
	findResponseByRequestId,
	generateRequestId,
	getLatestSessionFile,
	getSessionDir,
} from "../core/gemini-session";
import { getSessionName } from "../core/instance";
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
	requestId?: string;
	queued?: boolean;
}

export interface PendingEvent {
	type: "tool_complete" | "session_idle" | "message_complete" | "error";
	timestamp: Date;
	data?: string;
}

const pendingEvents = new Map<string, PendingEvent[]>();

export async function initGeminiSession(
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
	await waitForReady(sessionName, config.readyPatterns);

	return sessionName;
}

async function waitForReady(
	sessionName: string,
	patterns: string[],
): Promise<void> {
	while (true) {
		const output = await capturePane(sessionName);
		const autoDismissResult = await handleAutoDismiss(
			configNameFromSession(sessionName),
			sessionName,
			output,
		);
		if (autoDismissResult.acted) {
			await Bun.sleep(1000);
			continue;
		}

		for (const pattern of patterns) {
			if (output.includes(pattern)) {
				await Bun.sleep(500);
				return;
			}
		}

		await Bun.sleep(200);
	}
}

export async function sendGeminiPrompt(
	config: AgentConfig,
	workDir: string,
	prompt: string,
	options?: { waitForResponse?: boolean },
): Promise<GeminiResult> {
	const sessionName = getSessionName(config.name);
	const waitForResponse = options?.waitForResponse ?? true;

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
		if (!waitForResponse) {
			void waitForResponseByRequestId(sessionName, requestId, workDir)
				.then((response) => {
					updateLastActivity(sessionName);
					addEvent(config.name, {
						type: "message_complete",
						timestamp: new Date(),
						data: response,
					});
				})
				.catch((err) => {
					const error = err as Error;
					addEvent(config.name, {
						type: "error",
						timestamp: new Date(),
						data: error.message,
					});
				});

			updateLastActivity(sessionName);

			return {
				success: true,
				sessionName,
				requestId,
				queued: true,
			};
		}

		const response = await waitForResponseByRequestId(
			sessionName,
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
			requestId,
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

async function waitForResponseByRequestId(
	sessionName: string,
	requestId: string,
	workDir: string,
): Promise<string> {
	const sessionDir = getSessionDir(workDir);

	while (true) {
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

		const output = await capturePane(sessionName, 120);
		const autoDismissResult = await handleAutoDismiss(
			configNameFromSession(sessionName),
			sessionName,
			output,
		);
		if (autoDismissResult.acted) {
			await Bun.sleep(500);
			continue;
		}

		await Bun.sleep(500);
	}
}

function configNameFromSession(
	sessionName: string,
): "gemini_flash" | "gemini_pro" {
	return sessionName.includes("gemini_pro") ? "gemini_pro" : "gemini_flash";
}

export async function stopGeminiSession(config: AgentConfig): Promise<void> {
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

export function consumeEvent(
	agentName: string,
	eventType?: PendingEvent["type"],
): PendingEvent | undefined {
	const events = pendingEvents.get(agentName) || [];
	if (events.length === 0) {
		return undefined;
	}

	const index =
		eventType === undefined
			? 0
			: events.findIndex((event) => event.type === eventType);

	if (index < 0) {
		return undefined;
	}

	const [event] = events.splice(index, 1);
	pendingEvents.set(agentName, events);
	return event;
}

export function getGeminiStatus(config: AgentConfig): {
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
