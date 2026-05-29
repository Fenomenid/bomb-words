import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { io } from "socket.io-client";
import { Check, Copy, Crown, Edit3, Flag, HelpCircle, KeyRound, LogIn, Medal, Moon, Pause, Play, Plus, RotateCcw, Save, Siren, SkipForward, Sun, Timer, Trophy, Users, Volume2, VolumeX, X } from "lucide-react";
import "./styles.css";

const socketUrl = import.meta.env.VITE_SERVER_URL ?? (import.meta.env.DEV ? "http://localhost:3001" : window.location.origin);
const socket = io(socketUrl);

type Player = {
  id: string;
  name: string;
  score: number;
  isHost: boolean;
};

type Mine = {
  word: string;
  authorPlayerId: string;
  authorName: string;
};

type ScoreDelta = {
  playerId: string;
  playerName: string;
  delta: number;
  reason: string;
};

type RoomSnapshot = {
  id: string;
  phase: "lobby" | "mine_submission" | "explaining" | "round_result" | "game_result";
  players: Player[];
  selfId: string;
  roundIndex: number;
  settings: {
    roundDurationSec: number;
    mineSubmissionDurationSec: number;
    resultDurationSec: number;
    minesPerPlayer: number;
    endCondition: "target_score" | "rounds";
    targetScore: number;
    maxRounds: number;
    difficulty: "easy" | "medium" | "hard" | "custom";
  };
  customWordCount: number;
  customWords?: string[];
  finalStandings?: Player[];
  inviteUrl?: string;
  currentRound?: {
    word?: string;
    explainerId: string;
    explainerName: string;
    guesserId: string;
    guesserName: string;
    durationSec: number;
    startedAt?: number;
    timerEndsAt?: number;
    timerPausedAt?: number;
    timerRemainingMs?: number;
    isTimerPaused: boolean;
    status: "waiting_mines" | "active" | "success" | "failed" | "skipped" | "timeout";
    mineCount: number;
    mines?: Mine[];
    myMineCount: number;
    canSubmitMines: boolean;
    resultMine?: Mine;
    triggeredMines?: Mine[];
    scoreDeltas: ScoreDelta[];
  };
};

type SettingsDraft = {
  targetScore: string;
  maxRounds: string;
  minesPerPlayer: string;
  mineSubmissionDurationSec: string;
  roundDurationSec: string;
  resultDurationSec: string;
};

function settingsToDraft(settings: RoomSnapshot["settings"]): SettingsDraft {
  return {
    targetScore: String(settings.targetScore),
    maxRounds: String(settings.maxRounds),
    minesPerPlayer: String(settings.minesPerPlayer),
    mineSubmissionDurationSec: String(settings.mineSubmissionDurationSec),
    roundDurationSec: String(settings.roundDurationSec),
    resultDurationSec: String(settings.resultDurationSec),
  };
}

