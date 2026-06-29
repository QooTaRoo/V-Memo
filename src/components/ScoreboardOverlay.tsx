import React from 'react'
import { EventState, MatchSettings } from '../utils/scoreEngine'
import './ScoreboardOverlay.css'

interface ScoreboardOverlayProps {
  state: EventState
  settings: MatchSettings
  swapTeams?: boolean
}

export const ScoreboardOverlay: React.FC<ScoreboardOverlayProps> = ({ state, settings, swapTeams = false }) => {
  const { teamAName, teamBName, overlaySize, overlayPosition } = settings
  const { scoreA, scoreB, setsA, setsB, servingTeam, setScores } = state

  const positionClass = `overlay-pos-${overlayPosition}`
  const scaleStyle = {
    transform: `scale(${overlaySize / 200})`,
    transformOrigin: overlayPosition.replace('-', ' ')
  }

  const totalSetDots = Math.ceil(settings.maxSets / 2)

  const teamARow = (
    <div className="team-row" key="teamA">
      <div className="serve-indicator-container">
        {servingTeam === 'A' && <span className="serve-volleyball">🏐</span>}
      </div>
      <span className="team-name">{teamAName || 'TEAM A'}</span>
      <span className="team-score">{scoreA}</span>
      <div className="team-sets">
        {Array.from({ length: totalSetDots }).map((_, i) => (
          <span key={i} className={`set-dot ${i < setsA ? 'filled' : ''}`} />
        ))}
      </div>
    </div>
  )

  const teamBRow = (
    <div className="team-row" key="teamB">
      <div className="serve-indicator-container">
        {servingTeam === 'B' && <span className="serve-volleyball">🏐</span>}
      </div>
      <span className="team-name">{teamBName || 'TEAM B'}</span>
      <span className="team-score">{scoreB}</span>
      <div className="team-sets">
        {Array.from({ length: totalSetDots }).map((_, i) => (
          <span key={i} className={`set-dot ${i < setsB ? 'filled' : ''}`} />
        ))}
      </div>
    </div>
  )

  return (
    <div className={`scoreboard-overlay ${positionClass}`} style={scaleStyle}>
      <div className="scoreboard-glass">
        <div className="scoreboard-teams">
          {swapTeams ? teamBRow : teamARow}
          {swapTeams ? teamARow : teamBRow}
        </div>

        {/* 過去セットのスコア履歴 */}
        {setScores.length > 0 && (
          <div className="past-set-scores">
            {setScores.map((set, idx) => (
              <div key={idx} className="past-set-item">
                <span className="past-set-label">S{idx + 1}</span>
                <span className="past-set-value">{set.scoreA} - {set.scoreB}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
