import React from 'react'
import { EventState, MatchSettings } from '../utils/scoreEngine'
import './ScoreController.css'

interface ScoreControllerProps {
  state: EventState
  settings: MatchSettings
  disabled: boolean
  onAddPoint: (team: 'A' | 'B') => void
  onRemovePoint: (team: 'A' | 'B') => void
  onSetConfirm: () => void
  onToggleServe: (team: 'A' | 'B') => void
  onReset: () => void
  showOverlay: boolean
  onToggleOverlay: () => void
}

export const ScoreController: React.FC<ScoreControllerProps> = ({
  state,
  settings,
  disabled,
  onAddPoint,
  onRemovePoint,
  onSetConfirm,
  onToggleServe,
  onReset,
  showOverlay,
  onToggleOverlay
}) => {
  const { scoreA, scoreB, setsA, setsB, servingTeam, setWinner, matchFinished } = state
  const { teamAName, teamBName } = settings

  return (
    <div className="score-controller-container">
      {/* チームA操作ブロック */}
      <div className={`team-control-block ${servingTeam === 'A' ? 'serving' : ''}`}>
        <div className="control-team-header">
          <span className="control-serve-dot" title="サーブ権設定" onClick={() => !disabled && onToggleServe('A')}>
            🏐
          </span>
          <h4>{teamAName || 'Aチーム'}</h4>
        </div>
        
        <div className="score-adjust-section">
          <button
            className="btn-score-number"
            onClick={() => onAddPoint('A')}
            disabled={disabled || setWinner !== null || matchFinished}
            title="得点追加 (+1)"
          >
            {scoreA}
          </button>
          <button
            className="btn-undo"
            onClick={() => onRemovePoint('A')}
            disabled={disabled || scoreA === 0 || matchFinished}
            title="得点取り消し (Undo)"
          >
            ↩️ Undo
          </button>
        </div>

        <div className="sets-adjust-direct">
          <span>セット: {setsA}</span>
        </div>
      </div>

      {/* 中央アクションブロック (確定ボタンやシステム操作) */}
      <div className="center-action-block">
        {setWinner ? (
          <div className="set-winner-alert">
            <div className="alert-text">
              {setWinner === 'A' ? teamAName || 'Aチーム' : teamBName || 'Bチーム'} がセット獲得！
            </div>
            <button className="btn-confirm-set" onClick={onSetConfirm} disabled={disabled}>
              セット獲得を確定する
            </button>
          </div>
        ) : matchFinished ? (
          <div className="match-finished-alert">
            <div className="alert-text">試合終了</div>
            <button className="btn-reset-match" onClick={onReset} disabled={disabled}>
              試合リセット
            </button>
          </div>
        ) : (
          <div className="system-controls">
            <button className={`btn-system ${showOverlay ? 'active' : ''}`} onClick={onToggleOverlay} disabled={disabled}>
              {showOverlay ? '得点板: 表示中' : '得点板: 非表示'}
            </button>
            <button className="btn-system btn-danger" onClick={onReset} disabled={disabled}>
              最初からリセット
            </button>
          </div>
        )}
      </div>

      {/* チームB操作ブロック */}
      <div className={`team-control-block ${servingTeam === 'B' ? 'serving' : ''}`}>
        <div className="control-team-header">
          <span className="control-serve-dot" title="サーブ権設定" onClick={() => !disabled && onToggleServe('B')}>
            🏐
          </span>
          <h4>{teamBName || 'Bチーム'}</h4>
        </div>

        <div className="score-adjust-section">
          <button
            className="btn-score-number"
            onClick={() => onAddPoint('B')}
            disabled={disabled || setWinner !== null || matchFinished}
            title="得点追加 (+1)"
          >
            {scoreB}
          </button>
          <button
            className="btn-undo"
            onClick={() => onRemovePoint('B')}
            disabled={disabled || scoreB === 0 || matchFinished}
            title="得点取り消し (Undo)"
          >
            ↩️ Undo
          </button>
        </div>

        <div className="sets-adjust-direct">
          <span>セット: {setsB}</span>
        </div>
      </div>
    </div>
  )
}
