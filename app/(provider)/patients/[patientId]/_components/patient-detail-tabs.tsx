'use client';

import { Activity, Stethoscope, Pill, BookOpen, FileText, User, FlaskConical, HeartPulse, MessageSquare } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type {
  VitalsChartPoint,
  SymptomEntry,
  ProviderNote,
  AlertRow,
} from '@/lib/dashboard/types';
import type { ProviderMessage } from '@/lib/messages/types';
import { MESSAGE_TEMPLATE_LABELS } from '@/lib/messages/constants';
import { VitalsChart } from './vitals-chart';
import { SymptomHistory } from './symptom-history';
import { MedicationSummary } from './medication-summary';
import { EducationSummary } from './education-summary';
import { ProviderNotes } from './provider-notes';
import { SendMessageForm } from './send-message-form';
import { PatientInfoTab } from './patient-info-tab';
import { LabResultsTab } from './lab-results-tab';
import { ComorbidityTab } from './comorbidity-tab';

interface PatientDetailTabsProps {
  patientId: string;
  vitals: VitalsChartPoint[];
  symptoms: SymptomEntry[];
  adherenceSummary: unknown;
  educationProgress: unknown;
  notes: ProviderNote[];
  messages: ProviderMessage[];
  openAlerts: AlertRow[];
  comorbidities: string[];
  patientInfo?: {
    patient_id?: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    patient_code: string | null;
    risk_tier: string | null;
    track_assignment: string | null;
    facility_tier: number | null;
    linked_at: string | null;
    ckm_stage: number | null;
  };
}

export function PatientDetailTabs({
  patientId,
  vitals,
  symptoms,
  adherenceSummary,
  educationProgress,
  notes,
  messages,
  comorbidities,
  patientInfo,
}: PatientDetailTabsProps) {
  return (
    <Tabs defaultValue="info">
      <TabsList className="min-h-12 w-full justify-start overflow-x-auto">
        <TabsTrigger value="info" className="min-h-11 gap-1.5 px-3">
          <User className="h-4 w-4" aria-hidden="true" />
          <span>Info</span>
        </TabsTrigger>
        <TabsTrigger value="vitals" className="min-h-11 gap-1.5 px-3">
          <Activity className="h-4 w-4" aria-hidden="true" />
          <span>Vitals</span>
        </TabsTrigger>
        <TabsTrigger value="symptoms" className="min-h-11 gap-1.5 px-3">
          <Stethoscope className="h-4 w-4" aria-hidden="true" />
          <span>Symptoms</span>
        </TabsTrigger>
        <TabsTrigger value="labs" className="min-h-11 gap-1.5 px-3">
          <FlaskConical className="h-4 w-4" aria-hidden="true" />
          <span>Labs</span>
        </TabsTrigger>
        <TabsTrigger value="medications" className="min-h-11 gap-1.5 px-3">
          <Pill className="h-4 w-4" aria-hidden="true" />
          <span>Medications</span>
        </TabsTrigger>
        <TabsTrigger value="education" className="min-h-11 gap-1.5 px-3">
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          <span>Education</span>
        </TabsTrigger>
        <TabsTrigger value="notes" className="min-h-11 gap-1.5 px-3">
          <FileText className="h-4 w-4" aria-hidden="true" />
          <span>Notes</span>
        </TabsTrigger>
        <TabsTrigger value="comorbidities" className="min-h-11 gap-1.5 px-3">
          <HeartPulse className="h-4 w-4" aria-hidden="true" />
          <span>Comorbidities</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="info" className="mt-4">
        <PatientInfoTab info={patientInfo} patientId={patientId} />
      </TabsContent>

      <TabsContent value="vitals" className="mt-4">
        <VitalsChart data={vitals} />
      </TabsContent>

      <TabsContent value="symptoms" className="mt-4">
        <SymptomHistory symptoms={symptoms} />
      </TabsContent>

      <TabsContent value="labs" className="mt-4">
        <LabResultsTab patientId={patientId} />
      </TabsContent>

      <TabsContent value="medications" className="mt-4">
        <MedicationSummary patientId={patientId} adherenceSummary={adherenceSummary} />
      </TabsContent>

      <TabsContent value="education" className="mt-4">
        <EducationSummary educationProgress={educationProgress} />
      </TabsContent>

      <TabsContent value="notes" className="mt-4">
        <div className="space-y-8">
          {/* Clinical notes */}
          <ProviderNotes patientId={patientId} notes={notes} />

          {/* Divider */}
          <hr className="border-gray-200" />

          {/* Send message form */}
          <SendMessageForm patientId={patientId} />

          {/* Message history */}
          {messages.length > 0 && (
            <div className="space-y-3" data-testid="messages-sent">
              <h3 className="text-sm font-medium text-gray-700">
                Messages Sent ({messages.length})
              </h3>
              {messages.map((msg) => {
                let relativeTime: string;
                try {
                  relativeTime = formatDistanceToNow(parseISO(msg.created_at), {
                    addSuffix: true,
                  });
                } catch {
                  relativeTime = msg.created_at;
                }

                let readReceipt: string;
                try {
                  readReceipt = msg.read_at
                    ? `Read ${formatDistanceToNow(parseISO(msg.read_at), { addSuffix: true })}`
                    : '';
                } catch {
                  readReceipt = msg.read_at ? `Read ${msg.read_at}` : '';
                }

                return (
                  <div
                    key={msg.id}
                    className="rounded-lg border border-gray-200 bg-white p-4"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">
                          {msg.subject}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                          <MessageSquare className="h-3 w-3" />
                          {MESSAGE_TEMPLATE_LABELS[msg.template_type]}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500 shrink-0 ml-2">
                        {relativeTime}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap mb-2">
                      {msg.body}
                    </p>
                    <div className="flex items-center justify-end">
                      {msg.read_at ? (
                        <span className="text-xs text-green-600">
                          {readReceipt}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          Unread
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="comorbidities" className="mt-4">
        <ComorbidityTab comorbidities={comorbidities} patientId={patientId} />
      </TabsContent>
    </Tabs>
  );
}
