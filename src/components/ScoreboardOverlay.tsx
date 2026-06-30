import React from 'react'
import { EventState, MatchSettings } from '../utils/scoreEngine'
import './ScoreboardOverlay.css'

interface ScoreboardOverlayProps {
  state: EventState
  settings: MatchSettings
  swapTeams?: boolean
  scaleFactor?: number
}

export const ScoreboardOverlay: React.FC<ScoreboardOverlayProps> = ({ state, settings, swapTeams = false, scaleFactor = 1.0 }) => {
  const { teamAName, teamBName, overlaySize, overlayPosition } = settings
  const { scoreA, scoreB, setsA, setsB, servingTeam, setScores } = state

  const positionClass = `overlay-pos-${overlayPosition}`
  const scaleStyle = {
    transform: `scale(${(overlaySize / 200) * scaleFactor})`,
    transformOrigin: overlayPosition.replace('-', ' ')
  }

  const totalSetDots = Math.ceil(settings.maxSets / 2)
  const colorA = settings.teamAColor || '#ff9100'
  const colorB = settings.teamBColor || '#f50057'

  const teamARow = (
    <div className="team-row" key="teamA">
      <div className="serve-indicator-container">
        {servingTeam === 'A' && <span className="serve-volleyball" style={{ filter: `drop-shadow(0 0 4px ${colorA})` }}>🏐</span>}
      </div>
      <span className="team-name" style={{ color: colorA }}>{teamAName || 'TEAM A'}</span>
      <span className="team-score" style={{ color: colorA, textShadow: `0 0 10px ${colorA}4D` }}>{scoreA}</span>
      <div className="team-sets">
        {Array.from({ length: totalSetDots }).map((_, i) => (
          <span 
            key={i} 
            className={`set-dot ${i < setsA ? 'filled' : ''}`} 
            style={i < setsA ? { backgroundColor: colorA, borderColor: colorA, boxShadow: `0 0 8px ${colorA}, 0 0 15px ${colorA}80` } : undefined}
          />
        ))}
      </div>
    </div>
  )

  const teamBRow = (
    <div className="team-row" key="teamB">
      <div className="serve-indicator-container">
        {servingTeam === 'B' && <span className="serve-volleyball" style={{ filter: `drop-shadow(0 0 4px ${colorB})` }}>🏐</span>}
      </div>
      <span className="team-name" style={{ color: colorB }}>{teamBName || 'TEAM B'}</span>
      <span className="team-score" style={{ color: colorB, textShadow: `0 0 10px ${colorB}4D` }}>{scoreB}</span>
      <div className="team-sets">
        {Array.from({ length: totalSetDots }).map((_, i) => (
          <span 
            key={i} 
            className={`set-dot ${i < setsB ? 'filled' : ''}`} 
            style={i < setsB ? { backgroundColor: colorB, borderColor: colorB, boxShadow: `0 0 8px ${colorB}, 0 0 15px ${colorB}80` } : undefined}
          />
        ))}
      </div>
    </div>
  )

  if (settings.theme === 'broadcast-bar') {
    // テレビ中継風横長スリムバーデザイン
    // [サーブA] チームA [セット点数A] | 得点A : 得点B | [セット点数B] チームB [サーブB]
    return (
      <div className={`scoreboard-overlay ${positionClass} theme-broadcast-bar`} style={scaleStyle}>
        <div className="scoreboard-glass broadcast-bar-wrapper">
          <div className="broadcast-team-block top-team-block">
            <div className="serve-indicator-container">
              {servingTeam === 'A' && <span className="serve-volleyball" style={{ filter: `drop-shadow(0 0 4px ${colorA})` }}>🏐</span>}
            </div>
            <span className="team-name" style={{ color: colorA }}>{teamAName || 'TEAM A'}</span>
            <div className="team-sets">
              {Array.from({ length: totalSetDots }).map((_, i) => (
                <span 
                  key={i} 
                  className={`set-dot ${i < setsA ? 'filled' : ''}`} 
                  style={i < setsA ? { backgroundColor: colorA, borderColor: colorA, boxShadow: `0 0 6px ${colorA}` } : undefined}
                />
              ))}
            </div>
          </div>
          
          <div className="broadcast-divider" />
          
          <div className="broadcast-score-block">
            <span className="team-score" style={{ color: colorA, textShadow: `0 0 10px ${colorA}4d` }}>{scoreA}</span>
            <span className="score-sep">-</span>
            <span className="team-score" style={{ color: colorB, textShadow: `0 0 10px ${colorB}4d` }}>{scoreB}</span>
          </div>

          <div className="broadcast-divider" />

          <div className="broadcast-team-block bottom-team-block">
            <div className="team-sets">
              {Array.from({ length: totalSetDots }).map((_, i) => (
                <span 
                  key={i} 
                  className={`set-dot ${i < setsB ? 'filled' : ''}`} 
                  style={i < setsB ? { backgroundColor: colorB, borderColor: colorB, boxShadow: `0 0 6px ${colorB}` } : undefined}
                />
              ))}
            </div>
            <span className="team-name" style={{ color: colorB }}>{teamBName || 'TEAM B'}</span>
            <div className="serve-indicator-container">
              {servingTeam === 'B' && <span className="serve-volleyball" style={{ filter: `drop-shadow(0 0 4px ${colorB})` }}>🏐</span>}
            </div>
          </div>

          {setScores.length > 0 && (
            <>
              <div className="broadcast-divider" />
              <div className="broadcast-past-sets">
                {setScores.map((set, idx) => (
                  <span key={idx} className="past-set-pill">
                    S{idx + 1}:{set.scoreA}-{set.scoreB}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  const themeClass = `theme-${settings.theme || 'modern-dark'}`

  return (
    <div className={`scoreboard-overlay ${positionClass} ${themeClass}`} style={scaleStyle}>
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
