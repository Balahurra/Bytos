import { BytosAsk as AppBytosAsk, BytosMessage as AppBytosMessage, BytosSay as AppBytosSay } from "@shared/ExtensionMessage"
import { BytosAsk, BytosMessageType, BytosSay, BytosMessage as ProtoBytosMessage } from "@shared/proto/bytos/ui"

// Helper function to convert BytosAsk string to enum
function convertBytosAskToProtoEnum(ask: AppBytosAsk | undefined): BytosAsk | undefined {
	if (!ask) {
		return undefined
	}

	const mapping: Record<AppBytosAsk, BytosAsk> = {
		followup: BytosAsk.FOLLOWUP,
		plan_mode_respond: BytosAsk.PLAN_MODE_RESPOND,
		act_mode_respond: BytosAsk.ACT_MODE_RESPOND,
		command: BytosAsk.COMMAND,
		command_output: BytosAsk.COMMAND_OUTPUT,
		completion_result: BytosAsk.COMPLETION_RESULT,
		tool: BytosAsk.TOOL,
		api_req_failed: BytosAsk.API_REQ_FAILED,
		resume_task: BytosAsk.RESUME_TASK,
		resume_completed_task: BytosAsk.RESUME_COMPLETED_TASK,
		mistake_limit_reached: BytosAsk.MISTAKE_LIMIT_REACHED,
		browser_action_launch: BytosAsk.BROWSER_ACTION_LAUNCH,
		use_mcp_server: BytosAsk.USE_MCP_SERVER,
		new_task: BytosAsk.NEW_TASK,
		condense: BytosAsk.CONDENSE,
		summarize_task: BytosAsk.SUMMARIZE_TASK,
		report_bug: BytosAsk.REPORT_BUG,
		use_subagents: BytosAsk.USE_SUBAGENTS,
	}

	const result = mapping[ask]
	if (result === undefined) {
	}
	return result
}

// Helper function to convert BytosAsk enum to string
function convertProtoEnumToBytosAsk(ask: BytosAsk): AppBytosAsk | undefined {
	if (ask === BytosAsk.UNRECOGNIZED) {
		return undefined
	}

	const mapping: Record<Exclude<BytosAsk, BytosAsk.UNRECOGNIZED>, AppBytosAsk> = {
		[BytosAsk.FOLLOWUP]: "followup",
		[BytosAsk.PLAN_MODE_RESPOND]: "plan_mode_respond",
		[BytosAsk.ACT_MODE_RESPOND]: "act_mode_respond",
		[BytosAsk.COMMAND]: "command",
		[BytosAsk.COMMAND_OUTPUT]: "command_output",
		[BytosAsk.COMPLETION_RESULT]: "completion_result",
		[BytosAsk.TOOL]: "tool",
		[BytosAsk.API_REQ_FAILED]: "api_req_failed",
		[BytosAsk.RESUME_TASK]: "resume_task",
		[BytosAsk.RESUME_COMPLETED_TASK]: "resume_completed_task",
		[BytosAsk.MISTAKE_LIMIT_REACHED]: "mistake_limit_reached",
		[BytosAsk.BROWSER_ACTION_LAUNCH]: "browser_action_launch",
		[BytosAsk.USE_MCP_SERVER]: "use_mcp_server",
		[BytosAsk.NEW_TASK]: "new_task",
		[BytosAsk.CONDENSE]: "condense",
		[BytosAsk.SUMMARIZE_TASK]: "summarize_task",
		[BytosAsk.REPORT_BUG]: "report_bug",
		[BytosAsk.USE_SUBAGENTS]: "use_subagents",
	}

	return mapping[ask]
}

