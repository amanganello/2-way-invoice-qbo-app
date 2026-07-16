import { describe, it, expect, vi } from "vitest";
import { runSyncRecoveryScan, type SyncRecoveryScanDeps } from "@/application/sync/sync-recovery-scan.use-case.js";
import type { SyncLinkRecord } from "@/application/ports/sync.ports.js";

function makeLink(overrides: Partial<SyncLinkRecord> = {}): SyncLinkRecord {
  return {
    id: "sl-1", internalId: "inv-1", qboId: "qbo-1", qboSyncToken: null,
    qboUpdatedAt: null, internalUpdatedAt: new Date(), syncStatus: "PENDING",
    lastSyncedAt: null, lastSyncedSnapshot: null, version: 0,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

function makeDeps() {
  return {
    syncLinkRepo: {
      findStuckProcessing: vi.fn(async () => [makeLink({ id: "stuck", syncStatus: "PROCESSING" })]),
      setStatus: vi.fn(async () => makeLink()),
      findByStatuses: vi.fn(async () => [makeLink(), makeLink({ id: "sl-2", internalId: "inv-2" })]),
      findUnsynced: vi.fn(async () => []),
      findInvoicesWithoutSyncLink: vi.fn(async () => []),
    },
    enqueueReconcile: vi.fn(async () => {}),
  } satisfies SyncRecoveryScanDeps;
}

describe("runSyncRecoveryScan", () => {
  it("resets stuck PROCESSING records to ERROR (watchdog)", async () => {
    const deps = makeDeps();
    await runSyncRecoveryScan(deps);
    expect(deps.syncLinkRepo.setStatus).toHaveBeenCalledWith("stuck", 0, "ERROR", {});
  });

  it("enqueues reconcile for each PENDING|ERROR SyncLink", async () => {
    const deps = makeDeps();
    await runSyncRecoveryScan(deps);
    expect(deps.enqueueReconcile).toHaveBeenCalledTimes(2);
    expect(deps.enqueueReconcile).toHaveBeenCalledWith("inv-1");
    expect(deps.enqueueReconcile).toHaveBeenCalledWith("inv-2");
  });

  it("also enqueues unsynced records (lastSyncedAt IS NULL)", async () => {
    const deps = makeDeps();
    (deps.syncLinkRepo.findByStatuses as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (deps.syncLinkRepo.findUnsynced as ReturnType<typeof vi.fn>).mockResolvedValue([makeLink({ id: "new", internalId: "inv-new" })]);
    await runSyncRecoveryScan(deps);
    expect(deps.enqueueReconcile).toHaveBeenCalledWith("inv-new");
  });

  it("enqueues orphaned invoice (no SyncLink row at all)", async () => {
    const deps = makeDeps();
    (deps.syncLinkRepo.findByStatuses as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (deps.syncLinkRepo.findUnsynced as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (deps.syncLinkRepo.findInvoicesWithoutSyncLink as ReturnType<typeof vi.fn>).mockResolvedValue([
      { internalId: "inv-orphan" },
    ]);
    await runSyncRecoveryScan(deps);
    expect(deps.enqueueReconcile).toHaveBeenCalledWith("inv-orphan");
  });

  it("calls enqueueFailedPaymentRetries when provided", async () => {
    const retryFn = vi.fn(async () => {});
    const deps = { ...makeDeps(), enqueueFailedPaymentRetries: retryFn };
    await runSyncRecoveryScan(deps);
    expect(retryFn).toHaveBeenCalledOnce();
  });

  it("does not throw when enqueueFailedPaymentRetries is not provided", async () => {
    const deps = makeDeps();
    await expect(runSyncRecoveryScan(deps)).resolves.not.toThrow();
  });
});
