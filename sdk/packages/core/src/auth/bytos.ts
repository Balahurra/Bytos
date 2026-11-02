import { setTimeout as sleep } from "node:timers/promises";
import {
	decodeJwtPayload,
	getBytosEnvironmentConfig,
	type ITelemetryService,
} from "@bytos/shared";
import { hashSecret, sdkDebug } from "../logging/early-logger";
import {
	captureAuthFailed,
	captureAuthLoggedOut,
	captureAuthRefreshSoftFailure,
	captureAuthStarted,
	captureAuthSucceeded,
	identifyAccount,
} from "../services/telemetry/core-events";
import { startLocalOAuthServer } from "./server";
import type { OAuthCredentials, OAuthLoginCallbacks } from "./types";
import {
	isCredentialLikelyExpired,
	parseAuthorizationInput,
	parseOAuthError,
	resolveAuthorizationCodeInput,
	resolveUrl,
} from "./utils";

const DEFAULT_AUTH_ENDPOINTS = {
	authorize: "/api/v1/auth/authorize",
	token: "/api/v1/auth/token",
	register: "/api/v1/auth/register",
	refresh: "/api/v1/auth/refresh",
} as const;

const DEFAULT_WORKOS_ENDPOINTS = {
	deviceAuthorization: "/user_management/authorize/device",
	authenticate: "/user_management/authenticate",
} as const;

const DEFAULT_WORKOS_API_BASE_URL = "https://api.workos.com";
const DEFAULT_CALLBACK_PATH = "/auth";
const DEFAULT_CALLBACK_PORTS = Array.from(
	{ length: 11 },
	(_, index) => 48801 + index,
);
const DEFAULT_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const DEFAULT_RETRYABLE_TOKEN_GRACE_MS = 30 * 1000;
const DEFAULT_HTTP_TIMEOUT_MS = 30 * 1000;
const DEFAULT_DEVICE_AUTH_EXPIRES_IN_SECONDS = 300;
const DEFAULT_DEVICE_AUTH_INTERVAL_SECONDS = 5;

export type BytosTokenResolution = {
	forceRefresh?: boolean;
	refreshBufferMs?: number;
	retryableTokenGraceMs?: number;
};

interface BytosAuthApiUser {
	subject: string | null;
	email: string;
	name: string;
	bytosUserId: string | null;
	accounts: string[] | null;
}

interface BytosAuthResponseData {
	accessToken: string;
	refreshToken?: string;
	tokenType: string;
	expiresAt: string;
	userInfo: BytosAuthApiUser;
}

type BytosTokenResponse = {
	success: boolean;
	data: BytosAuthResponseData;
};

type HeaderMap = Record<string, string>;
type HeaderInput = HeaderMap | (() => Promise<HeaderMap> | HeaderMap);

type AuthTokenTelemetryClaims = {
	sessionId?: string;
};

type AuthCredentialTelemetryProperties = {
	sessionDurationMs?: number;
};

type AuthTelemetryDetails = AuthTokenTelemetryClaims &
	AuthCredentialTelemetryProperties;

export interface BytosOAuthProviderOptions {
	apiBaseUrl: string;
	headers?: HeaderInput;
	requestTimeoutMs?: number;
	telemetry?: ITelemetryService;
	useWorkOSDeviceAuth?: boolean;
	callbackPath?: string;
	callbackPorts?: number[];
	/**
	 * Optional identity provider name for token exchange.
	 */
	provider?: string;
}

export interface BytosOAuthCredentials extends OAuthCredentials {
	metadata?: {
		provider?: string;
		tokenType?: string;
		userInfo?: BytosAuthApiUser;
		[key: string]: unknown;
	};
}

class BytosOAuthTokenError extends Error {
	public readonly status?: number;
	public readonly errorCode?: string;
	public readonly requestId?: string;

