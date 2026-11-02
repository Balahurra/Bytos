import type { BasicLogger } from "../logging/logger";
import type { ITelemetryService } from "../services/telemetry";
import type { WorkspaceInfo } from "../session/workspace";
import type {
	AgentExtensionAutomationContext,
	AgentExtensionSessionContext,
} from "./contribution-registry";

/**
 * The IDE or client surface the user is running Bytos from.
 */
export type ClientName =
	| "bytos-vscode"
	| "bytos-jetbrains"
	| "bytos-cli"
	| "bytos-sdk"
	| "bytos-kanban"
	| "bytos-acp"
	| "bytos-platform"
	| (string & {});

/**
 * Identity of the calling client and host surface.
 */
export interface ClientContext {
	/** Client type emitted to Bytos request headers, e.g. "VSCode Extension", "bytos-cli", "bytos-sdk" */
	name: ClientName;
	/** Bytos client/extension semver string, e.g. "3.12.0" */
	version?: string;
	/** Host platform display name, e.g. "Visual Studio Code", "Cursor", "cli" */
	platform?: string;
	/** Host platform version, e.g. vscode.version or the CLI version */
	platformVersion?: string;
	/** Whether the host workspace currently has multiple roots. */
	isMultiRoot?: boolean;
}

/**
 * Identity of the authenticated user.
 */
export interface UserContext {
	/** PostHog / analytics distinct ID (an account or anonymous machine ID). */
	distinctId?: string;
	/** Authenticated Bytos account ID, or null when explicitly signed out. */
	accountId?: string | null;
	email?: string;
	organizationId?: string;
}

/**
 * Everything needed to describe the workspace and build the system prompt.
 *
 * Extends WorkspaceInfo (rootPath + git fields) with the additional fields
 * required by buildBytosSystemPrompt, so callers can spread a WorkspaceInfo
 * and add only what they know.
 */
export interface WorkspaceContext extends WorkspaceInfo {
	/**
	 * Current working directory. May differ from rootPath in multi-root
	 * workspaces or when the user cd'd inside the workspace.
	 */
	cwd?: string;
	/** Human-readable workspace name shown in the system prompt */
	workspaceName?: string;
	/**
	 * Pre-serialized workspace metadata block that replaces {{BYTOS_METADATA}}
	 * in the system prompt template.
	 */
	metadata?: string;
	/** Agent mode: "act" | "plan" | "yolo" */
	mode?: string;
	/** Additional rules/instructions injected into the system prompt */
	rules?: string;
	/** IDE display name, e.g. "VS Code", "JetBrains", "Terminal Shell" */
	ide?: string;
	/** Node process.platform string, e.g. "darwin", "win32", "linux" */
	platform?: string;
}

/**
 * Ambient runtime context carried alongside ProviderConfig.
 *
 * Captures who is calling (user + client), where they are (workspace),
 * and which services to use for logging and telemetry. None of these
 * belong in the LLM provider credential config.
 */
export interface ExtensionContext {
	user?: UserContext;
	client?: ClientContext;
	workspace?: WorkspaceContext;
	/** Core session metadata forwarded into plugin setup context. */
	session?: AgentExtensionSessionContext;
	/**
	 * Host-provided automation ingress for plugins. Present when the session is
	 * started through a BytosCore instance with automation enabled.
	 */
	automation?: AgentExtensionAutomationContext;
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
}
