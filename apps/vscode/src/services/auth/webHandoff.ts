/**
 * Shared constants for the web -> VS Code account handoff.
 *
 * The handshake itself (state + PKCE creation, callback validation, token
 * exchange) lives in `supabaseAccountService.ts`, the single implementation the
 * URI handler and the account controllers use. This module only carries the path
 * constant so the URI router and the service cannot drift apart.
 */

export const WEB_AUTH_CALLBACK_PATH = "/auth/callback"
