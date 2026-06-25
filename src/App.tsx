import React, { useState, useRef, useEffect } from 'react'
import { ScoreboardOverlay } from './components/ScoreboardOverlay'
import { EventList, formatTime } from './components/EventList'
import { ProjectData, getActiveEventState, findActiveEventIndex, INITIAL_STATE, EventState } from './utils/scoreEngine'
import { open } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import './App.css'

function App(): React.JSX.Element {
  // アプリケーションの状態管理
  const [videoPath, setVideoPath] = useState<string | null>(null)
  const [videoName, setVideoName] = useState<string>('')
  const [projectData, setProjectData] = useState<ProjectData | null>(null)
  const [jsonPath, setJsonPath] = useState<string>('')
  const [mediaPort, setMediaPort] = useState<number>(0)

  const [currentTime, setCurrentTime] = useState<number>(0)
  const [duration, setDuration] = useState<number>(0)
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [playbackRate, setPlaybackRate] = useState<number>(1)
  const [volume, setVolume] = useState<number>(1)
  const [isMuted, setIsMuted] = useState<boolean>(false)

  const [activeEventIndex, setActiveEventIndex] = useState<number>(-1)
  const [activeState, setActiveState] = useState<EventState>(INITIAL_STATE)

  // 参照 (Ref) 管理
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const isSeeking = useRef<boolean>(false)

  // 初期ロード時に Rust 側のメディアサーバーのポートを取得
  useEffect(() => {
    invoke<number>('get_media_port')
      .then((port) => {
        setMediaPort(port)
        console.log('Media server port retrieved:', port)
      })
      .catch((err) => {
        console.error('Failed to get media port from Rust:', err)
      })
  }, [])

  // 動画ファイル選択 (Tauri plugin-dialog 使用)
  const handleSelectVideo = async (): Promise<void> => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Videos',
          extensions: ['mp4', 'mov', 'webm', 'm4v']
        }]
      })
      
      if (selected && typeof selected === 'string') {
        setVideoPath(selected)
        const name = selected.split(/[/\\]/).pop() || ''
        setVideoName(name)
        setIsPlaying(false)
        setCurrentTime(0)
      }
    } catch (err: any) {
      console.error('Error selecting video:', err)
      alert('動画の選択に失敗しました: ' + err.message)
    }
  }

  // プロジェクトJSON選択 (Tauri plugin-dialog & plugin-fs 使用)
  const handleSelectJson = async (): Promise<void> => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Project JSON',
          extensions: ['json']
        }]
      })

      if (selected && typeof selected === 'string') {
        setJsonPath(selected)
        const content = await readTextFile(selected)
        const data = JSON.parse(content)
        setProjectData(data)
        
        // ロード時に現在の再生時間におけるスコアを復元
        const index = findActiveEventIndex(data.events, currentTime)
        setActiveEventIndex(index)
        setActiveState(getActiveEventState(data.events, currentTime))
      }
    } catch (err: any) {
      console.error('Error selecting JSON:', err)
      alert('JSONの読み込みに失敗しました: ' + err.message)
    }
  }

  // 再生・一時停止の切り替え
  const togglePlay = (): void => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.pause()
    } else {
      videoRef.current.play().catch((err) => {
        console.error('Play failed:', err)
      })
    }
  }

  // 1フレーム送り・戻し (30fps換算)
  const stepFrame = (direction: 'forward' | 'backward'): void => {
    if (!videoRef.current) return
    const frameTime = 1 / 30
    const newTime = direction === 'forward'
      ? Math.min(duration, videoRef.current.currentTime + frameTime)
      : Math.max(0, videoRef.current.currentTime - frameTime)

    videoRef.current.currentTime = newTime
    setCurrentTime(newTime)
    updateScoreState(newTime)
  }

  // 音量変更
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseFloat(e.target.value)
    setVolume(val)
    if (videoRef.current) {
      videoRef.current.volume = val
      videoRef.current.muted = val === 0
      setIsMuted(val === 0)
    }
  }

  // ミュート切り替え
  const toggleMute = (): void => {
    if (!videoRef.current) return
    const nextMute = !isMuted
    setIsMuted(nextMute)
    videoRef.current.muted = nextMute
  }

  // 再生速度変更
  const handlePlaybackRateChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const rate = parseFloat(e.target.value)
    setPlaybackRate(rate)
    if (videoRef.current) {
      videoRef.current.playbackRate = rate
    }
  }

  // タイムラインシーク操作
  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    isSeeking.current = true
    const newTime = parseFloat(e.target.value)
    setCurrentTime(newTime)
    if (videoRef.current) {
      videoRef.current.currentTime = newTime
    }
    updateScoreState(newTime)
  }

  // タイムライン操作終了
  const handleSeekEnd = (): void => {
    isSeeking.current = false
  }

  // 履歴リストのイベントクリック時シーク
  const handleEventClick = (timestamp: number): void => {
    if (videoRef.current) {
      videoRef.current.currentTime = timestamp
    }
    setCurrentTime(timestamp)
    updateScoreState(timestamp)
  }

  // 再生時間に応じたスコア状態の更新 (一方向データ更新)
  const updateScoreState = (time: number): void => {
    if (!projectData) return
    const index = findActiveEventIndex(projectData.events, time)
    setActiveEventIndex(index)
    setActiveState(getActiveEventState(projectData.events, time))
  }

  // ビデオ要素のイベントハンドラ
  const handleTimeUpdate = (): void => {
    if (!videoRef.current || isSeeking.current) return
    const time = videoRef.current.currentTime
    setCurrentTime(time)
    updateScoreState(time)
  }

  const handleLoadedMetadata = (): void => {
    if (!videoRef.current) return
    setDuration(videoRef.current.duration)
  }

  const handlePlay = (): void => setIsPlaying(true)
  const handlePause = (): void => setIsPlaying(false)

  // 初期ロード時のキーボードショートカット設定
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'SELECT') {
        e.preventDefault()
        togglePlay()
      }
      if (e.code === 'ArrowRight' && e.shiftKey) {
        stepFrame('forward')
      }
      if (e.code === 'ArrowLeft' && e.shiftKey) {
        stepFrame('backward')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isPlaying, duration])

  // RustのHTTPサーバー経由で安全に動画をロード (CORS, Range, WebKitのHEVCデコードに対応)
  const videoSrc = videoPath && mediaPort
    ? `http://127.0.0.1:${mediaPort}/?path=${encodeURIComponent(videoPath)}`
    : ''

  // 表示位置・倍率の設定 (未ロード時はデフォルト)
  const scoreboardSettings = projectData?.matchSettings || {
    teamAName: 'Aチーム',
    teamBName: 'Bチーム',
    maxSets: 3,
    normalSetPoints: 25,
    finalSetPoints: 25,
    theme: 'modern-dark',
    overlaySize: 100,
    overlayPosition: 'top-right' as const
  }

  return (
    <div className="app-container">
      {/* 左ペイン: 設定・ファイル管理 */}
      <aside className="sidebar">
        <div className="brand">
          <div className="logo-icon">🏐</div>
          <h2>V-Memo Score Editor</h2>
        </div>

        <div className="sidebar-section">
          <h3>ファイル読み込み</h3>
          <div className="file-buttons">
            <button className={`btn-file ${videoPath ? 'loaded' : ''}`} onClick={handleSelectVideo}>
              <span className="icon">📁</span>
              {videoPath ? '動画変更' : '動画ファイル選択'}
            </button>
            {videoName && <div className="file-name-preview" title={videoPath || ''}>{videoName}</div>}

            <button className={`btn-file ${projectData ? 'loaded' : ''}`} onClick={handleSelectJson}>
              <span className="icon">📄</span>
              {projectData ? 'JSON変更' : 'プロジェクトJSON選択'}
            </button>
            {jsonPath && <div className="file-name-preview" title={jsonPath}>{jsonPath.split(/[/\\]/).pop()}</div>}
          </div>
        </div>

        {projectData && (
          <div className="sidebar-section game-info">
            <h3>試合設定</h3>
            <div className="info-grid">
              <div className="info-label">チームA</div>
              <div className="info-value">{scoreboardSettings.teamAName}</div>
              
              <div className="info-label">チームB</div>
              <div className="info-value">{scoreboardSettings.teamBName}</div>

              <div className="info-label">マッチ形式</div>
              <div className="info-value">{scoreboardSettings.maxSets} セットマッチ</div>

              <div className="info-label">目標得点</div>
              <div className="info-value">通常 {scoreboardSettings.normalSetPoints} 点 / 最終 {scoreboardSettings.finalSetPoints} 点</div>

              <div className="info-label">表示位置</div>
              <div className="info-value">{scoreboardSettings.overlayPosition} ({scoreboardSettings.overlaySize}%)</div>
            </div>
          </div>
        )}
      </aside>

      {/* 中央ペイン: メインプレイヤー & タイムライン */}
      <main className="main-content">
        <div className="player-section">
          {videoSrc ? (
            <div className="video-wrapper">
              <video
                ref={videoRef}
                src={videoSrc}
                className="video-element"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onPlay={handlePlay}
                onPause={handlePause}
                onClick={togglePlay}
              />
              {/* スコアボードの重ね合わせ表示 */}
              <ScoreboardOverlay state={activeState} settings={scoreboardSettings} />
            </div>
          ) : (
            <div className="video-placeholder" onClick={handleSelectVideo}>
              <div className="placeholder-content">
                <span className="placeholder-icon">🎬</span>
                <p>動画ファイルを読み込んでください</p>
                <button className="btn-primary">動画を選択</button>
              </div>
            </div>
          )}
        </div>

        {/* タイムライン & コントローラー */}
        <div className="timeline-section">
          {/* シークバー */}
          <div className="seekbar-container">
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.01}
              value={currentTime}
              onChange={handleSeekChange}
              onMouseUp={handleSeekEnd}
              onTouchEnd={handleSeekEnd}
              className="seekbar-input"
              disabled={!videoPath}
            />
            {/* イベントマーカー表示 */}
            {videoPath && duration > 0 && projectData && (
              <div className="event-markers-track">
                {projectData.events.map((event) => {
                  const leftPos = (event.timestamp / duration) * 100
                  return (
                    <span
                      key={event.id}
                      className={`timeline-marker marker-${event.type}`}
                      style={{ left: `${leftPos}%` }}
                      title={`${formatTime(event.timestamp)} - ${event.type}`}
                      onClick={() => handleEventClick(event.timestamp)}
                    />
                  )
                })}
              </div>
            )}
          </div>

          {/* プレイヤーコントロール */}
          <div className="controls-container">
            <div className="controls-left">
              <button className="btn-control" onClick={() => stepFrame('backward')} disabled={!videoPath} title="1フレーム戻る (Shift+←)">
                ⏮
              </button>
              <button className="btn-play-pause" onClick={togglePlay} disabled={!videoPath}>
                {isPlaying ? '⏸ 一時停止' : '▶ 再生'}
              </button>
              <button className="btn-control" onClick={() => stepFrame('forward')} disabled={!videoPath} title="1フレーム進む (Shift+→)">
                ⏭
              </button>
              <span className="time-display">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="controls-right">
              {/* 再生速度 */}
              <div className="control-item">
                <label>速度:</label>
                <select value={playbackRate} onChange={handlePlaybackRateChange} disabled={!videoPath}>
                  <option value={0.5}>0.5x</option>
                  <option value={1.0}>1.0x</option>
                  <option value={1.5}>1.5x</option>
                  <option value={2.0}>2.0x</option>
                </select>
              </div>

              {/* 音量 */}
              <div className="control-item volume-control">
                <button className="btn-mute" onClick={toggleMute} disabled={!videoPath}>
                  {isMuted ? '🔇' : '🔊'}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  disabled={!videoPath}
                  className="volume-slider"
                />
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 右ペイン: イベント履歴 */}
      <section className="events-sidebar">
        <EventList
          events={projectData?.events || []}
          activeEventIndex={activeEventIndex}
          onEventClick={handleEventClick}
          teamAName={scoreboardSettings.teamAName}
          teamBName={scoreboardSettings.teamBName}
        />
      </section>
    </div>
  )
}

export default App
