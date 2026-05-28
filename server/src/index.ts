import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { GameError, RoomManager } from "./roomManager.js";
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
const timers = new Map<string, NodeJS.Timeout>();

io.on("connection", (socket) => {
  socket.on("room:create", ({ playerName }: { playerName: string }) => {
    handle(socket.id, () => {
      const room = rooms.createRoom(socket.id, playerName);
      socket.join(room.id);
      emitRoom(room);
    });
  });

  socket.on("room:join", ({ roomId, playerName }: { roomId: string; playerName: string }) => {
    handle(socket.id, () => {
      const room = rooms.joinRoom(socket.id, roomId, playerName);
      socket.join(room.id);
      emitRoom(room);
    });
  });

  socket.on("game:start", ({ roomId }: { roomId: string }) => {
    handle(socket.id, () => {
      const room = rooms.startGame(roomId, socket.id);
      schedulePhaseTimer(room);
      emitRoom(room);
    });
  });

  socket.on("settings:update", ({ roomId, settings }: { roomId: string; settings: Partial<Room["settings"]> }) => {
    handle(socket.id, () => emitRoom(rooms.updateSettings(roomId, socket.id, settings)));
  });

  socket.on("mine:add", ({ roomId, word }: { roomId: string; word: string }) => {
    handle(socket.id, () => emitRoom(rooms.addMine(roomId, socket.id, word)));
  });

  socket.on("round:start", ({ roomId }: { roomId: string }) => {
    handle(socket.id, () => {
      const room = rooms.startExplaining(roomId, socket.id);
      schedulePhaseTimer(room);
      emitRoom(room);
    });
  });

  socket.on("round:success", ({ roomId }: { roomId: string }) => {
    handle(socket.id, () => {
      clearRoundTimer(roomId);
      const room = rooms.completeSuccess(roomId, socket.id);
      schedulePhaseTimer(room);
      emitRoom(room);
    });
  });

  socket.on("round:mine", ({ roomId, mineWord }: { roomId: string; mineWord: string }) => {
    handle(socket.id, () => {
      emitRoom(rooms.triggerMine(roomId, socket.id, mineWord));
    });
  });

  socket.on("round:skip", ({ roomId }: { roomId: string }) => {
    handle(socket.id, () => {
      clearRoundTimer(roomId);
      const room = rooms.skipRound(roomId, socket.id);
      schedulePhaseTimer(room);
      emitRoom(room);
    });
  });

  socket.on("round:next", ({ roomId }: { roomId: string }) => {
    handle(socket.id, () => {
      clearRoundTimer(roomId);
      const room = rooms.nextRound(roomId, socket.id);
      schedulePhaseTimer(room);
      emitRoom(room);
    });
  });

  socket.on("game:reset", ({ roomId }: { roomId: string }) => {
    handle(socket.id, () => {
      clearRoundTimer(roomId);
      emitRoom(rooms.resetGame(roomId, socket.id));
    });
  });

  socket.on("timer:pause", ({ roomId }: { roomId: string }) => {
    handle(socket.id, () => {
      clearRoundTimer(roomId);
      emitRoom(rooms.pauseTimer(roomId, socket.id));
    });
  });

  socket.on("timer:resume", ({ roomId }: { roomId: string }) => {
    handle(socket.id, () => {
      const room = rooms.resumeTimer(roomId, socket.id);
      schedulePhaseTimer(room);
      emitRoom(room);
    });
  });

  socket.on("disconnect", () => {
    const previousRoomId = rooms.getRoomIdForSocket(socket.id);
    const result = rooms.leaveBySocket(socket.id);
    if (previousRoomId && result.deletedRoomId) {
      clearRoundTimer(previousRoomId);
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
});

function handle(socketId: string, callback: () => void): void {
  try {
    callback();
  } catch (error) {
    const message = error instanceof GameError ? error.message : "Ошибка сервера";
    io.to(socketId).emit("error", { message });
  }
}

function emitRoom(room: Room): void {
  for (const player of room.players) {
    io.to(player.id).emit("room", rooms.getSnapshot(room, player.id, publicClientOrigin()));
  }
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
}

function clearRoundTimer(roomId: string): void {
  const timer = timers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(roomId);
  }
}