	constructor(
		message: string,
		opts?: { status?: number; errorCode?: string; requestId?: string },
	) {
		super(message);
		this.name = "BytosOAuthTokenError";
		this.status = opts?.status;
		this.errorCode = opts?.errorCode;
		this.requestId = opts?.requestId;
	}

	public isLikelyInvalidGrant(): boolean {
		if (
			this.errorCode &&
			/invalid_grant|invalid_token|unauthorized/i.test(this.errorCode)
		) {
			return true;
		}
		if (this.status === 400 || this.status === 401 || this.status === 403) {
			return /invalid|expired|revoked|unauthorized/i.test(this.message);
		}
		return false;
	}
}

function toEpochMs(isoDateTime: string): number {
	const epoch = Date.parse(isoDateTime);
	if (Number.isNaN(epoch)) {
		throw new Error(`Invalid expiresAt value: ${isoDateTime}`);
	}
	return epoch;
}

function toBytosCredentials(
	responseData: BytosAuthResponseData,
	provider: string | undefined,
	fallback: Partial<BytosOAuthCredentials> = {},
): BytosOAuthCredentials {
	const accountId = responseData.userInfo.bytosUserId ?? fallback.accountId;
	const refreshToken = responseData.refreshToken ?? fallback.refresh;
	if (!refreshToken) {
		throw new Error("Token response did not include a refresh token");
	}
	const metadata: Record<string, unknown> = {
		...(fallback.metadata ?? {}),
		provider,
		tokenType: responseData.tokenType,
		userInfo: responseData.userInfo,
	};
	delete metadata.startedAt;

	return {
		access: responseData.accessToken,
		refresh: refreshToken,
		expires: toEpochMs(responseData.expiresAt),
		accountId: accountId ?? undefined,
		email: responseData.userInfo.email || fallback.email,
		metadata,
	};
}

async function resolveHeaders(input?: HeaderInput): Promise<HeaderMap> {
	if (!input) {
		return {};
	}
	return typeof input === "function" ? await input() : input;
}

function toSeconds(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	return Math.floor(value);
}

function asNonEmptyString(value: unknown): string | undefined {
	return (typeof value === "string" && value.trim()) || undefined;
}

function getAuthTokenTelemetryClaims(token: string): AuthTokenTelemetryClaims {
	const payload = decodeJwtPayload(token);
	if (!payload) {
		return {};
	}

	return {
		sessionId: asNonEmptyString(payload.sid),
	};
}

function getAuthCredentialTelemetryProperties(
	credentials: BytosOAuthCredentials,
): AuthCredentialTelemetryProperties {
	const authProperties: AuthCredentialTelemetryProperties = {};

	const sessionStartedAtMs = credentials.metadata?.sessionStartedAtMs;

	if (
		typeof sessionStartedAtMs === "number" &&
		Number.isFinite(sessionStartedAtMs) &&
		sessionStartedAtMs > 0
	) {
		authProperties.sessionDurationMs = Date.now() - sessionStartedAtMs;
	}

	return authProperties;
}

function getAuthTelemetryDetails(
	credentials: BytosOAuthCredentials,
): AuthTelemetryDetails {
	return {
		...getAuthTokenTelemetryClaims(credentials.access),
		...getAuthCredentialTelemetryProperties(credentials),
	};
}

type WorkOSDeviceAuthorizationResponse = {
	device_code?: string;
	user_code?: string;
	verification_uri?: string;
	verification_uri_complete?: string;
	expires_in?: number;
	interval?: number;
	error?: string;
	error_description?: string;
};

type WorkOSTokenResponse = {
	access_token?: string;
	refresh_token?: string;
	token_type?: string;
	expires_in?: number;
	error?: string;
	error_description?: string;
};

type WorkOSTokenSuccess = {
	accessToken: string;
	refreshToken: string;
	tokenType: string;
};

