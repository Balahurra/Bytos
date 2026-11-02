import { Empty, StringRequest } from "@shared/proto/bytos/common"
import * as vscode from "vscode"

const BYTOS_OUTPUT_CHANNEL = vscode.window.createOutputChannel("Bytos")

// Appends a log message to all Bytos output channels.
export async function debugLog(request: StringRequest): Promise<Empty> {
	BYTOS_OUTPUT_CHANNEL.appendLine(request.value)
	return Empty.create({})
}

// Register the Bytos output channel within the VSCode extension context.
export function registerBytosOutputChannel(context: vscode.ExtensionContext): vscode.OutputChannel {
	context.subscriptions.push(BYTOS_OUTPUT_CHANNEL)
	return BYTOS_OUTPUT_CHANNEL
}
