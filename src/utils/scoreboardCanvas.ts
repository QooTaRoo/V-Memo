import { EventState, MatchSettings } from './scoreEngine'

// 角丸の四角形を描画するヘルパー
function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  ctx.lineTo(x + radius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

/**
 * 得点板を Canvas 上に忠実に描画します。
 * （ctx.scaleを使用するとフォントがぼやけるバグを回避するため、サイズや座標に直接scaleを適用して描画します）
 * @param ctx 描画対象の CanvasRenderingContext2D
 * @param canvasWidth キャンバスの総幅（動画の横解像度）
 * @param canvasHeight キャンバスの総高さ（動画の縦解像度）
 * @param state 現在のスコアボード状態
 * @param settings 試合の設定
 * @param time 再生時間（秒、バレーボールアニメーション用）
 * @param isColorkeyActive クロマキー（グリーンバック）合成が有効かどうか
 */
export function drawScoreboardToCanvas(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  state: EventState,
  settings: MatchSettings,
  time: number,
  isColorkeyActive: boolean = false,
  swapTeams: boolean = false
) {
  const { teamAName, teamBName, overlaySize, overlayPosition } = settings
  const { scoreA, scoreB, setsA, setsB, servingTeam, setScores } = state

  // 動画の縦解像度に応じたベーススケール補正（720p基準に対する比率）
  const baseResolutionHeight = 720
  const resolutionScale = canvasHeight / baseResolutionHeight

  // 総合的な出力スケール
  const destScale = (overlaySize / 200) * resolutionScale

  // 基準座標系でのサイズ定義 (下部余白を調整し、上下対称の美しいバランスに改善)
  const baseWidth = 290
  const hasPastScores = setScores.length > 0
  const baseHeight = hasPastScores ? 158 : 120
  const margin = 15 * resolutionScale // マージンは解像度に合わせる

  // 出力先サイズ
  const destWidth = baseWidth * destScale
  const destHeight = baseHeight * destScale

  // 配置座標の決定
  let destX = margin
  let destY = margin

  switch (overlayPosition) {
    case 'top-left':
      destX = margin
      destY = margin
      break
    case 'top-right':
      destX = canvasWidth - destWidth - margin
      destY = margin
      break
    case 'bottom-left':
      destX = margin
      destY = canvasHeight - destHeight - margin
      break
    case 'bottom-right':
      destX = canvasWidth - destWidth - margin
      destY = canvasHeight - destHeight - margin
      break
  }

  // ----------------------------------------------------
  // 【超高画質化】スーパサンプリング・アンチエイリアシング (SSAA) 処理
  // 2倍解像度のオフスクリーンCanvasに一旦綺麗に描画し、それを縮小貼り付けすることで、
  // 小さい文字の潰れやジャギーを完全に解消します。
  // ----------------------------------------------------
  const oversample = 2
  const padding = 30 // シャドウの回り込み用の余白（ベース座標系）
  
  const offCanvas = document.createElement('canvas')
  offCanvas.width = (baseWidth + padding * 2) * oversample
  offCanvas.height = (baseHeight + padding * 2) * oversample

  const offCtx = offCanvas.getContext('2d', { alpha: true })
  if (!offCtx) {
    // 万が一コンテキストの作成に失敗した場合は、呼び出し元の ctx に直接等倍描画する（フォールバック）
    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    
    // 直接描画時のパラメータ
    const fbScale = destScale
    const fbStartX = destX
    const fbStartY = destY
    const fbBoardWidth = baseWidth * fbScale
    const fbBoardHeight = baseHeight * fbScale
    
    // 背景枠
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
    ctx.shadowBlur = 40 * fbScale
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 12 * fbScale
    drawRoundRect(ctx, fbStartX, fbStartY, fbBoardWidth, fbBoardHeight, 12 * fbScale)
    ctx.fillStyle = isColorkeyActive ? 'rgba(16, 16, 20, 1.0)' : 'rgba(10, 10, 12, 0.75)'
    ctx.fill()
    ctx.restore()

    // ボーダー
    ctx.save()
    drawRoundRect(ctx, fbStartX, fbStartY, fbBoardWidth, fbBoardHeight, 12 * fbScale)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
    ctx.lineWidth = 1 * fbScale
    ctx.stroke()
    ctx.restore()

    const fbRowHeight = 42 * fbScale
    const fbTeamAreaY = fbStartY + 14 * fbScale
    const fbTotalSetDots = Math.ceil(settings.maxSets / 2)

    // チーム行の描画（swapTeams に応じて上下順を入れ替え）
    const firstTeamName = swapTeams ? (teamBName || 'TEAM B') : (teamAName || 'TEAM A')
    const firstScore = swapTeams ? scoreB : scoreA
    const firstSets = swapTeams ? setsB : setsA
    const firstServing = swapTeams ? (servingTeam === 'B') : (servingTeam === 'A')
    const secondTeamName = swapTeams ? (teamAName || 'TEAM A') : (teamBName || 'TEAM B')
    const secondScore = swapTeams ? scoreA : scoreB
    const secondSets = swapTeams ? setsA : setsB
    const secondServing = swapTeams ? (servingTeam === 'A') : (servingTeam === 'B')

    drawTeamRow(ctx, fbTeamAreaY, firstTeamName, firstScore, firstSets, fbTotalSetDots, firstServing, fbStartX, fbBoardWidth, time, fbScale)
    drawTeamRow(ctx, fbTeamAreaY + fbRowHeight + 8 * fbScale, secondTeamName, secondScore, secondSets, fbTotalSetDots, secondServing, fbStartX, fbBoardWidth, time, fbScale)

    if (hasPastScores) {
      const fbPastY = fbStartY + 112 * fbScale
      ctx.beginPath()
      ctx.moveTo(fbStartX + 18 * fbScale, fbPastY)
      ctx.lineTo(fbStartX + fbBoardWidth - 18 * fbScale, fbPastY)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
      ctx.lineWidth = 1 * fbScale
      ctx.stroke()

      ctx.save()
      ctx.textBaseline = 'middle'
      let currentX = fbStartX + 18 * fbScale
      setScores.forEach((set, idx) => {
        ctx.font = `700 ${Math.round(15 * fbScale)}px "SF Pro", "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", sans-serif`
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
        const label = `S${idx + 1}`
        ctx.fillText(label, currentX, fbPastY + 23 * fbScale)
        currentX += ctx.measureText(label).width + 4 * fbScale

        ctx.font = `500 ${Math.round(16 * fbScale)}px "SF Pro", "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", sans-serif`
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
        const val = `${set.scoreA} - ${set.scoreB}`
        ctx.fillText(val, currentX, fbPastY + 23 * fbScale)
        currentX += ctx.measureText(val).width + 16 * fbScale
      })
      ctx.restore()
    }
    ctx.restore()
    return
  }

  // ----------------------------------------------------
  // SSAA Canvas への超高解像度描画
  // ----------------------------------------------------
  const scale = oversample
  const startX = padding * scale
  const startY = padding * scale
  const boardWidth = baseWidth * scale
  const boardHeight = baseHeight * scale

  offCtx.save()
  offCtx.imageSmoothingEnabled = true
  offCtx.imageSmoothingQuality = 'high'

  // 1. すりガラス背景の枠 (scoreboard-glass)
  offCtx.save()
  // シャドウ設定（2倍解像度の空間で滑らかにレンダリング）
  offCtx.shadowColor = 'rgba(0, 0, 0, 0.5)'
  offCtx.shadowBlur = 40 * scale
  offCtx.shadowOffsetX = 0
  offCtx.shadowOffsetY = 12 * scale

  // 外枠角丸の塗りつぶし
  drawRoundRect(offCtx, startX, startY, boardWidth, boardHeight, 12 * scale)
  offCtx.fillStyle = isColorkeyActive ? 'rgba(16, 16, 20, 1.0)' : 'rgba(10, 10, 12, 0.75)'
  offCtx.fill()
  offCtx.restore() // シャドウをリセット

  // 細いボーダーライン
  offCtx.save()
  drawRoundRect(offCtx, startX, startY, boardWidth, boardHeight, 12 * scale)
  offCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
  offCtx.lineWidth = 1 * scale
  offCtx.stroke()
  offCtx.restore()

  const rowHeight = 42 * scale
  const teamAreaY = startY + 14 * scale
  const totalSetDots = Math.ceil(settings.maxSets / 2)

  // --- チーム行の描画（swapTeams に応じて上下順を入れ替え）---
  const firstTeamName = swapTeams ? (teamBName || 'TEAM B') : (teamAName || 'TEAM A')
  const firstScore = swapTeams ? scoreB : scoreA
  const firstSets = swapTeams ? setsB : setsA
  const firstServing = swapTeams ? (servingTeam === 'B') : (servingTeam === 'A')
  const secondTeamName = swapTeams ? (teamAName || 'TEAM A') : (teamBName || 'TEAM B')
  const secondScore = swapTeams ? scoreA : scoreB
  const secondSets = swapTeams ? setsA : setsB
  const secondServing = swapTeams ? (servingTeam === 'A') : (servingTeam === 'B')

  drawTeamRow(offCtx, teamAreaY, firstTeamName, firstScore, firstSets, totalSetDots, firstServing, startX, boardWidth, time, scale)
  drawTeamRow(offCtx, teamAreaY + rowHeight + 8 * scale, secondTeamName, secondScore, secondSets, totalSetDots, secondServing, startX, boardWidth, time, scale)

  // 3. 過去セットのスコア履歴 (past-set-scores)
  if (hasPastScores) {
    const pastY = startY + 112 * scale
    // 分割線
    offCtx.beginPath()
    offCtx.moveTo(startX + 18 * scale, pastY)
    offCtx.lineTo(startX + boardWidth - 18 * scale, pastY)
    offCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
    offCtx.lineWidth = 1 * scale
    offCtx.stroke()

    // セットスコアの一覧描画
    offCtx.save()
    offCtx.textBaseline = 'middle'
    let currentX = startX + 18 * scale
    
    setScores.forEach((set, idx) => {
      // ラベル "S1" など
      offCtx.font = `700 ${Math.round(15 * scale)}px "SF Pro", "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", sans-serif`
      offCtx.fillStyle = 'rgba(255, 255, 255, 0.3)'
      const label = `S${idx + 1}`
      offCtx.fillText(label, currentX, pastY + 23 * scale)
      currentX += offCtx.measureText(label).width + 4 * scale

      // 値 "25 - 22" など (ウェイトを 500 に下げ、サイズを少し大きく 16px にしてシャープにする)
      offCtx.font = `500 ${Math.round(16 * scale)}px "SF Pro", "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", sans-serif`
      offCtx.fillStyle = 'rgba(255, 255, 255, 0.8)'
      const val = `${set.scoreA} - ${set.scoreB}`
      offCtx.fillText(val, currentX, pastY + 23 * scale)
      currentX += offCtx.measureText(val).width + 16 * scale // 次のアイテムとの間隔
    })
    offCtx.restore()
  }

  offCtx.restore()

  // ----------------------------------------------------
  // メイン Canvas への高品質縮小転写
  // ----------------------------------------------------
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    offCanvas,
    destX - padding * destScale,
    destY - padding * destScale,
    (baseWidth + padding * 2) * destScale,
    (baseHeight + padding * 2) * destScale
  )
  ctx.restore()
}

