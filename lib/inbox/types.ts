export interface MessageDeliveryReceipt {
  id: string;
  patient_id: string;
  patient_name: string;
  subject: string;
  created_at: string;
  read_at: string | null;
  delivery_state: 'available' | 'read' | 'failed' | 'superseded' | 'unknown';
  available_at: string | null;
}
