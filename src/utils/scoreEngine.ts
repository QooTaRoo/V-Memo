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
}

export interface ScoreEvent {
  id: string;
  timestamp: number;
  type: 'serve_change' | 'point' | 'set_confirm' | 'reset' | 'set_score_direct';
  team: 'A' | 'B' | null;
  state: EventState;
}

export interface ProjectData {
  matchSettings: MatchSettings;
  events: ScoreEvent[];
  videoPath?: string | null;
}

export const INITIAL_STATE: EventState = {
  scoreA: 0,
  scoreB: 0,
  setsA: 0,
  setsB: 0,
  setScores: [],
  servingTeam: null,
  matchFinished: false,
  setWinner: null
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