function requireBytosTokenResponse(
	payload: BytosTokenResponse,
	message: string,
): BytosAuthResponseData {
	if (!payload.success || !payload.data?.accessToken) {
		throw new Error(message);
	}
	return payload.data;
}

async function requestWorkOSDeviceAuthorization(
	clientId: string,
	options?: { requestTimeoutMs?: number; signal?: AbortSignal },
): Promise<{
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete?: string;
	expiresInSeconds: number;
	pollIntervalSeconds: number;
}> {
	const response = await fetch(
		resolveUrl(
			DEFAULT_WORKOS_API_BASE_URL,
			DEFAULT_WORKOS_ENDPOINTS.deviceAuthorization,
		),
		{
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({ client_id: clientId }),
			signal: AbortSignal.any([
				AbortSignal.timeout(
					options?.requestTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
				),
				...(options?.signal ? [options.signal] : []),
			]),
		},
	);

	const json = (await response
		.json()
		.catch(() => ({}))) as WorkOSDeviceAuthorizationResponse;
	if (!response.ok) {
		throw new BytosOAuthTokenError(
			`Device authorization failed: ${response.status}${json.error_description ? ` - ${json.error_description}` : ""}`,
			{
				status: response.status,
				errorCode: json.error,
				requestId: response.headers.get("x-request-id") ?? undefined,
			},
		);
	}
	if (!json.device_code || !json.user_code || !json.verification_uri) {
		throw new Error("Invalid WorkOS device authorization response");
	}

	return {
		deviceCode: json.device_code,
		userCode: json.user_code,
		verificationUri: json.verification_uri,
		verificationUriComplete: json.verification_uri_complete,
		expiresInSeconds: toSeconds(
			json.expires_in,
			DEFAULT_DEVICE_AUTH_EXPIRES_IN_SECONDS,
		),
		pollIntervalSeconds: toSeconds(
			json.interval,
			DEFAULT_DEVICE_AUTH_INTERVAL_SECONDS,
		),
	};
}

async function pollWorkOSTokens(options: {
	signal?: AbortSignal;
	clientId: string;
	deviceCode: string;
	expiresInSeconds: number;
	initialPollIntervalSeconds: number;
	requestTimeoutMs: number;
	workosApiBaseUrl: string;
	onProgress?: OAuthLoginCallbacks["onProgress"];
}): Promise<WorkOSTokenSuccess> {
	const deadline = Date.now() + options.expiresInSeconds * 1000;
	let intervalSeconds = Math.max(1, options.initialPollIntervalSeconds);

	while (Date.now() <= deadline) {
		const response = await fetch(
			resolveUrl(
				options.workosApiBaseUrl,
				DEFAULT_WORKOS_ENDPOINTS.authenticate,
			),
			{
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
					device_code: options.deviceCode,
					client_id: options.clientId,
				}),
				signal: AbortSignal.any([
					AbortSignal.timeout(options.requestTimeoutMs),
					...(options.signal ? [options.signal] : []),
				]),
			},
		);
		const payload = (await response
			.json()
			.catch(() => ({}))) as WorkOSTokenResponse;
		if (response.ok) {
			if (!payload.access_token || !payload.refresh_token) {
				throw new Error("Invalid WorkOS token response");
			}
			return {
				accessToken: payload.access_token,
				refreshToken: payload.refresh_token,
				tokenType: payload.token_type ?? "Bearer",
			};
		}

		switch (payload.error) {
			case "authorization_pending": {
				await sleep(intervalSeconds * 1000, undefined, {
					signal: options.signal,
				});
				break;
			}
			case "slow_down": {
				intervalSeconds += 1;
				await sleep(intervalSeconds * 1000, undefined, {
					signal: options.signal,
				});
				break;
			}
			case "access_denied":
			case "expired_token":
			case "invalid_grant": {
				throw new BytosOAuthTokenError(
					payload.error_description || "WorkOS authorization failed",
					{
						status: response.status,
						errorCode: payload.error,
						requestId: response.headers.get("x-request-id") ?? undefined,
					},
				);
			}
			default: {
				throw new BytosOAuthTokenError(
					`WorkOS token polling failed: ${response.status}${payload.error_description ? ` - ${payload.error_description}` : ""}`,
					{
						status: response.status,
						errorCode: payload.error,
						requestId: response.headers.get("x-request-id") ?? undefined,
					},
				);
			}
		}

		options.onProgress?.("Waiting for browser authentication confirmation...");
	}

	throw new Error("WorkOS device authorization timed out");
}

