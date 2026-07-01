import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Slot başına izole CODEX_HOME yönetimi.
 *
 * Codex CLI, CODEX_HOME altındaki sqlite state/log DB'lerini açarken başka bir
 * codex instance'ı aktif yazım yapıyorsa "database is locked" ile başlamadan
 * çıkar (bilinen codex sınırı). Paylaşılan ~/.codex yerine her squad slot'una
 * kendi home'unu verip auth/config/skills gibi ortak dosyaları canonical
 * home'dan symlink'leyerek bu çekişmeyi tamamen ortadan kaldırırız.
 */

const CANONICAL_CODEX_HOME =
	process.env.CODEX_HOME || join(homedir(), ".codex");

const SQUAD_CODEX_HOMES_ROOT = join(
	homedir(),
	".local",
	"share",
	"squad",
	"codex-homes",
);

// Canonical home'dan paylaşılan öğeler. State/log/goals sqlite'ları bilinçli
// olarak DAHİL DEĞİL — izolasyonun amacı tam da onları ayırmak. `memories` da
// dahil değil: helper agent'ların kalıcı hafızaya ihtiyacı yok ve memories
// sqlite'ı paylaşmak kilit çekişmesini geri getirir. `hooks`/`hooks.json` da
// dahil değil: config.toml'daki trust hash hooks.json'ın PATH'ine bağlı, izole
// home'daki farklı path codex'i interaktif "Review hooks" onayına düşürüyor.
const SHARED_ITEMS = ["auth.json", "config.toml", "skills", "AGENTS.md"];

export function ensureCodexHomeForSlot(slot: string): string {
	const home = join(SQUAD_CODEX_HOMES_ROOT, slot);
	mkdirSync(home, { recursive: true });

	for (const item of SHARED_ITEMS) {
		const target = join(CANONICAL_CODEX_HOME, item);
		const link = join(home, item);
		if (!existsSync(target)) continue;
		if (existsSync(link)) continue;
		try {
			symlinkSync(target, link);
		} catch {
			// EEXIST (dangling symlink vb.) — best effort, codex eksik öğeyle de çalışır
		}
	}

	return home;
}

/** Slot'un rollout JSONL sessions kökü (response/teslimat tespiti için). */
export function codexSessionsRootForSlot(slot: string): string {
	return join(SQUAD_CODEX_HOMES_ROOT, slot, "sessions");
}
