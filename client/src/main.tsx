import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { io } from "socket.io-client";
import { Check, Copy, Crown, Flag, KeyRound, LogIn, Medal, Pause, Play, Plus, RotateCcw, SkipForward, Timer, Trophy, Users } from "lucide-react";
import "./styles.css";

const socket = io(import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001");

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
  };
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

function App() {
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState("");
  const [playerName, setPlayerName] = useState(localStorage.getItem("playerName") ?? "");
  const [mineWord, setMineWord] = useState("");
  const [copied, setCopied] = useState(false);

  const roomIdFromUrl = useMemo(() => {
    const match = window.location.pathname.match(/\/room\/([A-Za-z0-9]+)/);
    return match?.[1]?.toUpperCase() ?? "";
  }, []);

  const self = room?.players.find((player) => player.id === room.selfId);
  const isHost = Boolean(self?.isHost);
  const round = room?.currentRound;
  const isExplainer = Boolean(round && room?.selfId === round.explainerId);
  const isGuesser = Boolean(round && room?.selfId === round.guesserId);
  const canStartGame = Boolean(room && isHost && room.players.length >= 3);

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

  if (!room) {
    return (
      <main className="page auth-page">
        <section className="auth-panel">
          <div>
            <p className="eyebrow">MVP</p>
            <h1>Слова-мины</h1>
            <p className="muted">Создайте комнату или войдите по приглашению. Голосовой созвон остается вне игры.</p>
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
          {error && <p className="error">{error}</p>}
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
        </div>
        <button className="secondary icon-text" onClick={copyInvite}>
          <Copy size={18} />
          {copied ? "Скопировано" : "Пригласить"}
        </button>
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
              <div className="player-row" key={player.id}>
                <div>
                  <strong className="player-name">
                    {player.name}
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
            <Explaining room={room} isExplainer={isExplainer} isGuesser={isGuesser} isHost={isHost} />
          )}

          {room.phase === "round_result" && round && <RoundResult room={room} isHost={isHost} />}
          {room.phase === "game_result" && <GameResult room={room} isHost={isHost} />}
        </section>
      </div>
    </main>
  );
}

