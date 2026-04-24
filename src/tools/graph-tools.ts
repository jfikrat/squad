import {
	type TaskGraph,
	type TaskNode,
	executeGraph,
} from "../core/graph-executor";

export const taskGraphTool = {
	name: "task_graph",
	description:
		"Submit a multi-step research plan as a DAG (directed acyclic graph). Squad executes tasks respecting dependencies: independent tasks run in parallel, dependent tasks wait for their inputs. Results from parent tasks are passed as context to children. Final aggregated output is written to a file. Always non-blocking — returns immediately with graphId and outputFile.",
	inputSchema: {
		type: "object",
		properties: {
			name: {
				type: "string",
				description: "Human-readable name for this task graph",
			},
			workDir: {
				type: "string",
				description: "Absolute working directory for all workers",
			},
			outputFile: {
				type: "string",
				description:
					"Path for the final aggregated result. Relative paths resolve against workDir. If omitted, auto-generated at .squad/results/graph-{id}.md",
			},
			maxConcurrency: {
				type: "number",
				description:
					"Maximum parallel workers (default: 3). Each task gets its own Claude session.",
			},
			tasks: {
				type: "array",
				description: "List of tasks forming the DAG",
				items: {
					type: "object",
					properties: {
						id: {
							type: "string",
							description:
								"Unique task identifier (e.g. 'fetch-data', 'synthesize')",
						},
						message: {
							type: "string",
							description:
								"The prompt for this task. Dependencies' results will be prepended automatically.",
						},
						model: {
							type: "string",
							enum: ["sonnet", "opus"],
							description: "Model to use: sonnet (fast) or opus (deep)",
						},
						dependsOn: {
							type: "array",
							items: { type: "string" },
							description:
								"Task IDs that must complete before this task starts. Their results become context.",
						},
						allowFileEdits: {
							type: "boolean",
							description:
								"Allow this worker to create/modify files (default: false)",
						},
					},
					required: ["id", "message", "model", "dependsOn"],
				},
			},
		},
		required: ["name", "workDir", "tasks"],
	},
};

export async function handleTaskGraph(args: {
	name: string;
	workDir: string;
	outputFile?: string;
	maxConcurrency?: number;
	tasks: TaskNode[];
}): Promise<{ content: Array<{ type: string; text: string }> }> {
	const graph: TaskGraph = {
		name: args.name,
		workDir: args.workDir,
		outputFile: args.outputFile,
		tasks: args.tasks,
		maxConcurrency: args.maxConcurrency,
	};

	// Fire-and-forget: start execution in background, return immediately
	const graphId = crypto.randomUUID().slice(0, 8);

	// We need to know the outputFile before dispatching
	const outputFile = args.outputFile
		? args.outputFile.startsWith("/")
			? args.outputFile
			: `${args.workDir}/${args.outputFile}`
		: `${args.workDir}/.squad/results/graph-${graphId}.md`;

	// Override the graph's output with our pre-computed path
	graph.outputFile = outputFile;

	void executeGraph(graph).catch((err) => {
		console.error(`Graph "${args.name}" failed:`, err);
	});

	const taskSummary = args.tasks
		.map((t) => {
			const deps = t.dependsOn.length > 0 ? ` (after: ${t.dependsOn.join(", ")})` : " (no deps)";
			return `  - ${t.id} [${t.model}]${deps}`;
		})
		.join("\n");

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					{
						status: "dispatched",
						graphId,
						name: args.name,
						outputFile,
						tasks: args.tasks.length,
						maxConcurrency: args.maxConcurrency ?? 3,
						plan: taskSummary,
					},
					null,
					2,
				),
			},
		],
	};
}
