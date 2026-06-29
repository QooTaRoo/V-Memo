import React from 'react'
import { ScoreEvent } from '../utils/scoreEngine'
import './EventList.css'

interface EventListProps {
  events: ScoreEvent[]
  activeEventIndex: number
  onEventClick: (timestamp: number) => void
  onEventDelete: (timestamp: number) => void
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
  onEventDelete,
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
          [...events].reverse().map((event) => {
            const originalIdx = events.findIndex(e => e.id === event.id)
            const isActive = originalIdx === activeEventIndex
            const { state, type, team } = event
            
            let detailText = ''
            if (type === 'serve_change') {
              detailText = `${team === 'A' ? teamAName || 'Aチーム' : teamBName || 'Bチーム'} サーブ権`
            } else if (type === 'point') {
              const actingTeam = team === 'A' ? teamAName || 'Aチーム' : teamBName || 'Bチーム'
              detailText = `${actingTeam} 得点`
            } else if (type === 'set_confirm') {
              detailText = `セット確定 (第${state.setsA + state.setsB}セット終了)`
            } else if (type === 'reset') {
              detailText = `試合スコア リセット`
            } else if (type === 'overlay_toggle') {
              detailText = `得点板: ${event.overlayVisible ? '表示' : '非表示'}`
            }

            return (
              <div
                key={event.id}
                className={`event-card ${isActive ? 'active' : ''}`}
                onClick={() => onEventClick(event.timestamp)}
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                  cursor: 'pointer',
                  backgroundColor: isActive ? 'rgba(0, 229, 255, 0.06)' : 'transparent',
                  transition: 'background-color 0.15s'
                }}
              >
                {/* 1行目: 時間 と 得点タグ/ゴミ箱 */}
                <div className="event-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <div className="header-left" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className="event-time" style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#00e5ff' }}>{formatTime(event.timestamp)}</span>
                    <span className={`event-tag tag-${type}`} style={{
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      backgroundColor: type === 'point' ? 'rgba(0, 229, 255, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                      color: type === 'point' ? '#00e5ff' : 'rgba(255, 255, 255, 0.6)'
                    }}>
                      {type === 'point' ? '得点' : type === 'serve_change' ? 'サーブ' : type === 'set_confirm' ? '確定' : type === 'overlay_toggle' ? '表示設定' : 'その他'}
                    </span>
                  </div>
                  {event.id !== 'init_serve' && (
                    <button
                      className="btn-delete-event"
                      title="イベント削除"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (window.confirm('このイベントを削除しますか？')) {
                          onEventDelete(event.timestamp)
                        }
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'rgba(255, 59, 48, 0.7)',
                        cursor: 'pointer',
                        fontSize: '11px',
                        padding: 0
                      }}
                    >
                      🗑️
                    </button>
                  )}
                </div>

                {/* 2行目: チームA( xx - xx ) チームB / 色分け表示 */}
                <div className="event-card-body" style={{ fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  {type === 'point' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%', flexWrap: 'wrap' }}>
                      <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: '500' }}>{teamAName || 'チームA'}</span>
                      <span style={{ color: 'rgba(255,255,255,0.4)', margin: '0 2px' }}>(</span>
                      
                      {/* 得点が入った方 (Aならシアン、そうでなければ半透明白) */}
                      <span style={{ 
                        fontWeight: 'bold', 
                        color: team === 'A' ? '#00e5ff' : 'rgba(255, 255, 255, 0.5)',
                        fontSize: '13px'
                      }}>
                        {state.scoreA}
                      </span>
                      
                      <span style={{ color: 'rgba(255,255,255,0.4)' }}>-</span>
                      
                      {/* 得点が入った方 (Bなら赤、そうでなければ半透明白) */}
                      <span style={{ 
                        fontWeight: 'bold', 
                        color: team === 'B' ? '#ff3b30' : 'rgba(255, 255, 255, 0.5)',
                        fontSize: '13px'
                      }}>
                        {state.scoreB}
                      </span>
                      
                      <span style={{ color: 'rgba(255,255,255,0.4)', margin: '0 2px' }}>)</span>
                      <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: '500' }}>{teamBName || 'チームB'}</span>

                      {/* セット獲得バッジがある場合 */}
                      {state.setWinner && (
                        <span style={{
                          marginLeft: 'auto',
                          fontSize: '10px',
                          backgroundColor: state.setWinner === 'A' ? 'rgba(0, 229, 255, 0.2)' : 'rgba(255, 59, 48, 0.2)',
                          color: state.setWinner === 'A' ? '#00e5ff' : '#ff3b30',
                          padding: '1px 4px',
                          borderRadius: '3px',
                          fontWeight: 'bold'
                        }}>
                          セット獲得: {state.setWinner === 'A' ? 'A' : 'B'}
                        </span>
                      )}
                    </div>
                  ) : (
                    /* 得点イベント以外 (サーブ権やリセット等) */
                    <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '11px', display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{detailText}</span>
                      <span style={{ color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
                        ({state.scoreA} - {state.scoreB})
                      </span>
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
