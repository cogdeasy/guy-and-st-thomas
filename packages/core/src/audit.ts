/** Information Governance audit trail event — every PHI access should log one. */
export interface AuditEvent {
  id: string;
  timestamp: string;
  actor: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'search' | 'login' | 'access-denied';
  resourceType?: string;
  resourceId?: string;
  patientId?: string;
  module?: string;
  outcome: 'success' | 'failure';
  detail?: string;
}

export type AuditSink = (event: AuditEvent) => void;
