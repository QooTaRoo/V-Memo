import { ScoreEvent, MatchSettings, getActiveEventState } from './scoreEngine'

export interface VideoMetadata {
  width: number
  height: number
  fps: number
  duration: number
  has_audio: boolean
}

/**
 * 渡されたスコアイベントの配列を解析し、得点板が表示されている区間のリスト（インターバル）を生成します。
 */
interface ScoreInterval {
  start: number // イン点からの相対秒数
  end: number
  scoreA: number
  scoreB: number
  setsA: number
  setsB: number
  servingTeam: 'A' | 'B' | null
  pastSetScoresText: string
}

function getScoreIntervals(
  events: ScoreEvent[],
  inPoint: number,
  outPoint: number
): ScoreInterval[] {
  const intervals: ScoreInterval[] = []
  
  // 1秒ごとにサンプリングして状態変化を検出し、インターバルにまとめます
  // (ミリ秒単位の微細な変化よりもタイムライン管理をしやすくするため)
  let currentInterval: ScoreInterval | null = null
  const fps = 30
  const totalFrames = Math.ceil((outPoint - inPoint) * fps)

  for (let i = 0; i < totalFrames; i++) {
    const relativeTime = i / fps
    const absoluteTime = inPoint + relativeTime
    const state = getActiveEventState(events, absoluteTime)
    
    // 得点板非表示の場合はインターバルを作らない/終了する
    if (!state.overlayVisible) {
      if (currentInterval) {
        currentInterval.end = relativeTime
        intervals.push(currentInterval)
        currentInterval = null
      }
      continue
    }

    // 過去のセットスコアテキストを作成
    const pastText = state.setScores
      .map((s) => `${s.scoreA}-${s.scoreB}`)
      .join(', ')

    // 状態が一致するかチェック
    const match = currentInterval &&
      currentInterval.scoreA === state.scoreA &&
      currentInterval.scoreB === state.scoreB &&
      currentInterval.setsA === state.setsA &&
      currentInterval.setsB === state.setsB &&
      currentInterval.servingTeam === state.servingTeam &&
      currentInterval.pastSetScoresText === pastText

    if (!match) {
      if (currentInterval) {
        currentInterval.end = relativeTime
        intervals.push(currentInterval)
      }
      currentInterval = {
        start: relativeTime,
        end: relativeTime,
        scoreA: state.scoreA,
        scoreB: state.scoreB,
        setsA: state.setsA,
        setsB: state.setsB,
        servingTeam: state.servingTeam,
        pastSetScoresText: pastText
      }
    }
  }

  if (currentInterval) {
    currentInterval.end = outPoint - inPoint
    intervals.push(currentInterval)
  }

  return intervals
}

/**
 * DaVinci Resolveに適合する FCPXML (v1.9) ファイル文字列を生成します。
 */
