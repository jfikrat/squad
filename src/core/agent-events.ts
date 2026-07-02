/**
 * Ortak agent event kuyruğu.
 *
 * Kuyruklar oda anahtarıyla ({slot}_{wdKey}, bkz. rooms.ts) tutulur — böylece
 * farklı workDir'lerden (farklı MCP client'lardan) gelen işlerin event'leri
 * birbirine karışmaz ve biri diğerinin sonucunu tüketemez.
 * Daha önce codex.ts/claude.ts içinde slot adıyla anahtarlanan iki ayrı kopya
 * vardı; tek modülde birleştirildi.
 */

export type AgentEventType =
	| "tool_complete"
	| "session_idle"
	| "message_complete"
	| "error";

export interface PendingEvent {
	type: AgentEventType;
	timestamp: Date;
	data?: string;
}

const queues = new Map<string, PendingEvent[]>();

export function addEvent(key: string, event: PendingEvent): void {
	if (!queues.has(key)) {
		queues.set(key, []);
	}
	queues.get(key)?.push(event);
}

export function pollEvents(key: string, peek = false): PendingEvent[] {
	const events = queues.get(key) || [];
	if (!peek) {
		queues.set(key, []);
	}
	return events;
}

/** Sadece eşleşen tek event'i kuyruktan çıkar (L-2026-04-03-01: tümünü boşaltma) */
export function consumeEvent(
	key: string,
	eventType?: AgentEventType,
): PendingEvent | undefined {
	const events = queues.get(key) || [];
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
	queues.set(key, events);
	return event;
}

export function pendingCount(key: string): number {
	return queues.get(key)?.length || 0;
}

export function clearEvents(key: string): void {
	queues.delete(key);
}

/**
 * Bir slot'a ait oda kuyruğu anahtarları ({slot}_{6-hex-wdKey} kalıbı).
 * Graph worker'larının uzun anahtarları ({slot}_g_xxx_...) bilinçli olarak
 * eşleşmez — onlar kimse tarafından poll edilmeyen geçici kuyruklardır.
 */
export function eventKeysForSlot(slot: string): string[] {
	const pattern = new RegExp(`^${slot}_[0-9a-f]{6}$`);
	return Array.from(queues.keys()).filter((key) => pattern.test(key));
}
