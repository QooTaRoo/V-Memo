import React, { useState, useRef, useEffect } from 'react'
import { ScoreboardOverlay } from './components/ScoreboardOverlay'
import { EventList, formatTime } from './components/EventList'
import { ScoreController } from './components/ScoreController'
import {
  ProjectData,
  getActiveEventState,
  findActiveEventIndex,
  recalculateEventStates,
  INITIAL_STATE,
  EventState,
  ScoreEvent,
  MatchSettings
} from './utils/scoreEngine'
import { open, save } from '@tauri-apps/plugin-dialog'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import './App.css'

// デフォルトの新規プロジェクトテンプレート
const createDefaultProject = (videoPath: string | null = null): ProjectData => ({
  matchSettings: {
    teamAName: '大宮東',
    teamBName: '伊奈学園',
    maxSets: 3,
    normalSetPoints: 25,
    finalSetPoints: 25,
    theme: 'modern-dark',
    overlaySize: 100,
    overlayPosition: 'top-left'
  },
  events: [
    {
      id: 'init_serve',
      timestamp: 0,
      type: 'serve_change',
      team: 'A',
      state: INITIAL_STATE
    }
  ],
  videoPath
})

function App(): React.JSX.Element {
  // アプリケーションの状態管理
  const [videoPath, setVideoPath] = useState<string | null>(null)
  const [videoName, setVideoName] = useState<string>('')
  const [projectData, setProjectData] = useState<ProjectData | null>(null)
  const [jsonPath, setJsonPath] = useState<string>('')
  const [videoAspectRatio, setVideoAspectRatio] = useState<number | null>(null)

  const [currentTime, setCurrentTime] = useState<number>(0)
  const [duration, setDuration] = useState<number>(0)
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [playbackRate, setPlaybackRate] = useState<number>(1)
  const [volume, setVolume] = useState<number>(1)
  const [isMuted, setIsMuted] = useState<boolean>(false)

  const [activeEventIndex, setActiveEventIndex] = useState<number>(-1)
  const [activeState, setActiveState] = useState<EventState>(INITIAL_STATE)

  // メディアデバッグ用ステート
  const [videoDomMuted, setVideoDomMuted] = useState<boolean>(false)
  const [videoDomVolume, setVideoDomVolume] = useState<number>(1)
  const [videoErrorMsg, setVideoErrorMsg] = useState<string>('None')

  // 参照 (Ref) 管理
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const isSeeking = useRef<boolean>(false)
  const lastInputTimeRef = useRef<number>(0) // 競合防止ロック用

  const syncVideoDomState = (): void => {
    if (videoRef.current) {
      setVideoDomMuted(videoRef.current.muted)
      setVideoDomVolume(videoRef.current.volume)
      if (videoRef.current.error) {
        setVideoErrorMsg(`Code ${videoRef.current.error.code}: ${videoRef.current.error.message}`)
      } else {
        setVideoErrorMsg('None')
      }
    }
  }

  const playTestTone = (): void => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      
      osc.type = 'sine'
      osc.frequency.value = 440 // A4 tone
      gain.gain.setValueAtTime(0.15, ctx.currentTime) // gentle volume
      
      osc.start()
      osc.stop(ctx.currentTime + 0.3)
      console.log('Speaker test tone played successfully')
    } catch (e: any) {
      console.error('Failed to play test tone:', e)
      alert('テスト音の再生に失敗しました: ' + e.message)
    }
  }


  // 音量およびミュート状態を HTML ビデオ要素へ確実にバインド
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume
      videoRef.current.muted = isMuted
    }
  }, [volume, isMuted, videoPath])

  // 動画ファイル選択 (単独ロード)
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

        // プロジェクトがない場合はデフォルト新規プロジェクトを自動生成
        if (!projectData) {
          const newProj = createDefaultProject(selected)
          // 初期化して再計算
          newProj.events = recalculateEventStates(newProj.events, newProj.matchSettings)
          setProjectData(newProj)
          setActiveEventIndex(0)
          setActiveState(newProj.events[0].state)
        } else {
          // すでにプロジェクトがある場合は、動画パスを差し替え
          setProjectData({
            ...projectData,
            videoPath: selected
          })
        }
      }
    } catch (err: any) {
      console.error('Error selecting video:', err)
      alert('動画の選択に失敗しました: ' + err.message)
    }
  }

  // プロジェクトJSON選択 (動画自動ロード付き)
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
        const content = await invoke<string>('load_project_json', { path: selected })
        const data = JSON.parse(content) as ProjectData
        
        // 状態を綺麗に再計算して適用 (データの整合性担保)
        data.events = recalculateEventStates(data.events, data.matchSettings)
        setProjectData(data)
        
        const index = findActiveEventIndex(data.events, currentTime)
        setActiveEventIndex(index)
        setActiveState(getActiveEventState(data.events, currentTime))

        // 動画の自動ロード
        if (data.videoPath) {
          const videoExists = await invoke<boolean>('check_file_exists', { path: data.videoPath })
          if (videoExists) {
            setVideoPath(data.videoPath)
            const name = data.videoPath.split(/[/\\]/).pop() || ''
            setVideoName(name)
            console.log('Video auto-loaded:', data.videoPath)
          } else {
            alert(
              `関連付けられた動画ファイルが見つかりませんでした。\nファイルが存在するか確認し、手動で動画を読み込んでください。\n(検索したパス: ${data.videoPath})`
            )
          }
        }
      }
    } catch (err: any) {
      console.error('Error selecting JSON:', err)
      alert('JSONの読み込みに失敗しました: ' + err.message)
    }
  }

  // プロジェクトの保存 (上書き / 別名保存)
  const handleSaveProject = async (saveAs: boolean = false): Promise<void> => {
    if (!projectData) return

    try {
      let targetPath = jsonPath
      if (saveAs || !jsonPath) {
        const selected = await save({
          filters: [{
            name: 'Project JSON',
            extensions: ['json']
          }],
          defaultPath: 'match_project.json'
        })
        if (!selected) return // キャンセル
        targetPath = selected
      }

      // 保存するデータ構造を整理 (現在の動画絶対パスを格納)
      const dataToSave: ProjectData = {
        ...projectData,
        videoPath: videoPath
      }

      await invoke('save_project_json', {
        path: targetPath,
        content: JSON.stringify(dataToSave, null, 2)
      })
      setJsonPath(targetPath)
      alert('プロジェクトを保存しました！')
    } catch (err: any) {
      console.error('Save failed:', err)
      alert('プロジェクトの保存に失敗しました: ' + err.message)
    }
  }

  // 現在の時間に基づいてアクティブなイベントの状態を特定し、UIに反映する処理
  const updateScoreState = (time: number): void => {
    if (!projectData) return
    const activeIndex = findActiveEventIndex(projectData.events, time)
    setActiveEventIndex(activeIndex)
    setActiveState(getActiveEventState(projectData.events, time))
  }

  // イベントを選択したときに、動画の再生時間を変更し、状態を同期する
  const handleEventClick = (timestamp: number): void => {
    if (videoRef.current) {
      videoRef.current.currentTime = timestamp
    }
    setCurrentTime(timestamp)
    if (projectData) {
      const activeIndex = findActiveEventIndex(projectData.events, timestamp)
      setActiveEventIndex(activeIndex)
      setActiveState(getActiveEventState(projectData.events, timestamp))
    }
  }

  // 共通のスコアイベント追加ロジック (ラグ補正・競合防止ロック含む)
  const addScoreEvent = (
    type: 'point' | 'serve_change' | 'set_confirm' | 'reset' | 'set_score_direct',
    team: 'A' | 'B' | null,
    manualTimestamp?: number
  ): void => {
    if (!projectData) return

    // 入力時刻を記録し、自動同期を1秒間ロック
    lastInputTimeRef.current = Date.now()

    let timestamp = videoRef.current ? videoRef.current.currentTime : 0
    if (manualTimestamp !== undefined) {
      timestamp = manualTimestamp
    } else if (type === 'point' || type === 'serve_change') {
      // 反応ラグ補正 (自動で0.3秒前。ただし0秒未満にならないようガード)
      timestamp = Math.max(0, timestamp - 0.3)
    }

    const newEvent: ScoreEvent = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp,
      type,
      team,
      state: INITIAL_STATE // 再計算で代入されるため初期状態
    }

    const updatedEvents = recalculateEventStates([...projectData.events, newEvent], projectData.matchSettings)
    
    const updatedProj = {
      ...projectData,
      events: updatedEvents
    }
    setProjectData(updatedProj)

    // 新しく追加した時間に近い状態に同期
    const activeIndex = findActiveEventIndex(updatedEvents, timestamp)
    setActiveEventIndex(activeIndex)
    setActiveState(getActiveEventState(updatedEvents, timestamp))
  }

  // 得点加算 (+1)
  const handleAddPoint = (team: 'A' | 'B'): void => {
    addScoreEvent('point', team)
  }


  // サーブ権切り替え
  const handleToggleServe = (team: 'A' | 'B'): void => {
    addScoreEvent('serve_change', team)
  }

  // セット確定
  const handleSetConfirm = (): void => {
    addScoreEvent('set_confirm', null)
  }

  // 得点板表示・非表示トグルをイベントとして追加
  const handleToggleOverlay = (): void => {
    if (!projectData) return
    const nextShow = !activeState.overlayVisible
    
    // 入力時刻を記録し、自動同期を1秒間ロック
    lastInputTimeRef.current = Date.now()
    
    const timestamp = videoRef.current ? videoRef.current.currentTime : 0
    
    const newEvent: ScoreEvent = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp,
      type: 'overlay_toggle',
      team: null,
      overlayVisible: nextShow,
      state: INITIAL_STATE
    }

    const updatedEvents = recalculateEventStates([...projectData.events, newEvent], projectData.matchSettings)
    setProjectData({
      ...projectData,
      events: updatedEvents
    })

    const activeIndex = findActiveEventIndex(updatedEvents, timestamp)
    setActiveEventIndex(activeIndex)
    setActiveState(getActiveEventState(updatedEvents, timestamp))
  }

  // 直近のイベントを1件削除するUndo機能 (初期イベントは除く)
  const handleUndo = (): void => {
    if (!projectData || projectData.events.length <= 1) return

    // 入力時刻を記録し、自動同期を1秒間ロック
    lastInputTimeRef.current = Date.now()

    // 最後のイベントを削除
    const newEvents = projectData.events.slice(0, -1)
    const updatedEvents = recalculateEventStates(newEvents, projectData.matchSettings)

    setProjectData({
      ...projectData,
      events: updatedEvents
    })

    // 同期処理
    const checkTime = videoRef.current ? videoRef.current.currentTime : 0
    const activeIndex = findActiveEventIndex(updatedEvents, checkTime)
    setActiveEventIndex(activeIndex)
    setActiveState(getActiveEventState(updatedEvents, checkTime))
  }

  // リセット
  const handleReset = (): void => {
    if (window.confirm('現在の試合スコアを初期状態にリセットしますか？\n(履歴はクリアされます)')) {
      const resetEvents = [
        {
          id: 'init_serve',
          timestamp: 0,
          type: 'serve_change' as const,
          team: 'A' as const,
          state: INITIAL_STATE
        }
      ]
      const updatedEvents = recalculateEventStates(resetEvents, projectData?.matchSettings || createDefaultProject().matchSettings)
      
      setProjectData({
        ...projectData!,
        events: updatedEvents
      })
      setActiveEventIndex(0)
      setActiveState(updatedEvents[0].state)
      if (videoRef.current) {
        videoRef.current.currentTime = 0
      }
      setCurrentTime(0)
    }
  }

  // イベント個別削除
  const handleEventDelete = (timestamp: number): void => {
    if (!projectData) return
    
    // 入力時刻を記録し、自動同期を1秒間ロック
    lastInputTimeRef.current = Date.now()

    // 指定されたタイムスタンプのイベントを探す
    // 同時に複数のイベントが全く同じ時間にある場合も考慮し、その時間に最も合致するものを1つ消す
    const targetIdx = projectData.events.findIndex(e => e.timestamp === timestamp)
    
    if (targetIdx !== -1) {
      // 0秒時点の初期サーブ権イベントは削除できないガード
      if (projectData.events[targetIdx].id === 'init_serve') {
        alert('初期イベントは削除できません。')
        return
      }

      const newEvents = projectData.events.filter((_, idx) => idx !== targetIdx)
      const updatedEvents = recalculateEventStates(newEvents, projectData.matchSettings)

      setProjectData({
        ...projectData,
        events: updatedEvents
      })

      const checkTime = videoRef.current ? videoRef.current.currentTime : 0
      const activeIndex = findActiveEventIndex(updatedEvents, checkTime)
      setActiveEventIndex(activeIndex)
      setActiveState(getActiveEventState(updatedEvents, checkTime))
    }
  }

  // 試合基本設定・表示設定の変更
  const handleSettingChange = <K extends keyof MatchSettings>(key: K, value: MatchSettings[K]): void => {
    let currentProj = projectData
    if (!currentProj) {
      currentProj = createDefaultProject(videoPath)
    }

    const updatedSettings = {
      ...currentProj.matchSettings,
      [key]: value
    }

    // 設定変更に伴い全イベントのスコア状態を再計算 (目標得点やセット数の変更があるため)
    const updatedEvents = recalculateEventStates(currentProj.events, updatedSettings)

    const updatedProj = {
      ...currentProj,
      matchSettings: updatedSettings,
      events: updatedEvents
    }

    setProjectData(updatedProj)
    
    const checkTime = videoRef.current ? videoRef.current.currentTime : 0
    const activeIndex = findActiveEventIndex(updatedEvents, checkTime)
    setActiveEventIndex(activeIndex)
    setActiveState(getActiveEventState(updatedEvents, checkTime))
  }

  // 再生・一時停止の切り替え
  const togglePlay = (): void => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.pause()
    } else {
      videoRef.current.muted = isMuted
      videoRef.current.volume = volume
      videoRef.current.play().catch((err) => {
        console.error('Play failed:', err)
      })
    }
  }

  // 1フレーム送り・戻し
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

  // ミュート
  const toggleMute = (): void => {
    if (!videoRef.current) return
    const nextMute = !isMuted
    setIsMuted(nextMute)
    videoRef.current.muted = nextMute
  }

  // 再生速度
  const handlePlaybackRateChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const rate = parseFloat(e.target.value)
    setPlaybackRate(rate)
    if (videoRef.current) {
      videoRef.current.playbackRate = rate
    }
  }

  // シーク
  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    isSeeking.current = true
    const newTime = parseFloat(e.target.value)
    setCurrentTime(newTime)
    if (videoRef.current) {
      videoRef.current.currentTime = newTime
    }
    updateScoreState(newTime)
  }

  const handleSeekEnd = (): void => {
    isSeeking.current = false
  }

  const handleTimeUpdate = (): void => {
    if (!videoRef.current || isSeeking.current) return
    
    // 入力後1秒間は、再生時間経過による自動同期をブロック (上書き防止ロック)
    if (Date.now() - lastInputTimeRef.current < 1000) {
      return
    }

    const time = videoRef.current.currentTime
    setCurrentTime(time)
    updateScoreState(time)
  }

  const handleLoadedMetadata = (): void => {
    if (!videoRef.current) return
    setDuration(videoRef.current.duration)
    const width = videoRef.current.videoWidth
    const height = videoRef.current.videoHeight
    if (width && height) {
      setVideoAspectRatio(width / height)
    }
    // メディアロード完了時に音量・ミュート状態を強制同期（WebKit対策）
    videoRef.current.volume = volume
    videoRef.current.muted = isMuted
  }

  const handlePlay = (): void => {
    setIsPlaying(true)
    if (videoRef.current) {
      videoRef.current.muted = isMuted
      videoRef.current.volume = volume
    }
  }
  const handlePause = (): void => setIsPlaying(false)

  // キーボードショートカット
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

  // TauriアセットプロトコルURIの生成
  const videoSrc = videoPath ? convertFileSrc(videoPath) : ''

  const scoreboardSettings = projectData?.matchSettings || createDefaultProject().matchSettings

  // 自前でイベントリストをラッピングし、削除用イベントを仲介
  const handleEventListClick = (timestamp: number): void => {
    handleEventClick(timestamp)
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
          <h3>プロジェクト・メディア</h3>
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

          {projectData && (
            <div className="save-buttons-row">
              <button className="btn-save" onClick={() => handleSaveProject(false)}>
                💾 上書き保存
              </button>
              <button className="btn-save btn-secondary" onClick={() => handleSaveProject(true)}>
                別名保存...
              </button>
            </div>
          )}
        </div>

        {/* 試合設定フォーム */}
        <div className="sidebar-section game-settings-form">
          <h3>試合設定</h3>
          <div className="settings-fields">
            <div className="field-group">
              <label>チームA名</label>
              <input
                type="text"
                value={scoreboardSettings.teamAName}
                onChange={(e) => handleSettingChange('teamAName', e.target.value)}
              />
            </div>
            
            <div className="field-group">
              <label>チームB名</label>
              <input
                type="text"
                value={scoreboardSettings.teamBName}
                onChange={(e) => handleSettingChange('teamBName', e.target.value)}
              />
            </div>

            <div className="field-group-row">
              <div className="field-group">
                <label>最大セット</label>
                <select
                  value={scoreboardSettings.maxSets}
                  onChange={(e) => handleSettingChange('maxSets', parseInt(e.target.value))}
                >
                  <option value={1}>1</option>
                  <option value={3}>3</option>
                  <option value={5}>5</option>
                </select>
              </div>

              <div className="field-group">
                <label>通常得点</label>
                <input
                  type="number"
                  min={1}
                  value={scoreboardSettings.normalSetPoints}
                  onChange={(e) => handleSettingChange('normalSetPoints', parseInt(e.target.value) || 25)}
                />
              </div>

              <div className="field-group">
                <label>最終得点</label>
                <input
                  type="number"
                  min={1}
                  value={scoreboardSettings.finalSetPoints}
                  onChange={(e) => handleSettingChange('finalSetPoints', parseInt(e.target.value) || 15)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* 得点板表示設定 */}
        <div className="sidebar-section overlay-settings-form">
          <h3>得点板プレビュー設定</h3>
          <div className="settings-fields">
            <div className="field-group-row">
              <div className="field-group">
                <label>位置</label>
                <select
                  value={scoreboardSettings.overlayPosition}
                  onChange={(e) => handleSettingChange('overlayPosition', e.target.value as any)}
                >
                  <option value="top-left">左上</option>
                  <option value="top-right">右上</option>
                  <option value="bottom-left">左下</option>
                  <option value="bottom-right">右下</option>
                </select>
              </div>

              <div className="field-group">
                <label>サイズ (%)</label>
                <input
                  type="number"
                  min={40}
                  max={150}
                  value={scoreboardSettings.overlaySize}
                  onChange={(e) => handleSettingChange('overlaySize', parseInt(e.target.value) || 100)}
                />
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* 中央ペイン: メインプレイヤー & タイムライン & 操作パネル */}
      <main className="main-content">
        <div className="player-section">
          {videoSrc ? (
            <div 
              className="video-wrapper"
              style={videoAspectRatio ? { aspectRatio: `${videoAspectRatio}` } : undefined}
            >
              <video
                ref={videoRef}
                src={videoSrc}
                className="video-element"
                playsInline
                onTimeUpdate={() => { handleTimeUpdate(); syncVideoDomState(); }}
                onLoadedMetadata={() => { handleLoadedMetadata(); syncVideoDomState(); }}
                onPlay={() => { handlePlay(); syncVideoDomState(); }}
                onPause={() => { handlePause(); syncVideoDomState(); }}
                onVolumeChange={syncVideoDomState}
                onError={(e) => {
                  const err = (e.target as HTMLVideoElement).error;
                  if (err) {
                    setVideoErrorMsg(`Code ${err.code}: ${err.message}`);
                  }
                }}
                onClick={togglePlay}
              />
              {/* スコアボードの重ね合わせ表示 (ON/OFFトグル連動) */}
              {activeState.overlayVisible && <ScoreboardOverlay state={activeState} settings={scoreboardSettings} />}
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
                      onClick={() => handleEventListClick(event.timestamp)}
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
          {videoPath && (
            <div className="debug-media-status">
              <div>
                MIME: {videoPath.toLowerCase().endsWith('.mov') ? 'video/quicktime' : videoPath.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4'} | 
                Err: {videoErrorMsg} | 
                Muted (State/DOM): {isMuted ? 'Muted' : 'Unmuted'} / {videoDomMuted ? 'Muted' : 'Unmuted'} | 
                Vol (State/DOM): {volume} / {videoDomVolume.toFixed(2)} | 
                URL: {videoSrc}
              </div>
              <div style={{ marginTop: '6px' }}>
                <button 
                  onClick={playTestTone}
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    backgroundColor: '#00e5ff',
                    color: '#08080a',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  🔊 スピーカーテスト音 (440Hz) を再生
                </button>
              </div>
            </div>
          )}
        </div>

        {/* スコア操作パネル */}
        <div className="score-control-section">
          {projectData ? (
            <ScoreController
              state={activeState}
              settings={scoreboardSettings}
              disabled={!videoPath}
              onAddPoint={handleAddPoint}
              onSetConfirm={handleSetConfirm}
              onToggleServe={handleToggleServe}
              onReset={handleReset}
              showOverlay={activeState.overlayVisible}
              onToggleOverlay={handleToggleOverlay}
              onUndo={handleUndo}
              canUndo={projectData ? projectData.events.length > 1 : false}
            />
          ) : (
            <div className="score-control-placeholder">
              動画またはプロジェクトJSONをロードすると、スコア操作パネルが有効になります。
            </div>
          )}
        </div>
      </main>

      {/* 右ペイン: イベント履歴 */}
      <section className="events-sidebar">
        <EventList
          events={projectData?.events || []}
          activeEventIndex={activeEventIndex}
          onEventClick={handleEventListClick}
          onEventDelete={handleEventDelete}
          teamAName={scoreboardSettings.teamAName}
          teamBName={scoreboardSettings.teamBName}
        />
      </section>
    </div>
  )
}

export default App