function App() {
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState("");
  const [playerName, setPlayerName] = useState(localStorage.getItem("playerName") ?? "");
  const [mineWord, setMineWord] = useState("");
  const [copied, setCopied] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem("soundEnabled") !== "false");
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem("theme") === "dark" ? "dark" : "light"),
  );

  const roomIdFromUrl = useMemo(() => {
    const match = window.location.pathname.match(/\/room\/([A-Za-z0-9]+)/);
    return match?.[1]?.toUpperCase() ?? "";
  }, []);

  const self = room?.players.find((player) => player.id === room.selfId);
  const isHost = Boolean(self?.isHost);
  const round = room?.currentRound;
  const isExplainer = Boolean(round && room?.selfId === round.explainerId);
  const isGuesser = Boolean(round && room?.selfId === round.guesserId);
  const hasEnoughCustomWords = Boolean(room && (room.settings.difficulty !== "custom" || room.customWordCount >= 10));
  const canStartGame = Boolean(room && isHost && room.players.length >= 3 && hasEnoughCustomWords);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("soundEnabled", String(soundEnabled));
  }, [soundEnabled]);

  useEffect(() => {
    socket.on("room", (snapshot: RoomSnapshot) => {
      setRoom(snapshot);
      setError("");
      if (window.location.pathname !== `/room/${snapshot.id}`) {
        window.history.replaceState(null, "", `/room/${snapshot.id}`);
      }
    });
    socket.on("error", ({ message }: { message: string }) => setError(message));

    return () => {
      socket.off("room");
      socket.off("error");
    };
  }, []);

  function rememberName() {
    localStorage.setItem("playerName", playerName.trim());
  }

  function createRoom() {
    rememberName();
    socket.emit("room:create", { playerName });
  }

  function joinRoom() {
    rememberName();
    socket.emit("room:join", { roomId: roomIdFromUrl, playerName });
  }

  function addMine(event: React.FormEvent) {
    event.preventDefault();
    if (!room) return;
    socket.emit("mine:add", { roomId: room.id, word: mineWord });
    setMineWord("");
  }

  async function copyInvite() {
    if (!room) return;
    const url = room.inviteUrl ?? `${window.location.origin}/room/${room.id}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function toggleTheme() {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }

  if (!room) {
    return (
      <main className="page auth-page">
        <section className="auth-panel">
          <div>
            <h1>Слова-мины</h1>
            <p className="muted">Создайте комнату или войдите по приглашению.</p>
          </div>
          <label className="field">
            <span>Ваше имя</span>
            <input value={playerName} onChange={(event) => setPlayerName(event.target.value)} placeholder="Например, Аня" />
          </label>
          {roomIdFromUrl ? (
            <button className="primary" onClick={joinRoom}>
              <LogIn size={18} />
              Войти в комнату {roomIdFromUrl}
            </button>
          ) : (
            <button className="primary" onClick={createRoom}>
              <Plus size={18} />
              Создать комнату
            </button>
          )}
          <button className="secondary" onClick={toggleTheme}>
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            {theme === "dark" ? "Светлая тема" : "Темная тема"}
          </button>
          <button className="secondary" onClick={() => setSoundEnabled((enabled) => !enabled)}>
            {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            {soundEnabled ? "Звук включен" : "Звук выключен"}
          </button>
          <button className="secondary" onClick={() => setShowRules(true)}>
            <HelpCircle size={18} />
            Правила
          </button>
          {error && <p className="error">{error}</p>}
          {showRules && <RulesModal onClose={() => setShowRules(false)} />}
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Комната {room.id}</p>
          <h1>Слова-мины</h1>
          {self && (
            <p className="self-label">
              Вы: <strong>{self.name}</strong>
            </p>
          )}
        </div>
        <div className="top-actions">
          {isHost && round && room.phase !== "game_result" && <TimerControls room={room} />}
          <button className="secondary icon-text" onClick={toggleTheme}>
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            {theme === "dark" ? "Светлая" : "Темная"}
          </button>
          <button className="secondary icon-text" onClick={() => setSoundEnabled((enabled) => !enabled)}>
            {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            {soundEnabled ? "Звук" : "Без звука"}
          </button>
          <button className="secondary icon-text" onClick={copyInvite}>
            <Copy size={18} />
            {copied ? "Скопировано" : "Пригласить"}
          </button>
          <button className="secondary icon-text" onClick={() => setShowRules(true)}>
            <HelpCircle size={18} />
            Правила
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="layout">
        <aside className="sidebar">
          <div className="section-title">
            <Users size={18} />
            Игроки
          </div>
          <div className="players">
            {room.players.map((player) => (
              <div className={getPlayerRowClassName(player, round, room.selfId)} key={player.id}>
                <div>
                  <strong className="player-name">
                    {player.name}
                    {player.id === room.selfId && <span className="self-mark">(Вы)</span>}
                    {player.isHost && <KeyRound size={15} aria-label="Хост" />}
                  </strong>
                  <span>{player.id === round?.explainerId ? "Объясняет" : player.id === round?.guesserId ? "Угадывает" : round ? "Минер" : "В лобби"}</span>
                </div>
                <b>{player.score}</b>
              </div>
            ))}
          </div>
        </aside>

        <section className="game-panel">
          {room.phase === "lobby" && (
            <Lobby canStartGame={canStartGame} isHost={isHost} room={room} />
          )}

          {room.phase === "mine_submission" && round && (
            <MineSubmission
              room={room}
              isExplainer={isExplainer}
              isHost={isHost}
              mineWord={mineWord}
              setMineWord={setMineWord}
              addMine={addMine}
            />
          )}

          {room.phase === "explaining" && round && (
            <Explaining room={room} isExplainer={isExplainer} isGuesser={isGuesser} isHost={isHost} soundEnabled={soundEnabled} />
          )}

          {room.phase === "round_result" && round && <RoundResult room={room} isHost={isHost} />}
          {room.phase === "game_result" && <GameResult room={room} isHost={isHost} />}
        </section>
      </div>
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </main>
  );
}

function Lobby({ room, isHost, canStartGame }: { room: RoomSnapshot; isHost: boolean; canStartGame: boolean }) {
  const [draftSettings, setDraftSettings] = useState(() => settingsToDraft(room.settings));
  const [customWordsText, setCustomWordsText] = useState(() => (room.customWords ?? []).join("\n"));
  const [customWordsSaveRequested, setCustomWordsSaveRequested] = useState(false);
  const [customWordsSaved, setCustomWordsSaved] = useState(false);

  useEffect(() => {
    setDraftSettings(settingsToDraft(room.settings));
  }, [room.settings]);

  useEffect(() => {
    if (room.customWords) {
      setCustomWordsText(room.customWords.join("\n"));
      if (customWordsSaveRequested) {
        setCustomWordsSaved(true);
        setCustomWordsSaveRequested(false);
      }
    }
  }, [customWordsSaveRequested, room.customWords]);

  useEffect(() => {
    if (!customWordsSaved) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setCustomWordsSaved(false), 2400);
    return () => window.clearTimeout(timeout);
  }, [customWordsSaved]);

  function updateSetting(key: keyof RoomSnapshot["settings"], value: string) {
    const nextValue = key === "endCondition" || key === "difficulty" ? value : Number(value);
    socket.emit("settings:update", {
      roomId: room.id,
      settings: {
        ...room.settings,
        [key]: nextValue,
      },
    });
  }

  function setDraftSetting(key: keyof SettingsDraft, value: string) {
    setDraftSettings((current) => ({ ...current, [key]: value }));
  }

  function commitNumberSetting(key: keyof SettingsDraft) {
    const value = draftSettings[key].trim();
    if (!value) {
      setDraftSettings(settingsToDraft(room.settings));
      return;
    }
    updateSetting(key, value);
  }

  function handleNumberKeyDown(event: React.KeyboardEvent<HTMLInputElement>, key: keyof SettingsDraft) {
    if (event.key === "Enter") {
      event.currentTarget.blur();
      commitNumberSetting(key);
    }
  }

  function saveCustomWords() {
    setCustomWordsSaveRequested(true);
    setCustomWordsSaved(false);
    socket.emit("settings:customWords", { roomId: room.id, wordsText: customWordsText });
  }

  function switchToBuiltInDictionary() {
    updateSetting("difficulty", "easy");
  }

  return (
    <div className="stage">
      <p className="eyebrow">Лобби</p>
      <h2>Ожидание игроков</h2>
      <p className="muted">Минимум 3 игрока. Сейчас в комнате: {room.players.length}.</p>
      <div className="settings-grid">
        <div className="field">
          <span>Источник слов</span>
          <div className="segmented" role="group" aria-label="Источник слов">
            <button
              type="button"
              className={room.settings.difficulty !== "custom" ? "active" : ""}
              disabled={!isHost}
              onClick={switchToBuiltInDictionary}
            >
              Встроенный
            </button>
            <button
              type="button"
              className={room.settings.difficulty === "custom" ? "active" : ""}
              disabled={!isHost}
              onClick={() => updateSetting("difficulty", "custom")}
            >
              Свой
            </button>
          </div>
        </div>
        <label className="field">
          <span>Сложность слов</span>
          <select
            disabled={!isHost || room.settings.difficulty === "custom"}
            value={room.settings.difficulty === "custom" ? "easy" : room.settings.difficulty}
            onChange={(event) => updateSetting("difficulty", event.target.value)}
          >
            <option value="easy">Легкий</option>
            <option value="medium">Средний</option>
            <option value="hard">Нереальный</option>
          </select>
        </label>
        <div className="field">
          <span>Финал игры</span>
          <div className="segmented" role="group" aria-label="Финал игры">
            <button
              type="button"
              className={room.settings.endCondition === "target_score" ? "active" : ""}
              disabled={!isHost}
              onClick={() => updateSetting("endCondition", "target_score")}
            >
              По очкам
            </button>
            <button
              type="button"
              className={room.settings.endCondition === "rounds" ? "active" : ""}
              disabled={!isHost}
              onClick={() => updateSetting("endCondition", "rounds")}
            >
              По раундам
            </button>
          </div>
        </div>
        {room.settings.endCondition === "target_score" ? (
          <label className="field">
            <span>Очков для победы</span>
            <input
              type="number"
              min={1}
              max={100}
              disabled={!isHost}
              value={draftSettings.targetScore}
              onChange={(event) => setDraftSetting("targetScore", event.target.value)}
              onBlur={() => commitNumberSetting("targetScore")}
              onKeyDown={(event) => handleNumberKeyDown(event, "targetScore")}
            />
          </label>
        ) : (
          <label className="field">
            <span>Количество раундов</span>
            <input
              type="number"
              min={1}
              max={100}
              disabled={!isHost}
              value={draftSettings.maxRounds}
              onChange={(event) => setDraftSetting("maxRounds", event.target.value)}
              onBlur={() => commitNumberSetting("maxRounds")}
              onKeyDown={(event) => handleNumberKeyDown(event, "maxRounds")}
            />
          </label>
        )}
        <label className="field">
          <span>Мин на игрока</span>
          <input
            type="number"
            min={1}
            max={10}
            disabled={!isHost}
            value={draftSettings.minesPerPlayer}
            onChange={(event) => setDraftSetting("minesPerPlayer", event.target.value)}
            onBlur={() => commitNumberSetting("minesPerPlayer")}
            onKeyDown={(event) => handleNumberKeyDown(event, "minesPerPlayer")}
          />
        </label>
        <label className="field">
          <span>Секунд на мины</span>
          <input
            type="number"
            min={10}
            max={300}
            disabled={!isHost}
            value={draftSettings.mineSubmissionDurationSec}
            onChange={(event) => setDraftSetting("mineSubmissionDurationSec", event.target.value)}
            onBlur={() => commitNumberSetting("mineSubmissionDurationSec")}
            onKeyDown={(event) => handleNumberKeyDown(event, "mineSubmissionDurationSec")}
          />
        </label>
        <label className="field">
          <span>Секунд на объяснение</span>
          <input
            type="number"
            min={10}
            max={300}
            disabled={!isHost}
            value={draftSettings.roundDurationSec}
            onChange={(event) => setDraftSetting("roundDurationSec", event.target.value)}
            onBlur={() => commitNumberSetting("roundDurationSec")}
            onKeyDown={(event) => handleNumberKeyDown(event, "roundDurationSec")}
          />
        </label>
        <label className="field">
          <span>Секунд результата</span>
          <input
            type="number"
            min={5}
            max={120}
            disabled={!isHost}
            value={draftSettings.resultDurationSec}
            onChange={(event) => setDraftSetting("resultDurationSec", event.target.value)}
            onBlur={() => commitNumberSetting("resultDurationSec")}
            onKeyDown={(event) => handleNumberKeyDown(event, "resultDurationSec")}
          />
        </label>
      </div>
      {room.settings.difficulty === "custom" && (
        <div className="custom-dictionary">
          <div>
            <p className="section-title">Свой словарь</p>
            <p className="muted">Сейчас слов: {room.customWordCount}. Нужно минимум 10. Одно слово на строку, без пробелов.</p>
          </div>
          {isHost ? (
            <>
              <textarea
                value={customWordsText}
                onChange={(event) => setCustomWordsText(event.target.value)}
                placeholder={"корабль\nмолния\nпожарный"}
                rows={8}
              />
              <button className="secondary" type="button" onClick={saveCustomWords}>
                <Save size={18} />
                {customWordsSaved ? "Сохранено" : "Сохранить словарь"}
              </button>
              {customWordsSaved && (
                <p className="notice ready-notice">
                  <span className="ready-icon" aria-hidden="true">
                    <Check size={18} />
                  </span>
                  <span>Словарь сохранен и используется в игре. Сейчас слов: {room.customWordCount}.</span>
                </p>
              )}
              {!customWordsSaved && room.customWordCount >= 10 && (
                <p className="notice">Используется свой словарь. Сейчас слов: {room.customWordCount}.</p>
              )}
            </>
          ) : (
            <p className="notice">Хост загрузит свой словарь перед стартом.</p>
          )}
        </div>
      )}
      {isHost ? (
        <>
          {room.settings.difficulty === "custom" && room.customWordCount < 10 && (
            <p className="notice">Для старта со своим словарем нужно минимум 10 сохраненных слов.</p>
          )}
          <button className="primary" disabled={!canStartGame} onClick={() => socket.emit("game:start", { roomId: room.id })}>
            <Flag size={18} />
            Начать игру
          </button>
        </>
      ) : (
        <p className="notice">Хост начнет игру, когда все будут готовы.</p>
      )}
    </div>
  );
}

function MineSubmission({
  room,
  isExplainer,
  isHost,
  mineWord,
  setMineWord,
  addMine,
}: {
  room: RoomSnapshot;
  isExplainer: boolean;
  isHost: boolean;
  mineWord: string;
  setMineWord: (value: string) => void;
  addMine: (event: React.FormEvent) => void;
}) {
  const round = room.currentRound!;
  const remaining = room.settings.minesPerPlayer - round.myMineCount;
  const secondsLeft = useCountdown(round);
  const totalMineSlots = Math.max(0, (room.players.length - 2) * room.settings.minesPerPlayer);
  const allMinesSubmitted = totalMineSlots > 0 && round.mineCount >= totalMineSlots;

  return (
    <div className="stage">
      <p className="eyebrow">Раунд {room.roundIndex}</p>
      <div className="timer">{secondsLeft}</div>
      <RoleLine round={round} selfId={room.selfId} />
      <TargetWord word={round.word} hiddenLabel="Слово скрыто" />

      {isExplainer ? (
        <div className={allMinesSubmitted ? "notice ready-notice" : "notice"}>
          {allMinesSubmitted && (
            <span className="ready-icon" aria-hidden="true">
              <Check size={18} />
            </span>
          )}
          <span>
            Остальные игроки придумывают мины. Сейчас мин: {round.mineCount}.
            {allMinesSubmitted && " Все возможные мины поставлены, можно начинать объяснение."}
          </span>
        </div>
      ) : !round.canSubmitMines ? (
        <p className="notice">Минеры придумывают мины. Вам видно только количество мин: {round.mineCount}.</p>
      ) : (
        <>
          <form className="mine-form" onSubmit={addMine}>
            <label className="field">
              <span>Мина</span>
              <input
                value={mineWord}
                disabled={remaining <= 0}
                onChange={(event) => setMineWord(event.target.value)}
                placeholder={remaining > 0 ? `Осталось: ${remaining}` : "Лимит исчерпан"}
              />
            </label>
            <button className="primary compact" disabled={remaining <= 0}>
              <Plus size={18} />
              Добавить
            </button>
          </form>
          <MineList mines={round.mines ?? []} editable roomId={room.id} selfId={room.selfId} />
        </>
      )}

      {(isHost || isExplainer) && (
        <button className="primary" disabled={round.mineCount === 0} onClick={() => socket.emit("round:start", { roomId: room.id })}>
          <Timer size={18} />
          Начать объяснение
        </button>
      )}
    </div>
  );
}

function Explaining({
  room,
  isExplainer,
  isGuesser,
  isHost,
  soundEnabled,
}: {
  room: RoomSnapshot;
  isExplainer: boolean;
  isGuesser: boolean;
  isHost: boolean;
  soundEnabled: boolean;
}) {
  const round = room.currentRound!;
  const secondsLeft = useCountdown(round);
  const isMiner = !isExplainer && !isGuesser;
  const canConfirmSuccess = isExplainer;
  const canSkip = isGuesser || isExplainer;
  const skipLabel = isGuesser ? "Сдаться" : "Не угадали";
  useTimerWarning(secondsLeft, room.phase, round.isTimerPaused, soundEnabled);

  return (
    <div className="stage">
      <p className="eyebrow">Объяснение</p>
      <div className="timer">{secondsLeft}</div>
      <RoleLine round={round} selfId={room.selfId} />
      <TargetWord word={isExplainer || isMiner ? round.word : undefined} hiddenLabel="Угадывайте слово" />
      <p className="notice">Мин в раунде: {round.mineCount}</p>

      {round.mines && (
        <MineList
          mines={round.mines}
          clickable={isMiner}
          roomId={room.id}
          triggeredWords={(round.triggeredMines ?? []).map((mine) => mine.word)}
        />
      )}

      <div className="actions">
        {canConfirmSuccess && (
          <button className="success" onClick={() => socket.emit("round:success", { roomId: room.id })}>
            <Check size={18} />
            Угадали
          </button>
        )}
        {canSkip && (
          <>
            <button className="danger" onClick={() => socket.emit("round:skip", { roomId: room.id })}>
              <Siren size={18} />
              {skipLabel}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function RoundResult({ room, isHost }: { room: RoomSnapshot; isHost: boolean }) {
  const round = room.currentRound!;
  const secondsLeft = useCountdown(round);
  const hasTriggeredMines = (round.triggeredMines?.length ?? 0) > 0;
  const statusText = getRoundResultTitle(round.status, hasTriggeredMines);

  return (
    <div className="stage">
      <p className="eyebrow">Результат</p>
      <h2>{statusText}</h2>
      <div className="timer small">{secondsLeft}</div>
      <p className="muted">
        Слово: <strong>{round.word ?? "неизвестно"}</strong>
      </p>
      {round.resultMine && <p className="notice">Мина: {round.resultMine.word}</p>}
      {(round.triggeredMines?.length ?? 0) > 0 && <p className="notice">Попались на мин: {round.triggeredMines?.length}</p>}
      <ScoreDeltaList deltas={round.scoreDeltas} />
      <MineList mines={round.mines ?? []} triggeredWords={(round.triggeredMines ?? []).map((mine) => mine.word)} />
      {isHost && (
        <button className="primary" onClick={() => socket.emit("round:next", { roomId: room.id })}>
          <Flag size={18} />
          Следующий раунд
        </button>
      )}
    </div>
  );
}

function ScoreDeltaList({ deltas }: { deltas: ScoreDelta[] }) {
  if (deltas.length === 0) {
    return <p className="notice">Очки в раунде не изменились.</p>;
  }

  return (
    <div className="score-deltas">
      {deltas.map((delta) => (
        <div className="score-delta" key={`${delta.playerId}-${delta.reason}`}>
          <span>{delta.playerName}</span>
          <strong className={delta.delta > 0 ? "positive" : "negative"}>
            {delta.delta > 0 ? "+" : ""}
            {delta.delta}
          </strong>
          <small>{delta.reason}</small>
        </div>
      ))}
    </div>
  );
}

function getRoundResultTitle(status: NonNullable<RoomSnapshot["currentRound"]>["status"], hasTriggeredMines: boolean) {
  if (status === "success") {
    return hasTriggeredMines ? "Слово угадано, но с потерями" : "Идеально угадано";
  }
  if (status === "skipped") {
    return hasTriggeredMines ? "Сработали мины" : "Слово не угадано";
  }
  if (status === "timeout") {
    return hasTriggeredMines ? "Время вышло, мины сработали" : "Время вышло";
  }
  if (status === "failed") {
    return hasTriggeredMines ? "Сработали мины" : "Слово не угадано";
  }
  return "Раунд завершен";
}

function GameResult({ room, isHost }: { room: RoomSnapshot; isHost: boolean }) {
  const standings = room.finalStandings ?? [...room.players].sort((a, b) => b.score - a.score);
  const topThree = standings.slice(0, 3);
  const rest = standings.slice(3);

  return (
    <div className="stage final-stage">
      <p className="eyebrow">Итог игры</p>
      <h2>Победители</h2>
      <div className="podium">
        {topThree.map((player, index) => (
          <div className={`podium-place place-${index + 1}`} key={player.id}>
            {index === 0 ? <Crown size={30} /> : index === 1 ? <Trophy size={28} /> : <Medal size={28} />}
            <strong>{player.name}</strong>
            <span>{player.score}</span>
          </div>
        ))}
      </div>
      {rest.length > 0 && (
        <div className="final-list">
          {rest.map((player, index) => (
            <div className="final-row" key={player.id}>
              <span>{index + 4}. {player.name}</span>
              <strong>{player.score}</strong>
            </div>
          ))}
        </div>
      )}
      {isHost && (
        <button className="primary" onClick={() => socket.emit("game:reset", { roomId: room.id })}>
          <RotateCcw size={18} />
          Новая игра
        </button>
      )}
    </div>
  );
}

function TimerControls({ room }: { room: RoomSnapshot }) {
  const round = room.currentRound;
  if (!round) {
    return null;
  }

  return round.isTimerPaused ? (
    <button className="secondary" onClick={() => socket.emit("timer:resume", { roomId: room.id })}>
      <Play size={18} />
      Продолжить таймер
    </button>
  ) : (
    <button className="secondary" onClick={() => socket.emit("timer:pause", { roomId: room.id })}>
      <Pause size={18} />
      Пауза
    </button>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Правила игры">
      <section className="rules-modal">
        <div className="modal-title">
          <h2>Правила</h2>
          <button className="icon-button" type="button" aria-label="Закрыть правила" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="rules-list">
          <p>Играйте голосом где удобно: сайт ведет комнаты, роли, таймеры, мины и очки.</p>
          <p>Хост создает комнату, выбирает сложность, таймеры, количество мин и условие финала.</p>
          <p>В каждом раунде один игрок объясняет слово, следующий по кругу угадывает, остальные становятся минерами.</p>
          <p>Минеры до начала объяснения добавляют и редактируют свои мины. Объясняющий и отгадывающий список мин не видят.</p>
          <p>Во время объяснения минеры нажимают на сработавшие мины и могут снять отметку, если ошиблись.</p>
          <p>Слово подтверждает объясняющий. Отгадывающий может сдаться, а объясняющий отметить, что слово не угадали.</p>
          <p>За угаданное слово объясняющий и отгадывающий получают +1. За провал или таймер оба теряют 1 очко.</p>
          <p>Каждая сработавшая мина снимает еще по 1 очку с объясняющего и отгадывающего, а автору мины дает +1.</p>
          <p>После результата следующий раунд стартует автоматически, пока не выполнено условие финала.</p>
        </div>
      </section>
    </div>
  );
}

function MineList({
  mines,
  clickable,
  editable,
  roomId,
  selfId,
  triggeredWords = [],
}: {
  mines: Mine[];
  clickable?: boolean;
  editable?: boolean;
  roomId?: string;
  selfId?: string;
  triggeredWords?: string[];
}) {
  if (mines.length === 0) {
    return <p className="muted">Мин пока нет.</p>;
  }

  return (
    <div className="mine-list">
      {mines.map((mine) => (
        <MineChip
          key={`${mine.word}-${mine.authorPlayerId}`}
          mine={mine}
          clickable={clickable}
          editable={editable && mine.authorPlayerId === selfId}
          roomId={roomId}
          isTriggered={triggeredWords.includes(mine.word)}
        />
      ))}
    </div>
  );
}

function MineChip({
  mine,
  clickable,
  editable,
  roomId,
  isTriggered,
}: {
  mine: Mine;
  clickable?: boolean;
  editable?: boolean;
  roomId?: string;
  isTriggered?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(mine.word);
  const [pendingTriggered, setPendingTriggered] = useState<boolean | null>(null);
  const effectiveTriggered = pendingTriggered ?? Boolean(isTriggered);

  useEffect(() => {
    setDraft(mine.word);
  }, [mine.word]);

  useEffect(() => {
    setPendingTriggered(null);
  }, [isTriggered]);

  function saveEdit() {
    if (!roomId) return;
    socket.emit("mine:update", { roomId, oldWord: mine.word, newWord: draft });
    setIsEditing(false);
  }

  if (editable && isEditing) {
    return (
      <form
        className="mine-edit"
        onSubmit={(event) => {
          event.preventDefault();
          saveEdit();
        }}
      >
        <input value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus />
        <button className="icon-button" type="submit" aria-label="Сохранить">
          <Save size={16} />
        </button>
        <button className="icon-button" type="button" aria-label="Отмена" onClick={() => setIsEditing(false)}>
          <X size={16} />
        </button>
      </form>
    );
  }

  return (
    <span
      className={[
        "mine-chip",
        clickable ? "clickable" : "",
        editable ? "editable" : "",
        effectiveTriggered ? "triggered" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        className="mine-word"
        disabled={!clickable}
        onClick={() => {
          if (!clickable) return;
          const nextTriggered = !effectiveTriggered;
          setPendingTriggered(nextTriggered);
          socket.emit("round:mine", { roomId, mineWord: mine.word, triggered: nextTriggered });
        }}
      >
        {mine.word}
        <span>{mine.authorName}</span>
        {effectiveTriggered && <b>сработала</b>}
      </button>
      {editable && (
        <button className="mine-edit-button" type="button" aria-label="Редактировать мину" onClick={() => setIsEditing(true)}>
          <Edit3 size={15} />
        </button>
      )}
    </span>
  );
}

function RoleLine({ round, selfId }: { round: NonNullable<RoomSnapshot["currentRound"]>; selfId: string }) {
  const explainerName = round.explainerId === selfId ? "Вы" : round.explainerName;
  const guesserName = round.guesserId === selfId ? "Вы" : round.guesserName;
  const explainerLabel = round.explainerId === selfId ? "Объясняете" : "Объясняет";
  const guesserLabel = round.guesserId === selfId ? "Угадываете" : "Угадывает";

  return (
    <div className="role-banner">
      <div className="role-pill role-pill-explainer">
        <span>{explainerLabel}</span>
        <strong>{explainerName}</strong>
      </div>
      <div className="role-pill role-pill-guesser">
        <span>{guesserLabel}</span>
        <strong>{guesserName}</strong>
      </div>
    </div>
  );
}

function TargetWord({ word, hiddenLabel }: { word?: string; hiddenLabel: string }) {
  return (
    <div className={word ? "target-word" : "target-word target-word-hidden"}>
      <span>Слово</span>
      <h2>{word ?? hiddenLabel}</h2>
    </div>
  );
}

function getPlayerRowClassName(
  player: Player,
  round: RoomSnapshot["currentRound"],
  selfId: string,
): string {
  return [
    "player-row",
    player.id === selfId ? "self" : "",
    player.id === round?.explainerId ? "role-explainer" : "",
    player.id === round?.guesserId ? "role-guesser" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function useCountdown(round: NonNullable<RoomSnapshot["currentRound"]>) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  if (round.isTimerPaused && round.timerRemainingMs !== undefined) {
    return Math.max(0, Math.ceil(round.timerRemainingMs / 1000));
  }

  if (!round.timerEndsAt) {
    return round.durationSec;
  }
  return Math.max(0, Math.ceil((round.timerEndsAt - now) / 1000));
}

function useTimerWarning(secondsLeft: number, phase: RoomSnapshot["phase"], isPaused: boolean, soundEnabled: boolean) {
  const lastSecondRef = useRef<number | null>(null);

  useEffect(() => {
    if (!soundEnabled || phase !== "explaining" || isPaused || secondsLeft <= 0 || secondsLeft > 10) {
      lastSecondRef.current = secondsLeft;
      return;
    }
    if (lastSecondRef.current === secondsLeft) {
      return;
    }

    lastSecondRef.current = secondsLeft;
    playTimerTick(secondsLeft);
  }, [secondsLeft, phase, isPaused, soundEnabled]);
}

function playTimerTick(secondsLeft: number) {
  const AudioContextClass =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  const audioContext = new AudioContextClass();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();
  const now = audioContext.currentTime;
  const urgent = secondsLeft <= 3;
  const frequency = urgent ? 660 + (3 - secondsLeft) * 70 : 440;
  const duration = urgent ? 0.16 : 0.12;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.82, now + duration);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1400, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(urgent ? 0.12 : 0.075, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
  window.setTimeout(() => void audioContext.close(), 240);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
