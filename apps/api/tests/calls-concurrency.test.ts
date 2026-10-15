import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  memberFindMany: vi.fn(),
  callHistoryCreate: vi.fn(),
  callHistoryUpdateMany: vi.fn(),
}));

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    conversationMember: {
      findMany: mocks.memberFindMany,
    },
    callHistory: {
      create: mocks.callHistoryCreate,
      updateMany: mocks.callHistoryUpdateMany,
    },
  },
}));

import { registerCallHandlers } from "../src/lib/calls.js";

function createHarness(userId: string, onlineUsers: string[]) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const emitted: Array<{ room: string; event: string; payload: unknown }> = [];

  const socket = {
    data: { userId },
    on: vi.fn((event: string, handler: (...args: any[]) => any) => {
      handlers.set(event, handler);
    }),
  };

  const io = {
    sockets: {
      adapter: {
        rooms: new Map(
          onlineUsers.map((id) => [`user:${id}`, new Set([`socket:${id}`])]),
        ),
      },
    },
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ room, event, payload });
      },
    }),
  };

  registerCallHandlers(io as any, socket as any);

  return { handlers, emitted };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("Call concurrency", () => {
  it("allows only one simultaneous call reservation for the same user", async () => {
    const userA = "11111111-1111-4111-8111-111111111111";
    const userB = "22222222-2222-4222-8222-222222222222";
    const conversationId = "33333333-3333-4333-8333-333333333333";

    mocks.memberFindMany.mockResolvedValue([
      { userId: userA },
      { userId: userB },
    ]);

    let resolveCreate!: (value: unknown) => void;
    mocks.callHistoryCreate.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    const harness = createHarness(userA, [userA, userB]);
    const start = harness.handlers.get("call:start");

    expect(start).toBeDefined();

    const firstAck = vi.fn();
    const secondAck = vi.fn();

    const firstRequest = start!({ conversationId, type: "audio" }, firstAck);

    // Let the first request reserve both users before the DB resolves.
    await vi.waitFor(() => {
      expect(mocks.callHistoryCreate).toHaveBeenCalledTimes(1);
    });

    const secondRequest = start!({ conversationId, type: "video" }, secondAck);

    await secondRequest;

    expect(secondAck).toHaveBeenCalledWith({
      ok: false,
      error: "USER_BUSY",
    });

    resolveCreate({});
    await firstRequest;

    expect(firstAck).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, callId: expect.any(String) }),
    );
    expect(mocks.callHistoryCreate).toHaveBeenCalledTimes(1);
  });

  it("releases reservations if call history persistence fails", async () => {
    const userA = "44444444-4444-4444-8444-444444444444";
    const userB = "55555555-5555-4555-8555-555555555555";
    const conversationId = "66666666-6666-4666-8666-666666666666";

    mocks.memberFindMany.mockResolvedValue([
      { userId: userA },
      { userId: userB },
    ]);
    mocks.callHistoryCreate
      .mockRejectedValueOnce(new Error("DB unavailable"))
      .mockResolvedValueOnce({});

    const harness = createHarness(userA, [userA, userB]);
    const start = harness.handlers.get("call:start");

    const failedAck = vi.fn();
    await start!({ conversationId, type: "audio" }, failedAck);

    expect(failedAck).toHaveBeenCalledWith({
      ok: false,
      error: "INTERNAL_SERVER_ERROR",
    });

    const retryAck = vi.fn();
    await start!({ conversationId, type: "audio" }, retryAck);

    expect(retryAck).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, callId: expect.any(String) }),
    );
  });
});
