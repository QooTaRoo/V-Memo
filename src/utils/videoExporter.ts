import { invoke } from '@tauri-apps/api/core'
import { Muxer, ArrayBufferTarget } from 'webm-muxer'
import { drawScoreboardToCanvas, drawTitleToCanvas } from './scoreboardCanvas'
import { ScoreEvent, MatchSettings, getActiveEventState } from './scoreEngine'

export interface VideoMetadata {
  width: number
  height: number
  fps: number
  duration: number
  has_audio: boolean
}

export interface ExportTitleOptions {
  showTitle: boolean
  eventName: string
  matchCard: string
  datePlace: string
  duration: number
}

/**
 * 得点板の描画のみを含む背景透過の WebM (VP9 + Alpha) 動画ファイルを一時フォルダにエクスポートします。
 * @param metadata 元動画のメタデータ (解像度や正確なFPS情報を含む)
 * @param events 記録されたスコアイベントの配列
 * @param settings 得点表示の設定
 * @param inPoint 書き出し開始のイン点（秒）
 * @param outPoint 書き出し終了のアウト点（秒）
 * @param titleOptions タイトル表示設定
 * @param onProgress 進捗通知のコールバック (0〜100の値)
 * @returns 生成された一時 WebM ファイルの絶対パス
 */
export async function exportTransparentWebm(
  metadata: VideoMetadata,
  events: ScoreEvent[],
  settings: MatchSettings,
  inPoint: number,
  outPoint: number,
  titleOptions: ExportTitleOptions,
  onProgress: (pct: number) => void
): Promise<{ path: string, useColorkey: boolean }> {
  const width = metadata.width || 1280
  const height = metadata.height || 720
  const fps = metadata.fps || 30.0
  const duration = outPoint - inPoint

  if (duration <= 0) {
    throw new Error('書き出し範囲が不正です（アウト点はイン点より後でなければなりません）')
  }

  // オフスクリーン Canvas の作成
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  
  // Safari対策: CanvasがDOMツリーに属していないと VideoFrame 生成時に「Canvas has no frame」などのGPU関連エラーが発生する場合がある
  // また、スタイル上のサイズがピクセルサイズと著しく異なったり、完全に透明/非表示（opacity: 0, display: none）だったり、
  // 画面外に配置されていると、描画バッファ（フレーム）が生成されずエラーになることがあるため、適切なサイズで背面に配置します。
  canvas.style.position = 'fixed'
  canvas.style.left = '0px'
  canvas.style.top = '0px'
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  canvas.style.opacity = '0.001'
  canvas.style.pointerEvents = 'none'
  canvas.style.zIndex = '-9999'
  document.body.appendChild(canvas)

  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) {
    try { if (canvas.parentNode) canvas.parentNode.removeChild(canvas) } catch (e) {}
    throw new Error('Canvas 2D コンテキストの取得に失敗しました')
  }

  try {
    // ダイナミックコーデックチェック & プローブフォールバックシステム
    const configsToTry: { config: VideoEncoderConfig; isH264: boolean; useColorkey: boolean }[] = [
      // 1. VP9 with Alpha (Ideal WebM)
      {
        config: {
          codec: 'vp09.00.10.08',
          width,
          height,
          bitrate: 20000000, // 20 Mbps に向上（ブロックノイズ防止）
          framerate: fps,
          alpha: 'keep' as any
        },
        isH264: false,
        useColorkey: false
      },
      // 2. VP8 with Alpha (Alternative WebM)
      {
        config: {
          codec: 'vp8',
          width,
          height,
          bitrate: 20000000, // 20 Mbps に向上
          framerate: fps,
          alpha: 'keep' as any
        },
        isH264: false,
        useColorkey: false
      },
      // 3. H.264 High Profile (annexb) - Level 5.1
      {
        config: {
          codec: 'avc1.640033', // Level 5.1 (High Profile) に引き上げ、1080p 60fps に完全対応
          width,
          height,
          bitrate: 20000000, // 20 Mbps に向上
          framerate: fps,
          avc: { format: 'annexb' }
        },
        isH264: true,
        useColorkey: true
      },
      // 4. H.264 Main Profile (annexb) - Level 5.1
      {
        config: {
          codec: 'avc1.4d0033', // Level 5.1 (Main Profile)
          width,
          height,
          bitrate: 20000000, // 20 Mbps に向上
          framerate: fps,
          avc: { format: 'annexb' }
        },
        isH264: true,
        useColorkey: true
      },
      // 5. H.264 Baseline Profile (annexb) - Level 5.1
      {
        config: {
          codec: 'avc1.420033', // Level 5.1 (Baseline Profile)
          width,
          height,
          bitrate: 20000000, // 20 Mbps に向上
          framerate: fps,
          avc: { format: 'annexb' }
        },
        isH264: true,
        useColorkey: true
      }
    ]

    let selectedOption = null
    let encoder: VideoEncoder | null = null
    let encoderError: any = null
    let muxer: Muxer<ArrayBufferTarget> | null = null

    let encoderReject!: (e: any) => void
    const encoderPromise = new Promise<void>((_, reject) => {
      encoderReject = reject
    })

    for (const option of configsToTry) {
      console.log(`[Exporter] Testing configuration for codec: ${option.config.codec}`)
      
      if (typeof VideoEncoder !== 'undefined' && VideoEncoder.isConfigSupported) {
        try {
          const support = await VideoEncoder.isConfigSupported(option.config)
          if (!support.supported) {
            console.log(`[Exporter] Codec ${option.config.codec} is reported as unsupported by isConfigSupported.`)
            continue
          }
        } catch (e) {
          console.warn(`[Exporter] isConfigSupported check failed for ${option.config.codec}:`, e)
        }
      }

      let hasFailed = false
      encoderError = null
      
      try {
        encoder = new VideoEncoder({
          output: (chunk, meta) => {
            if (muxer) {
              muxer.addVideoChunk(chunk, meta)
            }
          },
          error: (e) => {
            console.error(`[Exporter] VideoEncoder error for ${option.config.codec}:`, e)
            encoderError = e
            hasFailed = true
            if (encoderReject) encoderReject(e)
          }
        })

        encoder.configure(option.config)
        
        // 非同期のエラーコールバックが発火するのを30ms待機
        await new Promise((resolve) => setTimeout(resolve, 30))
        
        if (hasFailed || encoder.state === 'closed' || encoderError) {
          console.warn(`[Exporter] Codec ${option.config.codec} failed after configuration.`)
          try { encoder.close() } catch (err) {}
          encoder = null
          continue
        }
        
        selectedOption = option
        console.log(`[Exporter] Codec ${option.config.codec} configured successfully!`)
        break
      } catch (err: any) {
        console.warn(`[Exporter] Codec ${option.config.codec} threw synchronous configure exception:`, err)
        hasFailed = true
        encoderError = err
        try { if (encoder) encoder.close() } catch (err) {}
        encoder = null
      }
    }

    if (!selectedOption || !encoder) {
      const errorMsg = encoderError ? (encoderError.message || String(encoderError)) : 'すべてのコーデック設定が失敗しました。'
      throw new Error(`エンコーダの初期化に失敗しました: ${errorMsg}`)
    }

    const { isH264, useColorkey } = selectedOption
    const selectedCodec = selectedOption.config.codec

    // WebM Muxer の初期化 (H.264 の場合も Matroska コンテナとして Mux することでタイムスタンプを保護する)
    muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: {
        codec: isH264 ? 'V_MPEG4/ISO/AVC' : (selectedCodec.startsWith('vp8') ? 'V_VP8' : 'V_VP9'),
        width: width,
        height: height,
        alpha: !useColorkey,
      },
    })

    const totalFrames = Math.ceil(duration * fps)
    const frameDurationUs = Math.round(1000000 / fps) // マイクロ秒

    console.log(`[Exporter] Generating overlay layer: ${totalFrames} frames @ ${fps}fps (Codec: ${selectedCodec}, colorkey: ${useColorkey})`)

    for (let i = 0; i < totalFrames; i++) {
      // エンコーダーのエラーチェック
      if (encoderError) {
        throw new Error(`エンコード中にエラーが発生しました: ${encoderError.message || encoderError}`)
      }
      if (encoder.state === 'closed') {
        throw new Error('VideoEncoderのステートがclosedになりました。')
      }

      const frameTime = inPoint + i / fps

      // キャンバスをクリア (H264の場合はクロマキー用に緑で塗りつぶす)
      if (useColorkey) {
        ctx.fillStyle = '#00ff00'
        ctx.fillRect(0, 0, width, height)
      } else {
        ctx.clearRect(0, 0, width, height)
      }

      // 現在時刻のアクティブスコア状態を取得
      const activeState = getActiveEventState(events, frameTime)

      // 得点表示がONのときのみCanvasに描画
      if (activeState.overlayVisible) {
        drawScoreboardToCanvas(ctx, width, height, activeState, settings, frameTime, useColorkey)
      }

      // タイトルカードの描画（書き出し開始からの経過時間が指定時間未満の場合）
      const relativeTime = i / fps
      if (titleOptions.showTitle && relativeTime < titleOptions.duration) {
        let alpha = 1.0
        const fadeStart = titleOptions.duration - 1.0
        if (relativeTime > fadeStart) {
          alpha = Math.max(0, 1.0 - (relativeTime - fadeStart))
        }
        drawTitleToCanvas(
          ctx,
          width,
          height,
          titleOptions.eventName,
          titleOptions.matchCard,
          titleOptions.datePlace,
          alpha
        )
      }

      // CanvasからVideoFrameを生成（エラー時は最大5回リトライ）
      const timestampUs = i * frameDurationUs
      let frame: VideoFrame | null = null
      let bitmap: ImageBitmap | null = null
      let retries = 5
      let lastError: any = null

      while (retries > 0) {
        try {
          if (typeof createImageBitmap !== 'undefined') {
            bitmap = await createImageBitmap(canvas)
            frame = new VideoFrame(bitmap, {
              timestamp: timestampUs,
              duration: frameDurationUs,
            })
          } else {
            frame = new VideoFrame(canvas, {
              timestamp: timestampUs,
              duration: frameDurationUs,
            })
          }
          break // 成功したらループを抜ける
        } catch (err: any) {
          lastError = err
          retries--
          if (bitmap) {
            bitmap.close()
            bitmap = null
          }
          if (frame) {
            frame.close()
            frame = null
          }
          console.warn(`[Exporter] Failed to create VideoFrame (attempt ${5 - retries}/5): ${err.message || err}`)
          // 一時的に待機してグラフィックスバッファのリフレッシュを促す
          await new Promise((resolve) => setTimeout(resolve, 15))
        }
      }

      if (!frame) {
        const errMsg = lastError instanceof Error ? lastError.message : (lastError?.message || String(lastError))
        throw new Error(`オーバーレイ映像の生成に失敗しました: Canvasの読み込みエラー (${i}/${totalFrames}): ${errMsg}`)
      }

      try {
        encoder.encode(frame)
      } catch (err: any) {
        frame.close()
        if (bitmap) bitmap.close()
        const errMsg = err instanceof Error ? err.message : (err?.message || String(err))
        throw new Error(`フレームエンコードに失敗しました (${i}/${totalFrames}): ${errMsg}`)
      }
      frame.close()
      if (bitmap) bitmap.close()

      // WebKitのGPUプロセス/メモリ制限対策: エンコードキューが溜まりすぎないようスロットリングしてOOMクラッシュを防止
      while (encoder && encoder.encodeQueueSize > 6) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }

      // UIをフリーズさせないために進捗通知と微細なタイムアウトを入れる
      if (i % 30 === 0 || i === totalFrames - 1) {
        onProgress(Math.round((i / totalFrames) * 100))
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
    }

    // 残りキューのフラッシュとクローズ
    await Promise.race([
      encoder.flush().then(() => encoder.close()),
      encoderPromise
    ])

    let outputData: Uint8Array
    let tempFileNameSuffix = 'webm'

    if (muxer) {
      muxer.finalize()
      outputData = new Uint8Array(muxer.target.buffer)
    } else {
      throw new Error('エンコードデータの取得に失敗しました')
    }

    // 一時ファイルとして保存 (Rust側で書き込むことでフロントエンドのfsパーミッション制限を回避)
    console.log(`[Exporter] Requesting Rust to write overlay data to temp (${outputData.byteLength} bytes)`)
    
    // ArrayBuffer/Uint8Arrayをそのままシリアライズできる配列に変換して渡す
    const dataArray = Array.from(outputData)
    const tempFilePath = await invoke<string>('save_temp_file', {
      data: dataArray,
      suffix: tempFileNameSuffix
    })

    return { path: tempFilePath, useColorkey }
  } finally {
    // DOMからキャンバスを削除
    try {
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas)
      }
    } catch (e) {
      console.warn('[Exporter] Failed to remove canvas from DOM:', e)
    }
  }
}
