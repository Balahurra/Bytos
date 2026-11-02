import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"
import { OpenBytosSidebarPanelRequest, OpenBytosSidebarPanelResponse } from "@/shared/proto/index.host"

export async function openBytosSidebarPanel(_: OpenBytosSidebarPanelRequest): Promise<OpenBytosSidebarPanelResponse> {
	await vscode.commands.executeCommand(`${ExtensionRegistryInfo.views.Sidebar}.focus`)
	return {}
}
