import { NodeHubClient } from "../../../../dist/hub/index.js";

const url = process.env.BYTOS_TEST_HUB_URL;
const authorization = process.env.BYTOS_TEST_HUB_AUTHORIZATION;
if (!url || !authorization) {
	throw new Error("Missing BYTOS_TEST_HUB_URL or BYTOS_TEST_HUB_AUTHORIZATION");
}

const client = new NodeHubClient({
	url,
	resolveConnectionHeaders: () => ({ Authorization: authorization }),
});

try {
	await client.connect();
	console.log(`connected under ${process.versions.bun ? "Bun" : "Node"}`);
} finally {
	client.close();
}
