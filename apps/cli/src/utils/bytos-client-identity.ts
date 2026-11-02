import { setBytosClientIdentity } from "@bytos/shared";
import { getCliBuildInfo } from "./common";

export function registerBytosClientIdentity(name: string): void {
	const { version } = getCliBuildInfo();
	setBytosClientIdentity({
		name,
		version,
		platform: "cli",
		platformVersion: version,
	});
}
