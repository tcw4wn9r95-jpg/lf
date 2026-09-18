/*
 * Build stamp. Shown in Settings so "am I running the latest?" is answerable
 * without guessing, and kept in step with the service worker's cache name by
 * scripts/release.sh — they must never drift, or a deploy goes invisible.
 */
export const APP_VERSION = '2026.09.18-4';
