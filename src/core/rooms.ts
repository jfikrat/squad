import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { getSessionName } from "./instance";
import { type TmuxSession, getAllSessions } from "./tmux-manager";

/**
 * Oda (room) kimliği: slot + workDir.
 *
 * Squad tek proses olarak birden fazla MCP client'a (gateway arkasında farklı
 * Claude Code instance'ları) hizmet verebilir. INSTANCE_ID proses başına tek
 * üretildiği için tek başına client'ları ayıramaz — bu yüzden kalıcı agent
 * session'ları workDir ile anahtarlanır: farklı projeler farklı odalara düşer,
 * aynı slot'a konuşan iki client birbirinin konuşmasına karışamaz.
 */

/** workDir → deterministik kısa anahtar (aynı proje her zaman aynı odayı bulur) */
export function workDirKey(workDir: string): string {
	return createHash("sha256")
		.update(resolve(workDir))
		.digest("hex")
		.slice(0, 6);
}

/** Oda anahtarı: event kuyruğu ve izole CODEX_HOME bu anahtarla tutulur */
export function roomKey(slot: string, workDir: string): string {
	return `${slot}_${workDirKey(workDir)}`;
}

/** Kalıcı oda tmux session adı: agents_{INSTANCE_ID}_{slot}_{wdKey} */
export function sessionNameForRoom(slot: string, workDir: string): string {
	return getSessionName(roomKey(slot, workDir));
}

/**
 * Bu instance'ın bir slot'a ait canlı kalıcı odaları.
 * Async worker session'ları (isimlerinde requestId taşır) elenir: bir session
 * ancak adı kendi workDir'inden deterministik olarak türetilen oda adıyla
 * birebir eşleşiyorsa kalıcı odadır.
 */
export function getRoomsForSlot(slot: string): TmuxSession[] {
	return getAllSessions().filter(
		(s) => sessionNameForRoom(slot, s.workDir) === s.name,
	);
}

export type RoomResolution =
	| { ok: true; workDir: string; sessionName: string }
	| { ok: false; error: string };

/**
 * Bir tool çağrısını odaya çöz.
 * - workDir verildiyse: deterministik oda (yoksa bile ad hesaplanır, caller
 *   hasSession ile canlılığı kontrol eder).
 * - workDir yoksa: tek canlı oda varsa o; birden fazlaysa belirsizlik hatası
 *   (cross-client karışmayı önlemek için asla "en sonuncusu" seçilmez).
 */
export function resolveRoom(slot: string, workDir?: string): RoomResolution {
	if (workDir) {
		return {
			ok: true,
			workDir,
			sessionName: sessionNameForRoom(slot, workDir),
		};
	}

	const rooms = getRoomsForSlot(slot);
	if (rooms.length === 1) {
		return { ok: true, workDir: rooms[0].workDir, sessionName: rooms[0].name };
	}
	if (rooms.length === 0) {
		return {
			ok: false,
			error: `No running session for ${slot}. Pass workDir to target (or start) one.`,
		};
	}
	return {
		ok: false,
		error: `Multiple ${slot} sessions are running (one per workDir). Pass workDir to disambiguate. Candidates: ${rooms
			.map((r) => r.workDir)
			.join(", ")}`,
	};
}
