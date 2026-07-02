import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { AgentConfig } from "../config/agents";
import { type PendingEvent, addEvent, clearEvents } from "../core/agent-events";
import { handleAutoDismiss } from "../core/agent-ui";
import {
	findClaudeResponseByRequestId,
	generateClaudeRequestId,
	getClaudeSessionDir,
	getRecentClaudeSessionFiles,
} from "../core/claude-session";
import { getSessionName } from "../core/instance";
import { roomKey, sessionNameForRoom } from "../core/rooms";
import {
	capturePane,
	createSession,
	hasSession,
	isSessionStopping,
	killSession,
	sendBufferNoBracket,
	updateLastActivity,
} from "../core/tmux-manager";

// Bilinçli durdurmaları event kirliliğinden ayırmak için özel hata sınıfı
class SessionStoppedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionStoppedError";
	}
}

// Ready/yanıt bekleme üst sınırları (codex.ts ile aynı env değişkenleri)
const READY_TIMEOUT_MS = Number.parseInt(
	process.env.SQUAD_READY_TIMEOUT_MS || "",
	10,
);
const EFFECTIVE_READY_TIMEOUT_MS = Number.isFinite(READY_TIMEOUT_MS)
	? READY_TIMEOUT_MS
	: 180_000;

const RESPONSE_TIMEOUT_MS = Number.parseInt(
	process.env.SQUAD_RESPONSE_TIMEOUT_MS || "",
	10,
);
const EFFECTIVE_RESPONSE_TIMEOUT_MS = Number.isFinite(RESPONSE_TIMEOUT_MS)
	? RESPONSE_TIMEOUT_MS
	: 3 * 60 * 60 * 1000;

// TUI'nin canlı (yazılabilir) olduğunu gösteren ek işaretler
const CLAUDE_BUSY_PATTERNS = ["esc to interrupt", "Esc to interrupt"];

export interface ClaudeResult {
	success: boolean;
	response?: string;
	error?: string;
	sessionName: string;
	requestId?: string;
	queued?: boolean;
	outputFile?: string;
}

export type { PendingEvent };

