/**
 * Context Doctor browser half — registers the audit ring into the
 * native composer context-control position and drives it from the host's same-origin
 * `/api/context-doctor/audit` endpoint: fetch on mount, manual refresh.
 * @module dsh-context-doctor/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Required services. */
export declare const inject: string[];
export type { ContextAuditRingProps } from './ContextAuditRing.tsx';
export type { AuditUiState } from './store.ts';
/**
 * Client plugin body: register dictionaries, seed the store, and seat the
 * audit control once its native replacement hole is on the ledger.
 */
export declare function apply(ctx: ClientContext): void;
