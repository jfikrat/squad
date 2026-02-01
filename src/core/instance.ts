/**
 * MCP Server Instance ID
 *
 * Her MCP server instance'ı başladığında unique bir ID alır.
 * Bu ID tmux session isimlerinde kullanılarak farklı Claude Code
 * instance'larının session'larının çakışması önlenir.
 *
 * Örnek: agents_codex_high → agents_a7x2_codex_high
 */

function generateInstanceId(): string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	let id = "";
	for (let i = 0; i < 4; i++) {
		id += chars[Math.floor(Math.random() * chars.length)];
	}
	return id;
}

// Server başladığında bir kez üretilir
export const INSTANCE_ID = generateInstanceId();

/**
 * Session ismi oluştur (instance ID ile prefix'li)
 * @param name Agent/session adı (örn: "codex_high", "gemini_flash")
 * @returns Unique session ismi (örn: "agents_a7x2_codex_high")
 */
export function getSessionName(name: string): string {
	return `agents_${INSTANCE_ID}_${name}`;
}

// Startup log
console.error(`[squad-mcp] Instance ID: ${INSTANCE_ID}`);