export async function initClaudeSession(
	config: AgentConfig,
	workDir: string,
	sessionNameOverride?: string,
): Promise<string> {
	const sessionName =
		sessionNameOverride ?? sessionNameForRoom(config.name, workDir);

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
	const deadline = Date.now() + EFFECTIVE_READY_TIMEOUT_MS;

	while (true) {
		if (Date.now() > deadline) {
			throw new Error(
				`Claude TUI did not become ready within ${EFFECTIVE_READY_TIMEOUT_MS}ms (session: ${sessionName})`,
			);
		}
		if (!(await hasSession(sessionName))) {
			throw newTerminationError(sessionName, "(during startup)");
		}

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

/**
 * Gönderim öncesi kapı: TUI gerçekten yazılabilir durumda mı?
 * Session var ama TUI hâlâ boot ediyorsa (pane'de sadece shell varsa) yazılan
 * prompt shell'e gider ve kaybolur — bu bekleyiş onu engeller.
 */
async function waitForSendable(
	sessionName: string,
	patterns: string[],
): Promise<void> {
	const deadline = Date.now() + EFFECTIVE_READY_TIMEOUT_MS;
	const sendablePatterns = [...patterns, ...CLAUDE_BUSY_PATTERNS];

	while (true) {
		if (Date.now() > deadline) {
			throw new Error(
				`Claude TUI not sendable within ${EFFECTIVE_READY_TIMEOUT_MS}ms (session: ${sessionName})`,
			);
		}
		if (!(await hasSession(sessionName))) {
			throw newTerminationError(sessionName, "(before send)");
		}

		const output = await capturePane(sessionName, 120);
		const autoDismissResult = await handleAutoDismiss(
			configNameFromSession(sessionName),
			sessionName,
			output,
		);
		if (autoDismissResult.acted) {
			await Bun.sleep(1000);
			continue;
		}

		if (sendablePatterns.some((pattern) => output.includes(pattern))) {
			return;
		}

		await Bun.sleep(300);
	}
}

/**
 * Teslimat doğrulaması: chunked typing + Enter sonrası prompt gerçekten submit
 * edildi mi? Pane'de [RQ-id] aranır; bulunamazsa BİR kez yeniden gönderilir.
 */
async function verifyDelivery(
	sessionName: string,
	requestId: string,
	fullPrompt: string,
): Promise<void> {
	const marker = `[RQ-${requestId}]`;

	for (let attempt = 0; attempt < 2; attempt++) {
		await Bun.sleep(1500);

		const output = await capturePane(sessionName, 300);
		if (output.includes(marker)) {
			return;
		}

		if (attempt === 0) {
			await sendBufferNoBracket(sessionName, fullPrompt);
		}
	}

	throw new Error(
		`Prompt delivery could not be verified (requestId: ${requestId}, session: ${sessionName})`,
	);
}

function newTerminationError(sessionName: string, context: string): Error {
	if (isSessionStopping(sessionName)) {
		return new SessionStoppedError(
			`Session ${sessionName} stopped intentionally ${context}`,
		);
	}
	return new Error(`Claude session terminated unexpectedly ${context}`);
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
	// Sync mode: reuse the room session (slot + workDir — cross-client karışmaz)
	const sessionName = !waitForResponse
		? getSessionName(`${config.name}_${requestId}`)
		: sessionNameForRoom(config.name, workDir);
	const eventKey = roomKey(config.name, workDir);

	// Resolve outputFile: relative paths become workDir-relative,
	// if async with no outputFile, auto-generate under .squad/results/
	let outputFile = options?.outputFile;
	if (outputFile && !isAbsolute(outputFile)) {
		outputFile = join(workDir, outputFile);
	}
	if (!waitForResponse && !outputFile) {
		outputFile = join(workDir, ".squad", "results", `${requestId}.md`);
	}

	// Prompt'a request ID ve ANS talimatı ekle
	// Newline'ları kaldır: Claude Code multiline paste'te Enter submit yerine newline ekler
	const sanitizedPrompt = prompt.replace(/\n+/g, " ").trim();
	const fileConstraint = allowFileEdits
		? ""
		: " --- IMPORTANT: Do NOT create, modify, or delete any files. Only analyze and respond.";
	const fullPrompt = `[RQ-${requestId}] ${sanitizedPrompt}${fileConstraint} End your response with "[ANS-${requestId}]"`;

	// Yavaş kısımların tamamı: session kur, TUI'yi bekle, gönder, teslimatı doğrula.
	const deliver = async (): Promise<void> => {
		if (!(await hasSession(sessionName))) {
			await initClaudeSession(config, workDir, sessionName);
		}
		await waitForSendable(sessionName, config.readyPatterns);
		await sendBufferNoBracket(sessionName, fullPrompt);
		await verifyDelivery(sessionName, requestId, fullPrompt);
		updateLastActivity(sessionName);
	};

	if (!waitForResponse) {
		// Async mod: TUI boot'unu BEKLEMEDEN hemen dön — gateway timeout'una takılma.
		void deliver()
			.then(() => waitForClaudeResponse(requestId, sessionName, workDir))
			.then(async (response) => {
				addEvent(eventKey, {
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
				if (error.name !== "SessionStoppedError") {
					addEvent(eventKey, {
						type: "error",
						timestamp: new Date(),
						data: error.message,
					});
					if (outputFile) {
						writeOutputFile(outputFile, requestId, null, error.message);
					}
				}
				await killSession(sessionName);
			});

		return {
			success: true,
			sessionName,
			requestId,
			queued: true,
			outputFile,
		};
	}

	try {
		await deliver();

		// Response bekle (JSONL parsing)
		const response = await waitForClaudeResponse(
			requestId,
			sessionName,
			workDir,
		);

		// Cevap alındı, lastActivity güncelle
		updateLastActivity(sessionName);

		// Event ekle
		addEvent(eventKey, {
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

		if (error.name !== "SessionStoppedError") {
			addEvent(eventKey, {
				type: "error",
				timestamp: new Date(),
				data: error.message,
			});
		}

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
	const deadline = startTime + EFFECTIVE_RESPONSE_TIMEOUT_MS;
	const sessionDir = getClaudeSessionDir(workDir);

	while (true) {
		if (Date.now() > deadline) {
			throw new Error(
				`Claude response timed out after ${EFFECTIVE_RESPONSE_TIMEOUT_MS}ms (requestId: ${requestId})`,
			);
		}

		// Session hala var mı kontrol et (kullanıcı manuel kapatmış olabilir)
		if (!(await hasSession(sessionName))) {
			if (isSessionStopping(sessionName)) {
				throw new SessionStoppedError(
					`Session ${sessionName} stopped intentionally (requestId: ${requestId})`,
				);
			}
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

export async function stopClaudeSession(
	config: AgentConfig,
	workDir: string,
): Promise<void> {
	const sessionName = sessionNameForRoom(config.name, workDir);
	await killSession(sessionName);
	clearEvents(roomKey(config.name, workDir));
}
