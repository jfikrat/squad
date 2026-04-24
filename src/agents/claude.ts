import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { AgentConfig } from "../config/agents";
import { handleAutoDismiss } from "../core/agent-ui";
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
	requestId?: string;
	queued?: boolean;
	outputFile?: string;
}

export interface PendingEvent {
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

export async function sendClaudePrompt(
	config: AgentConfig,
	workDir: string,
	prompt: string,
	allowFileEdits: boolean,
	options?: { waitForResponse?: boolean; outputFile?: string },
): Promise<ClaudeResult> {
	const waitForResponse = options?.waitForResponse ?? true;
	const requestId = generateClaudeRequestId();

	// Async mode: unique session per dispatch so multiple workers can run in parallel
	// Sync mode: reuse the shared session (interactive conversation)
	const effectiveConfig = !waitForResponse
		? { ...config, name: `${config.name}_${requestId}` }
		: config;
	const sessionName = getSessionName(effectiveConfig.name);

	// Resolve outputFile: relative paths become workDir-relative,
	// if async with no outputFile, auto-generate under .squad/results/
	let outputFile = options?.outputFile;
	if (outputFile && !isAbsolute(outputFile)) {
		outputFile = join(workDir, outputFile);
	}
	if (!waitForResponse && !outputFile) {
		outputFile = join(workDir, ".squad", "results", `${requestId}.md`);
	}

	try {
		// Session yoksa oluştur
		if (!(await hasSession(sessionName))) {
			await initClaudeSession(effectiveConfig, workDir);
		}

		// Prompt'a request ID ve ANS talimatı ekle
		// Newline'ları kaldır: Claude Code multiline paste'te Enter submit yerine newline ekler
		const sanitizedPrompt = prompt.replace(/\n+/g, " ").trim();
		const fileConstraint = allowFileEdits
			? ""
			: " --- IMPORTANT: Do NOT create, modify, or delete any files. Only analyze and respond.";
		const fullPrompt = `[RQ-${requestId}] ${sanitizedPrompt}${fileConstraint} End your response with "[ANS-${requestId}]"`;

		// Chunked send-keys ile gönder (paste detection bypass)
		await sendBufferNoBracket(sessionName, fullPrompt);

		if (!waitForResponse) {
			void waitForClaudeResponse(requestId, sessionName, workDir)
				.then(async (response) => {
					addEvent(config.name, {
						type: "message_complete",
						timestamp: new Date(),
						data: response,
					});
					if (outputFile) {
						writeOutputFile(outputFile, requestId, response);
					}
					// Async workers get their own session — kill it when done
					await killSession(sessionName);
				})
				.catch(async (err) => {
					const error = err as Error;
					addEvent(config.name, {
						type: "error",
						timestamp: new Date(),
						data: error.message,
					});
					if (outputFile) {
						writeOutputFile(outputFile, requestId, null, error.message);
					}
					await killSession(sessionName);
				});

			updateLastActivity(sessionName);

			return {
				success: true,
				sessionName,
				requestId,
				queued: true,
				outputFile,
			};
		}

		// Response bekle (JSONL parsing)
		const response = await waitForClaudeResponse(
			requestId,
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

async function waitForClaudeResponse(
	requestId: string,
	sessionName: string,
	workDir: string,
): Promise<string> {
	const startTime = Date.now();
	const sessionDir = getClaudeSessionDir(workDir);

	while (true) {
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

function writeOutputFile(
	filePath: string,
	requestId: string,
	response: string | null,
	error?: string,
): void {
	try {
		mkdirSync(dirname(filePath), { recursive: true });
		const ts = new Date().toISOString();
		if (error) {
			writeFileSync(
				filePath,
				`---\nrequestId: ${requestId}\nstatus: error\ntimestamp: ${ts}\n---\n\n${error}\n`,
			);
		} else {
			writeFileSync(
				filePath,
				`---\nrequestId: ${requestId}\nstatus: done\ntimestamp: ${ts}\n---\n\n${response}\n`,
			);
		}
	} catch {
		// best-effort — don't crash the background handler
	}
}

function configNameFromSession(
	sessionName: string,
): "claude_sonnet" | "claude_opus" {
	return sessionName.includes("claude_opus") ? "claude_opus" : "claude_sonnet";
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
