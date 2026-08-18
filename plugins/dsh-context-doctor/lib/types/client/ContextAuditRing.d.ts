/**
 * Context Doctor's native composer control.
 * The panel deliberately uses one lightweight, mono-inspired visual language
 * in both DSH themes instead of inheriting the surrounding chat typography.
 */
import { type ReactElement } from 'react';
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots';
import type { createAuditStore } from './store.ts';
import { NS } from './locales.ts';
export type ContextAuditRingProps = PropsRuntime<'conversation.input.context'> & PropsStore<ReturnType<typeof createAuditStore>> & PropsLocale<typeof NS>;
/** Resident control that replaces the built-in meter just before Send. */
export declare function ContextAuditRing(props: ContextAuditRingProps): ReactElement;
