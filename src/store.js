// In-memory inbox and work orders. Restarting the server resets the demo.
import { runAgent, SLA_HOURS } from './agent.js';

// What a person can do next from each status. Nothing reaches a contractor before "approve".
export const NEXT = {
  draft: { approve: 'sent', discard: 'discarded' },
  sent: { schedule: 'scheduled' },
  scheduled: { complete: 'done' },
  forward: { done: 'forwarded' },
};

export function createStore(register, { now = () => new Date(), ...agentOpts } = {}) {
  const items = new Map();
  let seq = 0;

  async function receive(mail) {
    const m = { ...mail, id: mail.id ?? `m${++seq}-${Date.now()}`, received: now().toISOString() };
    const result = await runAgent(m, register, { ...agentOpts, now: now() });
    const item = { mail: m, ...result, status: result.kind === 'forward' ? 'forward' : 'draft', timeline: [] };
    item.timeline.push({ at: m.received, text: result.kind === 'forward' ? 'Agent: not a repair, forward to the property manager' : `Agent drafted a ${result.draft.urgency} work order` });
    items.set(m.id, item);
    return item;
  }

  // edits: fields of the draft a person may change before approving.
  function act(id, action, { by = 'Property manager', edits = {}, note } = {}) {
    const item = items.get(id);
    if (!item) throw new Error('unknown mail');
    const to = Object.hasOwn(NEXT, item.status) && Object.hasOwn(NEXT[item.status], action) ? NEXT[item.status][action] : null;
    if (!to) throw new Error(`cannot ${action} a ${item.status} item`);
    if (action === 'approve') {
      const allowed = ['unit', 'urgency', 'contractor', 'description', 'tenantReply'];
      for (const k of Object.keys(edits)) if (!allowed.includes(k)) throw new Error(`cannot edit ${k}`);
      if (edits.contractor && !register.contractors.some((c) => c.id === edits.contractor)) throw new Error('unknown contractor');
      if (edits.urgency && !Object.hasOwn(SLA_HOURS, edits.urgency)) throw new Error('unknown urgency');
      const { unit: unitId, ...rest } = edits;
      if (!unitId && item.draft.location.startsWith('unknown')) throw new Error('set the unit before approving');
      if (unitId) {
        const unit = register.units.find((u) => u.id === unitId);
        if (!unit) throw new Error('unknown unit');
        const prop = register.properties.find((p) => p.id === unit.property);
        item.unit = unit;
        item.draft.location = `${prop.name}, unit ${unit.unit}, ${prop.city}`;
      }
      Object.assign(item.draft, rest);
      // The deadline follows the urgency, counted from when the mail arrived.
      if (rest.urgency) item.draft.due = new Date(new Date(item.mail.received).getTime() + SLA_HOURS[rest.urgency] * 3600_000).toISOString();
    }
    item.status = to;
    const contractor = item.draft && register.contractors.find((c) => c.id === item.draft.contractor);
    const text = {
      approve: `${by} approved; work order sent to ${contractor?.name}, reply sent to ${item.mail.from}`,
      discard: `${by} discarded the draft`, schedule: `${contractor?.name} scheduled the visit`,
      complete: `${contractor?.name} marked the job done`, done: `${by} forwarded the mail`,
    }[action];
    item.timeline.push({ at: now().toISOString(), text: note ? `${text}: ${note}` : text });
    return item;
  }

  return { receive, act, list: () => [...items.values()], get: (id) => items.get(id) };
}
