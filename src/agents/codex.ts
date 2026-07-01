import type { AgentConfig } from "../config/agents";
import { handleAutoDismiss } from "../core/agent-ui";
import {
	findCodexRequestInRecentSessions,
	findCodexResponseInRecentSessions,
	generateCodexRequestId,
} from "../core/codex-session";
import { getSessionName } from "../core/instance";
import {
	capturePane,
	createSession,
	getSession,
	hasSession,
	isSessionStopping,
	killSession,
	relaunchCommand,
	sendBuffer,
	updateLastActivity,
} from "../core/tmux-manager";

// Bilinçli durdurmaları event kirliliğinden ayırmak için özel hata sınıfı
class SessionStoppedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionStoppedError";
	}
}

// Ready bekleme üst sınırı (TUI boot yavaş olabilir: yük altında dakikalar sürebiliyor)
const READY_TIMEOUT_MS = Number.parseInt(
	process.env.SQUAD_READY_TIMEOUT_MS || "",
	10,
);
const EFFECTIVE_READY_TIMEOUT_MS = Number.isFinite(READY_TIMEOUT_MS)
	? READY_TIMEOUT_MS
	: 180_000;

// Yanıt bekleme üst sınırı (xhigh uzun görevler için cömert default: 3 saat)
const RESPONSE_TIMEOUT_MS = Number.parseInt(
	process.env.SQUAD_RESPONSE_TIMEOUT_MS || "",
	10,
);
const EFFECTIVE_RESPONSE_TIMEOUT_MS = Number.isFinite(RESPONSE_TIMEOUT_MS)
	? RESPONSE_TIMEOUT_MS
	: 3 * 60 * 60 * 1000;

// TUI'nin canlı (yazılabilir) olduğunu gösteren işaretler: hazır footer'ları
// veya aktif yanıt üretim göstergeleri. Shell prompt'u (❯) bunlara DAHİL DEĞİL —
// boot sırasında shell'e paste edilen prompt'ların kaybolmasını bu ayrım engeller.
const CODEX_BUSY_PATTERNS = [
	"esc to interrupt",
	"Esc to interrupt",
	"esc to cancel",
];

