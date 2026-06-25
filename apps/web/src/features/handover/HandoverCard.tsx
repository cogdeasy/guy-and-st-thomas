import { useState, type ReactNode } from 'react';
import { useApiMutation } from '@trustos/api-client';
import { ageFromBirthDate } from '@trustos/core';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  news2Tone,
  type BadgeTone,
} from '@trustos/ui';
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import type { HandoverEntry, HandoverPriority, HandoverShift, HandoverStatus } from './types';

const PRIORITY_TONE: Record<HandoverPriority, BadgeTone> = {
  high: 'danger',
  urgent: 'warning',
  routine: 'neutral',
};

const PRIORITY_LABEL: Record<HandoverPriority, string> = {
  high: 'High priority',
  urgent: 'Urgent',
  routine: 'Routine',
};

interface UpdatePayload {
  id: string;
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
  priority: HandoverPriority;
  shift: HandoverShift;
  status: HandoverStatus;
}

export function HandoverCard({ entry }: { entry: HandoverEntry }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);

  const patient = entry.patient;
  const name = patient?.name?.[0];
  const fullName = `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim() || 'Unknown patient';
  const nhs = patient?.identifier?.find((i) => i.system?.includes('nhs-number'))?.value;

  return (
    <Card className={entry.status === 'handed-over' ? 'opacity-70' : undefined}>
      <CardHeader className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center gap-3 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          )}
          <div>
            <div className="font-semibold text-slate-900">{fullName}</div>
            <div className="text-xs text-slate-400">
              {patient ? `${ageFromBirthDate(patient.birthDate)}y · ${patient.gender}` : '—'}
              {nhs ? ` · NHS ${nhs}` : ''}
              {entry.specialty ? ` · ${entry.specialty}` : ''}
            </div>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {entry.news2 && (
            <Badge tone={news2Tone(entry.news2.risk)} title={`NEWS2 (${entry.news2.risk} risk)`}>
              NEWS2 {entry.news2.score}
            </Badge>
          )}
          <Badge tone={PRIORITY_TONE[entry.priority]}>{PRIORITY_LABEL[entry.priority]}</Badge>
          <Badge tone="info" className="capitalize">
            {entry.shift}
          </Badge>
          {entry.status === 'handed-over' && <Badge tone="success">Handed over</Badge>}
        </div>
      </CardHeader>

      {expanded && (
        <CardBody>
          {editing ? (
            <EditForm entry={entry} onDone={() => setEditing(false)} />
          ) : (
            <div className="space-y-3">
              <Sbar label="S" title="Situation" text={entry.situation} />
              <Sbar label="B" title="Background" text={entry.background} />
              <Sbar label="A" title="Assessment" text={entry.assessment} />
              <Sbar label="R" title="Recommendation" text={entry.recommendation} />
              <div className="flex items-center justify-between pt-1">
                <div className="text-xs text-slate-400">
                  {entry.author?.name?.[0]
                    ? `Handed over by ${entry.author.name[0].prefix?.join(' ') ?? ''} ${entry.author.name[0].given?.join(' ') ?? ''} ${entry.author.name[0].family ?? ''}`.trim()
                    : 'Author not recorded'}
                  {' · '}updated {new Date(entry.updatedAt).toLocaleString('en-GB')}
                </div>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      )}
    </Card>
  );
}

function Sbar({ label, title, text }: { label: string; title: string; text: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-nhs-blue text-sm font-bold text-white">
        {label}
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
        <p className="text-sm text-slate-700">{text}</p>
      </div>
    </div>
  );
}

function EditForm({ entry, onDone }: { entry: HandoverEntry; onDone: () => void }) {
  const [form, setForm] = useState({
    situation: entry.situation,
    background: entry.background,
    assessment: entry.assessment,
    recommendation: entry.recommendation,
    priority: entry.priority,
    shift: entry.shift,
    status: entry.status,
  });

  const mutation = useApiMutation<UpdatePayload, HandoverEntry>(
    'PUT',
    (body) => `/api/handover/entries/${body.id}`,
  );

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = () => {
    mutation.mutate({ id: entry.id, ...form }, { onSuccess: onDone });
  };

  return (
    <div className="space-y-3">
      <Field label="Situation">
        <textarea
          className={textareaClass}
          rows={2}
          value={form.situation}
          onChange={(e) => set({ situation: e.target.value })}
        />
      </Field>
      <Field label="Background">
        <textarea
          className={textareaClass}
          rows={2}
          value={form.background}
          onChange={(e) => set({ background: e.target.value })}
        />
      </Field>
      <Field label="Assessment">
        <textarea
          className={textareaClass}
          rows={2}
          value={form.assessment}
          onChange={(e) => set({ assessment: e.target.value })}
        />
      </Field>
      <Field label="Recommendation">
        <textarea
          className={textareaClass}
          rows={2}
          value={form.recommendation}
          onChange={(e) => set({ recommendation: e.target.value })}
        />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Priority">
          <select
            className={selectClass}
            value={form.priority}
            onChange={(e) => set({ priority: e.target.value as HandoverPriority })}
          >
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
            <option value="routine">Routine</option>
          </select>
        </Field>
        <Field label="Shift">
          <select
            className={selectClass}
            value={form.shift}
            onChange={(e) => set({ shift: e.target.value as HandoverShift })}
          >
            <option value="day">Day</option>
            <option value="night">Night</option>
          </select>
        </Field>
        <Field label="Status">
          <select
            className={selectClass}
            value={form.status}
            onChange={(e) => set({ status: e.target.value as HandoverStatus })}
          >
            <option value="active">Active</option>
            <option value="handed-over">Handed over</option>
          </select>
        </Field>
      </div>

      {mutation.isError && (
        <p className="text-sm text-nhs-red">Failed to save handover entry. Please try again.</p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button onClick={save} disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save handover'}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

const textareaClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none';
const selectClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none';