// Helper function to convert BytosSay string to enum
function convertBytosSayToProtoEnum(say: AppBytosSay | undefined): BytosSay | undefined {
	if (!say) {
		return undefined
	}

	const mapping: Record<AppBytosSay, BytosSay> = {
		task: BytosSay.TASK,
		error: BytosSay.ERROR,
		api_req_started: BytosSay.API_REQ_STARTED,
		api_req_finished: BytosSay.API_REQ_FINISHED,
		text: BytosSay.TEXT,
		reasoning: BytosSay.REASONING,
		completion_result: BytosSay.COMPLETION_RESULT_SAY,
		plan_completion_result: BytosSay.PLAN_COMPLETION_RESULT,
		user_feedback: BytosSay.USER_FEEDBACK,
		user_feedback_diff: BytosSay.USER_FEEDBACK_DIFF,
		command: BytosSay.COMMAND_SAY,
		command_output: BytosSay.COMMAND_OUTPUT_SAY,
		tool: BytosSay.TOOL_SAY,
		shell_integration_warning: BytosSay.SHELL_INTEGRATION_WARNING,
		shell_integration_warning_with_suggestion: BytosSay.SHELL_INTEGRATION_WARNING,
		browser_action_launch: BytosSay.BROWSER_ACTION_LAUNCH_SAY,
		browser_action: BytosSay.BROWSER_ACTION,
		browser_action_result: BytosSay.BROWSER_ACTION_RESULT,
		mcp_server_request_started: BytosSay.MCP_SERVER_REQUEST_STARTED,
		mcp_server_response: BytosSay.MCP_SERVER_RESPONSE,
		mcp_notification: BytosSay.MCP_NOTIFICATION,
		use_mcp_server: BytosSay.USE_MCP_SERVER_SAY,
		diff_error: BytosSay.DIFF_ERROR,
		deleted_api_reqs: BytosSay.DELETED_API_REQS,
		bytosignore_error: BytosSay.BYTOSIGNORE_ERROR,
		command_permission_denied: BytosSay.COMMAND_PERMISSION_DENIED,
		checkpoint_created: BytosSay.CHECKPOINT_CREATED,
		load_mcp_documentation: BytosSay.LOAD_MCP_DOCUMENTATION,
		info: BytosSay.INFO,
		hook_status: BytosSay.HOOK_STATUS,
		hook_output_stream: BytosSay.HOOK_OUTPUT_STREAM,
		conditional_rules_applied: BytosSay.CONDITIONAL_RULES_APPLIED,
		subagent: BytosSay.SUBAGENT_STATUS,
		use_subagents: BytosSay.USE_SUBAGENTS_SAY,
		subagent_usage: BytosSay.SUBAGENT_USAGE,
		compaction: BytosSay.COMPACTION,
	}

	const result = mapping[say]

	return result
}

// Helper function to convert BytosSay enum to string
function convertProtoEnumToBytosSay(say: BytosSay): AppBytosSay | undefined {
	if (say === BytosSay.UNRECOGNIZED) {
		return undefined
	}

	const mapping: Record<Exclude<BytosSay, BytosSay.UNRECOGNIZED>, AppBytosSay> = {
		[BytosSay.TASK]: "task",
		[BytosSay.ERROR]: "error",
		[BytosSay.API_REQ_STARTED]: "api_req_started",
		[BytosSay.API_REQ_FINISHED]: "api_req_finished",
		[BytosSay.TEXT]: "text",
		[BytosSay.REASONING]: "reasoning",
		[BytosSay.COMPLETION_RESULT_SAY]: "completion_result",
		[BytosSay.PLAN_COMPLETION_RESULT]: "plan_completion_result",
		[BytosSay.USER_FEEDBACK]: "user_feedback",
		[BytosSay.USER_FEEDBACK_DIFF]: "user_feedback_diff",
		[BytosSay.COMMAND_SAY]: "command",
		[BytosSay.COMMAND_OUTPUT_SAY]: "command_output",
		[BytosSay.TOOL_SAY]: "tool",
		[BytosSay.SHELL_INTEGRATION_WARNING]: "shell_integration_warning",
		[BytosSay.BROWSER_ACTION_LAUNCH_SAY]: "browser_action_launch",
		[BytosSay.BROWSER_ACTION]: "browser_action",
		[BytosSay.BROWSER_ACTION_RESULT]: "browser_action_result",
		[BytosSay.MCP_SERVER_REQUEST_STARTED]: "mcp_server_request_started",
		[BytosSay.MCP_SERVER_RESPONSE]: "mcp_server_response",
		[BytosSay.MCP_NOTIFICATION]: "mcp_notification",
		[BytosSay.USE_MCP_SERVER_SAY]: "use_mcp_server",
		[BytosSay.DIFF_ERROR]: "diff_error",
		[BytosSay.DELETED_API_REQS]: "deleted_api_reqs",
		[BytosSay.BYTOSIGNORE_ERROR]: "bytosignore_error",
		[BytosSay.COMMAND_PERMISSION_DENIED]: "command_permission_denied",
		[BytosSay.CHECKPOINT_CREATED]: "checkpoint_created",
		[BytosSay.LOAD_MCP_DOCUMENTATION]: "load_mcp_documentation",
		[BytosSay.INFO]: "info",
		[BytosSay.HOOK_STATUS]: "hook_status",
		[BytosSay.HOOK_OUTPUT_STREAM]: "hook_output_stream",
		[BytosSay.CONDITIONAL_RULES_APPLIED]: "conditional_rules_applied",
		[BytosSay.SUBAGENT_STATUS]: "subagent",
		[BytosSay.USE_SUBAGENTS_SAY]: "use_subagents",
		[BytosSay.SUBAGENT_USAGE]: "subagent_usage",
		[BytosSay.COMPACTION]: "compaction",
	}

	return mapping[say]
}

/**
 * Convert application BytosMessage to proto BytosMessage
 */