async function registerWorkOSTokens(
	workosTokens: WorkOSTokenSuccess,
	options: BytosOAuthProviderOptions,
	provider?: string,
	signal?: AbortSignal,
): Promise<BytosOAuthCredentials> {
	const body = {
		accessToken: workosTokens.accessToken,
		refreshToken: workosTokens.refreshToken,
	};

	const response = await fetch(
		resolveUrl(options.apiBaseUrl, DEFAULT_AUTH_ENDPOINTS.register),
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(await resolveHeaders(options.headers)),
			},
			body: JSON.stringify(body),
			signal: AbortSignal.any([
				AbortSignal.timeout(
					options.requestTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
				),
				...(signal ? [signal] : []),
			]),
		},
	);

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		const details = parseOAuthError(text);
		throw new BytosOAuthTokenError(
			`Token registration failed: ${response.status}${details.message ? ` - ${details.message}` : ""}`,
			{
				status: response.status,
				errorCode: details.code,
				requestId: response.headers.get("x-request-id") ?? undefined,
			},
		);
	}

	const json = (await response.json()) as BytosTokenResponse;
	return toBytosCredentials(
		requireBytosTokenResponse(json, "Invalid token exchange response"),
		provider ?? options.provider,
		{ metadata: { sessionStartedAtMs: Date.now() } },
	);
}

async function exchangeAuthorizationCode(
	code: string,
	callbackUrl: string,
	options: BytosOAuthProviderOptions,
	provider?: string,
): Promise<BytosOAuthCredentials> {
	const body = {
		grant_type: "authorization_code",
		code,
		client_type: "extension",
		redirect_uri: callbackUrl,
		provider: provider ?? options.provider,
	};

	const response = await fetch(
		resolveUrl(options.apiBaseUrl, DEFAULT_AUTH_ENDPOINTS.token),
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(await resolveHeaders(options.headers)),
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(
				options.requestTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
			),
		},
	);

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		const details = parseOAuthError(text);
		throw new BytosOAuthTokenError(
			`Token exchange failed: ${response.status}${details.message ? ` - ${details.message}` : ""}`,
			{
				status: response.status,
				errorCode: details.code,
				requestId: response.headers.get("x-request-id") ?? undefined,
			},
		);
	}

	const json = (await response.json()) as BytosTokenResponse;
	return toBytosCredentials(
		requireBytosTokenResponse(json, "Invalid token exchange response"),
		provider ?? options.provider,
		{ metadata: { sessionStartedAtMs: Date.now() } },
	);
}

