import fs from 'fs';
import path from 'path';
import {
  Lead,
  LeadStatus,
  CampaignTemplate,
  CallAttempt,
  EmailLog,
  CrmFields,
  LeadHistoryItem,
} from '../types';
import {
  CAMPAIGN_TEMPLATES,
  INITIAL_DEMO_LEADS,
  parseInboundEmailReply,
  renderEmailTemplate,
  addDaysToIso,
} from './dripCampaignService';
import { getMongoDb, withoutMongoId } from './mongoDbAdapter';

const STORE_PATH = path.resolve(process.cwd(), '.leads_drip_store.json');

// MongoDB collections backing the drip campaign
const LEADS_COLLECTION = 'leads';
const TEMPLATES_COLLECTION = 'campaign_templates';
const WORKFLOW_COLLECTION = 'lead_campaign_workflows';
const WORKFLOW_STATE_ID = 'drip_state';

interface DripStoreFile {
  leads: Lead[];
  templates: CampaignTemplate[];
  virtualOffsetDays: number;
  lastBatchRunAt: string;
}

let inMemoryStore: DripStoreFile | null = null;

// Stored templates override the built-in ones step by step, so a partial set still yields all 3 steps
function mergeTemplates(stored: CampaignTemplate[]): CampaignTemplate[] {
  return CAMPAIGN_TEMPLATES.map((def) => stored.find((t) => t.step === def.step) || def);
}

async function loadDripStoreFromMongo(): Promise<DripStoreFile | null> {
  const db = await getMongoDb();
  if (!db) return null;
  try {
    const [leadDocs, templateDocs, state] = await Promise.all([
      db.collection(LEADS_COLLECTION).find({}).sort({ createdAt: -1 }).toArray(),
      db.collection(TEMPLATES_COLLECTION).find({}).toArray(),
      db.collection(WORKFLOW_COLLECTION).findOne({ _id: WORKFLOW_STATE_ID as any }),
    ]);

    const store: DripStoreFile = {
      leads: leadDocs.map((d) => withoutMongoId(d) as unknown as Lead),
      templates: mergeTemplates(templateDocs.map((d) => withoutMongoId(d) as unknown as CampaignTemplate)),
      virtualOffsetDays: Number(state?.virtualOffsetDays) || 0,
      lastBatchRunAt: state?.lastBatchRunAt || new Date().toISOString(),
    };

    if (store.leads.length === 0) {
      store.leads = JSON.parse(JSON.stringify(INITIAL_DEMO_LEADS));
      await persistDripStoreToMongo(store, store.leads);
      console.log(`✨ Seeded ${store.leads.length} demo leads into MongoDB collection '${LEADS_COLLECTION}'.`);
    }
    return store;
  } catch (err) {
    console.warn('⚠️ Failed to load drip store from MongoDB, falling back to local file:', err);
    return null;
  }
}

