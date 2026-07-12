export type EventLogStatus = "PENDING" | "PROCESSED" | "FAILED" | "SKIPPED";

export type EventLogRecord = {
  eventId: string;
  status: EventLogStatus;
  processedAt: Date | null;
};

export interface EventLogPort {
  createIfNotExists(data: {
    eventId: string;
    source: string;
    eventType: string;
    payload: object;
  }): Promise<{ created: boolean; status: EventLogStatus | null }>;
  findStatus(eventId: string): Promise<EventLogStatus | null>;
  markProcessed(eventId: string): Promise<void>;
  markFailed(eventId: string): Promise<void>;
  resetToPending(eventId: string): Promise<void>;
}
