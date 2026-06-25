import { useState } from 'react';
import { useApiMutation, useApiQuery } from '@trustos/api-client';
import { Button, EmptyState, PageHeader, Spinner, Stat } from '@trustos/ui';
import { RefreshCw } from 'lucide-react';
import { HandoverCard } from './HandoverCard';
import type { HandoverList, HandoverShift } from './types';

type ShiftFilter = 'all' | HandoverShift;

export function HandoverBoardPage() {
  const [shift, setShift] = useState<ShiftFilter>('all');
  const query = shift === 'all' ? '' : `?shift=${shift}`;
  const { data, isLoading, refetch } = useApiQuery<HandoverList>(`/api/handover/list${query}`);

  const generate = useApiMutation<{ shift: HandoverShift }, { generated: number }>(
    'POST',
    () => '/api/handover/generate',
  );

  const onGenerate = () => {
    generate.mutate({ shift: shift === 'night' ? 'night' : 'day' }, { onSuccess: () => refetch() });
  };

  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Clinical Handover (SBAR)"
        description="Prioritised shift handover board for admitted patients, ranked by NEWS2."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-slate-300 text-sm">
              {(['all', 'day', 'night'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setShift(s)}
                  className={
                    'px-3 py-2 capitalize transition-colors ' +
                    (shift === s ? 'bg-nhs-blue text-white' : 'bg-white text-slate-600 hover:bg-slate-50')
                  }
                >
                  {s === 'all' ? 'All shifts' : s}
                </button>
              ))}
            </div>
            <Button onClick={onGenerate} disabled={generate.isPending}>
              <RefreshCw className={'h-4 w-4 ' + (generate.isPending ? 'animate-spin' : '')} />
              {generate.isPending ? 'Generating…' : 'Generate from NEWS2'}
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="On handover" value={data?.total ?? 0} hint="Active SBAR entries" />
        <Stat label="High priority" value={data?.counts.high ?? 0} tone="danger" hint="NEWS2 high risk" />
        <Stat label="Urgent" value={data?.counts.urgent ?? 0} tone="warning" hint="NEWS2 medium risk" />
        <Stat label="Routine" value={data?.counts.routine ?? 0} tone="success" hint="Stable" />
      </div>

      {generate.isError && (
        <p className="mb-4 text-sm text-nhs-red">
          Couldn't generate handover entries — there may be no admitted patients.
        </p>
      )}

      {isLoading ? (
        <Spinner className="m-10" />
      ) : items.length === 0 ? (
        <EmptyState
          title="No handover entries"
          description="Generate entries from the latest NEWS2 for all admitted patients to start the board."
        />
      ) : (
        <div className="space-y-3">
          {items.map((entry) => (
            <HandoverCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
