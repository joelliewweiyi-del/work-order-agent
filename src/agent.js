// The agent: mail in, draft work order out. Each step is logged, so a person sees how it decided.
// It never sends anything. A draft waits for a person to approve it.
import { verify, llmConfig } from 'doc-trace';
import { triageWithRules } from './rules.js';
import { triageWithLlm } from './llm.js';

export const SLA_HOURS = { emergency: 4, urgent: 24, routine: 120 };
const LABEL = { unit: 'Unit', issue: 'Issue', urgency: 'Urgency' };

export async function runAgent(mail, register, { extractor = 'auto', env = process.env, fetchFn, now = new Date() } = {}) {
  const steps = [];
  const step = (name, ok, detail) => steps.push({ name, ok, detail });
  const config = llmConfig(env);
  const useLlm = extractor === 'llm' || (extractor === 'auto' && config);
  if (useLlm && !config) throw new Error('extractor "llm" needs LLM_API_KEY or XAI_API_KEY');

  // 1. Triage
  const t = useLlm ? await triageWithLlm(mail, config, fetchFn) : triageWithRules(mail);
  const by = useLlm ? `llm:${config.model}` : 'rules';

  // 2. Check every quote against the mail. A value the mail does not contain is dropped.
  const text = `${mail.subject}\n${mail.body}`;
  const fields = verify([text], t.fields).map((f) => ({ ...f, label: LABEL[f.key] }));
  const rejected = fields.filter((f) => f.status === 'rejected');
  step('Read the mail', true, `${by}: ${t.isWorkOrder ? `work order, ${t.trade}, ${t.urgency}` : 'not a work order'}`);
  step('Check every quote against the mail', rejected.length === 0,
    rejected.length ? rejected.map((f) => `${f.label}: ${f.reason}`).join('; ') : `${fields.filter((f) => f.status === 'traced').length} of ${fields.length} quoted from the mail`);
  const value = (key) => fields.find((f) => f.key === key && f.status === 'traced')?.value ?? null;

  // 3. Who is this? The sender's address decides. A unit named in the mail must agree with it.
  const bySender = register.units.find((u) => u.contact.toLowerCase() === mail.from.toLowerCase());
  // "flat 2A", "Unit 2A" and "apt. 2a" all name unit 2A.
  const unitId = (s) => s.replace(/^\s*(flat|unit|apartment|apt\.?)\s+/i, '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  const named = value('unit') && unitId(value('unit'));
  let unit = bySender;
  if (!bySender) step('Match the sender to a unit', false, `${mail.from} is not a known tenant contact`);
  else if (named && named !== unitId(bySender.unit)) {
    unit = null;
    step('Match the sender to a unit', false, `sender rents unit ${bySender.unit}, the mail says unit ${named}`);
  } else {
    const prop = register.properties.find((p) => p.id === bySender.property);
    step('Match the sender to a unit', true, `${bySender.tenant}, unit ${bySender.unit}, ${prop.name}${named ? '' : ' (unit not named in the mail; taken from the sender)'}`);
  }

  if (!t.isWorkOrder) {
    step('Route', true, 'not a repair: forward to the property manager, no work order');
    return { mailId: mail.id, kind: 'forward', fields, steps, unit, draft: null };
  }

  // 4. Contractor by trade, and a due time from the urgency.
  const contractor = register.contractors.find((c) => c.trade === t.trade) ?? register.contractors.find((c) => c.trade === 'general');
  step('Choose a contractor', true, `${contractor.name} (${contractor.trade})`);
  const due = new Date(now.getTime() + SLA_HOURS[t.urgency] * 3600_000);
  step('Set the deadline', true, `${t.urgency}: within ${SLA_HOURS[t.urgency]} hours`);

  // 5. Draft. Anything uncertain is flagged for the person who approves.
  const flags = steps.filter((s) => !s.ok).map((s) => s.detail);
  const prop = unit && register.properties.find((p) => p.id === unit.property);
  const draft = {
    trade: t.trade, urgency: t.urgency, contractor: contractor.id, due: due.toISOString(),
    location: unit ? `${prop.name}, unit ${unit.unit}, ${prop.city}` : 'unknown: check before sending',
    description: value('issue') ?? mail.subject,
    tenantReply: `Hi ${unit?.tenant.split(' ')[0] ?? 'there'},\n\nThanks for letting us know. We've asked ${contractor.name} to come ${t.urgency === 'emergency' ? 'as soon as possible, within 4 hours' : t.urgency === 'urgent' ? 'within 24 hours' : 'within 5 working days'}. They will contact you to arrange access.`,
    flags,
  };
  step('Draft the work order', flags.length === 0, flags.length ? `${flags.length} point(s) to check before approving` : 'ready for approval');
  return { mailId: mail.id, kind: 'work-order', fields, steps, unit, draft };
}