function Lobby({ room, isHost, canStartGame }: { room: RoomSnapshot; isHost: boolean; canStartGame: boolean }) {
  function updateSetting(key: keyof RoomSnapshot["settings"], value: string) {
    const nextValue = key === "endCondition" ? value : Number(value);
    socket.emit("settings:update", {
      roomId: room.id,
      settings: {
        ...room.settings,
        [key]: nextValue,
      },
    });
  }

  return (
    <div className="stage">
      <p className="eyebrow">Лобби</p>
      <h2>Ожидание игроков</h2>
      <p className="muted">Минимум 3 игрока. Сейчас в комнате: {room.players.length}.</p>
      <div className="settings-grid">
        <label className="field">
          <span>Финал игры</span>
          <select
            disabled={!isHost}
            value={room.settings.endCondition}
            onChange={(event) => updateSetting("endCondition", event.target.value)}
          >
            <option value="target_score">По очкам</option>
            <option value="rounds">По раундам</option>
          </select>
        </label>
        <label className="field">
          <span>Очков для победы</span>
          <input
            type="number"
            min={1}
            max={100}
            disabled={!isHost || room.settings.endCondition !== "target_score"}
            value={room.settings.targetScore}
            onChange={(event) => updateSetting("targetScore", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Количество раундов</span>
          <input
            type="number"
            min={1}
            max={100}
            disabled={!isHost || room.settings.endCondition !== "rounds"}
            value={room.settings.maxRounds}
            onChange={(event) => updateSetting("maxRounds", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Мин на игрока</span>
          <input
            type="number"
            min={1}
            max={10}
            disabled={!isHost}
            value={room.settings.minesPerPlayer}
            onChange={(event) => updateSetting("minesPerPlayer", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Секунд на мины</span>
          <input
            type="number"
            min={10}
            max={300}
            disabled={!isHost}
            value={room.settings.mineSubmissionDurationSec}
            onChange={(event) => updateSetting("mineSubmissionDurationSec", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Секунд на объяснение</span>
          <input
            type="number"
            min={10}
            max={300}
            disabled={!isHost}
            value={room.settings.roundDurationSec}
            onChange={(event) => updateSetting("roundDurationSec", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Секунд результата</span>
          <input
            type="number"
            min={5}
            max={120}
            disabled={!isHost}
            value={room.settings.resultDurationSec}
            onChange={(event) => updateSetting("resultDurationSec", event.target.value)}
          />
        </label>
      </div>
      {isHost ? (
        <button className="primary" disabled={!canStartGame} onClick={() => socket.emit("game:start", { roomId: room.id })}>
          <Flag size={18} />
          Начать игру
        </button>
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

  return (
    <div className="stage">
      <p className="eyebrow">Раунд {room.roundIndex}</p>
      <div className="timer">{secondsLeft}</div>
      <h2>{round.word ?? "Слово скрыто"}</h2>
      <RoleLine round={round} />
      {isHost && <TimerControls room={room} />}

      {isExplainer ? (
        <p className="notice">Остальные игроки придумывают мины. Список мин скрыт.</p>
      ) : !round.canSubmitMines ? (
        <p className="notice">Минеры придумывают мины. Вам пока видно только количество мин: {round.mineCount}.</p>
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
          <MineList mines={round.mines ?? []} />
        </>
      )}

      {isHost && (
        <button className="primary" disabled={round.mineCount === 0} onClick={() => socket.emit("round:start", { roomId: room.id })}>
          <Timer size={18} />
          Начать объяснение
        </button>
      )}
    </div>
  );
}

function Explaining({ room, isExplainer, isGuesser, isHost }: { room: RoomSnapshot; isExplainer: boolean; isGuesser: boolean; isHost: boolean }) {
  const round = room.currentRound!;
  const secondsLeft = useCountdown(round);
  const canControl = isHost || isGuesser || isExplainer;

  return (
    <div className="stage">
      <p className="eyebrow">Объяснение</p>
      <div className="timer">{secondsLeft}</div>
      {isExplainer ? <h2>{round.word}</h2> : <h2>{isGuesser ? "Угадывайте слово" : round.word}</h2>}
      <RoleLine round={round} />
      {isHost && <TimerControls room={room} />}
      <p className="notice">Мин в раунде: {round.mineCount}</p>

      {round.mines && (
        <MineList
          mines={round.mines}
          clickable
          roomId={room.id}
          triggeredWords={(round.triggeredMines ?? []).map((mine) => mine.word)}
        />
      )}

      <div className="actions">
        {canControl && (
          <>
            <button className="success" onClick={() => socket.emit("round:success", { roomId: room.id })}>
              <Check size={18} />
              Угадали
            </button>
            <button className="secondary" onClick={() => socket.emit("round:skip", { roomId: room.id })}>
              <SkipForward size={18} />
              Скип
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
  const statusText = {
    success: "Слово угадали",
    failed: "Сработала мина",
    skipped: "Раунд пропущен",
    timeout: "Время вышло",
    waiting_mines: "Раунд завершен",
    active: "Раунд завершен",
  }[round.status];

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
      {isHost && <TimerControls room={room} />}
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

function MineList({
  mines,
  clickable,
  roomId,
  triggeredWords = [],
}: {
  mines: Mine[];
  clickable?: boolean;
  roomId?: string;
  triggeredWords?: string[];
}) {
  if (mines.length === 0) {
    return <p className="muted">Мин пока нет.</p>;
  }

  return (
    <div className="mine-list">
      {mines.map((mine) => (
        <button
          className={[
            "mine-chip",
            clickable ? "clickable" : "",
            triggeredWords.includes(mine.word) ? "triggered" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          key={`${mine.word}-${mine.authorPlayerId}`}
          disabled={!clickable}
          onClick={() => clickable && socket.emit("round:mine", { roomId, mineWord: mine.word })}
        >
          {mine.word}
          <span>{mine.authorName}</span>
        </button>
      ))}
    </div>
  );
}

function RoleLine({ round }: { round: NonNullable<RoomSnapshot["currentRound"]> }) {
  return (
    <p className="muted">
      Объясняет: <strong>{round.explainerName}</strong>. Угадывает: <strong>{round.guesserName}</strong>.
    </p>
  );
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
