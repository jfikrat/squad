import { sendGeminiPrompt } from "../agents/gemini";
import { AGENTS, MAX_PARALLEL_SEARCH } from "../config/agents";
import {
	findResponseByRequestId,
	generateRequestId,
	getLatestSessionFile,
	getSessionDir,
} from "../core/gemini-session";
import {
	capturePane,
	createSession,
	killSession,
	sendBuffer,
	sendKeys,
} from "../core/tmux-manager";

export const geminiFlashTool = {
	name: "gemini_flash",
	description:
		"Gemini 3 Flash for fast code generation. High-quality code writing with speed. Uses native Gemini CLI in visible tmux session. IMPORTANT: Always pass your current working directory (pwd) as workDir so Gemini can access project files.",
	inputSchema: {
		type: "object",
		properties: {
			message: {
				type: "string",
				description: "The coding task or request",
			},
			workDir: {
				type: "string",
				description:
					"Working directory for Gemini to access project files. Always pass your current pwd.",
			},
		},
		required: ["message", "workDir"],
	},
};

export const geminiProTool = {
	name: "gemini_pro",
	description:
		"Gemini 3 Pro for UI/UX design, feature planning, and creative analysis. Has full file access. Uses native Gemini CLI in visible tmux session. IMPORTANT: Always pass your current working directory (pwd) as workDir so Gemini can access project files.",
	inputSchema: {
		type: "object",
		properties: {
			message: {
				type: "string",
				description: "The question or analysis request",
			},
			workDir: {
				type: "string",
				description:
					"Working directory for Gemini to access project files. Always pass your current pwd.",
			},
		},
		required: ["message", "workDir"],
	},
};

export const geminiParallelSearchTool = {
	name: "gemini_parallel_search",
	description:
		"Multiple visible tmux sessions for parallel search. Max 5 concurrent queries. IMPORTANT: Always pass your current working directory (pwd) as workDir.",
	inputSchema: {
		type: "object",
		properties: {
			queries: {
				type: "array",
				items: { type: "string" },
				maxItems: MAX_PARALLEL_SEARCH,
				description: "Array of search queries (max 5)",
			},
			workDir: {
				type: "string",
				description:
					"Working directory for Gemini. Always pass your current pwd.",
			},
			model: {
				type: "string",
				enum: ["gemini-3-flash-preview", "gemini-3-pro-preview"],
				default: "gemini-3-flash-preview",
				description: "Model to use (default: flash)",
			},
		},
		required: ["queries", "workDir"],
	},
};

export async function handleGeminiFlash(args: {
	message: string;
	workDir: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const config = AGENTS.gemini_flash;
	const result = await sendGeminiPrompt(config, args.workDir, args.message);

	if (result.success) {
		return {
			content: [
				{
					type: "text",
					text: result.response || "No response received",
				},
			],
		};
	}

	return {
		content: [
			{
				type: "text",
				text: `Error: ${result.error}`,
			},
		],
	};
}

export async function handleGeminiPro(args: {
	message: string;
	workDir: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const config = AGENTS.gemini_pro;
	const result = await sendGeminiPrompt(config, args.workDir, args.message);

	if (result.success) {
		return {
			content: [
				{
					type: "text",
					text: result.response || "No response received",
				},
			],
		};
	}

	return {
		content: [
			{
				type: "text",
				text: `Error: ${result.error}`,
			},
		],
	};
}

export async function handleGeminiParallelSearch(args: {
	queries: string[];
	workDir: string;
	model?: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const queries = args.queries.slice(0, MAX_PARALLEL_SEARCH);
	const model = args.model || "gemini-3-flash-preview";
	const marker = "◆END◆";

	const results: Array<{ query: string; response: string }> = [];

	// Her query için ayrı session oluştur
	const sessionPromises = queries.map(async (query, index) => {
		const sessionName = `agents_parallel_${index}`;
		const requestId = generateRequestId();

		try {
			// Session oluştur
			await createSession(sessionName, args.workDir, [
				"gemini",
				"-m",
				model,
				"-y",
			]);

			// Ready bekle
			await waitForGeminiReady(sessionName, 30000);

			// Query gönder (request ID ile, multiline olduğu için sendBuffer)
			const safeQuery = `[RQ-${requestId}] Soru: ${query}\n\nYanıtının sonuna "[ANS-${requestId}]" yaz.`;
			await sendBuffer(sessionName, safeQuery);

			// Response bekle (JSON parsing)
			const response = await waitForGeminiResponse(
				args.workDir,
				requestId,
				120000,
			);

			return { query, response };
		} catch (err) {
			return { query, response: `Error: ${(err as Error).message}` };
		} finally {
			// Session'ı kapat
			await killSession(sessionName);
		}
	});

	// Tüm query'leri paralel çalıştır
	const parallelResults = await Promise.all(sessionPromises);
	results.push(...parallelResults);

	// İstatistikler
	const total = results.length;
	const successful = results.filter(
		(r) => !r.response.startsWith("Error:"),
	).length;
	const failed = total - successful;

	// Sonuçları formatla
	const formattedResults = results
		.map((r, i) => `## Query ${i + 1}: ${r.query}\n\n${r.response}`)
		.join("\n\n---\n\n");

	// Özet ekle
	const summary = `📊 **${total} query | ${successful} başarılı | ${failed} başarısız**\n\n---\n\n`;

	return {
		content: [
			{
				type: "text",
				text: summary + formattedResults,
			},
		],
	};
}

async function waitForGeminiReady(
	sessionName: string,
	timeout: number,
): Promise<void> {
	const patterns = ["YOLO mode", "Type your message", "Model:"];
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

	throw new Error("Gemini ready timeout");
}

async function waitForGeminiResponse(
	workDir: string,
	requestId: string,
	timeout: number,
): Promise<string> {
	const startTime = Date.now();
	const sessionDir = getSessionDir(workDir);

	while (Date.now() - startTime < timeout) {
		// Session JSON'dan yanıt ara
		const latestFile = getLatestSessionFile(sessionDir);
		if (latestFile) {
			const response = findResponseByRequestId(latestFile, requestId);
			if (response) {
				return response;
			}
		}

		await Bun.sleep(200);
	}

	throw new Error(`Response timeout (requestId: ${requestId})`);
}
