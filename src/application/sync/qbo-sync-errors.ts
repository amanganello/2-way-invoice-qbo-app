import { ExternalServiceError } from "@/shared/errors/app-error.js";

export class QboSyncError extends ExternalServiceError {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class QboDuplicateDocumentError extends QboSyncError {
  constructor(message = "QBO duplicate document number") {
    super(message);
  }
}

export class QboStaleObjectError extends QboSyncError {
  constructor(message = "QBO stale object") {
    super(message);
  }
}

export class QboAlreadyVoidedError extends QboSyncError {
  constructor(message = "QBO invoice already voided") {
    super(message);
  }
}

export class QboRateLimitedError extends QboSyncError {
  constructor(
    public readonly retryAfterSeconds: string,
    message = `QBO rate limited; retry after ${retryAfterSeconds}s`
  ) {
    super(message);
  }
}