export async function loginBytosOAuth(
	options: BytosOAuthProviderOptions & {
		callbacks: OAuthLoginCallbacks;
	},
): Promise<BytosOAuthCredentials> {
	captureAuthStarted(options.telemetry, options.provider ?? "bytos");
	const useWorkOSDeviceAuth = options.useWorkOSDeviceAuth ?? true;
	const callbackPorts = options.callbackPorts?.length
		? options.callbackPorts
		: DEFAULT_CALLBACK_PORTS;
	const callbackPath = options.callbackPath ?? DEFAULT_CALLBACK_PATH;
	const localServer = useWorkOSDeviceAuth
		? null
		: await startLocalOAuthServer({
				ports: callbackPorts,
				callbackPath,
				onListening: options.callbacks.onServerListening,
				onClose: options.callbacks.onServerClose,
			});
	const callbackUrl =
		localServer?.callbackUrl ||
		`http://127.0.0.1:${callbackPorts[0] ?? DEFAULT_CALLBACK_PORTS[0]}${callbackPath}`;

	try {
		let credentials: BytosOAuthCredentials;
		if (useWorkOSDeviceAuth) {
			const clientId = getBytosEnvironmentConfig().workOsClientId;
			const deviceAuthorization = await requestWorkOSDeviceAuthorization(
				clientId,
				options,
			);
			options.callbacks.onAuth({
				url:
					deviceAuthorization.verificationUriComplete ??
					deviceAuthorization.verificationUri,
				instructions: `Enter this code in your browser: ${deviceAuthorization.userCode}`,
			});

			const workosTokens = await pollWorkOSTokens({
				clientId,
				deviceCode: deviceAuthorization.deviceCode,
				expiresInSeconds: deviceAuthorization.expiresInSeconds,
				initialPollIntervalSeconds: deviceAuthorization.pollIntervalSeconds,
				requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
				workosApiBaseUrl: DEFAULT_WORKOS_API_BASE_URL,
				onProgress: options.callbacks.onProgress,
			});

			credentials = await registerWorkOSTokens(
				workosTokens,
				options,
				options.provider,
			);
		} else {
			const authUrl = new URL(
				resolveUrl(options.apiBaseUrl, DEFAULT_AUTH_ENDPOINTS.authorize),
			);
			authUrl.searchParams.set("client_type", "extension");
			authUrl.searchParams.set("callback_url", callbackUrl);
			authUrl.searchParams.set("redirect_uri", callbackUrl);
			options.callbacks.onAuth({
				url: authUrl.toString(),
				instructions: "Continue the authentication process in your browser.",
			});

			let code: string | undefined;
			let provider = options.provider;
			const authResult = await resolveAuthorizationCodeInput({
				waitForCallback: localServer?.waitForCallback ?? (async () => null),
				cancelWait: localServer?.cancelWait ?? (() => {}),
				onManualCodeInput: options.callbacks.onManualCodeInput,
				parseOptions: { includeProvider: true },
			});
			if (authResult.error) {
				throw new Error(`OAuth error: ${authResult.error}`);
			}
			code = authResult.code;
			provider = authResult.provider ?? provider;
			if (!code) {
				const input = await options.callbacks.onPrompt({
					message: "Paste the authorization code (or full redirect URL):",
				});
				const parsed = parseAuthorizationInput(input, {
					includeProvider: true,
				});
				code = parsed.code;
				provider = parsed.provider ?? provider;
			}
			if (!code) {
				throw new Error("Missing authorization code");
			}
			credentials = await exchangeAuthorizationCode(
				code,
				callbackUrl,
				options,
				provider,
			);
		}

		captureAuthSucceeded(
			options.telemetry,
			options.provider ?? "bytos",
			getAuthTelemetryDetails(credentials),
		);
		identifyAccount(options.telemetry, {
			id: credentials.accountId,
			email: credentials.email,
			provider: options.provider ?? "bytos",
		});
		return credentials;
	} catch (error) {
		captureAuthFailed(
			options.telemetry,
			options.provider ?? "bytos",
			error instanceof Error ? error.message : String(error),
			{
				requestId:
					error instanceof BytosOAuthTokenError ? error.requestId : undefined,
			},
		);
		throw error;
	} finally {
		localServer?.close();
	}
}

export async function startBytosDeviceAuth(options?: {
	signal?: AbortSignal;
	requestTimeoutMs?: number;
}): Promise<{
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete?: string;
	expiresInSeconds: number;
	pollIntervalSeconds: number;
}> {
	return await requestWorkOSDeviceAuthorization(
		getBytosEnvironmentConfig().workOsClientId,
		options,
	);
}