// チーム行を描画する内部関数
function drawTeamRow(
  ctx: CanvasRenderingContext2D,
  y: number,
  name: string,
  score: number,
  sets: number,
  totalSetDots: number,
  isServing: boolean,
  startX: number,
  boardWidth: number,
  time: number,
  scale: number
) {
  const rowHeight = 42 * scale
  const centerY = y + rowHeight / 2

  ctx.save()

  // 1. サーブ権表示
  if (isServing) {
    const phase = ((time % 2.0) / 2.0) * 2.0 * Math.PI
    const pulseScale = 1.0 + 0.075 * (1.0 - Math.cos(phase))
    const rotation = 7.5 * (1.0 - Math.cos(phase)) * (Math.PI / 180)

    ctx.save()
    const serveX = startX + (18 + 10) * scale // 左パディング18px + コンテナ半幅10px
    ctx.translate(serveX, centerY)
    ctx.scale(pulseScale, pulseScale)
    ctx.rotate(rotation)

    ctx.font = `${Math.round(16 * scale)}px "SF Pro", "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(255, 255, 255, 0.4)'
    ctx.shadowBlur = 4 * scale
    ctx.fillText('🏐', 0, 0)
    ctx.restore()
  }

  // 2. チーム名の描画 (ウェイトを 600 から 500 に下げて潰れを防止、サイズを 18px から 19px に微増させてシャープに)
  ctx.font = `500 ${Math.round(19 * scale)}px "SF Pro", "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", sans-serif`
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const teamNameX = startX + (18 + 20 + 10) * scale
  
  const maxNameWidth = 140 * scale
  let displayName = name
  if (ctx.measureText(name).width > maxNameWidth) {
    while (ctx.measureText(displayName + '...').width > maxNameWidth && displayName.length > 0) {
      displayName = displayName.substring(0, displayName.length - 1)
    }
    displayName += '...'
  }
  ctx.fillText(displayName, teamNameX, centerY)

  // 3. 得点の描画 (team-score)
  const scoreX = startX + boardWidth - (18 + 32 + 12) * scale
  ctx.font = `700 ${Math.round(32 * scale)}px "SF Pro", "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", sans-serif`
  ctx.fillStyle = '#00e5ff'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  
  ctx.save()
  ctx.shadowColor = 'rgba(0, 229, 255, 0.3)'
  ctx.shadowBlur = 10 * scale
  ctx.fillText(score.toString(), scoreX, centerY)
  ctx.restore()

  // 4. セットドット (team-sets)
  const dotRadius = 3.5 * scale
  const dotGap = 5 * scale
  const startDotX = scoreX + 8 * scale

  for (let i = 0; i < totalSetDots; i++) {
    const isFilled = i < sets
    const dotX = startDotX + i * (dotRadius * 2 + dotGap) + dotRadius
    
    ctx.save()
    ctx.beginPath()
    ctx.arc(dotX, centerY, dotRadius, 0, Math.PI * 2)
    
    if (isFilled) {
      ctx.fillStyle = '#ff9100'
      ctx.shadowColor = '#ff9100'
      ctx.shadowBlur = 8 * scale
      ctx.fill()
      
      ctx.beginPath()
      ctx.arc(dotX, centerY, dotRadius, 0, Math.PI * 2)
      ctx.strokeStyle = '#ffb74d'
      ctx.lineWidth = 1 * scale
      ctx.stroke()
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
      ctx.fill()
      
      ctx.beginPath()
      ctx.arc(dotX, centerY, dotRadius, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
      ctx.lineWidth = 1 * scale
      ctx.stroke()
    }
    ctx.restore()
  }

  ctx.restore()
}

/**
 * 動画の冒頭に表示されるタイトルカードを描画します。
 * @param ctx 描画対象の CanvasRenderingContext2D
 * @param width キャンバスの横解像度
 * @param height キャンバスの縦解像度
 * @param eventName 大会名
 * @param matchCard 対戦カード (Team A vs Team B)
 * @param datePlace 日時・場所など
 * @param alpha 不透明度 (0.0 〜 1.0)
 */
export function drawTitleToCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  eventName: string,
  matchCard: string,
  datePlace: string,
  alpha: number
) {
  if (alpha <= 0) return

  ctx.save()
  ctx.globalAlpha = alpha

  const centerY = height / 2

  // 1. 背景のグラデーション帯
  const gradient = ctx.createLinearGradient(0, centerY - 120, 0, centerY + 120)
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
  gradient.addColorStop(0.2, 'rgba(10, 10, 12, 0.75)')
  gradient.addColorStop(0.8, 'rgba(10, 10, 12, 0.75)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, centerY - 120, width, 240)

  // テキスト描画の共通設定
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#000000'
  ctx.lineJoin = 'round'

  // スケール基準（基準解像度: 1280x720）
  const scale = width / 1280

  // 2. 大会名 (1行目)
  if (eventName) {
    ctx.font = `600 ${Math.round(24 * scale)}px "SF Pro", "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", sans-serif`
    ctx.lineWidth = Math.round(5 * scale)
    ctx.strokeText(eventName, width / 2, centerY - 50)
    ctx.fillText(eventName, width / 2, centerY - 50)
  }

  // 3. 対戦カード (2行目 - メインタイトル)
  if (matchCard) {
    ctx.font = `800 ${Math.round(44 * scale)}px "SF Pro", "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", sans-serif`
    ctx.lineWidth = Math.round(7 * scale)
    ctx.strokeText(matchCard, width / 2, centerY + 10)
    ctx.fillText(matchCard, width / 2, centerY + 10)
  }

  // 4. 日時・場所など (3行目)
  if (datePlace) {
    ctx.font = `500 ${Math.round(18 * scale)}px "SF Pro", "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", sans-serif`
    ctx.lineWidth = Math.round(4 * scale)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
    ctx.strokeText(datePlace, width / 2, centerY + 65)
    ctx.fillText(datePlace, width / 2, centerY + 65)
  }

  ctx.restore()
}
