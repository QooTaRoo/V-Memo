import React, { useState, useEffect, useRef } from 'react'
import { ProjectData, ScoreEvent } from '../utils/scoreEngine'
import './ScoreProgressionGraph.css'

interface ScoreProgressionGraphProps {
  projectData: ProjectData | null;
  currentTime: number;
  swapTeams: boolean;
  onSeek: (time: number) => void;
}

export const ScoreProgressionGraph: React.FC<ScoreProgressionGraphProps> = ({
  projectData,
  currentTime,
  swapTeams,
  onSeek
}) => {
  const [selectedSet, setSelectedSet] = useState<number>(1)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  
  // 1. 得点イベントのみを抽出し、セットごとにグループ化
  const getPointEventsBySet = (): { [setNum: number]: ScoreEvent[] } => {
    if (!projectData || !projectData.events) return {}
    
    const pointEvents = projectData.events.filter(e => e.type === 'point')
    const grouped: { [setNum: number]: ScoreEvent[] } = {}
    
    pointEvents.forEach(event => {
      // セット番号を決定: setsA + setsB + 1
      const setNum = (event.state.setsA || 0) + (event.state.setsB || 0) + 1
      if (!grouped[setNum]) {
        grouped[setNum] = []
      }
      grouped[setNum].push(event)
    });
    
    return grouped
  }

  const groupedEvents = getPointEventsBySet()
  const availableSets = Object.keys(groupedEvents).map(Number).sort((a, b) => a - b)
  const currentSetNum = availableSets.length > 0 ? Math.max(...availableSets) : 1

  // 新しいセットが開始されたら、自動的に最新セットに切り替える
  useEffect(() => {
    if (availableSets.length > 0 && !availableSets.includes(selectedSet)) {
      setSelectedSet(currentSetNum)
    } else if (availableSets.length > 0 && selectedSet < currentSetNum && selectedSet === 1 && availableSets.includes(currentSetNum)) {
      // 初期状態から最新セットへ自動更新
      setSelectedSet(currentSetNum)
    }
  }, [currentSetNum])

  // 選択されたセットのイベントリスト
  const currentSetEvents = groupedEvents[selectedSet] || []

  // 2. 現在の再生時間に対応するアクティブな得点イベントのIDを特定
  const getActiveEventId = (): string => {
    if (currentSetEvents.length === 0) return ''
    
    // 現在時間以下のタイムスタンプを持つ最新のイベントを探す
    let activeEvent: ScoreEvent | null = null
    for (let i = 0; i < currentSetEvents.length; i++) {
      if (currentSetEvents[i].timestamp <= currentTime) {
        activeEvent = currentSetEvents[i]
      } else {
        break
      }
    }
    
    return activeEvent ? activeEvent.id : ''
  }

  const activeEventId = getActiveEventId()

  // 3. アクティブなイベントブロックへ自動スクロールする処理
  useEffect(() => {
    if (activeEventId) {
      const activeEl = document.getElementById(`col-${activeEventId}`)
      if (activeEl && scrollContainerRef.current) {
        const container = scrollContainerRef.current
        const elLeft = activeEl.offsetLeft
        const elWidth = activeEl.clientWidth
        const containerWidth = container.clientWidth
        
        // 中央付近にスクロールさせる
        container.scrollTo({
          left: elLeft - containerWidth / 2 + elWidth / 2,
          behavior: 'smooth'
        })
      }
    }
  }, [activeEventId])

  // 4. 左端サマリー用の最新スコアを取得
  const getSummaryScore = () => {
    if (currentSetEvents.length === 0) {
      return { scoreA: 0, scoreB: 0 }
    }
    const lastEvent = currentSetEvents[currentSetEvents.length - 1]
    return {
      scoreA: lastEvent.state.scoreA,
      scoreB: lastEvent.state.scoreB
    }
  }

  const summary = getSummaryScore()
  const teamAName = projectData?.matchSettings.teamAName || '大宮東'
  const teamBName = projectData?.matchSettings.teamBName || '三浦学苑'

  // 表示順（swapTeams）を考慮したチーム情報
  const topTeamName = swapTeams ? teamBName : teamAName
  const bottomTeamName = swapTeams ? teamAName : teamBName
  const topScore = swapTeams ? summary.scoreB : summary.scoreA
  const bottomScore = swapTeams ? summary.scoreA : summary.scoreB

  return (
    <div className="score-progression-graph">
      <div className="graph-header">
        <span className="graph-title-label">📊 スコア推移（時系列）</span>
        {availableSets.length > 0 ? (
          <div className="set-selector-wrapper">
            <label htmlFor="set-select">セット選択:</label>
            <select
              id="set-select"
              value={selectedSet}
              onChange={(e) => setSelectedSet(Number(e.target.value))}
              className="set-select-dropdown"
            >
              {availableSets.map(setNum => (
                <option key={setNum} value={setNum}>
                  第 {setNum} セット
                </option>
              ))}
            </select>
          </div>
        ) : (
          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)' }}>得点イベントが登録されていません</span>
        )}
      </div>

      <div className="graph-container-layout">
        {/* 左側: サマリーカード */}
        <div className="graph-summary-card">
          <div className="summary-set-label">SET {selectedSet}</div>
          <div className="summary-team-row top-team">
            <span className="summary-team-name" title={topTeamName}>{topTeamName}</span>
            <span className="summary-team-score">{topScore}</span>
          </div>
          <div className="summary-team-row bottom-team">
            <span className="summary-team-name" title={bottomTeamName}>{bottomTeamName}</span>
            <span className="summary-team-score">{bottomScore}</span>
          </div>
        </div>

        {/* 右側: スクロール可能な時系列ブロック */}
        <div 
          className="graph-scroll-area" 
          ref={scrollContainerRef}
        >
          {currentSetEvents.length === 0 ? (
            <div className="graph-empty-state">
              得点データがありません。スコアを追加するとここに時系列でプロットされます。
            </div>
          ) : (
            <div className="timeline-grid-wrapper">
              {currentSetEvents.map((event) => {
                const isA = event.team === 'A'
                // 得点した側が上段になるか判定
                // swapTeams = false の場合: Aが上段(isA = true), Bが下段(isA = false)
                // swapTeams = true の場合: Bが上段(isA = false), Aが下段(isA = true)
                const isTopScored = swapTeams ? !isA : isA
                const points = isA ? event.state.scoreA : event.state.scoreB
                const isActive = event.id === activeEventId

                return (
                  <div 
                    key={event.id} 
                    id={`col-${event.id}`}
                    className={`timeline-column ${isActive ? 'active-col' : ''}`}
                    onClick={() => onSeek(event.timestamp)}
                    title={`クリックしてシーク: ${event.timestamp.toFixed(2)}秒\n${isA ? teamAName : teamBName} 得点 (${event.state.scoreA} - ${event.state.scoreB})`}
                  >
                    {/* 上段行 */}
                    <div className="grid-cell top-cell">
                      {isTopScored ? (
                        <div className={`point-block top-block-style ${isActive ? 'active-block' : ''}`}>
                          {points}
                        </div>
                      ) : (
                        <div className="empty-cell-placeholder" />
                      )}
                    </div>

                    {/* 下段行 */}
                    <div className="grid-cell bottom-cell">
                      {!isTopScored ? (
                        <div className={`point-block bottom-block-style ${isActive ? 'active-block' : ''}`}>
                          {points}
                        </div>
                      ) : (
                        <div className="empty-cell-placeholder" />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
