import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApiMutation, useApiQuery, useResourceList } from '@trustos/api-client';
import { ref } from '@trustos/core';
import type { Encounter, Practitioner } from '@trustos/ontology';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Spinner,
} from '@trustos/ui';
import {
  NOTE_TYPES,
  NOTE_TYPE_LABELS,
  type ClinicalNoteType,
  type PatientNotesResponse,
  formatWhen,
  noteTone,
} from './types';

export function PatientNotesPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const { data, isLoading } = useApiQuery<PatientNotesResponse>(
    patientId ? `/api/documentation/${patientId}/notes` : null,
  );

  const practitioners = useResourceList('Practitioner');
  const encounters = useResourceList('Encounter');

  const activeEncounter = useMemo(() => {
    if (!patientId) return undefined;
    const patientRef = ref('Patient', patientId);
    return (encounters.data ?? []).find(
      (e: Encounter) => e.subject?.reference === patientRef && e.status === 'in-progress',
    );
  }, [encounters.data, patientId]);

  const [type, setType] = useState<ClinicalNoteType>('ward-round');
  const [authorId, setAuthorId] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createNote = useApiMutation<Record<string, unknown>>('POST', () => '/api/documentation/notes');

  const submit = () => {
    setError(null);
    if (!patientId) return;
    if (!authorId) {
      setError('Select an authoring clinician.');
      return;
    }
    if (!body.trim()) {
      setError('Note body cannot be empty.');
      return;
    }
    createNote.mutate(
      {
        patientId,
        authorId,
        type,
        body: body.trim(),
        encounterId: activeEncounter?.id,
      },
      {
        onSuccess: () => setBody(''),
        onError: (e: Error) => setError(e.message),
      },
    );
  };

  if (isLoading || !data) return <Spinner className="m-10" />;

  return (
    <div>
      <Link to="/documentation" className="text-sm text-nhs-blue hover:underline">
        ← Back to Clinical Documentation
      </Link>

      <div className="mt-3">
        <PageHeader
          title={data.patientName}
          description={`${data.total} note${data.total === 1 ? '' : 's'} on file${
            activeEncounter ? ' · active inpatient admission' : ''
          }`}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Notes timeline */}
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Notes timeline</h2>
          {data.notes.length === 0 ? (
            <EmptyState title="No notes yet" description="Add the first clinical note using the form." />
          ) : (
            <ol className="relative space-y-4 border-l-2 border-slate-200 pl-6">
              {data.notes.map((note) => (
                <li key={note.id} className="relative">
                  <span className="absolute -left-[31px] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-nhs-blue" />
                  <Card>
                    <CardHeader className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge tone={noteTone(note.type)}>{NOTE_TYPE_LABELS[note.type]}</Badge>
                        <span className="text-sm font-medium text-slate-700">{note.authorName}</span>
                        {note.authorRole && <span className="text-xs text-slate-400">{note.authorRole}</span>}
                      </div>
                      <span className="text-xs text-slate-400">{formatWhen(note.createdAt)}</span>
                    </CardHeader>
                    <CardBody>
                      <p className="whitespace-pre-line text-sm text-slate-700">{note.body}</p>
                    </CardBody>
                  </Card>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Compose note */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Add a note</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Note type</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as ClinicalNoteType)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
                >
                  {NOTE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {NOTE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Author</label>
                <select
                  value={authorId}
                  onChange={(e) => setAuthorId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
                >
                  <option value="">Select clinician…</option>
                  {(practitioners.data ?? []).map((p: Practitioner) => (
                    <option key={p.id} value={p.id}>
                      {[p.name?.[0]?.prefix?.join(' '), p.name?.[0]?.given?.join(' '), p.name?.[0]?.family]
                        .filter(Boolean)
                        .join(' ')}
                      {p.role ? ` (${p.role})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Note</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={6}
                  placeholder="Document the ward round, assessment and plan…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
                />
              </div>

              {activeEncounter && (
                <p className="text-xs text-slate-400">
                  Will be linked to the active admission ({activeEncounter.id}).
                </p>
              )}

              {error && <p className="text-xs text-nhs-red">{error}</p>}

              <Button onClick={submit} disabled={createNote.isPending} className="w-full">
                {createNote.isPending ? 'Saving…' : 'Save note'}
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
