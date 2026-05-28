export type RoomPhase = "lobby" | "mine_submission" | "explaining" | "round_result" | "game_result";
export type RoundStatus = "waiting_mines" | "active" | "success" | "failed" | "skipped" | "timeout";
export type EndCondition = "target_score" | "rounds";
export type Difficulty = "easy" | "medium" | "hard";

export type Player = {
  id: string;
  name: string;
  score: number;
  isHost: boolean;
};

export type Mine = {
  word: string;
  authorPlayerId: string;
};

export type ScoreDelta = {
  playerId: string;
  playerName: string;
  delta: number;
  reason: string;
};

export type Round = {
  word: string;
  explainerId: string;
  guesserId: string;
  mines: Mine[];
  startedAt?: number;
  durationSec: number;
  timerEndsAt?: number;
  timerPausedAt?: number;
  timerRemainingMs?: number;
  status: RoundStatus;
  resultMine?: Mine;
  triggeredMines: Mine[];
  scoreDeltas: ScoreDelta[];
};

export type Room = {
  id: string;
  players: Player[];
  phase: RoomPhase;
  currentRound?: Round;
  roundIndex: number;
  usedWords: string[];
  settings: {
    roundDurationSec: number;
    mineSubmissionDurationSec: number;
    resultDurationSec: number;
    minesPerPlayer: number;
    endCondition: EndCondition;
    targetScore: number;
    maxRounds: number;
    difficulty: Difficulty;
  };
};

export type PublicMine = Mine & {
  authorName: string;
};

export type RoomSnapshot = {
  id: string;
  phase: RoomPhase;
  players: Player[];
  selfId: string;
  roundIndex: number;
  settings: Room["settings"];
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
    status: RoundStatus;
    mineCount: number;
    mines?: PublicMine[];
    myMineCount: number;
    canSubmitMines: boolean;
    resultMine?: PublicMine;
    triggeredMines?: PublicMine[];
    scoreDeltas: ScoreDelta[];
  };
};
