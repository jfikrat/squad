import { sendGeminiPrompt } from "../agents/gemini";
import type { AgentConfig } from "../config/agents";
import { AGENTS } from "../config/agents";
import {
	findCodexResponseByRequestId,
	generateCodexRequestId,
	getLatestCodexSessionFile,
} from "../core/codex-session";
import {
	findResponseByRequestId,
	generateRequestId,
	getLatestSessionFile,
	getSessionDir,
} from "../core/gemini-session";
import {
	capturePane,
	createSession,
	hasSession,
	killSession,
	sendBuffer,
} from "../core/tmux-manager";

export type GeminiModel = "flash" | "pro";

const MODEL_MAP: Record<GeminiModel, string> = {
	flash: "gemini-3-flash-preview",
	pro: "gemini-3-pro-preview",
};

export const geminiTool = {
	name: "gemini",
	description:
		"Gemini 3 for fast code generation and creative analysis. Uses native Gemini CLI in visible tmux session. IMPORTANT: Always pass your current working directory (pwd) as workDir so Gemini can access project files.",
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
			model: {
				type: "string",
				enum: ["flash", "pro"],
				description:
					"Model to use. flash for speed, pro for complex analysis. Default: flash",
			},
		},
		required: ["message", "workDir"],
	},
};

export const parallelSearchTool = {
	name: "parallel_search",
	description:
		"Parallel search using multiple AI agents (2 Gemini Flash + 2 Codex Medium). Max 4 queries distributed automatically. IMPORTANT: Always pass your current working directory (pwd) as workDir.",
	inputSchema: {
		type: "object",
		properties: {
			queries: {
				type: "array",
				items: { type: "string" },
				maxItems: 4,
				description:
					"Array of search queries (max 4, distributed: 2 gemini + 2 codex)",
			},
			workDir: {
				type: "string",
				description:
					"Working directory for agents. Always pass your current pwd.",
			},
		},
		required: ["queries", "workDir"],
	},
};

function getGeminiConfig(model: GeminiModel): AgentConfig {
	const base = AGENTS.gemini;
	const modelId = MODEL_MAP[model];
	return {
		...base,
		name: `gemini_${model}`,
		command: [
			...base.command.slice(0, 1),
			"-m",
			modelId,
			...base.command.slice(1),
		],
	};
}

export async function handleGemini(args: {
	message: string;
	workDir: string;
	model?: GeminiModel;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const model = args.model || "flash";
	const config = getGeminiConfig(model);
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

export async function handleParallelSearch(args: {
	queries: string[];
	workDir: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const queries = args.queries.slice(0, 4);
	const results: Array<{ query: string; response: string; agent: string }> = [];

	// Query'leri dağıt: ilk yarısı gemini, ikinci yarısı codex
	const half = Math.ceil(queries.length / 2);
	const geminiQueries = queries.slice(0, half);
	const codexQueries = queries.slice(half);

	// Gemini session'ları
	const geminiPromises = geminiQueries.map(async (query, index) => {
		const sessionName = `agents_parallel_gemini_${index}`;
		const requestId = generateRequestId();

		try {
			await createSession(sessionName, args.workDir, [
				"gemini",
				"-m",
				"gemini-3-flash-preview",
				"-y",
			]);

			await waitForGeminiReady(sessionName, 30000);

			const safeQuery = `[RQ-${requestId}] Soru: ${query}\n\nYanıtının sonuna "[ANS-${requestId}]" yaz.`;
			await sendBuffer(sessionName, safeQuery);

			const response = await waitForGeminiResponse(
				args.workDir,
				requestId,
				120000,
			);

			return { query, response, agent: "gemini_flash" };
		} catch (err) {
			return {
				query,
				response: `Error: ${(err as Error).message}`,
				agent: "gemini_flash",
			};
		} finally {
			await killSession(sessionName);
		}
	});

	// Codex session'ları
	const codexPromises = codexQueries.map(async (query, index) => {
		const sessionName = `agents_parallel_codex_${index}`;
		const requestId = generateCodexRequestId();

		try {
			await createSession(sessionName, args.workDir, [
				"codex",
				"--dangerously-bypass-approvals-and-sandbox",
				"-c",
				'model_reasoning_effort="medium"',
			]);

			await waitForCodexReady(sessionName, 30000);

			const fullPrompt = `[RQ-${requestId}] ${query}\n\nIMPORTANT: End your response with "[ANS-${requestId}]"`;
			await sendBuffer(sessionName, fullPrompt);

			const response = await waitForCodexResponse(
				requestId,
				120000,
				sessionName,
			);

			return { query, response, agent: "codex_medium" };
		} catch (err) {
			return {
				query,
				response: `Error: ${(err as Error).message}`,
				agent: "codex_medium",
			};
		} finally {
			await killSession(sessionName);
		}
	});

	// Tüm query'leri paralel çalıştır
	const allResults = await Promise.all([...geminiPromises, ...codexPromises]);
	results.push(...allResults);

	// İstatistikler
	const total = results.length;
	const successful = results.filter(
		(r) => !r.response.startsWith("Error:"),
	).length;
	const failed = total - successful;
	const geminiCount = results.filter((r) => r.agent === "gemini_flash").length;
	const codexCount = results.filter((r) => r.agent === "codex_medium").length;

	// Sonuçları formatla
	const formattedResults = results
		.map(
			(r, i) => `## Query ${i + 1} [${r.agent}]: ${r.query}\n\n${r.response}`,
		)
		.join("\n\n---\n\n");

	// Özet ekle
	const summary = `📊 **${total} query (${geminiCount} gemini + ${codexCount} codex) | ${successful} başarılı | ${failed} başarısız**\n\n---\n\n`;

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

async function waitForCodexReady(
	sessionName: string,
	timeout: number,
): Promise<void> {
	const patterns = ["? for shortcuts", "context left", "How can I help"];
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

	throw new Error("Codex ready timeout");
}

async function waitForCodexResponse(
	requestId: string,
	timeout: number,
	sessionName: string,
): Promise<string> {
	const startTime = Date.now();

	while (Date.now() - startTime < timeout) {
		// Session hala var mı kontrol et
		if (!(await hasSession(sessionName))) {
			throw new Error("Codex session terminated by user");
		}

		// Session JSONL'den yanıt ara
		const latestFile = getLatestCodexSessionFile();
		if (latestFile) {
			const response = findCodexResponseByRequestId(latestFile, requestId);
			if (response) {
				return response;
			}
		}

		await Bun.sleep(500);
	}

	throw new Error(`Codex response timeout (requestId: ${requestId})`);
}