export function generateFcpXml(
  metadata: VideoMetadata,
  events: ScoreEvent[],
  settings: MatchSettings,
  inPoint: number,
  outPoint: number,
  bgAbsolutePath: string,
  originalVideoAbsolutePath: string | null
): string {
  const width = metadata.width || 1920
  const height = metadata.height || 1080
  const fps = metadata.fps || 29.97
  const duration = outPoint - inPoint

  // フレームレートに応じた FCPXML の frameDuration と name 定義
  let frameDuration = '1001/30000'
  let formatName = 'FFVideoFormat1080p2997'
  
  if (Math.abs(fps - 60.0) < 0.5) {
    frameDuration = '1/60'
    formatName = 'FFVideoFormat1080p60'
  } else if (Math.abs(fps - 59.94) < 0.5) {
    frameDuration = '1001/60000'
    formatName = 'FFVideoFormat1080p5994'
  } else if (Math.abs(fps - 30.0) < 0.5) {
    frameDuration = '1/30'
    formatName = 'FFVideoFormat1080p30'
  } else if (Math.abs(fps - 24.0) < 0.5) {
    frameDuration = '1/24'
    formatName = 'FFVideoFormat1080p24'
  } else if (Math.abs(fps - 23.976) < 0.5) {
    frameDuration = '1001/24000'
    formatName = 'FFVideoFormat1080p2398'
  }

  const bgFilename = bgAbsolutePath.split(/[/\\]/).pop() || 'scoreboard_bg.png'
  
  // XMLエスケープ関数
  const escapeXml = (str: string) =>
    str.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;'
        case '>': return '&gt;'
        case '&': return '&amp;'
        case '\'': return '&apos;'
        case '"': return '&quot;'
        default: return c
      }
    })

  // インターバルの取得
  const intervals = getScoreIntervals(events, inPoint, outPoint)

  // FCPXML の resources 部分
  let resources = `    <resources>
        <format id="r1" name="${formatName}" frameDuration="${frameDuration}" width="${width}" height="${height}"/>
        <effect id="r2" name="Basic Title" uid=".../Titles.localized/Bumper:Preview/Basic Title/Basic Title.moti"/>
        <asset id="r3" name="${escapeXml(bgFilename)}" src="file://localhost${escapeXml(bgAbsolutePath)}" start="0s" duration="${duration}s" hasVideo="1"/>`

  if (originalVideoAbsolutePath) {
    const videoFilename = originalVideoAbsolutePath.split(/[/\\]/).pop() || 'match_video.mp4'
    resources += `\n        <asset id="r4" name="${escapeXml(videoFilename)}" src="file://localhost${escapeXml(originalVideoAbsolutePath)}" start="0s" duration="${metadata.duration}s" hasVideo="1" hasAudio="${metadata.has_audio ? 1 : 0}"/>`
  }
  resources += `\n    </resources>`

  // タイトルクリップ（テキストレイヤー）の生成
  const generateTitleClip = (
    name: string,
    text: string,
    lane: number,
    offset: number,
    duration: number,
    fontSize: number,
    color: string,
    alignment: 'left' | 'right' | 'center'
  ) => {
    const offsetStr = `${offset.toFixed(3)}s`
    const durationStr = `${duration.toFixed(3)}s`
    const textStyleId = `ts_${name.toLowerCase().replace(/\s+/g, '_')}_${offset.toFixed(1).replace('.', '_')}`

    return `                        <title ref="r2" name="${escapeXml(name)}" lane="${lane}" offset="${offsetStr}" start="0s" duration="${durationStr}">
                            <text>
                                <text-style ref="${textStyleId}">${escapeXml(text)}</text-style>
                            </text>
                            <text-style-def id="${textStyleId}">
                                <style-template font="Hiragino Kaku Gothic ProN" size="${fontSize}" color="${color}" alignment="${alignment}"/>
                            </text-style-def>
                        </title>`
  }

  // タイムラインを構成するクリップ要素
  let spineClips = ''
  
  if (originalVideoAbsolutePath) {
    // 1. 元動画がアタッチされている場合：元動画をプライマリスパインに置き、その上のレーンに背景画像やテキストをオーバーレイ配置する
    let overlays = ''
    
    intervals.forEach((interval) => {
      const startOffset = interval.start
      const clipDuration = interval.end - interval.start
      if (clipDuration <= 0) return

      // 背景画像クリップをレーン1に配置
      overlays += `\n                        <video name="Scoreboard Background" lane="1" offset="${startOffset.toFixed(3)}s" ref="r3" start="0s" duration="${clipDuration.toFixed(3)}s">`

      // チーム名と得点・セット数をテキストレイヤーとして接続
      const teamANameText = settings.teamAName || 'TEAM A'
      const teamBNameText = settings.teamBName || 'TEAM B'
      
      overlays += `\n` + generateTitleClip('Team A Name', teamANameText, 2, 0, clipDuration, 36, '1 1 1 1', 'left')
      overlays += `\n` + generateTitleClip('Team B Name', teamBNameText, 3, 0, clipDuration, 36, '1 1 1 1', 'left')
      overlays += `\n` + generateTitleClip('Score A', interval.scoreA.toString(), 4, 0, clipDuration, 60, '0 0.9 1 1', 'right')
      overlays += `\n` + generateTitleClip('Score B', interval.scoreB.toString(), 5, 0, clipDuration, 60, '0 0.9 1 1', 'right')
      overlays += `\n` + generateTitleClip('Sets A', interval.setsA.toString(), 6, 0, clipDuration, 32, '1 1 1 1', 'center')
      overlays += `\n` + generateTitleClip('Sets B', interval.setsB.toString(), 7, 0, clipDuration, 32, '1 1 1 1', 'center')
      
      if (interval.pastSetScoresText) {
        overlays += `\n` + generateTitleClip('Past Set Scores', interval.pastSetScoresText, 8, 0, clipDuration, 24, '0.7 0.7 0.7 1', 'left')
      }

      overlays += `\n                        </video>`
    });

    spineClips = `                    <video name="Match Video" offset="0s" ref="r4" start="${inPoint.toFixed(3)}s" duration="${duration.toFixed(3)}s" role="video">${overlays}
                    </video>`
  } else {
    // 2. 元動画パスが無い場合：Gapクリップをプライマリスパインに置き、その上にオーバーレイを配置する
    let overlays = ''

    intervals.forEach((interval) => {
      const startOffset = interval.start
      const clipDuration = interval.end - interval.start
      if (clipDuration <= 0) return

      overlays += `\n                        <video name="Scoreboard Background" lane="1" offset="${startOffset.toFixed(3)}s" ref="r3" start="0s" duration="${clipDuration.toFixed(3)}s">`

      const teamANameText = settings.teamAName || 'TEAM A'
      const teamBNameText = settings.teamBName || 'TEAM B'

      overlays += `\n` + generateTitleClip('Team A Name', teamANameText, 2, 0, clipDuration, 36, '1 1 1 1', 'left')
      overlays += `\n` + generateTitleClip('Team B Name', teamBNameText, 3, 0, clipDuration, 36, '1 1 1 1', 'left')
      overlays += `\n` + generateTitleClip('Score A', interval.scoreA.toString(), 4, 0, clipDuration, 60, '0 0.9 1 1', 'right')
      overlays += `\n` + generateTitleClip('Score B', interval.scoreB.toString(), 5, 0, clipDuration, 60, '0 0.9 1 1', 'right')
      overlays += `\n` + generateTitleClip('Sets A', interval.setsA.toString(), 6, 0, clipDuration, 32, '1 1 1 1', 'center')
      overlays += `\n` + generateTitleClip('Sets B', interval.setsB.toString(), 7, 0, clipDuration, 32, '1 1 1 1', 'center')

      if (interval.pastSetScoresText) {
        overlays += `\n` + generateTitleClip('Past Set Scores', interval.pastSetScoresText, 8, 0, clipDuration, 24, '0.7 0.7 0.7 1', 'left')
      }

      overlays += `\n                        </video>`
    });

    spineClips = `                    <gap name="Timeline Gap" offset="0s" start="0s" duration="${duration.toFixed(3)}s">${overlays}
                    </gap>`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
${resources}
    <library>
        <event name="V-Memo Export">
            <project name="V-Memo Scoreboard Timeline">
                <sequence duration="${duration.toFixed(3)}s" format="r1" tcStart="0s" tcFormat="NDF">
                    <spine>
${spineClips}
                    </spine>
                </sequence>
            </project>
        </event>
    </library>
</fcpxml>
`
}
