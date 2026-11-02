import type { AgentPlugin } from "@bytos/sdk";
import { BYTOS_DEFAULT_MODEL_ID } from "@bytos/shared/browser";

export default {
	name: "packaged-backend-smoke",
	manifest: { capabilities: ["commands"] },
	setup(api) {
		if (typeof BYTOS_DEFAULT_MODEL_ID !== "string")
			throw new Error("Missing SDK browser exports");
		api.registerCommand({ name: "packaged-ping", handler: () => "pong" });
	},
} satisfies AgentPlugin;