export function convertBytosMessageToProto(message: AppBytosMessage): ProtoBytosMessage {
	// For sending messages, we need to provide values for required proto fields
	const askEnum = message.ask ? convertBytosAskToProtoEnum(message.ask) : undefined
	const sayEnum = message.say ? convertBytosSayToProtoEnum(message.say) : undefined

	// Determine appropriate enum values based on message type
	let finalAskEnum: BytosAsk = BytosAsk.FOLLOWUP // Proto default
	let finalSayEnum: BytosSay = BytosSay.TEXT // Proto default

	if (message.type === "ask") {
		finalAskEnum = askEnum ?? BytosAsk.FOLLOWUP // Use FOLLOWUP as default for ask messages
	} else if (message.type === "say") {
		finalSayEnum = sayEnum ?? BytosSay.TEXT // Use TEXT as default for say messages
	}

	const protoMessage: ProtoBytosMessage = {
		ts: message.ts,
		type: message.type === "ask" ? BytosMessageType.ASK : BytosMessageType.SAY,
		ask: finalAskEnum,
		say: finalSayEnum,
		text: message.text ?? "",
		reasoning: message.reasoning ?? "",
		images: message.images ?? [],
		files: message.files ?? [],
		partial: message.partial ?? false,
		// Convergent-replica fields (default 0 = unstamped, e.g. classic/legacy path).
		seq: message.seq ?? 0,
		epoch: message.epoch ?? 0,
		lastCheckpointHash: message.lastCheckpointHash ?? "",
		isCheckpointCheckedOut: message.isCheckpointCheckedOut ?? false,
		isOperationOutsideWorkspace: message.isOperationOutsideWorkspace ?? false,
		conversationHistoryIndex: message.conversationHistoryIndex ?? 0,
		conversationHistoryDeletedRange: message.conversationHistoryDeletedRange
			? {
					startIndex: message.conversationHistoryDeletedRange[0],
					endIndex: message.conversationHistoryDeletedRange[1],
				}
			: undefined,
		// Additional optional fields for specific ask/say types
		sayTool: undefined,
		sayBrowserAction: undefined,
		browserActionResult: undefined,
		askUseMcpServer: undefined,
		planModeResponse: undefined,
		askQuestion: undefined,
		askNewTask: undefined,
		apiReqInfo: undefined,
		modelInfo: message.modelInfo ?? undefined,
	}

	return protoMessage
}

/**
 * Convert proto BytosMessage to application BytosMessage
 */
export function convertProtoToBytosMessage(protoMessage: ProtoBytosMessage): AppBytosMessage {
	const message: AppBytosMessage = {
		ts: protoMessage.ts,
		type: protoMessage.type === BytosMessageType.ASK ? "ask" : "say",
	}

	// Convert ask enum to string
	if (protoMessage.type === BytosMessageType.ASK) {
		const ask = convertProtoEnumToBytosAsk(protoMessage.ask)
		if (ask !== undefined) {
			message.ask = ask
		}
	}

	// Convert say enum to string
	if (protoMessage.type === BytosMessageType.SAY) {
		const say = convertProtoEnumToBytosSay(protoMessage.say)
		if (say !== undefined) {
			message.say = say
		}
	}

	// Convert other fields - preserve empty strings as they may be intentional
	if (protoMessage.text !== "") {
		message.text = protoMessage.text
	}
	if (protoMessage.reasoning !== "") {
		message.reasoning = protoMessage.reasoning
	}
	if (protoMessage.images.length > 0) {
		message.images = protoMessage.images
	}
	if (protoMessage.files.length > 0) {
		message.files = protoMessage.files
	}
	if (protoMessage.partial) {
		message.partial = protoMessage.partial
	}
	if (protoMessage.lastCheckpointHash !== "") {
		message.lastCheckpointHash = protoMessage.lastCheckpointHash
	}
	if (protoMessage.isCheckpointCheckedOut) {
		message.isCheckpointCheckedOut = protoMessage.isCheckpointCheckedOut
	}
	if (protoMessage.isOperationOutsideWorkspace) {
		message.isOperationOutsideWorkspace = protoMessage.isOperationOutsideWorkspace
	}
	if (protoMessage.conversationHistoryIndex !== 0) {
		message.conversationHistoryIndex = protoMessage.conversationHistoryIndex
	}

	// Convert conversationHistoryDeletedRange from object to tuple
	if (protoMessage.conversationHistoryDeletedRange) {
		message.conversationHistoryDeletedRange = [
			protoMessage.conversationHistoryDeletedRange.startIndex,
			protoMessage.conversationHistoryDeletedRange.endIndex,
		]
	}

	// Convergent-replica fields. 0 means unstamped (classic/legacy path) — leave undefined so
	// the webview reducer treats such messages as always-applicable rather than epoch 0.
	if (protoMessage.seq && protoMessage.seq !== 0) {
		message.seq = protoMessage.seq
	}
	if (protoMessage.epoch && protoMessage.epoch !== 0) {
		message.epoch = protoMessage.epoch
	}

	return message
}
