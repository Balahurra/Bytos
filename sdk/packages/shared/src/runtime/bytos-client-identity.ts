export interface BytosClientIdentity {
	name?: string;
	version?: string;
	platform?: string;
	platformVersion?: string;
}

interface BytosClientIdentityGlobal {
	__bytosClientIdentity?: BytosClientIdentity;
}

function identityHolder(): BytosClientIdentityGlobal {
	return globalThis as BytosClientIdentityGlobal;
}

export function setBytosClientIdentity(
	identity: BytosClientIdentity | undefined,
): void {
	identityHolder().__bytosClientIdentity = identity;
}

export function getBytosClientIdentity(): BytosClientIdentity | undefined {
	return identityHolder().__bytosClientIdentity;
}
