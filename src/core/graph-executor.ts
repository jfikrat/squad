import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { sendClaudePrompt } from "../agents/claude";
import { AGENTS } from "../config/agents";
import { getSessionName } from "./instance";
import { killSession } from "./tmux-manager";

export interface TaskNode {
	id: string;
	message: string;
	model: "sonnet" | "opus";
	dependsOn: string[];
	allowFileEdits?: boolean;
}

export interface TaskGraph {
	name: string;
	workDir: string;
	outputFile?: string;
	tasks: TaskNode[];
	maxConcurrency?: number;
}

interface TaskState {
	node: TaskNode;
	status: "pending" | "running" | "done" | "error";
	result?: string;
	error?: string;
}

const MODEL_PRESETS: Record<string, { model: string; effort?: string }> = {
	opus: { model: "claude-opus-4-7", effort: "xhigh" },
	sonnet: { model: "claude-sonnet-4-6" },
};

function resolveOutputFile(
	workDir: string,
	graphId: string,
	outputFile?: string,
): string {
	if (outputFile && isAbsolute(outputFile)) return outputFile;
	if (outputFile) return join(workDir, outputFile);
	return join(workDir, ".squad", "results", `graph-${graphId}.md`);
}

function validateGraph(graph: TaskGraph): string | null {
	const ids = new Set(graph.tasks.map((t) => t.id));
	if (ids.size !== graph.tasks.length) return "Duplicate task IDs";
	for (const task of graph.tasks) {
		for (const dep of task.dependsOn) {
			if (!ids.has(dep)) return `Task "${task.id}" depends on unknown "${dep}"`;
		}
		if (task.dependsOn.includes(task.id))
			return `Task "${task.id}" depends on itself`;
	}
	// Simple cycle detection via topological sort
	const visited = new Set<string>();
	const visiting = new Set<string>();
	const taskMap = new Map(graph.tasks.map((t) => [t.id, t]));
	function hasCycle(id: string): boolean {
		if (visiting.has(id)) return true;
		if (visited.has(id)) return false;
		visiting.add(id);
		const node = taskMap.get(id);
		if (!node) return false;
		for (const dep of node.dependsOn) {
			if (hasCycle(dep)) return true;
		}
		visiting.delete(id);
		visited.add(id);
		return false;
	}
	for (const task of graph.tasks) {
		if (hasCycle(task.id)) return `Cycle detected involving task "${task.id}"`;
	}
	return null;
}

export async function executeGraph(
	graph: TaskGraph,
): Promise<{ graphId: string; outputFile: string }> {
	const graphId = crypto.randomUUID().slice(0, 8);
	const outputFile = resolveOutputFile(
		graph.workDir,
		graphId,
		graph.outputFile,
	);
	const maxConcurrency = graph.maxConcurrency ?? 3;

	// Validate
	const validationError = validateGraph(graph);
	if (validationError) {
		mkdirSync(dirname(outputFile), { recursive: true });
		writeFileSync(
			outputFile,
			`---\ngraphId: ${graphId}\nstatus: error\ntimestamp: ${new Date().toISOString()}\n---\n\nValidation error: ${validationError}\n`,
		);
		return { graphId, outputFile };
	}

	// Initialize state
	const states = new Map<string, TaskState>();
	for (const task of graph.tasks) {
		states.set(task.id, { node: task, status: "pending" });
	}

	// Write initial status
	mkdirSync(dirname(outputFile), { recursive: true });
	writeFileSync(
		outputFile,
		`---\ngraphId: ${graphId}\nname: ${graph.name}\nstatus: running\ntimestamp: ${new Date().toISOString()}\ntasks: ${graph.tasks.length}\n---\n\nGraph execution in progress...\n`,
	);

	// Execute the DAG
	try {
		await runDAG(states, graph.workDir, maxConcurrency);
	} catch (err) {
		const error = err as Error;
		writeFileSync(
			outputFile,
			`---\ngraphId: ${graphId}\nname: ${graph.name}\nstatus: error\ntimestamp: ${new Date().toISOString()}\n---\n\nExecution error: ${error.message}\n`,
		);
		return { graphId, outputFile };
	}

	// Build final output
	const sections: string[] = [];
	let allSuccess = true;

	for (const task of graph.tasks) {
		const state = states.get(task.id);
		if (!state) continue;
		sections.push(`## ${task.id} (${task.model})\n`);
		if (state.status === "done") {
			sections.push(state.result || "(empty result)");
		} else {
			allSuccess = false;
			sections.push(`**ERROR**: ${state.error || "unknown error"}`);
		}
		sections.push("");
	}

	const finalStatus = allSuccess ? "done" : "partial";
	const output = `---\ngraphId: ${graphId}\nname: ${graph.name}\nstatus: ${finalStatus}\ntimestamp: ${new Date().toISOString()}\ntasks: ${graph.tasks.length}\ncompleted: ${[...states.values()].filter((s) => s.status === "done").length}\n---\n\n${sections.join("\n")}`;

	writeFileSync(outputFile, output);
	return { graphId, outputFile };
}

