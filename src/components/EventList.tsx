import React from 'react'
import { ScoreEvent } from '../utils/scoreEngine'
import './EventList.css'

interface EventListProps {
  events: ScoreEvent[]
  activeEventIndex: number
  onEventClick: (timestamp: number) => void
  teamAName: string
  teamBName: string
}

export const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
}

export const EventList: React.FC<EventListProps> = ({
  events,
  activeEventIndex,
  onEventClick,
  teamAName,
  teamBName
}) => {
  return (
    <div className="event-list-container">
      <div className="event-list-header">
        <h3>イベント履歴</h3>
        <span className="event-count">{events.length} 件</span>
      </div>
      <div className="event-list-scroll">
        {events.length === 0 ? (
          <div className="no-events">
            プロジェクトJSONをロードすると、ここにスコア履歴が表示されます。
          </div>
        ) : (
          events.map((event, idx) => {
            const isActive = idx === activeEventIndex
            const { state, type, team } = event
            
            let detailText = ''
            if (type === 'serve_change') {
              detailText = `${team === 'A' ? teamAName || 'Aチーム' : teamBName || 'Bチーム'} サーブ権`
            } else if (type === 'point') {
              const actingTeam = team === 'A' ? teamAName || 'Aチーム' : teamBName || 'Bチーム'
              detailText = `${actingTeam} が得点`
            }

            return (
              <div
                key={event.id}
                className={`event-card ${isActive ? 'active' : ''}`}
                onClick={() => onEventClick(event.timestamp)}
              >
                <div className="event-card-header">
                  <span className="event-time">{formatTime(event.timestamp)}</span>
                  <span className={`event-tag tag-${type}`}>
                    {type === 'point' ? '得点' : 'サーブ'}
                  </span>
                </div>
                <div className="event-card-body">
                  <div className="event-detail">{detailText}</div>
                  <div className="event-scores-row">
                    <div className="score-display">
                      <span className="score-team-badge">A</span>
                      <span className="score-num">{state.scoreA}</span>
                      <span className="score-colon">:</span>
                      <span className="score-num">{state.scoreB}</span>
                      <span className="score-team-badge">B</span>
                    </div>
                    {state.setWinner && (
                      <span className="set-winner-badge">
                        セット獲得: {state.setWinner === 'A' ? 'A' : 'B'}
                      </span>
                    )}
                  </div>
                  {state.setScores.length > 0 && (
                    <div className="set-scores-history">
                      {state.setScores.map((s, sIdx) => (
                        <span key={sIdx} className="history-set">
                          {s.scoreA}-{s.scoreB}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
