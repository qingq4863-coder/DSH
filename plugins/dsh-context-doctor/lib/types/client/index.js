/**
 * Context Doctor browser half — registers the audit ring into the
 * native composer context-control position and drives it from the host's same-origin
 * `/api/context-doctor/audit` endpoint: fetch on mount, manual refresh.
 * @module dsh-context-doctor/client
 */
import { createAuditStore } from "./store.js";
import { ContextAuditRing } from "./ContextAuditRing.js";
import { NS, en, zh } from "./locales.js";
/** Required services. */
export const inject = ['slots', 'locale'];
/**
 * Client plugin body: register dictionaries, seed the store, and seat the
 * audit control once its native replacement hole is on the ledger.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'context-doctor: dictionaries');
    const store = createAuditStore();
    ctx.slots.inject('conversation.input.context', () => ctx.slots.register({
        name: 'conversation.input.context',
        store,
        locale: NS,
    }, ContextAuditRing));
}