async function runDAG(
	states: Map<string, TaskState>,
	workDir: string,
	maxConcurrency: number,
): Promise<void> {
	const running = new Set<string>();

	function getReady(): string[] {
		const ready: string[] = [];
		for (const [id, state] of states) {
			if (state.status !== "pending") continue;
			const allDepsDone = state.node.dependsOn.every(
				(dep) => states.get(dep)?.status === "done",
			);
			// If any dep errored, mark this as error too
			const anyDepError = state.node.dependsOn.some(
				(dep) => states.get(dep)?.status === "error",
			);
			if (anyDepError) {
				state.status = "error";
				state.error = "Dependency failed";
				continue;
			}
			if (allDepsDone) ready.push(id);
		}
		return ready;
	}

	while (true) {
		// Check if all done
		const allFinished = [...states.values()].every(
			(s) => s.status === "done" || s.status === "error",
		);
		if (allFinished) break;

		// Get ready tasks
		const ready = getReady();

		// Nothing ready and nothing running = deadlock (shouldn't happen after validation)
		if (ready.length === 0 && running.size === 0) break;

		// Dispatch up to maxConcurrency
		const toDispatch = ready.slice(0, maxConcurrency - running.size);

		const promises = toDispatch.map(async (taskId) => {
			const state = states.get(taskId);
			if (!state) return;
			state.status = "running";
			running.add(taskId);

			try {
				const result = await executeTask(state, states, workDir);
				state.status = "done";
				state.result = result;
			} catch (err) {
				state.status = "error";
				state.error = (err as Error).message;
			} finally {
				running.delete(taskId);
			}
		});

		if (promises.length > 0) {
			// Wait for at least one to finish before checking again
			await Promise.race(promises);
			// But also let others finish if they're quick
			await Promise.allSettled(promises);
		} else {
			// Nothing to dispatch, wait for running tasks
			await Bun.sleep(1000);
		}
	}
}

async function executeTask(
	state: TaskState,
	allStates: Map<string, TaskState>,
	workDir: string,
): Promise<string> {
	const { node } = state;

	// Build context from dependencies
	let contextPrefix = "";
	if (node.dependsOn.length > 0) {
		const depContexts = node.dependsOn.map((depId) => {
			const depState = allStates.get(depId);
			const result = depState?.result ?? "(no result)";
			return `[Result from "${depId}"]:\n${result}\n`;
		});
		contextPrefix = `${depContexts.join("\n")}\n[Your task]:\n`;
	}

	const fullMessage = `${contextPrefix}${node.message}`;

	// Each graph task gets a unique session to allow parallel execution
	const taskSessionId = crypto.randomUUID().slice(0, 8);
	const resolved = MODEL_PRESETS[node.model];
	const command = [...AGENTS.claude.command, "--model", resolved.model];
	if (resolved.effort) command.push("--effort", resolved.effort);
	const config = {
		...AGENTS.claude,
		name: `claude_${node.model}_g_${taskSessionId}`,
		command,
	};

	try {
		const result = await sendClaudePrompt(
			config,
			workDir,
			fullMessage,
			node.allowFileEdits ?? false,
		);

		if (!result.success) {
			throw new Error(result.error || "Worker failed");
		}

		return result.response || "(empty response)";
	} finally {
		// Always clean up the unique session
		const sessionName = getSessionName(config.name);
		await killSession(sessionName);
	}
}
