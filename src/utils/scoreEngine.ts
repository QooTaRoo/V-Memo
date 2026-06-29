export interface MatchSettings {
  teamAName: string;
  teamBName: string;
  maxSets: number;
  normalSetPoints: number;
  finalSetPoints: number;
  theme: string;
  overlaySize: number;
  overlayPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export interface SetScore {
  scoreA: number;
  scoreB: number;
}

export interface EventState {
  scoreA: number;
  scoreB: number;
  setsA: number;
  setsB: number;
  setScores: SetScore[];
  servingTeam: 'A' | 'B' | null;
  matchFinished: boolean;
  setWinner: 'A' | 'B' | null;
  overlayVisible: boolean;
}

export interface ScoreEvent {
  id: string;
  timestamp: number;
  type: 'serve_change' | 'point' | 'set_confirm' | 'reset' | 'set_score_direct' | 'overlay_toggle';
  team: 'A' | 'B' | null;
  state: EventState;
  overlayVisible?: boolean;
}

export interface ExportRange {
  id: string;
  name: string;
  inPoint: number;
  outPoint: number;
}

export interface ProjectData {
  matchSettings: MatchSettings;
  events: ScoreEvent[];
  videoPath?: string | null;
  exportRanges?: ExportRange[];
}

export const INITIAL_STATE: EventState = {
  scoreA: 0,
  scoreB: 0,
  setsA: 0,
  setsB: 0,
  setScores: [],
  servingTeam: null,
  matchFinished: false,
  setWinner: null,
  overlayVisible: true
};

export function findActiveEventIndex(events: ScoreEvent[], T: number): number {
  if (events.length === 0) return -1;

  let low = 0;
  let high = events.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (events[mid].timestamp <= T) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

export function getActiveEventState(events: ScoreEvent[], T: number): EventState {
  const index = findActiveEventIndex(events, T);
  if (index === -1) {
    return INITIAL_STATE;
  }
  return events[index].state;
}

/**
 * すべてのイベントの状態（state）を、時系列順にバレーボールルールに従って再計算します。
 * イベント追加・削除・編集や試合設定変更の後に呼び出します。
 */
export function recalculateEventStates(events: ScoreEvent[], settings: MatchSettings): ScoreEvent[] {
  // タイムスタンプ順にソート
  const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
  
  let scoreA = 0;
  let scoreB = 0;
  let setsA = 0;
  let setsB = 0;
  let setScores: SetScore[] = [];
  let servingTeam: 'A' | 'B' | null = null;
  let matchFinished = false;
  let setWinner: 'A' | 'B' | null = null;
  let overlayVisible = true;

  // 勝利に必要なセット数 (過半数)
  const totalSetsToWin = Math.ceil(settings.maxSets / 2);

  for (let i = 0; i < sortedEvents.length; i++) {
    const event = sortedEvents[i];

    // 直前のイベントでセット獲得が確定していた場合、
    // 次のイベントが 'set_confirm' であればセット数を増やし、得点をリセットする
    if (event.type === 'set_confirm') {
      if (setWinner === 'A') {
        setsA += 1;
        setScores.push({ scoreA, scoreB });
      } else if (setWinner === 'B') {
        setsB += 1;
        setScores.push({ scoreA, scoreB });
      }
      
      // 得点の初期化とセット勝者のクリア
      scoreA = 0;
      scoreB = 0;
      setWinner = null;

      // 試合終了判定
      if (setsA >= totalSetsToWin || setsB >= totalSetsToWin) {
        matchFinished = true;
      }
    } else if (event.type === 'point') {
      // 試合終了後やセット確定待ち時は得点加算しない
      if (!matchFinished && !setWinner) {
        if (event.team === 'A') {
          scoreA += 1;
          servingTeam = 'A';
        } else if (event.team === 'B') {
          scoreB += 1;
          servingTeam = 'B';
        }

        // 現在何セット目かを計算
        const currentSetNum = setsA + setsB + 1;
        const isFinalSet = currentSetNum === settings.maxSets;
        const targetPoints = isFinalSet ? settings.finalSetPoints : settings.normalSetPoints;

        // デュース判定 (目標点以上かつ2点差)
        if (scoreA >= targetPoints && (scoreA - scoreB) >= 2) {
          setWinner = 'A';
        } else if (scoreB >= targetPoints && (scoreB - scoreA) >= 2) {
          setWinner = 'B';
        }
      }
    } else if (event.type === 'serve_change') {
      servingTeam = event.team;
    } else if (event.type === 'reset') {
      scoreA = 0;
      scoreB = 0;
      setsA = 0;
      setsB = 0;
      setScores = [];
      servingTeam = null;
      matchFinished = false;
      setWinner = null;
      overlayVisible = true;
    } else if (event.type === 'set_score_direct') {
      // 手動でのセット直接調整用
      if (event.team === 'A') {
        setsA = event.state?.setsA ?? setsA;
      } else if (event.team === 'B') {
        setsB = event.state?.setsB ?? setsB;
      }
    } else if (event.type === 'overlay_toggle') {
      overlayVisible = event.overlayVisible ?? !overlayVisible;
    }

    // 状態を現在のイベントスナップショットに保存
    event.state = {
      scoreA,
      scoreB,
      setsA,
      setsB,
      setScores: [...setScores],
      servingTeam,
      matchFinished,
      setWinner,
      overlayVisible
    };
  }

  return sortedEvents;
}
