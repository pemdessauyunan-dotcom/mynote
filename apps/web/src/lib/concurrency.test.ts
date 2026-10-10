/**
 * Unit tests for the pure concurrency/backoff helpers in @noteflow/shared.
 * These are the pieces of the sync engine that don't require the network
 * or Windows hardware, so they run in CI.
 */
import { describe, it, expect } from "vitest";
import {
  reconcileNote, backoffDelay, newStableId, type Note,
} from "@noteflow/shared";

function mkNote(patch: Partial<Note> = {}): Note {
  const now = new Date("2026-01-01T00:00:00Z").toISOString();
  return {
    id: "00000000-0000-0000-0000-000000000000",
    user_id: "00000000-0000-0000-0000-000000000001",
    category_id: null, title: "", content: "", color: "slate", priority: "normal",
    is_pinned: false, is_archived: false, sort_order: 0,
    due_at: null, reminder_at: null, version: 5,
    created_at: now, updated_at: now, deleted_at: null,
    ...patch,
  };
}

describe("reconcileNote", () => {
  it("returns kind=none when server is at expectedVersion", () => {
    const local = mkNote({ title: "mine" });
    const server = mkNote({ title: "server", version: 5 });
    const r = reconcileNote(local, server, 5, new Date().toISOString());
    expect(r.kind).toBe("none");
    expect(r.needsRetry).toBe(true);
  });

  it("server wins when nothing changed locally", () => {
    const local = mkNote({ title: "old" });
    const server = mkNote({ title: "newer", version: 7 });
    const r = reconcileNote(local, server, 5, new Date().toISOString());
    // Our model always considers local as "changed", so this branch returns
    // both_changed with local time earlier than server time -> server snapshot.
    expect(["server_newer","both_changed"]).toContain(r.kind);
    expect((r.resolved as Note).title).toBe("newer");
    expect(r.needsRetry).toBe(false);
  });

  it("local wins when local is newer and adopts server's version", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const local = mkNote({ title: "mine", updated_at: future });
    const server = mkNote({ title: "server", version: 9 });
    const r = reconcileNote(local, server, 5, future);
    expect(r.kind).toBe("both_changed");
    expect((r.resolved as Note).title).toBe("mine");
    expect((r.resolved as Note).version).toBe(9);
    expect(r.needsRetry).toBe(true);
  });

  it("detects deleted_on_server", () => {
    const local = mkNote({ title: "mine" });
    const r = reconcileNote(local, null, 5, new Date().toISOString());
    expect(r.kind).toBe("deleted_on_server");
    expect(r.needsRetry).toBe(false);
  });

  it("treats soft-deleted server row as deleted", () => {
    const local = mkNote();
    const server = mkNote({ deleted_at: new Date().toISOString() });
    const r = reconcileNote(local, server, 5, new Date().toISOString());
    expect(r.kind).toBe("deleted_on_server");
  });
});

describe("backoffDelay", () => {
  it("grows exponentially and is capped", () => {
    const a = backoffDelay(0, 500, 20_000);
    const b = backoffDelay(1, 500, 20_000);
    const c = backoffDelay(10, 500, 20_000);
    expect(a).toBeGreaterThanOrEqual(250); expect(a).toBeLessThanOrEqual(500);
    expect(b).toBeGreaterThanOrEqual(500); expect(b).toBeLessThanOrEqual(1000);
    expect(c).toBeLessThanOrEqual(20_000);
  });
});

describe("newStableId", () => {
  it("produces RFC-4122 v4 UUIDs", () => {
    for (let i = 0; i < 20; i++) {
      expect(newStableId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});
