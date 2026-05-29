import { randomUUID } from "node:crypto";
import type { Mine, Player, PublicMine, PublicPlayer, Room, RoomSnapshot, RoundStatus } from "./types.js";
import { WORD_DICTIONARIES } from "./words.js";

const MIN_PLAYERS = 3;
const MIN_CUSTOM_WORDS = 10;
const MAX_CUSTOM_WORDS = 1000;
const MAX_CUSTOM_WORD_LENGTH = 40;

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameError";
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private socketRooms = new Map<string, string>();

  hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId.toUpperCase());
  }

  importRoom(room: Room, options: { markPlayersDisconnected?: boolean } = {}): Room {
    const normalizedRoom: Room = {
      ...room,
      id: room.id.toUpperCase(),
      players: options.markPlayersDisconnected
        ? room.players.map((player) => ({ ...this.normalizePersistedPlayer(player), isConnected: false }))
        : room.players.map((player) => this.normalizePersistedPlayer(player)),
    };
    this.rooms.set(normalizedRoom.id, normalizedRoom);
    return normalizedRoom;
  }

  getLoadedRooms(): Room[] {
    return [...this.rooms.values()];
  }

  createRoom(socketId: string, playerName: string, playerToken: string): Room {
    const room: Room = {
      id: this.createRoomId(),
      players: [this.createPlayer(socketId, playerName, playerToken, true)],
      phase: "lobby",
      roundIndex: 0,
      explainerQueue: [],
      guesserQueue: [],
      usedWords: [],
      customWords: [],
      settings: {
        roundDurationSec: 120,
        mineSubmissionDurationSec: 60,
        resultDurationSec: 10,
        minesPerPlayer: 2,
        endCondition: "target_score",
        targetScore: 10,
        maxRounds: 10,
        difficulty: "easy",
      },
    };

    this.rooms.set(room.id, room);
    this.socketRooms.set(socketId, room.id);
    return room;
  }

  joinRoom(socketId: string, roomId: string, playerName: string, playerToken: string): Room {
    const room = this.getRoom(roomId);
    if (room.players.some((player) => player.id === socketId)) {
      return room;
    }

    const normalizedToken = normalizePlayerToken(playerToken);
    const reconnectingPlayer = room.players.find((player) => {
      const staleSocket = !this.socketRooms.has(player.id);
      return player.token === normalizedToken && (!player.isConnected || staleSocket || player.id !== socketId);
    });
    if (reconnectingPlayer) {
      this.socketRooms.delete(reconnectingPlayer.id);
      this.replacePlayerId(room, reconnectingPlayer.id, socketId);
      reconnectingPlayer.id = socketId;
      reconnectingPlayer.name = playerName.trim().slice(0, 32);
      reconnectingPlayer.token = normalizedToken;
      reconnectingPlayer.isConnected = true;
      this.ensureConnectedHost(room);
      this.socketRooms.set(socketId, room.id);
      return room;
    }

    room.players.push(this.createPlayer(socketId, playerName, normalizedToken, room.players.length === 0));
    this.ensureConnectedHost(room);
    this.socketRooms.set(socketId, room.id);
    return room;
  }

  leaveBySocket(socketId: string): { room?: Room; disconnectedPlayerId?: string; deletedRoomId?: string } {
    const roomId = this.socketRooms.get(socketId);
    if (!roomId) {
      return {};
    }

    const room = this.rooms.get(roomId);
    this.socketRooms.delete(socketId);
    if (!room) {
      return {};
    }

    const disconnectedPlayer = room.players.find((player) => player.id === socketId);
    if (!disconnectedPlayer) {
      return {};
    }

    disconnectedPlayer.isConnected = false;
    this.ensureConnectedHost(room);

    return { room, disconnectedPlayerId: disconnectedPlayer.id };
  }

  removeDisconnectedPlayer(roomId: string, playerId: string): { room?: Room } {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) {
      return {};
    }

    const player = room.players.find((candidate) => candidate.id === playerId);
    if (!player || player.isConnected) {
      return {};
    }

    room.players = room.players.filter((candidate) => candidate.id !== playerId);
    room.explainerQueue = room.explainerQueue.filter((candidateId) => candidateId !== playerId);
    room.guesserQueue = room.guesserQueue.filter((candidateId) => candidateId !== playerId);
    if (room.players.length === 0) {
      this.resetEmptyRoom(room);
      return { room };
    }

    this.ensureConnectedHost(room);

    const round = room.currentRound;
    const activeRoleDisconnected = round?.explainerId === playerId || round?.guesserId === playerId;
    if (round && activeRoleDisconnected && room.phase !== "round_result" && room.phase !== "game_result") {
      round.status = "skipped";
      room.phase = "round_result";
      this.startPhaseTimer(round, room.settings.resultDurationSec);
    }

    return { room };
  }

  kickPlayer(roomId: string, hostSocketId: string, targetPlayerId: string): Room {
    const room = this.getRoom(roomId);
    this.assertHost(room, hostSocketId);
    if (hostSocketId === targetPlayerId) {
      throw new GameError("Хост не может кикнуть себя");
    }

    const targetPlayer = room.players.find((player) => player.id === targetPlayerId);
    if (!targetPlayer) {
      throw new GameError("Игрок не найден");
    }

    this.removePlayerFromRoom(room, targetPlayerId);
    this.socketRooms.delete(targetPlayerId);
    return room;
  }

  getRoomIdForSocket(socketId: string): string | undefined {
    return this.socketRooms.get(socketId);
  }

  startGame(roomId: string, socketId: string): Room {
    const room = this.getRoom(roomId);
    this.assertHost(room, socketId);
    if (room.players.length < MIN_PLAYERS) {
      throw new GameError(`Нужно минимум ${MIN_PLAYERS} игрока`);
    }
    if (this.connectedPlayers(room).length < MIN_PLAYERS) {
      throw new GameError(`Нужно минимум ${MIN_PLAYERS} игрока в сети`);
    }
    if (room.settings.difficulty === "custom" && room.customWords.length < MIN_CUSTOM_WORDS) {
      throw new GameError(`Для своего словаря нужно минимум ${MIN_CUSTOM_WORDS} слов`);
    }
    if (room.phase !== "lobby" && room.phase !== "round_result") {
      throw new GameError("Раунд уже идет");
    }
    if (room.phase === "lobby") {
      room.roundIndex = 0;
      room.explainerQueue = [];
      room.guesserQueue = [];
      room.usedWords = [];
      room.players = room.players.map((player) => ({ ...player, score: 0 }));
    }

    this.createRound(room);
    return room;
  }

  updateSettings(
    roomId: string,
    socketId: string,
    settings: Partial<Room["settings"]>,
  ): Room {
    const room = this.getRoom(roomId);
    this.assertHost(room, socketId);
    if (room.phase !== "lobby") {
      throw new GameError("Настройки можно менять только в лобби");
    }

    room.settings = {
      minesPerPlayer: clampInt(settings.minesPerPlayer, room.settings.minesPerPlayer, 1, 10),
      mineSubmissionDurationSec: clampInt(settings.mineSubmissionDurationSec, room.settings.mineSubmissionDurationSec, 10, 300),
      roundDurationSec: clampInt(settings.roundDurationSec, room.settings.roundDurationSec, 10, 300),
      resultDurationSec: clampInt(settings.resultDurationSec, room.settings.resultDurationSec, 5, 120),
      endCondition: settings.endCondition === "rounds" ? "rounds" : "target_score",
      targetScore: clampInt(settings.targetScore, room.settings.targetScore, 1, 100),
      maxRounds: clampInt(settings.maxRounds, room.settings.maxRounds, 1, 100),
      difficulty: isDifficulty(settings.difficulty) ? settings.difficulty : room.settings.difficulty,
    };
    return room;
  }

  updateCustomWords(roomId: string, socketId: string, wordsText: string): Room {
    const room = this.getRoom(roomId);
    this.assertHost(room, socketId);
    if (room.phase !== "lobby") {
      throw new GameError("Свой словарь можно менять только в лобби");
    }

    room.customWords = normalizeCustomWords(wordsText);
    if (room.settings.difficulty === "custom") {
      room.usedWords = room.usedWords.filter((word) => room.customWords.includes(word));
    }
    return room;
  }

  addMine(roomId: string, socketId: string, word: string): Room {
    const room = this.getRoom(roomId);
    const round = this.requireRound(room);
    if (room.phase !== "mine_submission" || round.status !== "waiting_mines") {
      throw new GameError("Сейчас нельзя добавлять мины");
    }
    if (round.explainerId === socketId) {
      throw new GameError("Объясняющий не добавляет мины");
    }
    if (round.guesserId === socketId) {
      throw new GameError("Отгадывающий не добавляет мины");
    }

    const normalized = normalizeMine(word);
    if (!normalized) {
      throw new GameError("Мина не может быть пустой");
    }
    if (round.mines.some((mine) => mine.word === normalized)) {
      throw new GameError("Такая мина уже есть");
    }

    const authorMineCount = round.mines.filter((mine) => mine.authorPlayerId === socketId).length;
    if (authorMineCount >= room.settings.minesPerPlayer) {
      throw new GameError("Лимит мин уже исчерпан");
    }

    round.mines.push({ word: normalized, authorPlayerId: socketId });
    return room;
  }

  updateMine(roomId: string, socketId: string, oldWord: string, newWord: string): Room {
    const room = this.getRoom(roomId);
    const round = this.requireRound(room);
    if (room.phase !== "mine_submission" || round.status !== "waiting_mines") {
      throw new GameError("Мины можно редактировать только до объяснения");
    }

    const oldNormalized = normalizeMine(oldWord);
    const newNormalized = normalizeMine(newWord);
    if (!newNormalized) {
      throw new GameError("Мина не может быть пустой");
    }

    const mine = round.mines.find((candidate) => candidate.word === oldNormalized);
    if (!mine) {
      throw new GameError("Мина не найдена");
    }
    if (mine.authorPlayerId !== socketId) {
      throw new GameError("Можно редактировать только свои мины");
    }
    if (oldNormalized !== newNormalized && round.mines.some((candidate) => candidate.word === newNormalized)) {
      throw new GameError("Такая мина уже есть");
    }

    mine.word = newNormalized;
    return room;
  }

  startExplaining(roomId: string, socketId: string): Room {
    const room = this.getRoom(roomId);
    const round = this.requireRound(room);
    this.assertExplainer(room, socketId);
    if (room.phase !== "mine_submission") {
      throw new GameError("Нельзя начать объяснение в этой фазе");
    }
    this.activateExplaining(room);
    return room;
  }

  autoStartExplaining(roomId: string): Room {
    const room = this.getRoom(roomId);
    if (room.phase === "mine_submission") {
      this.activateExplaining(room);
    }
    return room;
  }

  pauseTimer(roomId: string, socketId: string): Room {
    const room = this.getRoom(roomId);
    this.assertHost(room, socketId);
    const round = this.requireRound(room);
    if (!round.timerEndsAt || round.timerPausedAt || room.phase === "lobby") {
      return room;
    }

    round.timerPausedAt = Date.now();
    round.timerRemainingMs = Math.max(0, round.timerEndsAt - round.timerPausedAt);
    return room;
  }

  resumeTimer(roomId: string, socketId: string): Room {
    const room = this.getRoom(roomId);
    this.assertHost(room, socketId);
    const round = this.requireRound(room);
    if (!round.timerPausedAt || round.timerRemainingMs === undefined || room.phase === "lobby") {
      return room;
    }

    round.timerEndsAt = Date.now() + round.timerRemainingMs;
    round.timerPausedAt = undefined;
    round.timerRemainingMs = undefined;
    return room;
  }

  isTimerPaused(room: Room): boolean {
    return Boolean(room.currentRound?.timerPausedAt);
  }

  getTimerDelayMs(room: Room): number | undefined {
    const round = room.currentRound;
    if (!round?.timerEndsAt || round.timerPausedAt || room.phase === "lobby") {
      return undefined;
    }

    return Math.max(0, round.timerEndsAt - Date.now());
  }

  getTimerRemainingMs(room: Room): number | undefined {
    const round = room.currentRound;
    if (!round || room.phase === "lobby" || room.phase === "game_result") {
      return undefined;
    }
    if (round.timerPausedAt && round.timerRemainingMs !== undefined) {
      return Math.max(0, round.timerRemainingMs);
    }
    if (!round.timerEndsAt) {
      return undefined;
    }
    return Math.max(0, round.timerEndsAt - Date.now());
  }

  handleTimerElapsed(roomId: string): Room {
    const room = this.getRoom(roomId);
    if (this.isTimerPaused(room)) {
      return room;
    }

    if (room.phase === "mine_submission") {
      this.activateExplaining(room);
    } else if (room.phase === "explaining") {
      this.finishRound(room, "timeout");
    } else if (room.phase === "round_result") {
      this.startNextRoundOrFinishGame(room);
    }

    return room;
  }

  private activateExplaining(room: Room): void {
    const round = this.requireRound(room);
    round.status = "active";
    this.startPhaseTimer(round, room.settings.roundDurationSec);
    room.phase = "explaining";
  }

  completeSuccess(roomId: string, socketId: string): Room {
    const room = this.getRoom(roomId);
    this.assertCanConfirmSuccess(room, socketId);
    this.finishRound(room, "success");
    return room;
  }

  triggerMine(roomId: string, socketId: string, mineWord: string, triggered: boolean): Room {
    const room = this.getRoom(roomId);
    this.assertCanMarkMine(room, socketId);
    const round = this.requireRound(room);
    const normalized = normalizeMine(mineWord);
    const mine = round.mines.find((candidate) => candidate.word === normalized);
    if (!mine) {
      throw new GameError("Мина не найдена");
    }
    const alreadyTriggered = round.triggeredMines.some((candidate) => candidate.word === mine.word);
    if (triggered && !alreadyTriggered) {
      round.triggeredMines.push(mine);
    }
    if (!triggered && alreadyTriggered) {
      round.triggeredMines = round.triggeredMines.filter((candidate) => candidate.word !== mine.word);
    }
    round.resultMine = round.triggeredMines.at(-1);
    return room;
  }

  skipRound(roomId: string, socketId: string): Room {
    const room = this.getRoom(roomId);
    this.assertCanControlActiveRound(room, socketId);
    this.finishRound(room, "skipped");
    return room;
  }

  timeoutRound(roomId: string): Room {
    const room = this.getRoom(roomId);
    const round = this.requireRound(room);
    if (room.phase === "explaining" && round.status === "active") {
      this.finishRound(room, "timeout");
    }
    return room;
  }

  nextRound(roomId: string, socketId: string): Room {
    const room = this.getRoom(roomId);
    this.assertHost(room, socketId);
    if (room.phase !== "round_result") {
      throw new GameError("Следующий раунд доступен после результата");
    }

    this.startNextRoundOrFinishGame(room);
    return room;
  }

  resetGame(roomId: string, socketId: string): Room {
    const room = this.getRoom(roomId);
    this.assertHost(room, socketId);
    room.phase = "lobby";
    room.currentRound = undefined;
    room.roundIndex = 0;
    room.explainerQueue = [];
    room.guesserQueue = [];
    room.usedWords = [];
    room.players = room.players.map((player) => ({ ...player, score: 0 }));
    return room;
  }

  getSnapshot(room: Room, viewerId: string, inviteOrigin?: string): RoomSnapshot {
    const round = room.currentRound;
    const viewer = room.players.find((player) => player.id === viewerId);
    const isResult = room.phase === "round_result";
    const isExplainer = Boolean(round && viewer && round.explainerId === viewer.id);
    const isGuesser = Boolean(round && viewer && round.guesserId === viewer.id);
    const isMiner = Boolean(round && viewer && !isExplainer && !isGuesser);
    const showSecretRoundData = isResult || isExplainer || isMiner;
    const showMines = isResult || isMiner;

    return {
      id: room.id,
      phase: room.phase,
      players: this.publicPlayers(room.players),
      selfId: viewerId,
      roundIndex: room.roundIndex,
      settings: room.settings,
      customWordCount: room.customWords.length,
      customWords: viewer?.isHost && room.phase === "lobby" ? room.customWords : undefined,
      finalStandings: room.phase === "game_result" ? this.publicPlayers(this.getStandings(room)) : undefined,
      inviteUrl: inviteOrigin ? `${inviteOrigin}/room/${room.id}` : undefined,
      currentRound: round
        ? {
            word: showSecretRoundData ? round.word : undefined,
            explainerId: round.explainerId,
            explainerName: this.playerName(room, round.explainerId),
            guesserId: round.guesserId,
            guesserName: this.playerName(room, round.guesserId),
            durationSec: round.durationSec,
            startedAt: round.startedAt,
            timerEndsAt: round.timerEndsAt,
            timerPausedAt: round.timerPausedAt,
            timerRemainingMs: round.timerRemainingMs,
            isTimerPaused: Boolean(round.timerPausedAt),
            status: round.status,
            mineCount: round.mines.length,
            mines: showMines ? this.publicMines(room, round.mines) : undefined,
            myMineCount: round.mines.filter((mine) => mine.authorPlayerId === viewerId).length,
            canSubmitMines: room.phase === "mine_submission" && isMiner,
            resultMine: round.resultMine ? this.publicMines(room, [round.resultMine])[0] : undefined,
            triggeredMines: showMines ? this.publicMines(room, round.triggeredMines) : undefined,
            scoreDeltas: isResult || room.phase === "game_result" ? round.scoreDeltas : [],
          }
        : undefined,
    };
  }

  private createRound(room: Room): void {
    const { explainerId, guesserId } = this.pickRoundRoles(room);
    const word = this.pickWord(room);

    room.currentRound = {
      word,
      explainerId,
      guesserId,
      mines: [],
      durationSec: room.settings.mineSubmissionDurationSec,
      status: "waiting_mines",
      triggeredMines: [],
      scoreDeltas: [],
    };
    this.startPhaseTimer(room.currentRound, room.settings.mineSubmissionDurationSec);
    room.phase = "mine_submission";
    room.roundIndex += 1;
  }

  private pickRoundRoles(room: Room): { explainerId: string; guesserId: string } {
    const playerIds = this.connectedPlayers(room).map((player) => player.id);
    room.explainerQueue = this.normalizeRoleQueue(room.explainerQueue, playerIds);
    if (room.explainerQueue.length === 0) {
      room.explainerQueue = shuffle(playerIds);
    }

    const explainerId = room.explainerQueue.shift();
    if (!explainerId) {
      throw new GameError("Нет игроков для раунда");
    }

    const guesserCandidates = playerIds.filter((playerId) => playerId !== explainerId);
    room.guesserQueue = this.normalizeRoleQueue(room.guesserQueue, guesserCandidates);
    if (room.guesserQueue.length === 0) {
      room.guesserQueue = shuffle(guesserCandidates);
    }

    let guesserId = room.guesserQueue.shift();
    if (!guesserId || guesserId === explainerId) {
      guesserId = guesserCandidates[Math.floor(Math.random() * guesserCandidates.length)];
    }
    if (!guesserId) {
      throw new GameError("Нет отгадывающего для раунда");
    }

    return { explainerId, guesserId };
  }

  private normalizeRoleQueue(queue: string[], playerIds: string[]): string[] {
    const activeIds = new Set(playerIds);
    const seen = new Set<string>();
    return queue.filter((playerId) => {
      if (!activeIds.has(playerId) || seen.has(playerId)) {
        return false;
      }
      seen.add(playerId);
      return true;
    });
  }

  private pickWord(room: Room): string {
    const words = room.settings.difficulty === "custom" ? room.customWords : WORD_DICTIONARIES[room.settings.difficulty];
    if (words.length === 0) {
      throw new GameError("Словарь пустой");
    }
    if (room.usedWords.length >= words.length) {
      room.usedWords = [];
    }

    const availableWords = words.filter((word) => !room.usedWords.includes(word));
    const word = availableWords[Math.floor(Math.random() * availableWords.length)];
    room.usedWords.push(word);
    return word;
  }

  private createPlayer(socketId: string, playerName: string, playerToken: string, isHost: boolean): Player {
    const trimmedName = playerName.trim();
    if (!trimmedName) {
      throw new GameError("Введите имя");
    }

    return {
      id: socketId,
      token: normalizePlayerToken(playerToken),
      name: trimmedName.slice(0, 32),
      score: 0,
      isHost,
      isConnected: true,
    };
  }

  private getRoom(roomId: string): Room {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) {
      throw new GameError("Комната не найдена");
    }
    return room;
  }

  private requireRound(room: Room) {
    if (!room.currentRound) {
      throw new GameError("Раунд еще не создан");
    }
    return room.currentRound;
  }

  private assertHost(room: Room, socketId: string): void {
    const player = room.players.find((candidate) => candidate.id === socketId);
    if (!player?.isHost) {
      throw new GameError("Действие доступно только хосту");
    }
  }

  private assertExplainer(room: Room, socketId: string): void {
    const round = this.requireRound(room);
    const player = room.players.find((candidate) => candidate.id === socketId);
    if (!player) {
      throw new GameError("Игрок не найден");
    }
    if (player.id !== round.explainerId) {
      throw new GameError("Начать объяснение может только объясняющий");
    }
  }

  private assertCanControlActiveRound(room: Room, socketId: string): void {
    const round = this.requireRound(room);
    if (room.phase !== "explaining" || round.status !== "active") {
      throw new GameError("Раунд сейчас не активен");
    }
    const player = room.players.find((candidate) => candidate.id === socketId);
    if (!player) {
      throw new GameError("Игрок не найден");
    }
    if (player.id !== round.guesserId && player.id !== round.explainerId) {
      throw new GameError("Раунд как неугаданный отмечают объясняющий или отгадывающий");
    }
  }

  private assertCanConfirmSuccess(room: Room, socketId: string): void {
    const round = this.requireRound(room);
    if (room.phase !== "explaining" || round.status !== "active") {
      throw new GameError("Раунд сейчас не активен");
    }
    const player = room.players.find((candidate) => candidate.id === socketId);
    if (!player) {
      throw new GameError("Игрок не найден");
    }
    if (player.id !== round.explainerId) {
      throw new GameError("Угадывание подтверждает объясняющий");
    }
  }

  private assertCanMarkMine(room: Room, socketId: string): void {
    const round = this.requireRound(room);
    if (room.phase !== "explaining" || round.status !== "active") {
      throw new GameError("Раунд сейчас не активен");
    }
    const player = room.players.find((candidate) => candidate.id === socketId);
    if (!player) {
      throw new GameError("Игрок не найден");
    }
    if (player.id === round.explainerId || player.id === round.guesserId) {
      throw new GameError("Мины отмечают только минеры");
    }
  }

  private finishRound(room: Room, requestedStatus: RoundStatus): void {
    const round = this.requireRound(room);
    const triggeredCount = round.triggeredMines.length;
    round.scoreDeltas = [];

    if (requestedStatus === "success") {
      for (const playerId of [round.explainerId, round.guesserId]) {
        const player = room.players.find((candidate) => candidate.id === playerId);
        if (player) {
          const reason = player.id === round.explainerId ? "объяснение угадали" : "слово угадано";
          this.applyScoreDelta(round, player, 1, reason);
        }
      }
    }

    if (requestedStatus === "skipped" || requestedStatus === "timeout") {
      round.status = requestedStatus;
      for (const playerId of [round.explainerId, round.guesserId]) {
        const player = room.players.find((candidate) => candidate.id === playerId);
        if (player) {
          const reason = requestedStatus === "timeout" ? "время вышло" : "не угадали";
          this.applyScoreDelta(round, player, -1, reason);
        }
      }
    } else {
      round.status = requestedStatus;
    }

    if (triggeredCount > 0) {
      for (const playerId of [round.explainerId, round.guesserId]) {
        const player = room.players.find((candidate) => candidate.id === playerId);
        if (player) {
          const delta = -triggeredCount;
          this.applyScoreDelta(round, player, delta, `${triggeredCount} мин`);
        }
      }
      const authorCounts = new Map<string, number>();
      for (const mine of round.triggeredMines) {
        authorCounts.set(mine.authorPlayerId, (authorCounts.get(mine.authorPlayerId) ?? 0) + 1);
      }
      for (const [authorPlayerId, count] of authorCounts) {
        const player = room.players.find((candidate) => candidate.id === authorPlayerId);
        if (player) {
          this.applyScoreDelta(round, player, count, count === 1 ? "сработала мина" : `${count} мины сработали`);
        }
      }
    }

    room.phase = "round_result";
    this.startPhaseTimer(round, room.settings.resultDurationSec);
  }

  private applyScoreDelta(round: Room["currentRound"], player: Player, delta: number, reason: string): void {
    if (!round) {
      return;
    }

    player.score += delta;
    round.scoreDeltas.push({
      playerId: player.id,
      playerName: player.name,
      delta,
      reason,
    });
  }

  private startNextRoundOrFinishGame(room: Room): void {
    if (this.shouldFinishGame(room)) {
      room.phase = "game_result";
      if (room.currentRound) {
        room.currentRound.timerEndsAt = undefined;
        room.currentRound.timerPausedAt = undefined;
        room.currentRound.timerRemainingMs = undefined;
      }
      return;
    }

    this.createRound(room);
  }

  private shouldFinishGame(room: Room): boolean {
    if (room.settings.endCondition === "rounds") {
      return room.roundIndex >= room.settings.maxRounds;
    }

    return room.players.some((player) => player.score >= room.settings.targetScore);
  }

  private getStandings(room: Room): Player[] {
    return [...room.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  private publicPlayers(players: Player[]): PublicPlayer[] {
    return players.map(({ token: _token, ...player }) => player);
  }

  private connectedPlayers(room: Room): Player[] {
    return room.players.filter((player) => player.isConnected);
  }

  private removePlayerFromRoom(room: Room, playerId: string): void {
    room.players = room.players.filter((candidate) => candidate.id !== playerId);
    room.explainerQueue = room.explainerQueue.filter((candidateId) => candidateId !== playerId);
    room.guesserQueue = room.guesserQueue.filter((candidateId) => candidateId !== playerId);

    if (room.players.length === 0) {
      this.resetEmptyRoom(room);
      return;
    }

    this.ensureConnectedHost(room);
    const round = room.currentRound;
    const activeRoleRemoved = round?.explainerId === playerId || round?.guesserId === playerId;
    if (round && activeRoleRemoved && room.phase !== "round_result" && room.phase !== "game_result") {
      round.status = "skipped";
      room.phase = "round_result";
      this.startPhaseTimer(round, room.settings.resultDurationSec);
    }
  }

  private resetEmptyRoom(room: Room): void {
    room.phase = "lobby";
    room.currentRound = undefined;
    room.roundIndex = 0;
    room.explainerQueue = [];
    room.guesserQueue = [];
    room.usedWords = [];
  }

  private ensureConnectedHost(room: Room): void {
    const connectedPlayers = this.connectedPlayers(room);
    if (connectedPlayers.length === 0 || connectedPlayers.some((player) => player.isHost)) {
      return;
    }
    for (const player of room.players) {
      player.isHost = false;
    }
    connectedPlayers[0].isHost = true;
  }

  private replacePlayerId(room: Room, oldPlayerId: string, newPlayerId: string): void {
    room.explainerQueue = replaceIdInList(room.explainerQueue, oldPlayerId, newPlayerId);
    room.guesserQueue = replaceIdInList(room.guesserQueue, oldPlayerId, newPlayerId);
    const round = room.currentRound;
    if (!round) {
      return;
    }
    if (round.explainerId === oldPlayerId) {
      round.explainerId = newPlayerId;
    }
    if (round.guesserId === oldPlayerId) {
      round.guesserId = newPlayerId;
    }
    for (const mine of round.mines) {
      if (mine.authorPlayerId === oldPlayerId) {
        mine.authorPlayerId = newPlayerId;
      }
    }
    for (const mine of round.triggeredMines) {
      if (mine.authorPlayerId === oldPlayerId) {
        mine.authorPlayerId = newPlayerId;
      }
    }
    if (round.resultMine?.authorPlayerId === oldPlayerId) {
      round.resultMine.authorPlayerId = newPlayerId;
    }
    for (const delta of round.scoreDeltas) {
      if (delta.playerId === oldPlayerId) {
        delta.playerId = newPlayerId;
      }
    }
  }

  private startPhaseTimer(round: Room["currentRound"], durationSec: number): void {
    if (!round) {
      return;
    }

    round.durationSec = durationSec;
    round.startedAt = Date.now();
    round.timerEndsAt = round.startedAt + durationSec * 1000;
    round.timerPausedAt = undefined;
    round.timerRemainingMs = undefined;
  }

  private publicMines(room: Room, mines: Mine[]): PublicMine[] {
    return mines.map((mine) => ({
      ...mine,
      authorName: this.playerName(room, mine.authorPlayerId),
    }));
  }

  private playerName(room: Room, playerId: string): string {
    return room.players.find((player) => player.id === playerId)?.name ?? "Игрок";
  }

  private normalizePersistedPlayer(player: Player): Player {
    return {
      ...player,
      token: normalizePlayerToken(player.token || `legacy:${player.id}`),
    };
  }

  private createRoomId(): string {
    let id = "";
    do {
      id = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
    } while (this.rooms.has(id));
    return id;
  }
}

function normalizeMine(word: string): string {
  return word.trim().toLowerCase();
}

function normalizePlayerToken(token: unknown): string {
  if (typeof token === "string" && token.trim()) {
    return token.trim();
  }
  return randomUUID();
}

function replaceIdInList(items: string[], oldId: string, newId: string): string[] {
  return items.map((item) => (item === oldId ? newId : item));
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function isDifficulty(value: unknown): value is Room["settings"]["difficulty"] {
  return value === "easy" || value === "medium" || value === "hard" || value === "custom";
}

function normalizeCustomWords(wordsText: string): string[] {
  const words = wordsText
    .split(/[\n,]+/)
    .map((word) => word.trim().toLowerCase().replace(/\s+/g, " "))
    .filter(Boolean);
  const uniqueWords: string[] = [];
  const seen = new Set<string>();

  for (const word of words) {
    if (word.length > MAX_CUSTOM_WORD_LENGTH) {
      throw new GameError(`Слово или фраза "${word}" длиннее ${MAX_CUSTOM_WORD_LENGTH} символов`);
    }
    if (!seen.has(word)) {
      seen.add(word);
      uniqueWords.push(word);
    }
    if (uniqueWords.length > MAX_CUSTOM_WORDS) {
      throw new GameError(`В своем словаре максимум ${MAX_CUSTOM_WORDS} слов`);
    }
  }

  return uniqueWords;
}
