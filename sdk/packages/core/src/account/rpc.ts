import type {
	BytosAccountActionRequest,
	ProviderActionRequest,
} from "@bytos/shared";
import type {
	BytosAccountBalance,
	BytosAccountOrganization,
	BytosAccountOrganizationBalance,
	BytosAccountOrganizationUsageTransaction,
	BytosAccountPaymentTransaction,
	BytosAccountUsageTransaction,
	BytosAccountUser,
	FeaturebaseTokenResponse,
} from "./types";

export interface BytosAccountOperations {
	fetchMe(): Promise<BytosAccountUser>;
	fetchBalance(userId?: string): Promise<BytosAccountBalance>;
	fetchUsageTransactions(
		userId?: string,
	): Promise<BytosAccountUsageTransaction[]>;
	fetchPaymentTransactions(
		userId?: string,
	): Promise<BytosAccountPaymentTransaction[]>;
	fetchUserOrganizations(): Promise<BytosAccountOrganization[]>;
	fetchOrganizationBalance(
		organizationId: string,
	): Promise<BytosAccountOrganizationBalance>;
	fetchOrganizationUsageTransactions(input: {
		organizationId: string;
		memberId?: string;
	}): Promise<BytosAccountOrganizationUsageTransaction[]>;
	switchAccount(organizationId?: string | null): Promise<void>;
	fetchFeaturebaseToken?(): Promise<FeaturebaseTokenResponse | undefined>;
}

export function isBytosAccountActionRequest(
	request: ProviderActionRequest,
): request is BytosAccountActionRequest {
	return request.action === "bytosAccount";
}

export async function executeBytosAccountAction(
	request: BytosAccountActionRequest,
	service: BytosAccountOperations,
): Promise<unknown> {
	switch (request.operation) {
		case "fetchMe":
			return service.fetchMe();
		case "fetchBalance":
			return service.fetchBalance(request.userId);
		case "fetchUsageTransactions":
			return service.fetchUsageTransactions(request.userId);
		case "fetchPaymentTransactions":
			return service.fetchPaymentTransactions(request.userId);
		case "fetchUserOrganizations":
			return service.fetchUserOrganizations();
		case "fetchOrganizationBalance":
			return service.fetchOrganizationBalance(request.organizationId);
		case "fetchOrganizationUsageTransactions":
			return service.fetchOrganizationUsageTransactions({
				organizationId: request.organizationId,
				memberId: request.memberId,
			});
		case "switchAccount":
			await service.switchAccount(request.organizationId);
			return { updated: true };
		case "fetchFeaturebaseToken":
			return service.fetchFeaturebaseToken?.();
		default: {
			const exhaustive: never = request;
			throw new Error(
				`Unsupported Bytos account operation: ${String(exhaustive)}`,
			);
		}
	}
}

export interface ProviderActionExecutor {
	runProviderAction(request: ProviderActionRequest): Promise<{
		result: unknown;
	}>;
}

export class RpcBytosAccountService implements BytosAccountOperations {
	private readonly executor: ProviderActionExecutor;

	constructor(executor: ProviderActionExecutor) {
		this.executor = executor;
	}

	public async fetchMe(): Promise<BytosAccountUser> {
		return this.request<BytosAccountUser>({
			action: "bytosAccount",
			operation: "fetchMe",
		});
	}

	public async fetchBalance(userId?: string): Promise<BytosAccountBalance> {
		return this.request<BytosAccountBalance>({
			action: "bytosAccount",
			operation: "fetchBalance",
			...(userId?.trim() ? { userId: userId.trim() } : {}),
		});
	}

	public async fetchUsageTransactions(
		userId?: string,
	): Promise<BytosAccountUsageTransaction[]> {
		return this.request<BytosAccountUsageTransaction[]>({
			action: "bytosAccount",
			operation: "fetchUsageTransactions",
			...(userId?.trim() ? { userId: userId.trim() } : {}),
		});
	}

	public async fetchPaymentTransactions(
		userId?: string,
	): Promise<BytosAccountPaymentTransaction[]> {
		return this.request<BytosAccountPaymentTransaction[]>({
			action: "bytosAccount",
			operation: "fetchPaymentTransactions",
			...(userId?.trim() ? { userId: userId.trim() } : {}),
		});
	}

	public async fetchUserOrganizations(): Promise<BytosAccountOrganization[]> {
		return this.request<BytosAccountOrganization[]>({
			action: "bytosAccount",
			operation: "fetchUserOrganizations",
		});
	}

	public async fetchOrganizationBalance(
		organizationId: string,
	): Promise<BytosAccountOrganizationBalance> {
		const orgId = organizationId.trim();
		if (!orgId) {
			throw new Error("organizationId is required");
		}
		return this.request<BytosAccountOrganizationBalance>({
			action: "bytosAccount",
			operation: "fetchOrganizationBalance",
			organizationId: orgId,
		});
	}

	public async fetchOrganizationUsageTransactions(input: {
		organizationId: string;
		memberId?: string;
	}): Promise<BytosAccountOrganizationUsageTransaction[]> {
		const orgId = input.organizationId.trim();
		if (!orgId) {
			throw new Error("organizationId is required");
		}
		return this.request<BytosAccountOrganizationUsageTransaction[]>({
			action: "bytosAccount",
			operation: "fetchOrganizationUsageTransactions",
			organizationId: orgId,
			...(input.memberId?.trim() ? { memberId: input.memberId.trim() } : {}),
		});
	}

	public async switchAccount(organizationId?: string | null): Promise<void> {
		await this.request<{ updated: boolean }>({
			action: "bytosAccount",
			operation: "switchAccount",
			organizationId: organizationId?.trim() || null,
		});
	}

	public async fetchFeaturebaseToken(): Promise<
		FeaturebaseTokenResponse | undefined
	> {
		return this.request<FeaturebaseTokenResponse | undefined>({
			action: "bytosAccount",
			operation: "fetchFeaturebaseToken",
		});
	}

	private async request<T>(request: BytosAccountActionRequest): Promise<T> {
		const response = await this.executor.runProviderAction(request);
		return response.result as T;
	}
}
