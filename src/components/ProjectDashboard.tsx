import React, { useState, useEffect } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { ProjectData, INITIAL_STATE, recalculateEventStates } from '../utils/scoreEngine'
import './ProjectDashboard.css'

interface RecentProject {
  name: string;
  path: string;
  lastOpened: number;
  videoPath?: string | null;
}

interface ProjectDashboardProps {
  onProjectLoaded: (projectData: ProjectData, jsonPath: string) => void;
}

export const ProjectDashboard: React.FC<ProjectDashboardProps> = ({ onProjectLoaded }) => {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [activeTab, setActiveTab] = useState<'recents' | 'new-project'>('recents')
  
  // 新規プロジェクトフォームの状態
  const [teamAName, setTeamAName] = useState('大宮東')
  const [teamBName, setTeamBName] = useState('伊奈学園')
  const [maxSets, setMaxSets] = useState<number>(3)
  const [normalPoints, setNormalPoints] = useState<number>(25)
  const [finalPoints, setFinalPoints] = useState<number>(25)
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null)
  const [selectedVideoName, setSelectedVideoName] = useState<string>('')

  // 起動時にローカルストレージから最近使用したプロジェクトをロード
  useEffect(() => {
    loadRecentProjects()
  }, [])

  const loadRecentProjects = () => {
    try {
      const stored = localStorage.getItem('vmemo_recent_projects')
      if (stored) {
        const parsed = JSON.parse(stored) as RecentProject[]
        // 開いた日時順（降順）にソート
        parsed.sort((a, b) => b.lastOpened - a.lastOpened)
        setRecentProjects(parsed)
      }
    } catch (e) {
      console.error('Failed to load recent projects from localStorage:', e)
    }
  }

  // 履歴の更新
  const updateRecentProjectInStorage = (path: string, videoPath: string | null = null) => {
    try {
      const stored = localStorage.getItem('vmemo_recent_projects')
      let list: RecentProject[] = stored ? JSON.parse(stored) : []
      
      const fileName = path.split(/[/\\]/).pop() || 'Unset'
      const existingIdx = list.findIndex(p => p.path === path)
      
      const updatedProject: RecentProject = {
        name: fileName,
        path: path,
        lastOpened: Date.now(),
        videoPath: videoPath
      }

      if (existingIdx > -1) {
        // すでに存在する場合は更新
        list[existingIdx] = updatedProject
      } else {
        // 新規追加
        list.push(updatedProject)
      }

      localStorage.setItem('vmemo_recent_projects', JSON.stringify(list))
      loadRecentProjects()
    } catch (e) {
      console.error('Failed to update recent projects:', e)
    }
  }

  // 履歴からの削除
  const handleRemoveRecent = (e: React.MouseEvent, pathToRemove: string) => {
    e.stopPropagation() // 親カードのクリック発火を防ぐ
    try {
      const updated = recentProjects.filter(p => p.path !== pathToRemove)
      localStorage.setItem('vmemo_recent_projects', JSON.stringify(updated))
      setRecentProjects(updated)
    } catch (e) {
      console.error('Failed to remove project from recents:', e)
    }
  }

  // 動画選択
  const handleSelectVideo = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Videos',
          extensions: ['mp4', 'mov', 'webm', 'm4v']
        }]
      })
      if (selected && typeof selected === 'string') {
        setSelectedVideo(selected)
        setSelectedVideoName(selected.split(/[/\\]/).pop() || '')
      }
    } catch (err: any) {
      alert('動画の選択に失敗しました: ' + err.message)
    }
  }

  // 既存のJSONプロジェクトファイルを開く
  const handleOpenExisting = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Project JSON',
          extensions: ['json']
        }]
      })

      if (selected && typeof selected === 'string') {
        await loadProjectFile(selected)
      }
    } catch (err: any) {
      alert('プロジェクトの読み込みに失敗しました: ' + err.message)
    }
  }

  // 指定のJSONファイルをロードして親コンポーネントに伝える
  const loadProjectFile = async (path: string) => {
    try {
      const content = await invoke<string>('load_project_json', { path })
      const data = JSON.parse(content) as ProjectData
      
      // イベント状態の再計算
      data.events = recalculateEventStates(data.events, data.matchSettings)
      
      // 履歴ストレージを更新
      updateRecentProjectInStorage(path, data.videoPath)
      
      // 親コンポーネントにコールバック
      onProjectLoaded(data, path)
    } catch (err: any) {
      console.error('Failed to load project file:', err)
      alert(`プロジェクトのロードに失敗しました。\nファイルが存在しないか、壊れている可能性があります。\nエラー: ${err.message}`)
    }
  }

  // 新規プロジェクト作成
  const handleCreateNew = async () => {
    if (!teamAName.trim() || !teamBName.trim()) {
      alert('チーム名を入力してください。')
      return
    }

    try {
      // 1. プロジェクトファイルの保存先を決定
      const selectedPath = await save({
        filters: [{
          name: 'Project JSON',
          extensions: ['json']
        }],
        defaultPath: 'match_project.json'
      })

      if (!selectedPath) return // キャンセル

      // 2. 初期プロジェクトデータの作成
      const defaultSettings = {
        teamAName: teamAName.trim(),
        teamBName: teamBName.trim(),
        maxSets,
        normalSetPoints: normalPoints,
        finalSetPoints: finalPoints,
        theme: 'modern-dark',
        overlaySize: 100,
        overlayPosition: 'top-left' as const
      }

      const newProjectData: ProjectData = {
        matchSettings: defaultSettings,
        events: [
          {
            id: 'init_serve',
            timestamp: 0,
            type: 'serve_change',
            team: 'A',
            state: INITIAL_STATE
          }
        ],
        videoPath: selectedVideo
      }

      newProjectData.events = recalculateEventStates(newProjectData.events, defaultSettings)

      // 3. ファイルの保存
      await invoke('save_project_json', {
        path: selectedPath,
        content: JSON.stringify(newProjectData, null, 2)
      })

      // 4. 履歴に追加し、親コンポーネントにロード完了を伝える
      updateRecentProjectInStorage(selectedPath, selectedVideo)
      onProjectLoaded(newProjectData, selectedPath)
    } catch (err: any) {
      console.error('Failed to create new project:', err)
      alert('プロジェクトの新規作成に失敗しました: ' + err.message)
    }
  }

  const formatTimestamp = (ts: number): string => {
    const d = new Date(ts)
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div className="project-dashboard">
      <div className="dashboard-window">
        {/* ヘッダーエリア */}
        <header className="dashboard-header">
          <div className="brand-logo">
            <span className="logo-emoji">🏐</span>
            <div className="brand-texts">
              <h1>V-Memo Score Editor</h1>
              <p>Volleyball Scoreboard Overlay & Annotation System</p>
            </div>
          </div>
          <button className="btn-open-file" onClick={handleOpenExisting}>
            📁 既存プロジェクトを開く...
          </button>
        </header>

        {/* メインレイアウト */}
        <div className="dashboard-body">
          {/* 左側: タブ選択 */}
          <aside className="dashboard-sidebar">
            <button 
              className={`sidebar-tab ${activeTab === 'recents' ? 'active' : ''}`}
              onClick={() => setActiveTab('recents')}
            >
              🕒 最近使用したプロジェクト
            </button>
            <button 
              className={`sidebar-tab ${activeTab === 'new-project' ? 'active' : ''}`}
              onClick={() => setActiveTab('new-project')}
            >
              ➕ 新規プロジェクト作成
            </button>
          </aside>

          {/* 右側: コンテンツエリア */}
          <main className="dashboard-content">
            {activeTab === 'recents' && (
              <div className="recents-tab">
                <h2>最近のプロジェクト</h2>
                {recentProjects.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">📁</div>
                    <p>最近使用したプロジェクトはありません。</p>
                    <p className="empty-sub">「新規プロジェクト作成」タブからプロジェクトを始めるか、「既存プロジェクトを開く」をクリックしてください。</p>
                  </div>
                ) : (
                  <div className="recent-projects-grid">
                    {recentProjects.map((proj) => (
                      <div 
                        key={proj.path} 
                        className="project-card"
                        onClick={() => loadProjectFile(proj.path)}
                      >
                        <div className="card-top">
                          <div className="project-icon">📄</div>
                          <div className="project-info">
                            <div className="project-name" title={proj.name}>{proj.name}</div>
                            <div className="project-path" title={proj.path}>{proj.path}</div>
                          </div>
                        </div>
                        <div className="card-details">
                          {proj.videoPath && (
                            <div className="associated-video" title={proj.videoPath}>
                              🎬 {proj.videoPath.split(/[/\\]/).pop()}
                            </div>
                          )}
                          <div className="last-opened">
                            開いた日時: {formatTimestamp(proj.lastOpened)}
                          </div>
                        </div>
                        <button 
                          className="btn-delete-recent" 
                          onClick={(e) => handleRemoveRecent(e, proj.path)}
                          title="履歴から削除 (ファイルは削除されません)"
                        >
                          🗑️
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'new-project' && (
              <div className="new-project-tab">
                <h2>新規プロジェクト作成</h2>
                <div className="new-project-form">
                  <div className="form-row">
                    <div className="form-group">
                      <label>チームA名</label>
                      <input 
                        type="text" 
                        value={teamAName} 
                        onChange={(e) => setTeamAName(e.target.value)} 
                        placeholder="例: 大宮東"
                      />
                    </div>
                    <div className="form-group">
                      <label>チームB名</label>
                      <input 
                        type="text" 
                        value={teamBName} 
                        onChange={(e) => setTeamBName(e.target.value)} 
                        placeholder="例: 伊奈学園"
                      />
                    </div>
                  </div>

                  <div className="form-row flex-three">
                    <div className="form-group">
                      <label>最大セット数</label>
                      <select 
                        value={maxSets} 
                        onChange={(e) => setMaxSets(Number(e.target.value))}
                      >
                        <option value={1}>1セットマッチ</option>
                        <option value={3}>3セットマッチ</option>
                        <option value={5}>5セットマッチ</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label>通常セット点数</label>
                      <input 
                        type="number" 
                        min={1} 
                        value={normalPoints} 
                        onChange={(e) => setNormalPoints(Number(e.target.value))}
                      />
                    </div>

                    <div className="form-group">
                      <label>最終セット点数</label>
                      <input 
                        type="number" 
                        min={1} 
                        value={finalPoints} 
                        onChange={(e) => setFinalPoints(Number(e.target.value))}
                      />
                    </div>
                  </div>

                  <div className="form-group video-selector-group">
                    <label>動画ファイル (任意)</label>
                    <div className="video-picker-row">
                      <button className="btn-pick-video" onClick={handleSelectVideo}>
                        🎬 動画ファイルを選択...
                      </button>
                      {selectedVideo ? (
                        <div className="video-path-preview" title={selectedVideo}>
                          {selectedVideoName}
                        </div>
                      ) : (
                        <div className="video-path-preview empty">未選択 (後から読み込むことも可能です)</div>
                      )}
                    </div>
                  </div>

                  <div className="form-actions">
                    <button className="btn-submit-create" onClick={handleCreateNew}>
                      🚀 プロジェクトを作成して保存...
                    </button>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
