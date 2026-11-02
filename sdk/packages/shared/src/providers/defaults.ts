/**
 * Fallback default model for the Bytos provider. The `bytos` provider manifest
 * in `@bytos/llms` prefers the first entry of the Bytos recommended-models list
 * and falls back to this id when that list is empty.
 */
export const BYTOS_DEFAULT_MODEL_ID = "anthropic/claude-sonnet-5.5";
