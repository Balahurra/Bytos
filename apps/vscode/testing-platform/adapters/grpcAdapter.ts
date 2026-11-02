import { AccountServiceClient } from "@bytos-grpc/account"
import { BrowserServiceClient } from "@bytos-grpc/browser"
import { CheckpointsServiceClient } from "@bytos-grpc/checkpoints"
import { CommandsServiceClient } from "@bytos-grpc/commands"
import { FileServiceClient } from "@bytos-grpc/file"
import { McpServiceClient } from "@bytos-grpc/mcp"
import { ModelsServiceClient } from "@bytos-grpc/models"
import { SlashServiceClient } from "@bytos-grpc/slash"
import { StateServiceClient } from "@bytos-grpc/state"
import { TaskServiceClient } from "@bytos-grpc/task"
import { UiServiceClient } from "@bytos-grpc/ui"
import { WebServiceClient } from "@bytos-grpc/web"
import { credentials } from "@grpc/grpc-js"
import { promisify } from "util"

const serviceRegistry = {
	"bytos.AccountService": AccountServiceClient,
	"bytos.BrowserService": BrowserServiceClient,
	"bytos.CheckpointsService": CheckpointsServiceClient,
	"bytos.CommandsService": CommandsServiceClient,
	"bytos.FileService": FileServiceClient,
	"bytos.McpService": McpServiceClient,
	"bytos.ModelsService": ModelsServiceClient,
	"bytos.SlashService": SlashServiceClient,
	"bytos.StateService": StateServiceClient,
	"bytos.TaskService": TaskServiceClient,
	"bytos.UiService": UiServiceClient,
	"bytos.WebService": WebServiceClient,
} as const

export type ServiceClients = {
	-readonly [K in keyof typeof serviceRegistry]: InstanceType<(typeof serviceRegistry)[K]>
}

export class GrpcAdapter {
	private clients: Partial<ServiceClients> = {}

	constructor(address: string) {
		for (const [name, Client] of Object.entries(serviceRegistry)) {
			this.clients[name as keyof ServiceClients] = new (Client as any)(address, credentials.createInsecure())
		}
	}

	async call(service: keyof ServiceClients, method: string, request: any): Promise<any> {
		const client = this.clients[service]
		if (!client) {
			throw new Error(`No gRPC client registered for service: ${String(service)}`)
		}

		const fn = (client as any)[method]
		if (typeof fn !== "function") {
			throw new Error(`Method ${method} not found on service ${String(service)}`)
		}

		try {
			const fnAsync = promisify(fn).bind(client)
			const response = await fnAsync(request.message)
			return response?.toObject ? response.toObject() : response
		} catch (error) {
			console.error(`[GrpcAdapter] ${service}.${method} failed:`, error)
			throw error
		}
	}

	close(): void {
		for (const client of Object.values(this.clients)) {
			if (client && typeof (client as any).close === "function") {
				;(client as any).close()
			}
		}
	}
}
