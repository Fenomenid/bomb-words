import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { GameError, RoomManager } from "./roomManager.js";
import { RoomStore } from "./roomStore.js";
import type { Room } from "./types.js";

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? (process.env.NODE_ENV === "production" ? "*" : "http://localhost:5173");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.resolve(__dirname, "../../client/dist");

const app = express();
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", CLIENT_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(clientDistPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDistPath, "index.html"));
  });
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
  },
});

const rooms = new RoomManager();
const roomStore = new RoomStore();
const timers = new Map<string, NodeJS.Timeout>();
const reconnectTimers = new Map<string, NodeJS.Timeout>();
const RECONNECT_GRACE_MS = 5 * 60_000;

io.on("connection", (socket) => {
  socket.on("room:create", ({ playerName }: { playerName: string }) => {
    handle(socket.id, () => {
      const room = rooms.createRoom(socket.id, playerName);
      socket.join(room.id);
      emitRoom(room);
    });
  });

  socket.on("room:join", ({ roomId, playerName }: { roomId: string; playerName: string }) => {
    handle(socket.id, async () => {
      await ensureRoomLoaded(roomId);
      const room = rooms.joinRoom(socket.id, roomId, playerName);
      clearReconnectTimer(room.id, socket.id);
      socket.join(room.id);
      emitRoom(room);
    });
  });

  socket.on("room:heartbeat", ({ roomId }: { roomId: string }) => {
    if (rooms.getRoomIdForSocket(socket.id) === roomId) {
      socket.emit("room:heartbeat", { ok: true, at: Date.now() });
    }
  });

  socket.on("game:start", ({ roomId }: { roomId: string }) => {
    handle(socket.id, async () => {
      await ensureRoomLoaded(roomId);
      const room = rooms.startGame(roomId, socket.id);
      schedulePhaseTimer(room);
      emitRoom(room);
    });
  });

  socket.on("settings:update", ({ roomId, settings }: { roomId: string; settings: Partial<Room["settings"]> }) => {
    handle(socket.id, async () => {
      await ensureRoomLoaded(roomId);
      emitRoom(rooms.updateSettings(roomId, socket.id, settings));
    });
  });

  socket.on("settings:customWords", ({ roomId, wordsText }: { roomId: string; wordsText: string }) => {
    handle(socket.id, async () => {
      await ensureRoomLoaded(roomId);
      emitRoom(rooms.updateCustomWords(roomId, socket.id, wordsText));
    });
  });

  socket.on("player:kick", ({ roomId, playerId }: { roomId: string; playerId: string }) => {
    handle(socket.id, async () => {
      await ensureRoomLoaded(roomId);
      const room = rooms.kickPlayer(roomId, socket.id, playerId);
      clearReconnectTimer(room.id, playerId);
      io.to(playerId).emit("kicked", { message: "Хост удалил вас из комнаты" });
      const kickedSocket = io.sockets.sockets.get(playerId);
      kickedSocket?.leave(room.id);
      schedulePhaseTimer(room);
      emitRoom(room);
    });
  });

  socket.on("mine:add", ({ roomId, word }: { roomId: string; word: string }) => {
    handle(socket.id, async () => {
      await ensureRoomLoaded(roomId);
      emitRoom(rooms.addMine(roomId, socket.id, word));
    });
  });

  socket.on("mine:update", ({ roomId, oldWord, newWord }: { roomId: string; oldWord: string; newWord: string }) => {
    handle(socket.id, async () => {
      await ensureRoomLoaded(roomId);
      emitRoom(rooms.updateMine(roomId, socket.id, oldWord, newWord));
    });
  });

  socket.on("round:start", ({ roomId }: { roomId: string }) => {
    handle(socket.id, async () => {
      await ensureRoomLoaded(roomId);
      const room = rooms.startExplaining(roomId, socket.id);
      schedulePhaseTimer(room);
      emitRoom(room);
    });
  });

  socket.on("round:success", ({ roomId }: { roomId: string }) => {
    handle(socket.id, async () => {
      await ensureRoomLoaded(roomId);
      clearRoundTimer(roomId);
      const room = rooms.completeSuccess(roomId, socket.id);
      schedulePhaseTimer(room);
      emitRoom(room);
    });
  });

  socket.on("round:mine", ({ roomId, mineWord, triggered }: { roomId: string; mineWord: string; triggered?: boolean }) => {
    handle(socket.id, async () => {
      await ensureRoomLoaded(roomId);
      emitRoom(rooms.triggerMine(roomId, socket.id, mineWord, triggered !== false));
    });
  });

  socket.on("round:skip", ({ roomId }: { roomId: string }) => {
    handle(socket.id, async () => {
      await ensureRoomLoaded(roomId);
      clearRoundTimer(roomId);
      const room = rooms.skipRound(roomId, socket.id);
      schedulePhaseTimer(room);
      emitRoom(room);
    });
  });

  socket.on("round:next", ({ roomId }: { roomId: string }) => {
    handle(socket.id, async () => {
      await ensureRoomLoaded(roomId);
      clearRoundTimer(roomId);
      const room = rooms.nextRound(roomId, socket.id);
      schedulePhaseTimer(room);
      emitRoom(room);
    });
  });

  socket.on("game:reset", ({ roomId }: { roomId: string }) => {
    handle(socket.id, async () => {
      await ensureRoomLoaded(roomId);
      clearRoundTimer(roomId);
      emitRoom(rooms.resetGame(roomId, socket.id));
    });
  });

  socket.on("timer:pause", ({ roomId }: { roomId: string }) => {
    handle(socket.id, async () => {
      await ensureRoomLoaded(roomId);
      clearRoundTimer(roomId);
      emitRoom(rooms.pauseTimer(roomId, socket.id));
    });
  });

  socket.on("timer:resume", ({ roomId }: { roomId: string }) => {
    handle(socket.id, async () => {
      await ensureRoomLoaded(roomId);
      const room = rooms.resumeTimer(roomId, socket.id);
      schedulePhaseTimer(room);
      emitRoom(room);
    });
  });

  socket.on("disconnect", () => {
    const previousRoomId = rooms.getRoomIdForSocket(socket.id);
    const result = rooms.leaveBySocket(socket.id);
    if (previousRoomId && result.disconnectedPlayerId) {
      scheduleReconnectCleanup(previousRoomId, result.disconnectedPlayerId);
    }
    if (result.room) {
      if (rooms.isTimerPaused(result.room)) {
        clearRoundTimer(result.room.id);
      }
      schedulePhaseTimer(result.room);
      emitRoom(result.room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  void restorePersistedRooms();
});

async function handle(socketId: string, callback: () => void | Promise<void>): Promise<void> {
  try {
    await callback();
  } catch (error) {
    const message = error instanceof GameError ? error.message : "Ошибка сервера";
    io.to(socketId).emit("error", { message });
  }
}

function emitRoom(room: Room): void {
  void persistRoom(room);
  for (const player of room.players) {
    if (!player.isConnected) {
      continue;
    }
    io.to(player.id).emit("room", rooms.getSnapshot(room, player.id, publicClientOrigin()));
  }
  emitTimer(room);
}

function emitTimer(room: Room): void {
  const remainingMs = rooms.getTimerRemainingMs(room);
  if (remainingMs === undefined) {
    return;
  }

  io.to(room.id).emit("timer", {
    roomId: room.id,
    phase: room.phase,
    remainingMs,
    isPaused: rooms.isTimerPaused(room),
  });
}

function publicClientOrigin(): string | undefined {
  if (process.env.PUBLIC_CLIENT_ORIGIN) {
    return process.env.PUBLIC_CLIENT_ORIGIN;
  }
  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:5173";
  }
  return undefined;
}

function schedulePhaseTimer(room: Room): void {
  clearRoundTimer(room.id);
  const delayMs = rooms.getTimerDelayMs(room);
  if (delayMs === undefined) {
    return;
  }

  timers.set(
    room.id,
    setTimeout(() => {
      try {
        const nextRoom = rooms.handleTimerElapsed(room.id);
        schedulePhaseTimer(nextRoom);
        emitRoom(nextRoom);
      } catch {
        clearRoundTimer(room.id);
      }
    }, delayMs),
  );
  emitTimer(room);
}

async function ensureRoomLoaded(roomId: string): Promise<void> {
  if (rooms.hasRoom(roomId)) {
    return;
  }

  const persistedRoom = await roomStore.getRoom(roomId);
  if (!persistedRoom) {
    return;
  }

  const room = rooms.importRoom(persistedRoom, { markPlayersDisconnected: true });
  schedulePhaseTimer(room);
}

async function restorePersistedRooms(): Promise<void> {
  if (!roomStore.enabled) {
    console.log("Room persistence disabled: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is not set");
    return;
  }

  try {
    const persistedRooms = await roomStore.listRooms();
    for (const persistedRoom of persistedRooms) {
      const room = rooms.importRoom(persistedRoom, { markPlayersDisconnected: true });
      schedulePhaseTimer(room);
    }
    console.log(`Restored ${persistedRooms.length} rooms from Redis`);
  } catch (error) {
    console.error("Failed to restore rooms from Redis", error);
  }
}

async function persistRoom(room: Room): Promise<void> {
  try {
    await roomStore.saveRoom(room);
  } catch (error) {
    console.error(`Failed to persist room ${room.id}`, error);
  }
}

function clearRoundTimer(roomId: string): void {
  const timer = timers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(roomId);
  }
}

function scheduleReconnectCleanup(roomId: string, playerId: string): void {
  clearReconnectTimer(roomId, playerId);
  reconnectTimers.set(
    reconnectTimerKey(roomId, playerId),
    setTimeout(() => {
      const result = rooms.removeDisconnectedPlayer(roomId, playerId);
      reconnectTimers.delete(reconnectTimerKey(roomId, playerId));
      if (result.room) {
        schedulePhaseTimer(result.room);
        emitRoom(result.room);
      }
    }, RECONNECT_GRACE_MS),
  );
}

function clearReconnectTimer(roomId: string, playerId: string): void {
  const key = reconnectTimerKey(roomId, playerId);
  const timer = reconnectTimers.get(key);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  reconnectTimers.delete(key);
}

function reconnectTimerKey(roomId: string, playerId: string): string {
  return `${roomId}:${playerId}`;
}