export async function completeBytosDeviceAuth(options: {
	signal?: AbortSignal;
	deviceCode: string;
	expiresInSeconds: number;
	pollIntervalSeconds: number;
	apiBaseUrl: string;
	provider?: string;
	headers?: HeaderInput;
	requestTimeoutMs?: number;
	telemetry?: ITelemetryService;
}): Promise<BytosOAuthCredentials> {
	const providerName = options.provider ?? "bytos";
	captureAuthStarted(options.telemetry, providerName);
	try {
		const workosTokens = await pollWorkOSTokens({
			signal: options.signal,
			clientId: getBytosEnvironmentConfig().workOsClientId,
			deviceCode: options.deviceCode,
			expiresInSeconds: options.expiresInSeconds,
			initialPollIntervalSeconds: options.pollIntervalSeconds,
			requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
			workosApiBaseUrl: DEFAULT_WORKOS_API_BASE_URL,
		});
		const credentials = await registerWorkOSTokens(
			workosTokens,
			{
				apiBaseUrl: options.apiBaseUrl,
				headers: options.headers,
				requestTimeoutMs: options.requestTimeoutMs,
				provider: options.provider,
			},
			options.provider,
			options.signal,
		);
		captureAuthSucceeded(
			options.telemetry,
			providerName,
			getAuthTelemetryDetails(credentials),
		);
		identifyAccount(options.telemetry, {
			id: credentials.accountId,
			email: credentials.email,
			provider: providerName,
		});
		return credentials;
	} catch (error) {
		captureAuthFailed(
			options.telemetry,
			providerName,
			error instanceof Error ? error.message : String(error),
			{
				requestId:
					error instanceof BytosOAuthTokenError ? error.requestId : undefined,
			},
		);
		throw error;
	}
}

export async function refreshBytosToken(
	current: BytosOAuthCredentials,
	options: BytosOAuthProviderOptions,
): Promise<BytosOAuthCredentials> {
	const refreshUrl = resolveUrl(
		options.apiBaseUrl,
		DEFAULT_AUTH_ENDPOINTS.refresh,
	);
	sdkDebug(
		`bytos.refresh.request url=${refreshUrl} refreshTokenHash=${hashSecret(current.refresh)}`,
	);
	const response = await fetch(refreshUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(await resolveHeaders(options.headers)),
		},
		body: JSON.stringify({
			refreshToken: current.refresh,
			grantType: "refresh_token",
		}),
		signal: AbortSignal.timeout(
			options.requestTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
		),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		const details = parseOAuthError(text);
		const requestId = response.headers.get("x-request-id") ?? undefined;
		sdkDebug(
			`bytos.refresh.error status=${response.status} errorCode=${details.code ?? "none"} message=${details.message ?? "none"} requestId=${requestId ?? "none"}`,
		);
		throw new BytosOAuthTokenError(
			`Token refresh failed: ${response.status}${details.message ? ` - ${details.message}` : ""}`,
			{ status: response.status, errorCode: details.code, requestId },
		);
	}

	const json = (await response.json()) as BytosTokenResponse;
	const provider =
		(current.metadata?.provider as string | undefined) ?? options.provider;
	const result = toBytosCredentials(
		requireBytosTokenResponse(json, "Invalid token refresh response"),
		provider,
		current,
	);
	sdkDebug(
		`bytos.refresh.success newAccessTokenHash=${hashSecret(result.access)} newRefreshTokenHash=${hashSecret(result.refresh)} expires=${result.expires}`,
	);
	return result;
}

/**
 * Resolve valid Bytos credentials, refreshing when needed.
 *
 * Contract: returns refreshed/current credentials when usable; returns `null`
 * ONLY when the refresh token was rejected (invalid grant — re-auth required);
 * THROWS on transient failures (network, timeout, 5xx) so callers can leave
 * stored credentials untouched and retry later.
 */
