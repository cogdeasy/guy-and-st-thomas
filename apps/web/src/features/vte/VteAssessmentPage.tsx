import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApiMutation, useApiQuery } from '@trustos/api-client';
import { ageFromBirthDate } from '@trustos/core';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
  Spinner,
} from '@trustos/ui';
import {
  patientName,
  prophylaxisLabel,
  type Prophylaxis,
  type VteAssessment,
  type VteCatalog,
  type Worklist,
  type WorklistItem,
} from './types';

interface AssessBody {
  encounterId: string;
  riskFactors: string[];
  bleedingRiskFactors: string[];
}

function recommend(riskFactors: string[], bleedingRiskFactors: string[]): Prophylaxis {
  if (riskFactors.length === 0) return 'none';
  return bleedingRiskFactors.length > 0 ? 'mechanical' : 'pharmacological';
}

function prophylaxisTone(p: Prophylaxis) {
  if (p === 'pharmacological') return 'info' as const;
  if (p === 'mechanical') return 'warning' as const;
  return 'neutral' as const;
}

export function VteAssessmentPage() {
  const { encounterId } = useParams<{ encounterId: string }>();
  const navigate = useNavigate();

  const catalog = useApiQuery<VteCatalog>('/api/vte/catalog');
  const worklist = useApiQuery<Worklist>('/api/vte/worklist');
  const item: WorklistItem | undefined = worklist.data?.items.find(
    (i) => i.encounterId === encounterId,
  );
  const existing: VteAssessment | null = item?.assessment ?? null;

  const [risk, setRisk] = useState<Set<string>>(new Set());
  const [bleeding, setBleeding] = useState<Set<string>>(new Set());

  // Pre-populate the form from any existing assessment once it loads.
  useEffect(() => {
    if (existing) {
      setRisk(new Set(existing.riskFactors));
      setBleeding(new Set(existing.bleedingRiskFactors));
    } else {
      setRisk(new Set());
      setBleeding(new Set());
    }
  }, [existing]);

  const mutation = useApiMutation<AssessBody, VteAssessment>('POST', () => '/api/vte/assess');

  const recommendation = useMemo(() => recommend([...risk], [...bleeding]), [risk, bleeding]);

  if (worklist.isLoading || catalog.isLoading) return <Spinner className="m-10" />;

  if (!item) {
    return (
      <div>
        <Link to="/vte" className="text-sm text-nhs-blue hover:underline">
          ← Back to VTE worklist
        </Link>
        <p className="mt-6 text-slate-600">This encounter is not on the current VTE worklist.</p>
      </div>
    );
  }

  const toggle = (set: Set<string>, update: (s: Set<string>) => void, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  };

  const submit = () => {
    if (!encounterId) return;
    mutation.mutate(
      { encounterId, riskFactors: [...risk], bleedingRiskFactors: [...bleeding] },
      { onSuccess: () => navigate('/vte') },
    );
  };

  return (
    <div>
      <Link to="/vte" className="text-sm text-nhs-blue hover:underline">
        ← Back to VTE worklist
      </Link>

      <div className="mt-3 rounded-xl bg-nhs-darkblue p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{patientName(item.patient)}</h1>
            <div className="mt-1 text-sm text-sky-200">
              {item.patient?.gender}
              {item.patient?.birthDate ? ` · ${ageFromBirthDate(item.patient.birthDate)}y` : ''}
              {item.patient?.identifier?.[0]?.value
                ? ` · NHS ${item.patient.identifier[0].value}`
                : ''}
              {item.specialty ? ` · ${item.specialty}` : ''}
            </div>
          </div>
          <div className="text-right">
            {item.overdue ? (
              <Badge tone="danger">Overdue</Badge>
            ) : item.assessed ? (
              <Badge tone="success">Assessed</Badge>
            ) : (
              <Badge tone="warning">Pending</Badge>
            )}
            {item.hoursSinceAdmission !== undefined && (
              <div className="mt-1 text-xs text-sky-200">
                {item.hoursSinceAdmission}h since admission
              </div>
            )}
          </div>
        </div>
      </div>

      <PageHeader title="" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Thrombosis risk factors</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {(catalog.data?.riskFactors ?? []).map((factor) => (
              <CheckRow
                key={factor}
                label={factor}
                checked={risk.has(factor)}
                onChange={() => toggle(risk, setRisk, factor)}
              />
            ))}
          </CardBody>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Bleeding risk factors</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {(catalog.data?.bleedingRiskFactors ?? []).map((factor) => (
              <CheckRow
                key={factor}
                label={factor}
                checked={bleeding.has(factor)}
                onChange={() => toggle(bleeding, setBleeding, factor)}
              />
            ))}
          </CardBody>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Recommendation</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              <div className="text-sm text-slate-500">Recommended prophylaxis</div>
              <Badge tone={prophylaxisTone(recommendation)} className="mt-1 text-base">
                {prophylaxisLabel(recommendation)}
              </Badge>
            </div>
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              {recommendation === 'pharmacological' &&
                'VTE risk present with no bleeding risk — offer pharmacological prophylaxis (e.g. LMWH).'}
              {recommendation === 'mechanical' &&
                'VTE risk present alongside bleeding risk — offer mechanical prophylaxis (e.g. anti-embolism stockings / IPC).'}
              {recommendation === 'none' &&
                'No thrombosis risk factors selected — pharmacological prophylaxis not indicated.'}
            </p>
            <div className="text-xs text-slate-400">
              {risk.size} risk · {bleeding.size} bleeding-risk factor(s) selected
            </div>
            {mutation.isError && (
              <p className="text-sm text-nhs-red">Failed to save assessment. Please try again.</p>
            )}
            <Button className="w-full" onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending
                ? 'Saving…'
                : existing
                  ? 'Update assessment'
                  : 'Record assessment'}
            </Button>
            {existing && (
              <div className="text-xs text-slate-400">
                Last assessed {new Date(existing.assessedAt).toLocaleString()}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-nhs-blue focus:ring-nhs-blue"
      />
      <span>{label}</span>
    </label>
  );
}