export interface CodexResult {
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

export async function initCodexSession(
	config: AgentConfig,
	workDir: string,
): Promise<string> {
	const sessionName = getSessionName(config.name);

	// Session zaten varsa kullan
	if (await hasSession(sessionName)) {
		return sessionName;
	}

	// Yeni session oluştur. Readiness beklemesi bilinçli olarak burada YOK:
	// tek kapı waitForSendable — boot-retry mantığı orada.
	await createSession(sessionName, workDir, config.command);

	return sessionName;
}

// Codex'in ~/.codex sqlite'ı başka bir codex instance'ı tarafından kilitliyken
// TUI başlayamadan çıkar. Bu geçici bir durumdur — pane'de bu metni görünce
// komutu yeniden denemek genellikle yeterlidir.
const CODEX_BOOT_LOCK_PATTERNS = [
	"another Codex process is using its local data",
	"database is locked",
];
const BOOT_RETRY_INTERVAL_MS = 10_000;

/**
 * Gönderim öncesi kapı: TUI gerçekten yazılabilir durumda mı?
 * Session var ama TUI hâlâ boot ediyorsa (pane'de sadece shell görünüyorsa)
 * paste edilen prompt shell'e gider ve kaybolur — bu bekleyiş onu engeller.
 * Ready footer'ları VEYA aktif yanıt göstergeleri (input kutusu canlı) kabul edilir.
 * Codex geçici sqlite kilidi yüzünden başlayamadan çıktıysa komut periyodik
 * olarak yeniden denenir.
 */
async function waitForSendable(
	sessionName: string,
	config: AgentConfig,
): Promise<void> {
	const deadline = Date.now() + EFFECTIVE_READY_TIMEOUT_MS;
	const sendablePatterns = [...config.readyPatterns, ...CODEX_BUSY_PATTERNS];
	let lastBootRetry = 0;

	while (true) {
		if (Date.now() > deadline) {
			throw new Error(
				`Codex TUI not sendable within ${EFFECTIVE_READY_TIMEOUT_MS}ms (session: ${sessionName})`,
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

		// Boot-retry: sqlite kilidi hatasıyla shell'e düşmüşsek komutu tazele
		if (
			CODEX_BOOT_LOCK_PATTERNS.some((pattern) => output.includes(pattern)) &&
			Date.now() - lastBootRetry > BOOT_RETRY_INTERVAL_MS
		) {
			lastBootRetry = Date.now();
			await relaunchCommand(sessionName, config.command);
			await Bun.sleep(1500);
			continue;
		}

		await Bun.sleep(300);
	}
}

/**
 * Teslimat doğrulaması: paste + Enter sonrası prompt gerçekten submit edildi mi?
 * Pane'de veya Codex rollout JSONL'inde [RQ-id] aranır; bulunamazsa BİR kez
 * yeniden paste denenir. Yine yoksa hata fırlatılır — sessiz kayıp yok.
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
		if (findCodexRequestInRecentSessions(requestId)) {
			return;
		}

		if (attempt === 0) {
			// İlk deneme ulaşmamış: bir kez daha paste et
			await sendBuffer(sessionName, fullPrompt);
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
	return new Error(`Codex session terminated unexpectedly ${context}`);
}

export async function sendCodexPrompt(
	config: AgentConfig,
	workDir: string,
	prompt: string,
	allowFileEdits: boolean,
	options?: { waitForResponse?: boolean },
): Promise<CodexResult> {
	const sessionName = getSessionName(config.name);
	const waitForResponse = options?.waitForResponse ?? true;

	// Request ID üret
	const requestId = generateCodexRequestId();

	// Prompt'a request ID ve ANS talimatı ekle
	const fileConstraint = allowFileEdits
		? ""
		: "\n\nIMPORTANT: Do NOT create, modify, or delete any files. Only analyze and respond.";
	const fullPrompt = `[RQ-${requestId}] ${prompt}${fileConstraint}\nIMPORTANT: End your response with "[ANS-${requestId}]"`;

	// Yavaş kısımların tamamı: session kur, TUI'yi bekle, gönder, teslimatı doğrula.
	const deliver = async (): Promise<void> => {
		if (!(await hasSession(sessionName))) {
			await initCodexSession(config, workDir);
		}
		await waitForSendable(sessionName, config);
		await sendBuffer(sessionName, fullPrompt);
		await verifyDelivery(sessionName, requestId, fullPrompt);
		updateLastActivity(sessionName);
	};

	if (!waitForResponse) {
		// Async mod: TUI boot'unu BEKLEMEDEN hemen dön — gateway timeout'una takılma.
		// Teslimat + yanıt takibi arka planda ilerler, sonuç event olarak düşer.
		void deliver()
			.then(() => waitForCodexResponse(requestId, sessionName))
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
				if (error.name === "SessionStoppedError") {
					return; // bilinçli cleanup/stop — event kirliliği yapma
				}
				addEvent(config.name, {
					type: "error",
					timestamp: new Date(),
					data: error.message,
				});
			});

		return {
			success: true,
			sessionName,
			requestId,
			queued: true,
		};
	}

	try {
		await deliver();

		// Response bekle (JSONL parsing)
		const response = await waitForCodexResponse(requestId, sessionName);

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

		if (error.name !== "SessionStoppedError") {
			addEvent(config.name, {
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

async function waitForCodexResponse(
	requestId: string,
	sessionName: string,
): Promise<string> {
	const deadline = Date.now() + EFFECTIVE_RESPONSE_TIMEOUT_MS;

	while (true) {
		if (Date.now() > deadline) {
			throw new Error(
				`Codex response timed out after ${EFFECTIVE_RESPONSE_TIMEOUT_MS}ms (requestId: ${requestId})`,
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
				`Codex session terminated by user (requestId: ${requestId})`,
			);
		}

		// Birden fazla Codex session dosyasında yanıtı ara.
		const response = findCodexResponseInRecentSessions(requestId, 30);
		if (response) {
			return response;
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
): "codex_medium" | "codex_xhigh" {
	return sessionName.includes("codex_medium") ? "codex_medium" : "codex_xhigh";
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