export async function getValidBytosCredentials(
	currentCredentials: BytosOAuthCredentials | null,
	providerOptions: BytosOAuthProviderOptions,
	options?: BytosTokenResolution,
): Promise<BytosOAuthCredentials | null> {
	if (!currentCredentials) {
		sdkDebug("bytos.getCredentials outcome=no_current_credentials");
		return null;
	}

	const refreshBufferMs = options?.refreshBufferMs ?? DEFAULT_REFRESH_BUFFER_MS;
	const retryableTokenGraceMs =
		options?.retryableTokenGraceMs ?? DEFAULT_RETRYABLE_TOKEN_GRACE_MS;
	const forceRefresh = options?.forceRefresh === true;

	if (
		!forceRefresh &&
		!isCredentialLikelyExpired(currentCredentials, refreshBufferMs)
	) {
		sdkDebug(
			`bytos.getCredentials outcome=still_valid forceRefresh=${forceRefresh}`,
		);
		return currentCredentials;
	}

	sdkDebug(
		`bytos.getCredentials outcome=needs_refresh forceRefresh=${forceRefresh} accessTokenHash=${hashSecret(currentCredentials.access)}`,
	);

	try {
		return await refreshBytosToken(currentCredentials, providerOptions);
	} catch (error) {
		const authTelemetryDetails = getAuthTelemetryDetails(currentCredentials);
		const requestIdDetails =
			error instanceof BytosOAuthTokenError && error.requestId
				? { request_id: error.requestId }
				: {};
		const failureDetails = {
			status: error instanceof BytosOAuthTokenError ? error.status : undefined,
			errorCode:
				error instanceof BytosOAuthTokenError ? error.errorCode : undefined,
			...requestIdDetails,
			...authTelemetryDetails,
			errorName: error instanceof Error ? error.name : undefined,
		};
		if (error instanceof BytosOAuthTokenError && error.isLikelyInvalidGrant()) {
			sdkDebug(
				`bytos.getCredentials outcome=invalid_grant status=${error.status} errorCode=${error.errorCode ?? "none"}`,
			);
			// This is the single owner of the involuntary-logout event for the
			// Bytos provider — callers observing the `null` return must NOT
			// emit their own user.auth_logged_out. `token_invalid` matches the
			// legacy extension's LogoutReason vocabulary so warehouse queries
			// cover both bundles; the raw OAuth code stays in `errorCode`.
			captureAuthLoggedOut(
				providerOptions.telemetry,
				providerOptions.provider ?? "bytos",
				"token_invalid",
				{
					status: error.status,
					errorCode: error.errorCode,
					...requestIdDetails,
					...authTelemetryDetails,
				},
			);
			return null;
		}
		if (currentCredentials.expires - Date.now() > retryableTokenGraceMs) {
			// Keep current token on transient refresh failures while still valid.
			sdkDebug(
				`bytos.getCredentials outcome=transient_failure_kept_current error=${error instanceof Error ? error.message : String(error)}`,
			);
			captureAuthRefreshSoftFailure(
				providerOptions.telemetry,
				providerOptions.provider ?? "bytos",
				{ ...failureDetails, tokenExpired: false },
			);
			return currentCredentials;
		}
		// Transient failure with an already-expired token: rethrow instead of
		// returning null. A null from this function means the refresh token was
		// REJECTED (re-auth required); a network blip that happens to land after
		// expiry must not be mistaken for that — callers were wiping stored
		// credentials over it, logging out every Bytos process on the machine.
		sdkDebug(
			`bytos.getCredentials outcome=transient_failure_rethrown error=${error instanceof Error ? error.message : String(error)}`,
		);
		// Every one of these events was a hard logout before the
		// transient-vs-invalid_grant fix — the "prevented logout" counter.
		captureAuthRefreshSoftFailure(
			providerOptions.telemetry,
			providerOptions.provider ?? "bytos",
			{ ...failureDetails, tokenExpired: true },
		);
		throw error;
	}
}
