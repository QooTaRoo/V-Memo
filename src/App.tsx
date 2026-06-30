import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open, save } from '@tauri-apps/plugin-dialog'
import React, { useEffect, useRef, useState } from 'react'
import './App.css'
import { EventList, formatTime } from './components/EventList'
import { ProjectDashboard } from './components/ProjectDashboard'
import { ScoreboardOverlay } from './components/ScoreboardOverlay'
import { ScoreController } from './components/ScoreController'
import { ScoreProgressionGraph } from './components/ScoreProgressionGraph'
import {
  EventState,
  ExportPreset,
  findActiveEventIndex,
  getActiveEventState,
  INITIAL_STATE,
  MatchSettings,
  ProjectData,
  recalculateEventStates,
  ScoreEvent
} from './utils/scoreEngine'
import { exportTransparentWebm } from './utils/videoExporter'

// デフォルトの新規プロジェクトテンプレート
const createDefaultProject = (videoPath: string | null = null): ProjectData => ({
  matchSettings: {
    teamAName: '',
    teamBName: '',
    maxSets: 3,
    normalSetPoints: 25,
    finalSetPoints: 25,
    theme: 'modern-dark',
    overlaySize: 100,
    overlayPosition: 'top-left',
    teamAColor: '#ffffff',
    teamBColor: '#ffffff',
    workspaceTheme: 'dark'
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

  // イン点・アウト点状態
  const [inPoint, setInPoint] = useState<number | null>(null)
  const [outPoint, setOutPoint] = useState<number | null>(null)

  // エクスポートモーダルの状態
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false)
  const [isMatchSettingsModalOpen, setIsMatchSettingsModalOpen] = useState<boolean>(false)
  const [isDisplaySettingsModalOpen, setIsDisplaySettingsModalOpen] = useState<boolean>(false)
  const [exportResolution, setExportResolution] = useState<string>('original')
  const [exportFade, setExportFade] = useState<boolean>(true)
  const [exportTitle, setExportTitle] = useState<boolean>(false)
  const [exportEventName, setExportEventName] = useState<string>('')
  const [exportMatchCard, setExportMatchCard] = useState<string>('')
  const [exportDatePlace, setExportDatePlace] = useState<string>('')
  const [exportTitleDuration, setExportTitleDuration] = useState<number | ''>(5)
  const [exportProgress, setExportProgress] = useState<number>(0)
  const [isExporting, setIsExporting] = useState<boolean>(false)
  const [exportStatusText, setExportStatusText] = useState<string>('')
  const [exportRangeMode, setExportRangeMode] = useState<'all' | 'inout'>('all')
  const [exportType, setExportType] = useState<'normal' | 'transparent'>('normal')
  const [exportPresets, setExportPresets] = useState<ExportPreset[]>([])
  const [activePresetId, setActivePresetId] = useState<string | null>(null)
  const [newPresetName, setNewPresetName] = useState<string>('')
  const [swapTeams, setSwapTeams] = useState<boolean>(false)
  const [mediaPort, setMediaPort] = useState<number | null>(null)
  const [videoScaleFactor, setVideoScaleFactor] = useState<number>(1.0)
  const [isRepairing, setIsRepairing] = useState<boolean>(false)
  const [repairStatusText, setRepairStatusText] = useState<string>('')
  const [showConvertConfirm, setShowConvertConfirm] = useState<string | null>(null)
  const convertResolverRef = useRef<((choice: 'convert' | 'skip') => void) | null>(null)


  // 試合設定数値入力の一時ローカル状態 (空文字入力を許容するため)
  const [inputNormalPoints, setInputNormalPoints] = useState<string>('25')
  const [inputFinalPoints, setInputFinalPoints] = useState<string>('15')
  const [inputOverlaySize, setInputOverlaySize] = useState<string>('100')

  // 参照 (Ref) 管理
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const isSeeking = useRef<boolean>(false)
  const lastInputTimeRef = useRef<number>(0) // 競合防止ロック用

  const syncVideoDomState = (): void => {
    // デバッグ情報削除に伴い空処理化
  }


  // 音量およびミュート状態を HTML ビデオ要素へ確実にバインド
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume
      videoRef.current.muted = isMuted
    }
  }, [volume, isMuted, videoPath])

  const updateVideoScaleFactor = () => {
    if (videoRef.current && videoRef.current.videoWidth > 0) {
      const displayedWidth = videoRef.current.clientWidth
      const nativeWidth = videoRef.current.videoWidth
      setVideoScaleFactor(displayedWidth / nativeWidth)
    }
  }

  useEffect(() => {
    if (!videoRef.current) return
    
    updateVideoScaleFactor()
    
    const observer = new ResizeObserver(() => {
      updateVideoScaleFactor()
    })
    
    observer.observe(videoRef.current)
    
    return () => {
      observer.disconnect()
    }
  }, [videoPath, projectData])


  // 音声形式（MP3 in MP4等）の自動変換チェック
  const checkAndFixVideoAudio = async (path: string): Promise<string> => {
    try {
      const metadata = await invoke<any>('get_video_metadata', { path })
      console.log('[AudioConvert] Loaded video metadata:', metadata)
      
      const hasAudio = metadata.hasAudio ?? metadata.has_audio
      const codec = (metadata.audioCodec ?? metadata.audio_codec)?.toLowerCase() || ''
      
      if (hasAudio && (codec === 'mp3' || codec.includes('mp3'))) {
        return new Promise<string>((resolve) => {
          convertResolverRef.current = async (choice: 'convert' | 'skip') => {
            convertResolverRef.current = null
            setShowConvertConfirm(null)
            
            if (choice === 'convert') {
              // デフォルトの出力ファイル名を生成
              const parts = path.split(/[/\\]/);
              const filename = parts.pop() || 'video.mp4';
              const parentDir = parts.join('/');
              const lastDot = filename.lastIndexOf('.');
              const stem = lastDot !== -1 ? filename.substring(0, lastDot) : filename;
              const ext = lastDot !== -1 ? filename.substring(lastDot + 1) : 'mp4';
              const defaultDest = `${parentDir}/${stem}_fixed.${ext}`;

              // 保存ファイル選択ダイアログを開く
              const savePath = await save({
                defaultPath: defaultDest,
                filters: [{
                  name: 'Videos',
                  extensions: [ext]
                }]
              });

              if (savePath && typeof savePath === 'string') {
                setIsRepairing(true)
                setRepairStatusText('音声形式を変換中...')
                // レンダリングスレッドに描画（モーダル表示）の機会を与えるため、100ms待つ
                await new Promise((r) => setTimeout(r, 100))
                try {
                  console.log('[AudioConvert] Starting format conversion for:', path, '->', savePath)
                  const fixedPath = await invoke<string>('fix_video_audio', { inputPath: path, outputPath: savePath })
                  console.log('[AudioConvert] Conversion complete:', fixedPath)
                  alert(`音声形式の変換が完了しました！\n変換後の動画「${fixedPath.split(/[/\\]/).pop()}」を読み込みます。`)
                  resolve(fixedPath)
                  return
                } catch (err: any) {
                  console.error('[AudioConvert] Conversion error:', err)
                  alert(`音声形式の変換中にエラーが発生しました:\n${err.message || err}`)
                } finally {
                  setIsRepairing(false)
                }
              }
            }
            resolve(path)
          }
          setShowConvertConfirm(path)
        })
      }
    } catch (err: any) {
      console.error('[AudioConvert] Check failed:', err)
      alert(`動画音声のチェック中にエラーが発生しました:\n${err.message || err}`)
    }
    return path
  }

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
        const finalPath = await checkAndFixVideoAudio(selected)
        setVideoPath(finalPath)
        const name = finalPath.split(/[/\\]/).pop() || ''
        setVideoName(name)
        setIsPlaying(false)
        setCurrentTime(0)
        setInPoint(null)
        setOutPoint(null)

        // プロジェクトがない場合はデフォルト新規プロジェクトを自動生成
        if (!projectData) {
          const newProj = createDefaultProject(finalPath)
          // 初期化して再計算
          newProj.events = recalculateEventStates(newProj.events, newProj.matchSettings)
          setProjectData(newProj)
          setActiveEventIndex(0)
          setActiveState(newProj.events[0].state)
        } else {
          // すでにプロジェクトがある場合は、動画パスを差し替え
          setProjectData({
            ...projectData,
            videoPath: finalPath
          })
        }
      }
    } catch (err: any) {
      console.error('Error selecting video:', err)
      alert('動画の選択に失敗しました: ' + err.message)
    }
  }

  // 履歴更新のヘルパー
  const updateRecentProjectInStorage = (path: string, videoPath: string | null = null) => {
    try {
      const stored = localStorage.getItem('vmemo_recent_projects')
      let list: any[] = stored ? JSON.parse(stored) : []
      const fileName = path.split(/[/\\]/).pop() || 'Unset'
      const existingIdx = list.findIndex(p => p.path === path)
      const updatedProject = {
        name: fileName,
        path: path,
        lastOpened: Date.now(),
        videoPath: videoPath
      }
      if (existingIdx > -1) {
        list[existingIdx] = updatedProject
      } else {
        list.push(updatedProject)
      }
      localStorage.setItem('vmemo_recent_projects', JSON.stringify(list))
    } catch (e) {
      console.error('Failed to update recent projects:', e)
    }
  }

  // プロジェクト読み込み時の状態反映
  const applyProjectLoadedData = async (data: ProjectData, path: string) => {
    setJsonPath(path)
    
    // 状態を綺麗に再計算して適用 (データの整合性担保)
    data.events = recalculateEventStates(data.events, data.matchSettings)
    setProjectData(data)

    // 試合設定入力の同期
    if (data.matchSettings) {
      setInputNormalPoints(String(data.matchSettings.normalSetPoints || 25))
      setInputFinalPoints(String(data.matchSettings.finalSetPoints || 15))
      setInputOverlaySize(String(data.matchSettings.overlaySize || 100))
    }

    // イン点・アウト点の復元
    if (data.inPoint !== undefined) {
      setInPoint(data.inPoint)
    } else {
      setInPoint(null)
    }
    if (data.outPoint !== undefined) {
      setOutPoint(data.outPoint)
    } else {
      setOutPoint(null)
    }

    // エクスポート設定の復元
    if (data.exportSettings) {
      const settings = data.exportSettings
      if (settings.resolution !== undefined) setExportResolution(settings.resolution)
      if (settings.fade !== undefined) setExportFade(settings.fade)
      if (settings.showTitle !== undefined) setExportTitle(settings.showTitle)
      if (settings.eventName !== undefined) setExportEventName(settings.eventName)
      if (settings.matchCard !== undefined) setExportMatchCard(settings.matchCard)
      if (settings.datePlace !== undefined) setExportDatePlace(settings.datePlace)
      if (settings.titleDuration !== undefined) setExportTitleDuration(settings.titleDuration)
      if (settings.exportType !== undefined) setExportType(settings.exportType as any)
      if (settings.rangeMode !== undefined) setExportRangeMode(settings.rangeMode as any)
    }
    
    // プリセットの復元
    if (data.exportPresets) {
      setExportPresets(data.exportPresets)
      setActivePresetId(null)
    } else {
      setExportPresets([])
      setActivePresetId(null)
    }
    
    const index = findActiveEventIndex(data.events, currentTime)
    setActiveEventIndex(index)
    setActiveState(getActiveEventState(data.events, currentTime))

    // 動画の自動ロード
    if (data.videoPath) {
      const videoExists = await invoke<boolean>('check_file_exists', { path: data.videoPath })
      if (videoExists) {
        const finalPath = await checkAndFixVideoAudio(data.videoPath)
        setVideoPath(finalPath)
        const name = finalPath.split(/[/\\]/).pop() || ''
        setVideoName(name)
        console.log('Video auto-loaded:', finalPath)
      } else {
        alert(
          `関連付けられた動画ファイルが見つかりませんでした。\nファイルが存在するか確認し、手動で動画を読み込んでください。\n(検索したパス: ${data.videoPath})`
        )
        setVideoPath(null)
        setVideoName('')
      }
    } else {
      setVideoPath(null)
      setVideoName('')
    }
  }

  // プロジェクトを閉じる処理
  const handleCloseProject = () => {
    setProjectData(null)
    setJsonPath('')
    setVideoPath(null)
    setVideoName('')
    setInPoint(null)
    setOutPoint(null)
    setCurrentTime(0)
    setIsPlaying(false)
    setActiveEventIndex(-1)
    setActiveState(INITIAL_STATE)
  }


  // プロジェクトの保存 (上書き / 別名保存)
  const handleSaveProject = async (saveAs: boolean = false): Promise<void> => {
    // projectData が null の場合 (動画のみ読み込み状態) は、デフォルト構造で保存を続行
    const baseProject = projectData ?? createDefaultProject(videoPath)

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

      // 保存するデータ構造を整理 (現在の動画絶対パス、イン点/アウト点、エクスポート設定、書き出しプリセットを格納)
      const dataToSave: ProjectData = {
        ...baseProject,
        videoPath: videoPath,
        inPoint: inPoint,
        outPoint: outPoint,
        exportSettings: {
          resolution: exportResolution,
          fade: exportFade,
          showTitle: exportTitle,
          eventName: exportEventName,
          matchCard: exportMatchCard,
          datePlace: exportDatePlace,
          titleDuration: exportTitleDuration,
          exportType: exportType,
          rangeMode: exportRangeMode
        },
        exportPresets: exportPresets
      }

      await invoke('save_project_json', {
        path: targetPath,
        content: JSON.stringify(dataToSave, null, 2)
      })
      setJsonPath(targetPath)
      setProjectData(dataToSave)
      updateRecentProjectInStorage(targetPath, videoPath)
      alert('プロジェクトを保存しました！')
    } catch (err: any) {
      console.error('Save failed:', err)
      alert('プロジェクトの保存に失敗しました: ' + err.message)
    }
  }

  // プリセットのロード (適用)
  const applyPreset = (preset: ExportPreset) => {
    setActivePresetId(preset.id)
    setInPoint(preset.inPoint)
    setOutPoint(preset.outPoint)
    if (preset.exportSettings) {
      const s = preset.exportSettings
      if (s.resolution !== undefined) setExportResolution(s.resolution)
      if (s.fade !== undefined) setExportFade(s.fade)
      if (s.showTitle !== undefined) setExportTitle(s.showTitle)
      if (s.eventName !== undefined) setExportEventName(s.eventName)
      if (s.matchCard !== undefined) setExportMatchCard(s.matchCard)
      if (s.datePlace !== undefined) setExportDatePlace(s.datePlace)
      if (s.titleDuration !== undefined) setExportTitleDuration(s.titleDuration)
      if (s.exportType !== undefined) setExportType(s.exportType)
      if (s.rangeMode !== undefined) setExportRangeMode(s.rangeMode)
    }
  }

  // プリセットデータの自動保存
  const autoSavePresets = async (updatedPresets: ExportPreset[]) => {
    if (!jsonPath) return  // 保存先パスがなければ何もできない
    // projectData が null の場合 (動画のみ読み込み状態) はデフォルト構造で保存
    const baseProject = projectData ?? createDefaultProject(videoPath)
    try {
      const dataToSave: ProjectData = {
        ...baseProject,
        videoPath: videoPath,
        inPoint: inPoint,
        outPoint: outPoint,
        exportSettings: {
          resolution: exportResolution,
          fade: exportFade,
          showTitle: exportTitle,
          eventName: exportEventName,
          matchCard: exportMatchCard,
          datePlace: exportDatePlace,
          titleDuration: exportTitleDuration,
          exportType: exportType,
          rangeMode: exportRangeMode
        },
        exportPresets: updatedPresets
      }
      
      await invoke('save_project_json', {
        path: jsonPath,
        content: JSON.stringify(dataToSave, null, 2)
      })
      setProjectData(dataToSave)
      console.log('[AutoSave] Presets saved automatically to JSON:', jsonPath)
    } catch (err) {
      console.error('[AutoSave] Failed to auto-save presets:', err)
    }
  }

  // プリセットの新規追加
  const addNewPreset = async (name: string) => {
    // jsonPath がない場合はまずプロジェクトの保存先を指定させる
    let targetPath = jsonPath
    if (!targetPath) {
      const selected = await save({
        filters: [{ name: 'Project JSON', extensions: ['json'] }],
        defaultPath: 'match_project.json'
      })
      if (!selected) return
      targetPath = selected
      setJsonPath(targetPath)
    }

    const newPreset: ExportPreset = {
      id: Date.now().toString(),
      name: name,
      inPoint: inPoint,
      outPoint: outPoint,
      exportSettings: {
        resolution: exportResolution,
        fade: exportFade,
        showTitle: exportTitle,
        eventName: exportEventName,
        matchCard: exportMatchCard,
        datePlace: exportDatePlace,
        titleDuration: exportTitleDuration,
        exportType: exportType,
        rangeMode: exportRangeMode
      }
    }
    const updated = [...exportPresets, newPreset]
    setExportPresets(updated)
    setActivePresetId(newPreset.id)
    
    const baseProject = projectData ?? createDefaultProject(videoPath)
    const dataToSave: ProjectData = { ...baseProject, videoPath, inPoint, outPoint, exportPresets: updated }
    setProjectData(dataToSave)
    
    try {
      await invoke('save_project_json', { path: targetPath, content: JSON.stringify(dataToSave, null, 2) })
      console.log('[AutoSave] Preset added and saved.')
    } catch (err) {
      console.error('[AutoSave] Failed:', err)
    }
  }

  // 現在の設定で既存のプリセットを上書き
  const updatePreset = async (id: string) => {
    const updated = exportPresets.map(p => {
      if (p.id === id) {
        return {
          ...p,
          inPoint: inPoint,
          outPoint: outPoint,
          exportSettings: {
            resolution: exportResolution,
            fade: exportFade,
            showTitle: exportTitle,
            eventName: exportEventName,
            matchCard: exportMatchCard,
            datePlace: exportDatePlace,
            titleDuration: exportTitleDuration,
            exportType: exportType,
            rangeMode: exportRangeMode
          }
        }
      }
      return p
    })
    setExportPresets(updated)
    autoSavePresets(updated)
  }

  // プリセットの削除
  const deletePreset = (id: string) => {
    const updated = exportPresets.filter(p => p.id !== id)
    setExportPresets(updated)
    if (activePresetId === id) {
      setActivePresetId(null)
    }
    autoSavePresets(updated)
  }

  // タイムアウトイベントの追加
  const handleTimeout = (team: 'A' | 'B'): void => {
    if (!projectData) return
    
    const currentEventState = activeEventIndex >= 0 
      ? projectData.events[activeEventIndex].state 
      : INITIAL_STATE
      
    const newEvent: ScoreEvent = {
      id: `timeout_${Date.now()}`,
      timestamp: currentTime,
      type: 'timeout',
      team: team,
      state: {
        ...currentEventState,
        servingTeam: currentEventState.servingTeam,
        matchFinished: currentEventState.matchFinished,
        setWinner: null
      }
    }
    
    const updatedEvents = [...projectData.events, newEvent]
    updatedEvents.sort((a, b) => a.timestamp - b.timestamp)
    
    const recalculated = recalculateEventStates(updatedEvents, projectData.matchSettings)
    
    const updatedProject = {
      ...projectData,
      events: recalculated
    }
    setProjectData(updatedProject)
    
    const newIndex = recalculated.findIndex(e => e.id === newEvent.id)
    setActiveEventIndex(newIndex)
    setActiveState(recalculated[newIndex].state)
    
    // イベント追加後、もしプロジェクトファイル(jsonPath)があれば自動保存する
    if (jsonPath) {
      invoke('save_project_json', {
        path: jsonPath,
        content: JSON.stringify(updatedProject, null, 2)
      }).catch(err => console.error('[AutoSave] Failed to auto-save timeout event:', err))
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

  // 試合設定数値入力の同期用
  useEffect(() => {
    if (projectData) {
      setInputNormalPoints(String(projectData.matchSettings.normalSetPoints))
      setInputFinalPoints(String(projectData.matchSettings.finalSetPoints))
      setInputOverlaySize(String(projectData.matchSettings.overlaySize))
    }
  }, [
    projectData?.matchSettings.normalSetPoints,
    projectData?.matchSettings.finalSetPoints,
    projectData?.matchSettings.overlaySize
  ])

  // アプリ起動時にメディアサーバーのポートを取得する
  useEffect(() => {
    const fetchPort = async () => {
      try {
        const port = await invoke<number>('get_media_port')
        setMediaPort(port)
        console.log('[App] Loaded media server port:', port)
      } catch (err) {
        console.error('Failed to load media server port:', err)
      }
    }
    fetchPort()
  }, [])

  // セット数変化時にプリセット名を自動更新 & チームの左右自動入れ替え
  useEffect(() => {
    const setNum = activeState.setsA + activeState.setsB + 1
    setNewPresetName(`第${setNum}セット`)
    // 偶数セット (第2, 4...) は自動でチームを入れ替え
    setSwapTeams((setNum % 2) === 0)
  }, [activeState.setsA, activeState.setsB])

  // モーダルが開かれた時の初期範囲モード自動決定 & 対戦カード名の自動生成
  useEffect(() => {
    if (isExportModalOpen) {
      if (inPoint !== null || outPoint !== null) {
        setExportRangeMode('inout')
      } else {
        setExportRangeMode('all')
      }
      // モードは常に通常エクスポートをデフォルトに
      setExportType('normal')
      // 対戦カード名を自動生成（チーム名 + アクティブなプリセット名）
      const teamA = scoreboardSettings.teamAName || 'チームA'
      const teamB = scoreboardSettings.teamBName || 'チームB'
      const activePreset = exportPresets.find(p => p.id === activePresetId)
      const matchCardAuto = activePreset
        ? `${teamA} VS ${teamB} (${activePreset.name})`
        : `${teamA} VS ${teamB}`
      setExportMatchCard(matchCardAuto)
    }
  }, [isExportModalOpen, inPoint, outPoint])

  // エクスポートリスナー
  useEffect(() => {
    let unlistenComplete: any
    let unlistenError: any
    const setupListeners = async () => {
      unlistenComplete = await listen('export-complete', () => {
        setIsExporting(false)
        setExportStatusText('完了！')
        alert('動画のエクスポートが完了しました！')
        setIsExportModalOpen(false)
      })
      unlistenError = await listen('export-error', (event: any) => {
        setIsExporting(false)
        setExportStatusText('エラー発生')
        alert(`エクスポートに失敗しました:\n${event.payload}`)
      })
    }
    setupListeners()
    return () => {
      if (unlistenComplete) unlistenComplete()
      if (unlistenError) unlistenError()
    }
  }, [])

  // エクスポート実行
  const handleExport = async (): Promise<void> => {
    if (!videoPath || !projectData) return

    try {
      // 保存先ファイルの選択
      const isTransparent = exportType === 'transparent'
      const outputVideoPath = await save({
        title: isTransparent ? '得点板（透過）動画の保存先' : 'エクスポート動画の保存先',
        defaultPath: `${videoName.replace(/\.[^/.]+$/, '')}_fixed.${isTransparent ? 'mov' : 'mp4'}`,
        filters: [{
          name: isTransparent ? 'MOV Video (ProRes 4444)' : 'MP4 Video',
          extensions: [isTransparent ? 'mov' : 'mp4']
        }]
      })

      if (!outputVideoPath || typeof outputVideoPath !== 'string') {
        return
      }

      setIsExporting(true)
      setExportProgress(0)
      setExportStatusText('メタデータ取得中...')

      // ビデオメタデータの取得
      const metadata = await invoke<any>('get_video_metadata', { path: videoPath })
      console.log('[Export] Loaded video metadata for FFmpeg:', metadata)

      setExportStatusText('オーバーレイ映像を生成中...')
      
      const inPt = exportRangeMode === 'all' ? 0 : (inPoint !== null ? inPoint : 0)
      const outPt = exportRangeMode === 'all' ? duration : (outPoint !== null ? outPoint : duration)

      // 得点板透明WebMを一時フォルダにエクスポート
      const { path: tempWebmPath, useColorkey } = await exportTransparentWebm(
        metadata,
        projectData.events,
        scoreboardSettings,
        inPt,
        outPt,
        {
          showTitle: exportTitle,
          eventName: exportEventName,
          matchCard: exportMatchCard,
          datePlace: exportDatePlace,
          duration: typeof exportTitleDuration === 'number' ? exportTitleDuration : 5
        },
        (pct) => {
          setExportProgress(pct)
          setExportStatusText(`オーバーレイ映像を生成中... ${pct}%`)
        }
      )

      setExportStatusText(isTransparent ? 'FFmpegで透過動画に変換中...' : 'FFmpegで元動画と合成中...')
      
      // Tauri側の export_video を呼び出す
      await invoke('export_video', {
        args: {
          inputVideoPath: videoPath,
          overlayVideoPath: tempWebmPath,
          outputVideoPath: outputVideoPath,
          exportType: exportType,
          inPoint: inPt,
          outPoint: outPt,
          resolution: exportResolution,
          fade: exportFade,
          totalDuration: duration,
          fps: metadata.fps,
          useColorkey: useColorkey
        }
      })

      setExportStatusText('合成処理を開始しました。完了をお待ちください...')
    } catch (e: any) {
      console.error('[Export] Error during export process:', e)
      setIsExporting(false)
      setExportStatusText('失敗しました')
      alert('エクスポートに失敗しました:\n' + e.message)
    }
  }

  // ローカルメディアサーバーのURL生成 (Tauriのアセットプロトコルでの音声再生バグ回避のため)
  const videoSrc = (videoPath && mediaPort)
    ? `http://127.0.0.1:${mediaPort}/video?path=${encodeURIComponent(videoPath)}`
    : ''

  const scoreboardSettings = projectData?.matchSettings || createDefaultProject().matchSettings

  // 自前でイベントリストをラッピングし、削除用イベントを仲介
  const handleEventListClick = (timestamp: number): void => {
    handleEventClick(timestamp)
  }

  if (!projectData) {
    return <ProjectDashboard onProjectLoaded={applyProjectLoadedData} />
  }

  const currentTheme = scoreboardSettings.workspaceTheme || 'dark'

  return (
    <div className={`app-root theme-${currentTheme}`} style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      {/* 上部メニューバー */}
      <header className="app-menubar">
        <div className="menubar-left" style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span className="menubar-logo" style={{ fontSize: '20px' }}>🏐</span>
          <span className="menubar-title" style={{ fontSize: '15px', fontWeight: 'bold', background: 'linear-gradient(135deg, #00e5ff, #00ff66)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            V-Memo Score Editor
          </span>
          {jsonPath && (
            <span 
              className="menubar-project-name" 
              title={jsonPath}
              style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
                backgroundColor: 'var(--bg-input)',
                padding: '4px 10px',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                marginLeft: '8px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '250px'
              }}
            >
              📄 {jsonPath.split(/[/\\]/).pop()}
            </span>
          )}
        </div>
        <div className="menubar-right" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button 
            className="menu-btn" 
            onClick={handleSelectVideo}
          >
            🎬 動画を変更
          </button>
          <button 
            className="menu-btn" 
            onClick={() => handleSaveProject(false)}
          >
            💾 上書き保存
          </button>
          <button 
            className="menu-btn" 
            onClick={() => handleSaveProject(true)}
          >
            📝 別名保存...
          </button>
          <button 
            className="menu-btn" 
            onClick={() => setIsMatchSettingsModalOpen(true)}
          >
            ⚙️ 試合設定...
          </button>
          <button 
            className="menu-btn" 
            onClick={() => setIsDisplaySettingsModalOpen(true)}
          >
            🎨 表示設定...
          </button>
          <button 
            className="menu-btn menu-btn-primary" 
            onClick={() => setIsExportModalOpen(true)}
            disabled={!videoPath}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: '700',
              backgroundColor: videoPath ? '#00e5ff' : 'var(--bg-input)',
              border: 'none',
              color: videoPath ? '#08080a' : 'var(--text-muted)',
              borderRadius: '5px',
              cursor: videoPath ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s'
            }}
          >
            📤 動画のエクスポート...
          </button>
          <span style={{ borderLeft: '1px solid var(--border-color)', height: '16px', margin: '0 4px' }} />
          <button 
            className="menu-btn menu-btn-danger" 
            onClick={handleCloseProject}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: '600',
              backgroundColor: 'rgba(255, 80, 80, 0.1)',
              border: '1px solid rgba(255, 80, 80, 0.2)',
              color: '#ff5050',
              borderRadius: '5px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            🚪 プロジェクトを閉じる
          </button>
        </div>
      </header>

      <div className="app-container">

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
                    console.error(`Video Error: Code ${err.code}: ${err.message}`);
                  }
                }}
                onClick={togglePlay}
              />
              {/* スコアボードの重ね合わせ表示 (ON/OFFトグル連動) */}
              {activeState.overlayVisible && <ScoreboardOverlay state={activeState} settings={scoreboardSettings} swapTeams={swapTeams} scaleFactor={videoScaleFactor} />}
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
            {/* イン点・アウト点の範囲表示 */}
            {videoPath && duration > 0 && inPoint !== null && (
              <div 
                className="in-out-range-highlight"
                style={{
                  position: 'absolute',
                  top: 0,
                  height: '100%',
                  left: `${(inPoint / duration) * 100}%`,
                  width: `${(( (outPoint !== null ? outPoint : duration) - inPoint) / duration) * 100}%`,
                  backgroundColor: 'rgba(0, 229, 255, 0.18)',
                  pointerEvents: 'none',
                  borderRadius: '3px',
                  zIndex: 1
                }}
              />
            )}
            {/* イン点マーカー (水色の縦線) */}
            {videoPath && duration > 0 && inPoint !== null && (
              <div 
                className="in-point-line-marker"
                style={{
                  position: 'absolute',
                  left: `${(inPoint / duration) * 100}%`,
                  top: '-4px',
                  width: '2px',
                  height: 'calc(100% + 8px)',
                  backgroundColor: '#00e5ff',
                  pointerEvents: 'none',
                  zIndex: 2,
                  boxShadow: '0 0 6px rgba(0, 229, 255, 0.8)'
                }}
              />
            )}
            {/* アウト点マーカー (赤色の縦線) */}
            {videoPath && duration > 0 && outPoint !== null && (
              <div 
                className="out-point-line-marker"
                style={{
                  position: 'absolute',
                  left: `${(outPoint / duration) * 100}%`,
                  top: '-4px',
                  width: '2px',
                  height: 'calc(100% + 8px)',
                  backgroundColor: '#ff3b30',
                  pointerEvents: 'none',
                  zIndex: 2,
                  boxShadow: '0 0 6px rgba(255, 59, 48, 0.8)'
                }}
              />
            )}
            {/* イン点フラグ (クリックでイン点へシーク) */}
            {videoPath && duration > 0 && inPoint !== null && (
              <div 
                className="in-point-flag"
                onClick={(e) => {
                  e.stopPropagation();
                  if (videoRef.current) {
                    videoRef.current.currentTime = inPoint;
                    setCurrentTime(inPoint);
                  }
                }}
                style={{
                  position: 'absolute',
                  left: `${(inPoint / duration) * 100}%`,
                  transform: 'translateX(-50%)',
                  top: '-18px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  zIndex: 15,
                  userSelect: 'none',
                  filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))'
                }}
                title={`イン点へ移動: ${formatTime(inPoint)}`}
              >
                🏳️
              </div>
            )}
            {/* アウト点フラグ (クリックでアウト点へシーク) */}
            {videoPath && duration > 0 && outPoint !== null && (
              <div 
                className="out-point-flag"
                onClick={(e) => {
                  e.stopPropagation();
                  if (videoRef.current) {
                    videoRef.current.currentTime = outPoint;
                    setCurrentTime(outPoint);
                  }
                }}
                style={{
                  position: 'absolute',
                  left: `${(outPoint / duration) * 100}%`,
                  transform: 'translateX(-50%)',
                  top: '-18px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  zIndex: 15,
                  userSelect: 'none',
                  filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))'
                }}
                title={`アウト点へ移動: ${formatTime(outPoint)}`}
              >
                🚩
              </div>
            )}
          </div>

          {/* プレイヤーコントロール */}
          <div className="controls-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', gap: '16px', flexWrap: 'wrap' }}>
            <div className="controls-left" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'nowrap' }}>
              {/* スキップ・再生ボタン群 (-10, -5, -1, -f, 再生, +f, +1, +5, +10) */}
              <div className="playback-group" style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                <button 
                  onClick={() => { if (videoRef.current) { const t = Math.max(0, videoRef.current.currentTime - 10); videoRef.current.currentTime = t; setCurrentTime(t); } }}
                  disabled={!videoPath}
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: 'white',
                    padding: '4px 6px',
                    fontSize: '11px',
                    borderRadius: '4px',
                    cursor: !videoPath ? 'not-allowed' : 'pointer',
                    opacity: !videoPath ? 0.4 : 1,
                    minWidth: '28px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    transition: 'all 0.15s'
                  }}
                  title="10秒戻る"
                >
                  -10
                </button>
                <button 
                  onClick={() => { if (videoRef.current) { const t = Math.max(0, videoRef.current.currentTime - 5); videoRef.current.currentTime = t; setCurrentTime(t); } }}
                  disabled={!videoPath}
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: 'white',
                    padding: '4px 6px',
                    fontSize: '11px',
                    borderRadius: '4px',
                    cursor: !videoPath ? 'not-allowed' : 'pointer',
                    opacity: !videoPath ? 0.4 : 1,
                    minWidth: '28px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    transition: 'all 0.15s'
                  }}
                  title="5秒戻る"
                >
                  -5
                </button>
                <button 
                  onClick={() => { if (videoRef.current) { const t = Math.max(0, videoRef.current.currentTime - 1); videoRef.current.currentTime = t; setCurrentTime(t); } }}
                  disabled={!videoPath}
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: 'white',
                    padding: '4px 6px',
                    fontSize: '11px',
                    borderRadius: '4px',
                    cursor: !videoPath ? 'not-allowed' : 'pointer',
                    opacity: !videoPath ? 0.4 : 1,
                    minWidth: '28px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    transition: 'all 0.15s'
                  }}
                  title="1秒戻る"
                >
                  -1
                </button>
                <button 
                  onClick={() => { if (videoRef.current) { const t = Math.max(0, videoRef.current.currentTime - 1/30); videoRef.current.currentTime = t; setCurrentTime(t); } }}
                  disabled={!videoPath}
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: 'white',
                    padding: '4px 6px',
                    fontSize: '11px',
                    borderRadius: '4px',
                    cursor: !videoPath ? 'not-allowed' : 'pointer',
                    opacity: !videoPath ? 0.4 : 1,
                    minWidth: '28px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    transition: 'all 0.15s'
                  }}
                  title="1フレーム戻る (Shift+←)"
                >
                  -f
                </button>

                <button 
                  onClick={togglePlay} 
                  disabled={!videoPath}
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: !videoPath ? 'rgba(255, 255, 255, 0.1)' : '#00e5ff',
                    color: !videoPath ? 'rgba(255, 255, 255, 0.4)' : '#08080a',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: !videoPath ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                    margin: '0 4px',
                    fontWeight: 'bold',
                    transition: 'all 0.15s'
                  }}
                >
                  {isPlaying ? '⏸' : '▶'}
                </button>

                <button 
                  onClick={() => { if (videoRef.current) { const t = Math.min(duration, videoRef.current.currentTime + 1/30); videoRef.current.currentTime = t; setCurrentTime(t); } }}
                  disabled={!videoPath}
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: 'white',
                    padding: '4px 6px',
                    fontSize: '11px',
                    borderRadius: '4px',
                    cursor: !videoPath ? 'not-allowed' : 'pointer',
                    opacity: !videoPath ? 0.4 : 1,
                    minWidth: '28px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    transition: 'all 0.15s'
                  }}
                  title="1フレーム進む (Shift+→)"
                >
                  +f
                </button>
                <button 
                  onClick={() => { if (videoRef.current) { const t = Math.min(duration, videoRef.current.currentTime + 1); videoRef.current.currentTime = t; setCurrentTime(t); } }}
                  disabled={!videoPath}
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: 'white',
                    padding: '4px 6px',
                    fontSize: '11px',
                    borderRadius: '4px',
                    cursor: !videoPath ? 'not-allowed' : 'pointer',
                    opacity: !videoPath ? 0.4 : 1,
                    minWidth: '28px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    transition: 'all 0.15s'
                  }}
                  title="1秒進む"
                >
                  +1
                </button>
                <button 
                  onClick={() => { if (videoRef.current) { const t = Math.min(duration, videoRef.current.currentTime + 5); videoRef.current.currentTime = t; setCurrentTime(t); } }}
                  disabled={!videoPath}
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: 'white',
                    padding: '4px 6px',
                    fontSize: '11px',
                    borderRadius: '4px',
                    cursor: !videoPath ? 'not-allowed' : 'pointer',
                    opacity: !videoPath ? 0.4 : 1,
                    minWidth: '28px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    transition: 'all 0.15s'
                  }}
                  title="5秒進む"
                >
                  +5
                </button>
                <button 
                  onClick={() => { if (videoRef.current) { const t = Math.min(duration, videoRef.current.currentTime + 10); videoRef.current.currentTime = t; setCurrentTime(t); } }}
                  disabled={!videoPath}
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: 'white',
                    padding: '4px 6px',
                    fontSize: '11px',
                    borderRadius: '4px',
                    cursor: !videoPath ? 'not-allowed' : 'pointer',
                    opacity: !videoPath ? 0.4 : 1,
                    minWidth: '28px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    transition: 'all 0.15s'
                  }}
                  title="10秒進む"
                >
                  +10
                </button>
              </div>

              <span className="time-display" style={{ marginLeft: '12px', fontSize: '12px', color: 'rgba(255, 255, 255, 0.8)', whiteSpace: 'nowrap' }}>
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>

              {/* イン点・アウト点設定ボタン (トグル動作、レイアウト崩れ対策) */}
              {videoPath && (
                <div className="in-out-buttons" style={{ display: 'flex', gap: '4px', marginLeft: '12px', alignItems: 'center' }}>
                  <button 
                    onClick={() => setInPoint(inPoint !== null ? null : currentTime)} 
                    style={{
                      height: '24px',
                      padding: '0 8px',
                      fontSize: '11px',
                      backgroundColor: inPoint !== null ? 'rgba(0, 229, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                      border: inPoint !== null ? '1px solid #00e5ff' : '1px solid rgba(255, 255, 255, 0.1)',
                      color: inPoint !== null ? '#00e5ff' : 'rgba(255,255,255,0.6)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      whiteSpace: 'nowrap',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title={inPoint !== null ? `イン点: ${formatTime(inPoint)} (クリックでクリア)` : '現在の時間をイン点に設定'}
                  >
                    [ IN {inPoint !== null ? '✓' : ''} ]
                  </button>
                  <button 
                    onClick={() => setOutPoint(outPoint !== null ? null : currentTime)} 
                    style={{
                      height: '24px',
                      padding: '0 8px',
                      fontSize: '11px',
                      backgroundColor: outPoint !== null ? 'rgba(255, 59, 48, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                      border: outPoint !== null ? '1px solid #ff3b30' : '1px solid rgba(255, 255, 255, 0.1)',
                      color: outPoint !== null ? '#ff3b30' : 'rgba(255,255,255,0.6)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      whiteSpace: 'nowrap',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title={outPoint !== null ? `アウト点: ${formatTime(outPoint)} (クリックでクリア)` : '現在の時間をアウト点に設定'}
                  >
                    [ OUT {outPoint !== null ? '✓' : ''} ]
                  </button>
                </div>
              )}
            </div>

            <div className="controls-right" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'nowrap' }}>
              {/* 再生速度 */}
              <div className="control-item" style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                <label style={{ fontSize: '12px' }}>速度:</label>
                <select value={playbackRate} onChange={handlePlaybackRateChange} disabled={!videoPath} style={{ padding: '2px 4px', background: '#202024', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', fontSize: '12px' }}>
                  <option value={0.5}>0.5x</option>
                  <option value={1.0}>1.0x</option>
                  <option value={1.5}>1.5x</option>
                  <option value={2.0}>2.0x</option>
                </select>
              </div>

              {/* 音量 */}
              <div className="control-item volume-control" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button className="btn-mute" onClick={toggleMute} disabled={!videoPath} style={{ background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', fontSize: '14px', padding: 0 }}>
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
                  style={{ width: '60px', height: '4px', cursor: 'pointer' }}
                />
              </div>
            </div>
          </div>

          {/* 切り出しプリセット (セット切り出しリスト) */}
          {videoPath && (
            <div className="presets-container" style={{
              marginTop: '10px',
              padding: '10px 12px',
              background: 'var(--bg-main)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-main)', flexShrink: 0 }}>
                  📂 切り出し範囲プリセット
                </span>
                <div style={{ display: 'flex', gap: '4px', flex: 1, justifyContent: 'flex-end' }}>
                  <input
                    type="text"
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    placeholder="例: 第1セット"
                    style={{
                      flex: 1,
                      maxWidth: '160px',
                      padding: '3px 8px',
                      fontSize: '11px',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-input)',
                      borderRadius: '4px',
                      color: 'var(--text-main)',
                      outline: 'none'
                    }}
                  />
                  <button
                    onClick={() => {
                      if (newPresetName.trim()) {
                        addNewPreset(newPresetName.trim())
                        setNewPresetName('')
                      }
                    }}
                    disabled={!newPresetName.trim()}
                    style={{
                      padding: '3px 10px',
                      fontSize: '11px',
                      backgroundColor: newPresetName.trim() ? 'rgba(0, 229, 255, 0.15)' : 'var(--bg-input)',
                      border: newPresetName.trim() ? '1px solid rgba(0, 229, 255, 0.3)' : '1px solid var(--border-input)',
                      color: newPresetName.trim() ? '#00e5ff' : 'var(--text-muted)',
                      borderRadius: '4px',
                      cursor: newPresetName.trim() ? 'pointer' : 'default',
                      fontWeight: 'bold',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    ＋ 追加
                  </button>
                </div>
              </div>

              {exportPresets.length === 0 ? (
                <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', padding: '6px 0' }}>
                  登録されたプリセットはありません。範囲(イン/アウト点)を設定して追加してください。
                </p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {exportPresets.map(preset => {
                    const isActive = activePresetId === preset.id;
                    return (
                      <div
                        key={preset.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          backgroundColor: isActive ? 'rgba(0, 229, 255, 0.15)' : 'var(--bg-input)',
                          border: isActive ? '1px solid #00e5ff' : '1px solid var(--border-card)',
                          borderRadius: '4px',
                          padding: '2px 2px 2px 8px',
                          gap: '6px'
                        }}
                      >
                        <span
                          onClick={() => applyPreset(preset)}
                          style={{
                            fontSize: '11px',
                            color: isActive ? '#00e5ff' : 'var(--text-main)',
                            cursor: 'pointer',
                            fontWeight: isActive ? 'bold' : 'normal'
                          }}
                          title={`クリックして適用 (イン: ${formatTime(preset.inPoint !== null ? preset.inPoint : 0)} / アウト: ${formatTime(preset.outPoint !== null ? preset.outPoint : duration)})`}
                        >
                          {preset.name}
                        </span>
                        
                        <div style={{ display: 'flex', gap: '2px' }}>
                          <button
                            onClick={() => updatePreset(preset.id)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              fontSize: '10px',
                              padding: '2px',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                            title="現在の設定で上書き保存"
                          >
                            💾
                          </button>
                          <button
                            onClick={() => deletePreset(preset.id)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'rgba(255, 59, 48, 0.7)',
                              cursor: 'pointer',
                              fontSize: '10px',
                              padding: '2px',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                            title="削除"
                          >
                            ❌
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>

        {/* スコア推移グラフ */}
        <div className="score-graph-section" style={{ padding: '0 20px 10px 20px', flexShrink: 0 }}>
          <ScoreProgressionGraph
            projectData={projectData}
            currentTime={currentTime}
            swapTeams={swapTeams}
            onSeek={(time) => {
              if (videoRef.current) {
                videoRef.current.currentTime = time
              }
            }}
          />
        </div>
      </main>

      {/* 右ペイン: 得点操作 & イベント履歴 */}
      <section className="events-sidebar">
        <div className="compact-score-controller-wrapper" style={{ padding: '16px 16px 0 16px', flexShrink: 0 }}>
          {projectData ? (
            <ScoreController
              compact={true}
              state={activeState}
              settings={scoreboardSettings}
              disabled={!videoPath}
              onAddPoint={handleAddPoint}
              onSetConfirm={handleSetConfirm}
              onToggleServe={handleToggleServe}
              onReset={handleReset}
              onTimeout={handleTimeout}
              showOverlay={activeState.overlayVisible}
              onToggleOverlay={handleToggleOverlay}
              onUndo={handleUndo}
              canUndo={projectData ? projectData.events.length > 1 : false}
              swapTeams={swapTeams}
              onToggleSwapTeams={() => setSwapTeams(s => !s)}
            />
          ) : (
            <div className="score-control-placeholder" style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', fontSize: '12px', color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>
              プロジェクトをロードすると操作パネルが有効になります。
            </div>
          )}
        </div>
        <EventList
          events={projectData?.events || []}
          activeEventIndex={activeEventIndex}
          onEventClick={handleEventListClick}
          onEventDelete={handleEventDelete}
          teamAName={scoreboardSettings.teamAName}
          teamBName={scoreboardSettings.teamBName}
          teamAColor={scoreboardSettings.teamAColor}
          teamBColor={scoreboardSettings.teamBColor}
        />
      </section>

      {/* 動画エクスポートモーダル */}
      {isExportModalOpen && (
        <div 
          className="modal-backdrop"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999
          }}
        >
          <div 
            className="modal-content"
            style={{
              backgroundColor: '#16161a',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              padding: '24px',
              width: '540px',
              maxWidth: '90%',
              color: 'white',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: '#00e5ff' }}>
              🎬 動画をエクスポート
            </h2>

            {isExporting ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <p style={{ fontWeight: 'bold', fontSize: '15px' }}>{exportStatusText}</p>
                <div style={{
                  width: '100%',
                  height: '8px',
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  marginTop: '12px',
                  marginBottom: '6px'
                }}>
                  <div style={{
                    width: `${exportProgress}%`,
                    height: '100%',
                    backgroundColor: '#00e5ff',
                    transition: 'width 0.2s ease'
                  }} />
                </div>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>進捗: {exportProgress}%</span>
              </div>
            ) : (
              <div>
                {/* 1. 書き出し範囲情報 */}
                <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>1. 書き出し範囲</h4>
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
                      <input 
                        type="radio" 
                        name="exportRangeMode" 
                        value="all" 
                        checked={exportRangeMode === 'all'} 
                        onChange={() => setExportRangeMode('all')} 
                      />
                      動画全体 (全範囲)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', opacity: (inPoint === null && outPoint === null) ? 0.5 : 1 }}>
                      <input 
                        type="radio" 
                        name="exportRangeMode" 
                        value="inout" 
                        disabled={inPoint === null && outPoint === null}
                        checked={exportRangeMode === 'inout'} 
                        onChange={() => setExportRangeMode('inout')} 
                      />
                      指定範囲 (イン点・アウト点)
                    </label>
                  </div>
                  
                  <p style={{ margin: '8px 0 0 0', fontSize: '13px', color: 'rgba(255,255,255,0.8)' }}>
                    {exportRangeMode === 'all' ? (
                      `範囲: 開始 00:00.00 〜 終了 ${formatTime(duration)} (全体)`
                    ) : (
                      `範囲: ${inPoint !== null ? formatTime(inPoint) : '00:00.00'} 〜 ${outPoint !== null ? formatTime(outPoint) : formatTime(duration)}`
                    )}
                  </p>
                  <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#00e5ff' }}>
                    総書き出し時間: {formatTime(
                      exportRangeMode === 'all' 
                        ? duration 
                        : (outPoint !== null ? outPoint : duration) - (inPoint !== null ? inPoint : 0)
                    )}
                  </p>
                </div>

                {/* 2. 出力モードの選択 */}
                <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>2. 出力モード</h4>
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
                      <input 
                        type="radio" 
                        name="exportType" 
                        value="normal" 
                        checked={exportType === 'normal'} 
                        onChange={() => setExportType('normal')} 
                      />
                      元動画と合成して出力 (通常のMP4)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
                      <input 
                        type="radio" 
                        name="exportType" 
                        value="transparent" 
                        checked={exportType === 'transparent'} 
                        onChange={() => setExportType('transparent')} 
                      />
                      得点板のみ出力 (透過MOV/他編集ソフト用)
                    </label>
                  </div>
                </div>

                {/* 3. 出力設定 */}
                <div style={{ marginBottom: '16px' }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>3. 出力解像度・エフェクト</h4>
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '8px' }}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '12px' }}>解像度</label>
                      <select 
                        value={exportResolution} 
                        onChange={(e) => setExportResolution(e.target.value)}
                        style={{ padding: '6px', background: '#202024', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }}
                      >
                        <option value="original">オリジナル解像度を維持</option>
                        <option value="1080p">1920x1080 (1080p)</option>
                        <option value="720p">1280x720 (720p)</option>
                        <option value="480p">854x480 (480p)</option>
                      </select>
                    </div>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', marginTop: '16px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
                        <input 
                          type="checkbox" 
                          checked={exportFade} 
                          onChange={(e) => setExportFade(e.target.checked)} 
                        />
                        得点変動時のフェード効果
                      </label>
                    </div>
                  </div>
                </div>

                {/* 4. タイトルカード設定 */}
                <div style={{ marginBottom: '24px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <h4 style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>4. 開始前の試合情報タイトル表示 (黒背景)</h4>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
                        <input 
                          type="checkbox" 
                          checked={exportTitle} 
                          onChange={(e) => setExportTitle(e.target.checked)} 
                        />
                        有効化
                      </label>
                    </div>

                    {exportTitle && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>大会/イベント名</label>
                        <input 
                          type="text" 
                          value={exportEventName} 
                          placeholder="〇〇大会・〇〇選手権など"
                          onChange={(e) => setExportEventName(e.target.value)}
                          style={{ padding: '6px', background: '#202024', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>対戦カード / 詳細</label>
                        <input 
                          type="text" 
                          value={exportMatchCard} 
                          placeholder="チームA VS チームB (第〇セット)"
                          onChange={(e) => setExportMatchCard(e.target.value)}
                          style={{ padding: '6px', background: '#202024', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>日時・場所 など</label>
                          <input 
                            type="text" 
                            value={exportDatePlace} 
                            placeholder="〇年〇月〇日 / 〇〇体育館など"
                            onChange={(e) => setExportDatePlace(e.target.value)}
                            style={{ padding: '6px', background: '#202024', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }}
                          />
                        </div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>表示時間 (秒)</label>
                          <input 
                            type="number" 
                            min={1} 
                            max={30}
                            value={exportTitleDuration} 
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '') setExportTitleDuration('');
                              else {
                                const num = parseInt(val);
                                if (!isNaN(num)) setExportTitleDuration(num);
                              }
                            }}
                            onBlur={() => {
                              if (exportTitleDuration === '' || exportTitleDuration < 1) {
                                setExportTitleDuration(5);
                              }
                            }}
                            style={{ padding: '6px', background: '#202024', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', textAlign: 'center' }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* ボタンアクション */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                  <button 
                    onClick={() => setIsExportModalOpen(false)}
                    style={{
                      padding: '8px 16px',
                      background: 'rgba(255,255,255,0.05)',
                      color: 'white',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                  >
                    キャンセル
                  </button>
                  <button 
                    onClick={handleExport}
                    style={{
                      padding: '8px 20px',
                      background: '#00e5ff',
                      color: '#08080a',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    エクスポート実行
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 試合設定モーダル */}
      {isMatchSettingsModalOpen && (
        <div 
          className="modal-backdrop"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999
          }}
          onClick={() => setIsMatchSettingsModalOpen(false)}
        >
          <div 
            className="settings-modal-window"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '500px',
              backgroundColor: 'var(--bg-panel)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '24px',
              color: 'var(--text-main)',
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
          >
            <h3 style={{ margin: 0, fontSize: '18px', color: '#00e5ff', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', fontWeight: 'bold' }}>
              ⚙️ 試合設定
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold' }}>チームA名</label>
                  <input 
                    type="text" 
                    value={scoreboardSettings.teamAName} 
                    onChange={(e) => handleSettingChange('teamAName', e.target.value)}
                    style={{ padding: '10px', background: 'var(--bg-input)', color: 'var(--text-main)', border: '1px solid var(--border-input)', borderRadius: '6px', fontSize: '14px', outline: 'none' }}
                  />
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold' }}>チームB名</label>
                  <input 
                    type="text" 
                    value={scoreboardSettings.teamBName} 
                    onChange={(e) => handleSettingChange('teamBName', e.target.value)}
                    style={{ padding: '10px', background: 'var(--bg-input)', color: 'var(--text-main)', border: '1px solid var(--border-input)', borderRadius: '6px', fontSize: '14px', outline: 'none' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold' }}>チームAカラー</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input 
                      type="color" 
                      value={scoreboardSettings.teamAColor || '#ffffff'} 
                      onChange={(e) => handleSettingChange('teamAColor', e.target.value)}
                      style={{ width: '40px', height: '36px', padding: 0, border: '1px solid var(--border-input)', borderRadius: '6px', cursor: 'pointer', background: 'none' }}
                    />
                    <span style={{ fontSize: '13px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                      {scoreboardSettings.teamAColor || '#ffffff'}
                    </span>
                  </div>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold' }}>チームBカラー</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input 
                      type="color" 
                      value={scoreboardSettings.teamBColor || '#ffffff'} 
                      onChange={(e) => handleSettingChange('teamBColor', e.target.value)}
                      style={{ width: '40px', height: '36px', padding: 0, border: '1px solid var(--border-input)', borderRadius: '6px', cursor: 'pointer', background: 'none' }}
                    />
                    <span style={{ fontSize: '13px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                      {scoreboardSettings.teamBColor || '#ffffff'}
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold' }}>最大セット数</label>
                  <select 
                    value={scoreboardSettings.maxSets} 
                    onChange={(e) => handleSettingChange('maxSets', parseInt(e.target.value))}
                    style={{ padding: '10px', background: 'var(--bg-input)', color: 'var(--text-main)', border: '1px solid var(--border-input)', borderRadius: '6px', fontSize: '14px', outline: 'none' }}
                  >
                    <option value={1}>1セットマッチ</option>
                    <option value={3}>3セットマッチ</option>
                    <option value={5}>5セットマッチ</option>
                  </select>
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold' }}>通常セット点数</label>
                  <input 
                    type="number" 
                    min={1}
                    value={inputNormalPoints} 
                    onChange={(e) => setInputNormalPoints(e.target.value)}
                    onBlur={() => {
                      const val = parseInt(inputNormalPoints);
                      if (!isNaN(val) && val >= 1) {
                        handleSettingChange('normalSetPoints', val);
                      } else {
                        setInputNormalPoints(String(scoreboardSettings.normalSetPoints));
                      }
                    }}
                    style={{ padding: '10px', background: 'var(--bg-input)', color: 'var(--text-main)', border: '1px solid var(--border-input)', borderRadius: '6px', fontSize: '14px', textAlign: 'center', outline: 'none' }}
                  />
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold' }}>最終セット点数</label>
                  <input 
                    type="number" 
                    min={1}
                    value={inputFinalPoints} 
                    onChange={(e) => setInputFinalPoints(e.target.value)}
                    onBlur={() => {
                      const val = parseInt(inputFinalPoints);
                      if (!isNaN(val) && val >= 1) {
                        handleSettingChange('finalSetPoints', val);
                      } else {
                        setInputFinalPoints(String(scoreboardSettings.finalSetPoints));
                      }
                    }}
                    style={{ padding: '10px', background: 'var(--bg-input)', color: 'var(--text-main)', border: '1px solid var(--border-input)', borderRadius: '6px', fontSize: '14px', textAlign: 'center', outline: 'none' }}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button 
                onClick={() => setIsMatchSettingsModalOpen(false)}
                style={{
                  padding: '10px 24px',
                  background: '#00e5ff',
                  color: '#08080a',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontSize: '14px',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#00bccc'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#00e5ff'}
              >
                適用して閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 表示設定モーダル */}
      {isDisplaySettingsModalOpen && (
        <div 
          className="modal-backdrop"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999
          }}
          onClick={() => setIsDisplaySettingsModalOpen(false)}
        >
          <div 
            className="settings-modal-window"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '500px',
              backgroundColor: 'var(--bg-panel)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '24px',
              color: 'var(--text-main)',
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
          >
            <h3 style={{ margin: 0, fontSize: '18px', color: '#00e5ff', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', fontWeight: 'bold' }}>
              🎨 表示設定
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold' }}>得点板サイズ (%)</label>
                  <input 
                    type="number" 
                    min={10}
                    max={300}
                    value={inputOverlaySize} 
                    onChange={(e) => setInputOverlaySize(e.target.value)}
                    onBlur={() => {
                      const val = parseInt(inputOverlaySize);
                      if (!isNaN(val) && val >= 10 && val <= 300) {
                        handleSettingChange('overlaySize', val);
                      } else {
                        setInputOverlaySize(String(scoreboardSettings.overlaySize));
                      }
                    }}
                    style={{ height: '38px', boxSizing: 'border-box', padding: '0 10px', background: 'var(--bg-input)', color: 'var(--text-main)', border: '1px solid var(--border-input)', borderRadius: '6px', fontSize: '14px', textAlign: 'center', outline: 'none' }}
                  />
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold' }}>得点板位置</label>
                  <select 
                    value={scoreboardSettings.overlayPosition} 
                    onChange={(e) => handleSettingChange('overlayPosition', e.target.value as any)}
                    style={{ height: '38px', boxSizing: 'border-box', padding: '0 10px', background: 'var(--bg-input)', color: 'var(--text-main)', border: '1px solid var(--border-input)', borderRadius: '6px', fontSize: '14px', outline: 'none' }}
                  >
                    <option value="top-left">左上</option>
                    <option value="top-right">右上</option>
                    <option value="bottom-left">左下</option>
                    <option value="bottom-right">右下</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold' }}>得点板デザイン</label>
                  <select 
                    value={scoreboardSettings.theme} 
                    onChange={(e) => handleSettingChange('theme', e.target.value)}
                    style={{ height: '38px', boxSizing: 'border-box', padding: '0 10px', background: 'var(--bg-input)', color: 'var(--text-main)', border: '1px solid var(--border-input)', borderRadius: '6px', fontSize: '14px', outline: 'none' }}
                  >
                    <option value="modern-dark">グラスモーフィズム</option>
                    <option value="minimal">ミニマル・フラット</option>
                    <option value="retro-digital">レトロ・デジタル</option>
                    <option value="broadcast-bar">テレビ中継風バー</option>
                  </select>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold' }}>全体のテーマ</label>
                  <select 
                    value={scoreboardSettings.workspaceTheme || 'dark'} 
                    onChange={(e) => handleSettingChange('workspaceTheme', e.target.value as any)}
                    style={{ height: '38px', boxSizing: 'border-box', padding: '0 10px', background: 'var(--bg-input)', color: 'var(--text-main)', border: '1px solid var(--border-input)', borderRadius: '6px', fontSize: '14px', outline: 'none' }}
                  >
                    <option value="dark">モダン・ダーク</option>
                    <option value="light">クリーン・ライト</option>
                    <option value="amoled">ミッドナイト・ブラック</option>
                  </select>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button 
                onClick={() => setIsDisplaySettingsModalOpen(false)}
                style={{
                  padding: '10px 24px',
                  background: '#00e5ff',
                  color: '#08080a',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontSize: '14px',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#00bccc'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#00e5ff'}
              >
                適用して閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 音声形式変換の確認モーダル */}
      {showConvertConfirm && (
        <div 
          className="modal-backdrop"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99998
          }}
        >
          <div 
            className="settings-modal-window"
            style={{
              backgroundColor: '#16161a',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              padding: '24px',
              width: '460px',
              maxWidth: '90%',
              color: 'white',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
          >
            <h3 style={{ margin: 0, color: '#00e5ff', display: 'flex', alignItems: 'center', gap: '8px' }}>
              🎵 音声形式の互換性変換
            </h3>
            <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.6', color: '#e2e2e7' }}>
              この動画は音声がMP3形式であるため、音が出ない可能性があります。
              <br /><br />
              再生可能な標準の音声形式（AAC）に変換した動画ファイルを新しく作成して、それを読み込みますか？
              （変換は数秒で完了し、元の動画ファイルはそのまま残ります）
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
              <button 
                onClick={() => convertResolverRef.current?.('skip')}
                style={{
                  padding: '10px 16px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: 'white',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontSize: '13px'
                }}
              >
                変換せずに開く
              </button>
              <button 
                onClick={() => convertResolverRef.current?.('convert')}
                style={{
                  padding: '10px 20px',
                  background: '#00e5ff',
                  color: '#08080a',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontSize: '13px'
                }}
              >
                変換して開く (推奨)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 音声変換ローディングオーバーレイ */}
      {isRepairing && (
        <div 
          className="modal-backdrop"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            color: 'white',
            gap: '16px'
          }}
        >
          <div className="spinner" style={{
            width: '48px',
            height: '48px',
            border: '4px solid rgba(255, 255, 255, 0.1)',
            borderTop: '4px solid #00e5ff',
            borderRadius: '50%',
            animation: 'spin-loading 1s linear infinite'
          }}></div>
          <style>{`
            @keyframes spin-loading {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
          <div style={{ fontSize: '16px', fontWeight: 'bold', letterSpacing: '0.5px' }}>{repairStatusText}</div>
        </div>
      )}
    </div>
  </div>

  )
}

export default App
