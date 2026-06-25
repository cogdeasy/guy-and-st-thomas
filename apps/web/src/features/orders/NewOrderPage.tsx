import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, FlaskConical, Plus, Trash2, X } from 'lucide-react';
import { useApiMutation, useApiQuery } from '@trustos/api-client';
import { ageFromBirthDate } from '@trustos/core';
import type { Patient } from '@trustos/ontology';
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
  type CatalogueItem,
  type CatalogueResponse,
  type OrderCategory,
  type OrderPriority,
} from './types';

const PRIORITIES: OrderPriority[] = ['routine', 'urgent', 'asap', 'stat'];

export function NewOrderPage() {
  const navigate = useNavigate();
  const [patientQuery, setPatientQuery] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [category, setCategory] = useState<OrderCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [basket, setBasket] = useState<CatalogueItem[]>([]);
  const [priority, setPriority] = useState<OrderPriority>('routine');
  const [clinicalDetails, setClinicalDetails] = useState('');
  const [placed, setPlaced] = useState(0);

  const cataloguePath = `/api/orders/catalogue?${new URLSearchParams({
    ...(category !== 'all' ? { category } : {}),
    ...(search ? { q: search } : {}),
  }).toString()}`;
  const catalogue = useApiQuery<CatalogueResponse>(cataloguePath);

  const patients = useApiQuery<{ patients: Patient[] }>(
    `/api/patients/search?q=${encodeURIComponent(patientQuery)}`,
  );

  const placeOrder = useApiMutation<
    { patientId: string; itemId: string; priority: OrderPriority; clinicalDetails?: string },
    { id: string }
  >('POST', () => '/api/orders/order');

  const basketIds = useMemo(() => new Set(basket.map((b) => b.id)), [basket]);

  const toggle = (item: CatalogueItem) => {
    setBasket((prev) =>
      prev.some((b) => b.id === item.id) ? prev.filter((b) => b.id !== item.id) : [...prev, item],
    );
  };

  const submit = async () => {
    if (!selectedPatient || basket.length === 0) return;
    for (const item of basket) {
      await placeOrder.mutateAsync({
        patientId: selectedPatient.id,
        itemId: item.id,
        priority,
        clinicalDetails: clinicalDetails.trim() || undefined,
      });
    }
    setPlaced(basket.length);
    setBasket([]);
    setClinicalDetails('');
    setTimeout(() => navigate('/orders'), 900);
  };

  const patientName = (p: Patient) =>
    `${p.name?.[0]?.given?.join(' ') ?? ''} ${p.name?.[0]?.family ?? ''}`.trim();

  return (
    <div>
      <Link to="/orders" className="text-sm text-nhs-blue hover:underline">
        ← Back to worklist
      </Link>
      <PageHeader
        title="New order"
        description="Build a basket from the coded order catalogue and submit against a patient."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Catalogue */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Order catalogue</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <CategoryTab active={category === 'all'} onClick={() => setCategory('all')} label="All" />
                {catalogue.data?.categories.map((c) => (
                  <CategoryTab
                    key={c.key}
                    active={category === c.key}
                    onClick={() => setCategory(c.key)}
                    label={c.label}
                  />
                ))}
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search orderables (e.g. troponin, CT, swab)"
                className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
              />

              {catalogue.isLoading && <Spinner />}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {catalogue.data?.items.map((item) => {
                  const inBasket = basketIds.has(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggle(item)}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        inBasket
                          ? 'border-nhs-blue bg-nhs-blue/5'
                          : 'border-slate-200 hover:border-nhs-blue/50 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-slate-800">{item.name}</span>
                        {inBasket ? (
                          <Check className="h-4 w-4 shrink-0 text-nhs-blue" />
                        ) : (
                          <Plus className="h-4 w-4 shrink-0 text-slate-300" />
                        )}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">{item.hint}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                        <Badge tone="neutral">{item.specimen ?? item.modality ?? 'Investigation'}</Badge>
                        <span>~{item.turnaroundHours}h TAT</span>
                        <span className="text-slate-300">·</span>
                        <span className="font-mono">{item.code}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              {!catalogue.isLoading && (catalogue.data?.items.length ?? 0) === 0 && (
                <EmptyState title="No orderables match your search" />
              )}
            </CardBody>
          </Card>
        </div>

        {/* Patient + basket */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Patient</CardTitle>
            </CardHeader>
            <CardBody>
              {selectedPatient ? (
                <div className="flex items-center justify-between rounded-lg bg-nhs-darkblue p-3 text-white">
                  <div>
                    <div className="font-semibold">{patientName(selectedPatient)}</div>
                    <div className="text-xs text-sky-200">
                      {selectedPatient.gender} · {ageFromBirthDate(selectedPatient.birthDate)}y ·{' '}
                      {selectedPatient.identifier?.[0]?.value}
                    </div>
                  </div>
                  <button type="button" onClick={() => setSelectedPatient(null)} aria-label="Clear patient">
                    <X className="h-4 w-4 text-sky-200 hover:text-white" />
                  </button>
                </div>
              ) : (
                <>
                  <input
                    value={patientQuery}
                    onChange={(e) => setPatientQuery(e.target.value)}
                    placeholder="Search name / NHS number / MRN"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
                  />
                  <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                    {patients.isLoading && <Spinner />}
                    {(patients.data?.patients ?? []).slice(0, 10).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedPatient(p)}
                        className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
                      >
                        <div className="font-medium text-slate-800">{patientName(p)}</div>
                        <div className="text-xs text-slate-400">
                          {p.gender} · {ageFromBirthDate(p.birthDate)}y · {p.identifier?.[0]?.value}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Order basket</CardTitle>
              <Badge tone="info">{basket.length}</Badge>
            </CardHeader>
            <CardBody className="space-y-4">
              {basket.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-slate-400">
                  <FlaskConical className="h-4 w-4" /> Select orderables from the catalogue.
                </p>
              ) : (
                <ul className="space-y-1">
                  {basket.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
                    >
                      <span className="text-slate-700">{item.name}</span>
                      <button type="button" onClick={() => toggle(item)} aria-label={`Remove ${item.name}`}>
                        <Trash2 className="h-4 w-4 text-slate-400 hover:text-nhs-red" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Priority
                </label>
                <div className="flex flex-wrap gap-2">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium uppercase transition-colors ${
                        priority === p
                          ? 'bg-nhs-blue text-white'
                          : 'border border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Clinical details
                </label>
                <textarea
                  value={clinicalDetails}
                  onChange={(e) => setClinicalDetails(e.target.value)}
                  rows={3}
                  placeholder="Relevant history / indication for request"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
                />
              </div>

              {placed > 0 && (
                <p className="rounded-lg bg-nhs-green/10 px-3 py-2 text-sm text-nhs-green">
                  {placed} order{placed > 1 ? 's' : ''} placed — opening worklist…
                </p>
              )}
              {placeOrder.isError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-nhs-red">
                  {placeOrder.error.message}
                </p>
              )}

              <Button
                className="w-full"
                disabled={!selectedPatient || basket.length === 0 || placeOrder.isPending}
                onClick={submit}
              >
                {placeOrder.isPending
                  ? 'Placing…'
                  : `Place ${basket.length || ''} order${basket.length === 1 ? '' : 's'}`}
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function CategoryTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active ? 'bg-nhs-blue text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  );
}