async function persistDripStoreToMongo(store: DripStoreFile, changedLeads: Lead[]): Promise<void> {
  const db = await getMongoDb();
  if (!db) return;
  try {
    if (changedLeads.length > 0) {
      await db.collection(LEADS_COLLECTION).bulkWrite(
        changedLeads.map((lead) => ({
          replaceOne: { filter: { id: lead.id }, replacement: withoutMongoId(lead as any), upsert: true },
        })),
        { ordered: false }
      );
    }
    await db.collection(WORKFLOW_COLLECTION).updateOne(
      { _id: WORKFLOW_STATE_ID as any },
      { $set: { virtualOffsetDays: store.virtualOffsetDays, lastBatchRunAt: store.lastBatchRunAt, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
  } catch (err) {
    console.warn('⚠️ Failed to persist drip store to MongoDB (saved locally):', err);
  }
}

export async function getDripStore(): Promise<DripStoreFile> {
  if (inMemoryStore) {
    return inMemoryStore;
  }

  const mongoStore = await loadDripStoreFromMongo();
  if (mongoStore) {
    inMemoryStore = mongoStore;
    return inMemoryStore;
  }

  if (fs.existsSync(STORE_PATH)) {
    try {
      const content = fs.readFileSync(STORE_PATH, 'utf-8');
      inMemoryStore = JSON.parse(content);
      return inMemoryStore!;
    } catch (e) {
      console.warn('Could not read .leads_drip_store.json, creating initial store:', e);
    }
  }

  inMemoryStore = {
    leads: [...INITIAL_DEMO_LEADS],
    templates: [...CAMPAIGN_TEMPLATES],
    virtualOffsetDays: 0,
    lastBatchRunAt: new Date().toISOString(),
  };
  await saveDripStore(inMemoryStore);
  return inMemoryStore;
}

/**
 * Persists the store locally and to MongoDB. Pass the leads that changed to avoid
 * rewriting the whole collection; omitting it upserts every lead.
 */
export async function saveDripStore(store: DripStoreFile, changedLeads: Lead[] = store.leads): Promise<void> {
  inMemoryStore = store;
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save drip store file:', err);
  }
  await persistDripStoreToMongo(store, changedLeads);
}

// Reset to initial demo leads (replaces every stored lead, including MongoDB)
export async function resetDemoLeads(): Promise<Lead[]> {
  const store = await getDripStore();
  store.leads = JSON.parse(JSON.stringify(INITIAL_DEMO_LEADS));
  store.virtualOffsetDays = 0;
  const db = await getMongoDb();
  if (db) {
    try {
      await db.collection(LEADS_COLLECTION).deleteMany({});
    } catch (err) {
      console.warn('⚠️ Failed to clear leads in MongoDB before reset:', err);
    }
  }
  await saveDripStore(store);
  return store.leads;
}

export async function deleteLead(leadId: string): Promise<void> {
  const store = await getDripStore();
  const before = store.leads.length;
  store.leads = store.leads.filter((l) => l.id !== leadId);
  if (store.leads.length === before) throw new Error('Lead not found');
  await saveDripStore(store, []);
  const db = await getMongoDb();
  if (db) {
    try {
      await db.collection(LEADS_COLLECTION).deleteOne({ id: leadId });
    } catch (err) {
      console.warn('⚠️ Failed to delete lead from MongoDB:', err);
    }
  }
}

export async function saveCampaignTemplates(templates: CampaignTemplate[]): Promise<CampaignTemplate[]> {
  const store = await getDripStore();
  store.templates = mergeTemplates(templates);
  await saveDripStore(store, []);
  const db = await getMongoDb();
  if (db) {
    try {
      await db.collection(TEMPLATES_COLLECTION).bulkWrite(
        store.templates.map((t) => ({
          replaceOne: { filter: { step: t.step }, replacement: withoutMongoId(t as any), upsert: true },
        }))
      );
    } catch (err) {
      console.warn('⚠️ Failed to save campaign templates to MongoDB:', err);
    }
  }
  return store.templates;
}

// Add New Lead - automatically triggers 1st Mail
export async function createNewLead(payload: {
  companyName: string;
  leadName: string;
  email: string;
  phone?: string;
  country?: string;
  notes?: string;
  assignedTo?: string;
  sendEmail1Immediately?: boolean;
}): Promise<Lead> {
  const store = await getDripStore();
  const now = new Date().toISOString();
  const leadId = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const newLead: Lead = {
    id: leadId,
    companyName: payload.companyName.trim(),
    leadName: payload.leadName.trim(),
    initialEmail: payload.email.trim(),
    initialPhone: payload.phone?.trim() || '',
    country: payload.country?.trim() || 'Global',
    status: 'new_lead',
    currentStep: 1,
    createdAt: now,
    lastActivityAt: now,
    nextActionDueAt: now,
    crmFields: {
      contactPersonResponsible: '',
      directEmailId: '',
      phoneWhatsApp: payload.phone?.trim() || '',
      yarnCountsFabricItems: '',
      approximateQuantityPerMonth: '',
      destinationPortCnf: '',
      notes: payload.notes?.trim() || '',
    },
    emailLogs: [],
    callAttempts: [],
    history: [
      {
        id: `h_${Date.now()}_1`,
        timestamp: now,
        action: 'Lead Created',
        details: `Created new lead with status New Lead. Assigned to ${payload.assignedTo || 'Lahoti Export Team'}.`,
        actor: 'User / CRM System',
      },
    ],
    assignedTo: payload.assignedTo || 'Lahoti Export Team',
    isDripActive: true,
  };

  // Automatically send 1st Mail when status is new lead
  if (payload.sendEmail1Immediately !== false) {
    const template1 = store.templates.find((t) => t.step === 1) || CAMPAIGN_TEMPLATES[0];
    const { subject, body } = renderEmailTemplate(template1, newLead, 'Rajesh Lahoti');

    const emailLog: EmailLog = {
      id: `em_${Date.now()}`,
      step: 1,
      subject,
      body,
      sentAt: now,
      sender: 'Rajesh Lahoti (Exports Division)',
      recipient: newLead.initialEmail,
      status: 'sent',
    };

    newLead.emailLogs.push(emailLog);
    newLead.status = 'mail_1_sent';
    newLead.currentStep = 1;
    newLead.lastActivityAt = now;
    // 2nd mail trigger is scheduled in 4 days if no response
    newLead.nextActionDueAt = addDaysToIso(now, 4);

    newLead.history.unshift({
      id: `h_${Date.now()}_2`,
      timestamp: now,
      action: '1st Mail Sent (Auto-Trigger)',
      details: `Subject: "${subject}". Information collection template dispatched. 2nd follow-up scheduled for 4 days if no reply.`,
      actor: 'Drip Automation Engine',
    });
  }

  store.leads.unshift(newLead);
  await saveDripStore(store, [newLead]);
  return newLead;
}

// Send Next Email in Sequence manually or via workflow
export async function sendNextDripEmail(leadId: string, senderName: string = 'Rajesh Lahoti'): Promise<Lead> {
  const store = await getDripStore();
  const lead = store.leads.find((l) => l.id === leadId);
  if (!lead) throw new Error('Lead not found');

  const now = new Date().toISOString();
  let nextStep: 1 | 2 | 3 = 1;

  if (lead.status === 'new_lead') {
    nextStep = 1;
  } else if (lead.status === 'mail_1_sent') {
    nextStep = 2;
  } else if (lead.status === 'mail_2_sent') {
    nextStep = 3;
  } else if (lead.status === 'mail_3_sent') {
    // Lead is already past step 3, assign to sales for call
    lead.status = 'call_pending_1';
    lead.lastActivityAt = now;
    lead.nextActionDueAt = null;
    lead.history.unshift({
      id: `h_${Date.now()}`,
      timestamp: now,
      action: 'Drip Completed -> Assigned to Sales Rep for Calling',
      details: 'All 3 emails sent with no reply. Created priority phone call task for sales representative.',
      actor: 'Workflow Engine',
    });
    await saveDripStore(store, [lead]);
    return lead;
  }

  const template = store.templates.find((t) => t.step === nextStep) || CAMPAIGN_TEMPLATES[nextStep - 1];
  const { subject, body } = renderEmailTemplate(template, lead, senderName);

  const emailLog: EmailLog = {
    id: `em_${Date.now()}`,
    step: nextStep,
    subject,
    body,
    sentAt: now,
    sender: `${senderName} (Lahoti Overseas)`,
    recipient: lead.crmFields.directEmailId || lead.initialEmail,
    status: 'sent',
  };

  lead.emailLogs.unshift(emailLog);
  lead.lastActivityAt = now;
  lead.currentStep = nextStep;

  if (nextStep === 1) {
    lead.status = 'mail_1_sent';
    lead.nextActionDueAt = addDaysToIso(now, 4);
  } else if (nextStep === 2) {
    lead.status = 'mail_2_sent';
    lead.nextActionDueAt = addDaysToIso(now, 4);
  } else if (nextStep === 3) {
    lead.status = 'mail_3_sent';
    lead.nextActionDueAt = addDaysToIso(now, 4); // After 4 days, phone call step triggers
  }

  lead.history.unshift({
    id: `h_${Date.now()}`,
    timestamp: now,
    action: `${nextStep === 1 ? '1st' : nextStep === 2 ? '2nd' : '3rd'} Mail Sent`,
    details: `Subject: "${subject}". Next action scheduled in 4 days.`,
    actor: 'Drip Automation Engine',
  });

  await saveDripStore(store, [lead]);
  return lead;
}

// Process Inbound Email Reply & Auto-Extract CRM Fields
export async function simulateInboundReply(
  leadId: string,
  replyText: string,
  customSender?: string
): Promise<{ lead: Lead; extractedFields: Partial<CrmFields>; confidenceScore: number }> {
  const store = await getDripStore();
  const lead = store.leads.find((l) => l.id === leadId);
  if (!lead) throw new Error('Lead not found');

  const now = new Date().toISOString();
  const parseResult = parseInboundEmailReply(replyText);

  // Auto-update CRM fields from reply
  lead.crmFields = {
    ...lead.crmFields,
    ...(parseResult.extractedFields.contactPersonResponsible
      ? { contactPersonResponsible: parseResult.extractedFields.contactPersonResponsible }
      : {}),
    ...(parseResult.extractedFields.directEmailId
      ? { directEmailId: parseResult.extractedFields.directEmailId }
      : {}),
    ...(parseResult.extractedFields.phoneWhatsApp
      ? { phoneWhatsApp: parseResult.extractedFields.phoneWhatsApp }
      : {}),
    ...(parseResult.extractedFields.yarnCountsFabricItems
      ? { yarnCountsFabricItems: parseResult.extractedFields.yarnCountsFabricItems }
      : {}),
    ...(parseResult.extractedFields.approximateQuantityPerMonth
      ? { approximateQuantityPerMonth: parseResult.extractedFields.approximateQuantityPerMonth }
      : {}),
    ...(parseResult.extractedFields.destinationPortCnf
      ? { destinationPortCnf: parseResult.extractedFields.destinationPortCnf }
      : {}),
    ...(parseResult.extractedFields.sourcingReferralContact
      ? { sourcingReferralContact: parseResult.extractedFields.sourcingReferralContact }
      : {}),
  };

  // Update latest email log to mark replied
  if (lead.emailLogs.length > 0) {
    lead.emailLogs[0].status = 'replied';
    lead.emailLogs[0].repliedAt = now;
    lead.emailLogs[0].replyText = replyText;
    lead.emailLogs[0].extractedFields = parseResult.extractedFields;
  }

  // Halt drip campaign and mark as Information Received
  lead.status = 'info_received';
  lead.isDripActive = false;
  lead.nextActionDueAt = null;
  lead.lastActivityAt = now;

  const extractedSummary = Object.entries(parseResult.extractedFields)
    .filter(([_, v]) => !!v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' | ');

  lead.history.unshift({
    id: `h_${Date.now()}`,
    timestamp: now,
    action: 'Inbound Reply Received & CRM Fields Auto-Updated',
    details: `Extracted ${parseResult.extractedCount} fields (${extractedSummary || 'Standard Response'}). Drip sequence halted.`,
    actor: 'Smart Reply AI/NLP Parser',
  });

  await saveDripStore(store, [lead]);
  return {
    lead,
    extractedFields: parseResult.extractedFields,
    confidenceScore: parseResult.confidenceScore,
  };
}

// Log Sales Phone Call Attempt (Enforcing 2-attempt rule for "Not Reachable")
export async function logCallAttempt(
  leadId: string,
  payload: {
    callerName: string;
    outcome: 'no_answer' | 'switched_off' | 'busy' | 'wrong_number' | 'connected' | 'call_back_requested';
    notes: string;
  }
): Promise<Lead> {
  const store = await getDripStore();
  const lead = store.leads.find((l) => l.id === leadId);
  if (!lead) throw new Error('Lead not found');

  const now = new Date().toISOString();
  const attemptNumber = (lead.callAttempts.length + 1) as 1 | 2;

  const callAttempt: CallAttempt = {
    id: `call_${Date.now()}`,
    attemptNumber,
    attemptedAt: now,
    callerName: payload.callerName || 'Sales Representative',
    outcome: payload.outcome,
    notes: payload.notes || '',
  };

  lead.callAttempts.push(callAttempt);
  lead.lastActivityAt = now;

  // RULE LOGIC:
  // 1. If connected -> Status changes to 'call_connected' or 'info_received'
  if (payload.outcome === 'connected') {
    lead.status = 'call_connected';
    lead.isDripActive = false;
    lead.nextActionDueAt = null;
    lead.history.unshift({
      id: `h_${Date.now()}`,
      timestamp: now,
      action: `Call Attempt ${attemptNumber}: Connected!`,
      details: `Prospect reached successfully by ${callAttempt.callerName}. Notes: ${payload.notes}`,
      actor: callAttempt.callerName,
    });
  } else {
    // Unsuccessful attempt (no answer, switched off, busy, wrong number)
    const failedAttempts = lead.callAttempts.filter((c) => c.outcome !== 'connected').length;

    if (failedAttempts >= 2) {
      // RULE: If in 2 times they can't connect to them on phone, make the lead status NOT REACHABLE
      lead.status = 'not_reachable';
      lead.isDripActive = false;
      lead.nextActionDueAt = null;
      lead.history.unshift({
        id: `h_${Date.now()}_nr`,
        timestamp: now,
        action: 'Lead Status Changed to NOT REACHABLE',
        details: `Rule Enforced: 2 consecutive failed phone calls logged (${callAttempt.outcome}). Campaign ended.`,
        actor: 'Sales Automation Rule',
      });
    } else {
      // 1st failed attempt
      lead.status = 'call_pending_2';
      lead.history.unshift({
        id: `h_${Date.now()}_c1`,
        timestamp: now,
        action: `Call Attempt 1 Logged (${callAttempt.outcome})`,
        details: `Could not connect. Follow-up 2nd phone call attempt required before marking Not Reachable. Notes: ${payload.notes}`,
        actor: callAttempt.callerName,
      });
    }
  }

  await saveDripStore(store, [lead]);
  return lead;
}

// Update lead general fields
export async function updateLead(leadId: string, updates: Partial<Lead>): Promise<Lead> {
  const store = await getDripStore();
  const leadIndex = store.leads.findIndex((l) => l.id === leadId);
  if (leadIndex === -1) throw new Error('Lead not found');

  const now = new Date().toISOString();
  store.leads[leadIndex] = {
    ...store.leads[leadIndex],
    ...updates,
    lastActivityAt: now,
  };

  store.leads[leadIndex].history.unshift({
    id: `h_${Date.now()}`,
    timestamp: now,
    action: 'Lead Details Updated',
    details: 'Manual update to CRM fields/status.',
    actor: 'CRM User',
  });

  await saveDripStore(store, [store.leads[leadIndex]]);
  return store.leads[leadIndex];
}

// Batch automated drip processor: runs every interval or when triggered
export async function processDripBatch(virtualDaysToAdvance: number = 0): Promise<{
  processedCount: number;
  emailsSent: number;
  callsAssigned: number;
  updatedLeads: Lead[];
}> {
  const store = await getDripStore();
  const now = new Date();
  if (virtualDaysToAdvance > 0) {
    store.virtualOffsetDays += virtualDaysToAdvance;
  }

  // Current effective time including virtual offset
  const effectiveNow = new Date(now.getTime() + store.virtualOffsetDays * 24 * 60 * 60 * 1000);
  let emailsSent = 0;
  let callsAssigned = 0;
  let processedCount = 0;
  const updatedLeads: Lead[] = [];

  for (const lead of store.leads) {
    if (!lead.isDripActive || !lead.nextActionDueAt) continue;

    const dueDate = new Date(lead.nextActionDueAt);
    if (effectiveNow >= dueDate) {
      processedCount++;

      if (lead.status === 'new_lead') {
        // Send 1st mail
        const t1 = store.templates.find((t) => t.step === 1) || CAMPAIGN_TEMPLATES[0];
        const { subject, body } = renderEmailTemplate(t1, lead, 'Rajesh Lahoti');
        lead.emailLogs.unshift({
          id: `em_${Date.now()}_${emailsSent}`,
          step: 1,
          subject,
          body,
          sentAt: effectiveNow.toISOString(),
          sender: 'Rajesh Lahoti (Lahoti Overseas)',
          recipient: lead.initialEmail,
          status: 'sent',
        });
        lead.status = 'mail_1_sent';
        lead.currentStep = 1;
        lead.lastActivityAt = effectiveNow.toISOString();
        lead.nextActionDueAt = addDaysToIso(effectiveNow.toISOString(), 4);
        lead.history.unshift({
          id: `h_${Date.now()}_${processedCount}`,
          timestamp: effectiveNow.toISOString(),
          action: '1st Mail Sent (Batch Processor)',
          details: `Subject: "${subject}". 2nd mail scheduled in 4 days.`,
          actor: 'Drip Scheduler',
        });
        emailsSent++;
        updatedLeads.push(lead);
      } else if (lead.status === 'mail_1_sent') {
        // 4 days passed with no reply -> Send 2nd mail
        const t2 = store.templates.find((t) => t.step === 2) || CAMPAIGN_TEMPLATES[1];
        const { subject, body } = renderEmailTemplate(t2, lead, 'Rajesh Lahoti');
        lead.emailLogs.unshift({
          id: `em_${Date.now()}_${emailsSent}`,
          step: 2,
          subject,
          body,
          sentAt: effectiveNow.toISOString(),
          sender: 'Rajesh Lahoti (Lahoti Overseas)',
          recipient: lead.crmFields.directEmailId || lead.initialEmail,
          status: 'sent',
        });
        lead.status = 'mail_2_sent';
        lead.currentStep = 2;
        lead.lastActivityAt = effectiveNow.toISOString();
        lead.nextActionDueAt = addDaysToIso(effectiveNow.toISOString(), 4);
        lead.history.unshift({
          id: `h_${Date.now()}_${processedCount}`,
          timestamp: effectiveNow.toISOString(),
          action: '2nd Mail Sent (4-Day Trigger)',
          details: `No reply after 4 days. Dispatched follow-up email 2: "${subject}".`,
          actor: 'Drip Scheduler',
        });
        emailsSent++;
        updatedLeads.push(lead);
      } else if (lead.status === 'mail_2_sent') {
        // 4 more days passed with no reply -> Send 3rd mail
        const t3 = store.templates.find((t) => t.step === 3) || CAMPAIGN_TEMPLATES[2];
        const { subject, body } = renderEmailTemplate(t3, lead, 'Rajesh Lahoti');
        lead.emailLogs.unshift({
          id: `em_${Date.now()}_${emailsSent}`,
          step: 3,
          subject,
          body,
          sentAt: effectiveNow.toISOString(),
          sender: 'Rajesh Lahoti (Lahoti Overseas)',
          recipient: lead.crmFields.directEmailId || lead.initialEmail,
          status: 'sent',
        });
        lead.status = 'mail_3_sent';
        lead.currentStep = 3;
        lead.lastActivityAt = effectiveNow.toISOString();
        lead.nextActionDueAt = addDaysToIso(effectiveNow.toISOString(), 4);
        lead.history.unshift({
          id: `h_${Date.now()}_${processedCount}`,
          timestamp: effectiveNow.toISOString(),
          action: '3rd Mail Sent (4-Day Trigger)',
          details: `No reply after 4 days. Dispatched 3rd supply chain email: "${subject}".`,
          actor: 'Drip Scheduler',
        });
        emailsSent++;
        updatedLeads.push(lead);
      } else if (lead.status === 'mail_3_sent') {
        // 4 more days passed after 3rd mail with no reply -> Trigger Phone Call Step
        lead.status = 'call_pending_1';
        lead.currentStep = 4;
        lead.lastActivityAt = effectiveNow.toISOString();
        lead.nextActionDueAt = null;
        lead.history.unshift({
          id: `h_${Date.now()}_${processedCount}`,
          timestamp: effectiveNow.toISOString(),
          action: 'Assigned to Sales Person for Calling',
          details: 'Drip sequence completed (3 emails unreplied). Rule: Sales rep must call prospect. 2 failed attempts will mark Not Reachable.',
          actor: 'Drip Scheduler',
        });
        callsAssigned++;
        updatedLeads.push(lead);
      }
    }
  }

  store.lastBatchRunAt = effectiveNow.toISOString();
  await saveDripStore(store, updatedLeads);

  return {
    processedCount,
    emailsSent,
    callsAssigned,
    updatedLeads,
  };
}
