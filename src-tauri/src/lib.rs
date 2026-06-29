use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::thread;
use tauri::State;
use tiny_http::{Server, Response, Header};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

struct MediaPort(u16);

#[tauri::command]
fn get_media_port(port_state: State<'_, MediaPort>) -> u16 {
    port_state.0
}

fn start_media_server() -> u16 {
    let server = Server::http("127.0.0.1:0").expect("Failed to bind HTTP server");
    let port = server.server_addr().port();

    thread::spawn(move || {
        for request in server.incoming_requests() {
            thread::spawn(move || {
                let method = request.method();
                let url_str = request.url();

                // OPTIONS preflight
                if method == &tiny_http::Method::Options {
                    let cors_origin = Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap();
                    let cors_methods = Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"GET, HEAD, OPTIONS"[..]).unwrap();
                    let cors_headers = Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Range, Content-Type"[..]).unwrap();
                    let cors_max_age = Header::from_bytes(&b"Access-Control-Max-Age"[..], &b"86400"[..]).unwrap();
                    
                    let mut response = Response::empty(200);
                    response.add_header(cors_origin);
                    response.add_header(cors_methods);
                    response.add_header(cors_headers);
                    response.add_header(cors_max_age);
                    let _ = request.respond(response);
                    return;
                }

                if method != &tiny_http::Method::Get && method != &tiny_http::Method::Head {
                    let _ = request.respond(Response::from_string("Method Not Allowed").with_status_code(405));
                    return;
                }

                // Rangeヘッダーの取得
                let mut range_header_val = None;
                for header in request.headers() {
                    if header.field.as_str().as_str().eq_ignore_ascii_case("range") {
                        range_header_val = Some(header.value.as_str().to_string());
                        break;
                    }
                }

                println!("[MediaServer Request] Method={:?} URL={} Range={:?}", method, url_str, range_header_val);

                // クエリパラメータ ?path= の抽出
                let path_encoded = match url_str.split("?path=").nth(1) {
                    Some(p) => p,
                    None => {
                        println!("[MediaServer Error] Missing path in URL: {}", url_str);
                        let _ = request.respond(Response::from_string("Missing path").with_status_code(400));
                        return;
                    }
                };

                // URLデコード
                let file_path_str = match urlencoding::decode(path_encoded) {
                    Ok(p) => p.into_owned(),
                    Err(e) => {
                        println!("[MediaServer Error] Invalid path encoding: {}", e);
                        let _ = request.respond(Response::from_string("Invalid path encoding").with_status_code(400));
                        return;
                    }
                };

                let path = Path::new(&file_path_str);
                if !path.exists() {
                    println!("[MediaServer Error] File not found: {}", file_path_str);
                    let _ = request.respond(Response::from_string("File not found").with_status_code(404));
                    return;
                }

                let mut file = match File::open(path) {
                    Ok(f) => f,
                    Err(e) => {
                        println!("[MediaServer Error] Could not open file: {}", e);
                        let _ = request.respond(Response::from_string("Could not open file").with_status_code(500));
                        return;
                    }
                };

                let file_size = match file.metadata() {
                    Ok(meta) => meta.len(),
                    Err(e) => {
                        println!("[MediaServer Error] Could not read file metadata: {}", e);
                        let _ = request.respond(Response::from_string("Could not read file metadata").with_status_code(500));
                        return;
                    }
                };

                // 各種ヘッダー定義
                let cors_header = Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap();
                let cors_expose = Header::from_bytes(&b"Access-Control-Expose-Headers"[..], &b"Content-Range, Content-Length, Accept-Ranges"[..]).unwrap();

                let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                let content_type = if ext == "mov" {
                    "video/quicktime"
                } else if ext == "webm" {
                    "video/webm"
                } else {
                    "video/mp4"
                };
                let content_type_header = Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()).unwrap();

                if let Some(range) = range_header_val {
                    let range_str = range.replace("bytes=", "");
                    let parts: Vec<&str> = range_str.split('-').collect();
                    
                    let mut start = 0;
                    let mut end = file_size - 1;
                    
                    if parts.len() == 2 {
                        if parts[0].is_empty() {
                            if let Ok(suffix_len) = parts[1].parse::<u64>() {
                                start = file_size.saturating_sub(suffix_len);
                            }
                        } else {
                            start = parts[0].parse::<u64>().unwrap_or(0);
                            if !parts[1].is_empty() {
                                end = parts[1].parse::<u64>().unwrap_or(file_size - 1);
                            }
                        }
                    }

                    if start >= file_size || end >= file_size || start > end {
                        println!("[MediaServer Error] Range Not Satisfiable: bytes {}-{}/{}", start, end, file_size);
                        let mut response = Response::from_string("Range Not Satisfiable").with_status_code(416);
                        let content_range = format!("bytes */{}", file_size);
                        let content_range_header = Header::from_bytes(&b"Content-Range"[..], content_range.as_bytes()).unwrap();
                        response.add_header(content_range_header);
                        response.add_header(cors_header);
                        response.add_header(cors_expose);
                        let _ = request.respond(response);
                        return;
                    }

                    let chunk_size = end - start + 1;
                    println!(
                        "[MediaServer Response 206] bytes {}-{}/{} (chunk_size={}) type={}",
                        start, end, file_size, chunk_size, content_type
                    );

                    let accept_ranges_header = Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap();
                    let content_range = format!("bytes {}-{}/{}", start, end, file_size);
                    let content_range_header = Header::from_bytes(&b"Content-Range"[..], content_range.as_bytes()).unwrap();

                    let headers = vec![
                        cors_header,
                        cors_expose,
                        accept_ranges_header,
                        content_type_header,
                        content_range_header,
                    ];

                    let status_code = tiny_http::StatusCode(206);

                    if method == &tiny_http::Method::Head {
                        let response = Response::new(
                            status_code,
                            headers,
                            std::io::empty(),
                            Some(chunk_size as usize),
                            None,
                        );
                        let _ = request.respond(response);
                    } else {
                        if file.seek(SeekFrom::Start(start)).is_err() {
                            println!("[MediaServer Error] Seek failed to offset {}", start);
                            let _ = request.respond(Response::from_string("Seek error").with_status_code(500));
                            return;
                        }
                        let response = Response::new(
                            status_code,
                            headers,
                            file.take(chunk_size),
                            Some(chunk_size as usize),
                            None,
                        );
                        let _ = request.respond(response);
                    }
                } else {
                    println!("[MediaServer Response 200] size={} type={}", file_size, content_type);
                    let headers = vec![
                        cors_header,
                        cors_expose,
                        content_type_header,
                    ];

                    let status_code = tiny_http::StatusCode(200);
                    let full_size = file_size as usize;

                    if method == &tiny_http::Method::Head {
                        let response = Response::new(
                            status_code,
                            headers,
                            std::io::empty(),
                            Some(full_size),
                            None,
                        );
                        let _ = request.respond(response);
                    } else {
                        let response = Response::new(
                            status_code,
                            headers,
                            file,
                            Some(full_size),
                            None,
                        );
                        let _ = request.respond(response);
                    }
                }
            });
        }
    });

    port
}


#[tauri::command]
fn save_project_json(path: String, content: String) -> Result<(), String> {
    use std::io::Write;
    let mut file = File::create(path).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_project_json(path: String) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut content = String::new();
    file.read_to_string(&mut content).map_err(|e| e.to_string())?;
    Ok(content)
}

#[tauri::command]
fn check_file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn get_temp_dir() -> String {
    std::env::temp_dir().to_string_lossy().into_owned()
}

#[tauri::command]
fn save_temp_file(data: Vec<u8>, suffix: String) -> Result<String, String> {
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};
    
    let start = SystemTime::now();
    let since_the_epoch = start
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    let timestamp = since_the_epoch.as_millis();
    
    let temp_dir = std::env::temp_dir();
    let file_name = format!("vmemo_overlay_{}.{}", timestamp, suffix);
    let temp_file_path = temp_dir.join(file_name);
    
    let mut file = File::create(&temp_file_path).map_err(|e| e.to_string())?;
    file.write_all(&data).map_err(|e| e.to_string())?;
    
    Ok(temp_file_path.to_string_lossy().into_owned())
}

#[derive(Serialize, Deserialize, Debug)]
struct VideoMetadata {
    width: u32,
    height: u32,
    fps: f64,
    duration: f64,
    has_audio: bool,
}

#[tauri::command]
fn get_video_metadata(path: String) -> Result<VideoMetadata, String> {
    use std::process::Command;

    // ffprobe -v error -show_entries stream=width,height,r_frame_rate,duration,codec_type -show_entries format=duration -of json <path>
    let output_res = Command::new("ffprobe")
        .args(&[
            "-v", "error",
            "-show_entries", "stream=width,height,r_frame_rate,duration,codec_type",
            "-show_entries", "format=duration",
            "-of", "json",
            &path,
        ])
        .output();

    let output = match output_res {
        Ok(out) => out,
        Err(_) => {
            // Homebrewのフォールバックパス
            Command::new("/opt/homebrew/bin/ffprobe")
                .args(&[
                    "-v", "error",
                    "-show_entries", "stream=width,height,r_frame_rate,duration,codec_type",
                    "-show_entries", "format=duration",
                    "-of", "json",
                    &path,
                ])
                .output()
                .map_err(|e| format!("Failed to run ffprobe (Homebrew path tried): {}", e))?
        }
    };

    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe exited with error: {}", err_msg));
    }

    let out_str = String::from_utf8(output.stdout)
        .map_err(|e| format!("Invalid UTF-8 from ffprobe: {}", e))?;

    let parsed: serde_json::Value = serde_json::from_str(&out_str)
        .map_err(|e| format!("Failed to parse ffprobe JSON: {}", e))?;

    let streams = parsed.get("streams")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "No streams found in video".to_string())?;

    let mut width = 0;
    let mut height = 0;
    let mut fps = 30.0;
    let mut has_audio = false;
    let mut stream_duration = None;

    for stream in streams {
        let codec_type = stream.get("codec_type").and_then(|v| v.as_str()).unwrap_or("");
        if codec_type == "video" {
            width = stream.get("width").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            height = stream.get("height").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            
            if let Some(r_fps_str) = stream.get("r_frame_rate").and_then(|v| v.as_str()) {
                let parts: Vec<&str> = r_fps_str.split('/').collect();
                if parts.len() == 2 {
                    if let (Ok(num), Ok(den)) = (parts[0].parse::<f64>(), parts[1].parse::<f64>()) {
                        if den > 0.0 {
                            fps = num / den;
                        }
                    }
                }
            }

            if let Some(dur_str) = stream.get("duration").and_then(|v| v.as_str()) {
                if let Ok(dur) = dur_str.parse::<f64>() {
                    stream_duration = Some(dur);
                }
            }
        } else if codec_type == "audio" {
            has_audio = true;
        }
    }

    let format_duration = parsed.get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|d| d.as_str())
        .and_then(|d_str| d_str.parse::<f64>().ok());

    let duration = stream_duration.or(format_duration).unwrap_or(0.0);

    Ok(VideoMetadata {
        width,
        height,
        fps,
        duration,
        has_audio,
    })
}

#[derive(Deserialize, Debug, Clone)]
struct ExportArgs {
    input_video_path: Option<String>,
    overlay_video_path: String,
    output_video_path: String,
    export_type: String, // "normal" | "transparent"
    in_point: f64,
    out_point: f64,
    resolution: String, // "original" | "1080p" | "720p" | "480p"
    fade: bool,
    total_duration: f64,
    fps: Option<f64>,
    use_colorkey: Option<bool>,
}

#[tauri::command]
fn export_video(app_handle: AppHandle, args: ExportArgs) -> Result<(), String> {
    thread::spawn(move || {
        println!("[Export Spawned] Start exporting with args: {:?}", args);
        match run_ffmpeg_export(&app_handle, args) {
            Ok(_) => {
                println!("[Export Spawned] Export finished successfully");
                let _ = app_handle.emit("export-complete", ());
            }
            Err(e) => {
                eprintln!("[Export Spawned] Export failed: {}", e);
                let _ = app_handle.emit("export-error", e);
            }
        }
    });
    Ok(())
}

fn run_ffmpeg_export(app_handle: &AppHandle, args: ExportArgs) -> Result<(), String> {
    use std::process::{Command, Stdio};
    use std::io::BufReader;

    let total_duration = args.total_duration;
    let mut ffmpeg_args = Vec::new();
    
    ffmpeg_args.push("-y".to_string());

    if args.export_type == "normal" {
        let input_video = args.input_video_path.clone().ok_or_else(|| "Input video path is missing".to_string())?;

        ffmpeg_args.push("-ss".to_string());
        ffmpeg_args.push(format!("{:.3}", args.in_point));
        ffmpeg_args.push("-to".to_string());
        ffmpeg_args.push(format!("{:.3}", args.out_point));
        ffmpeg_args.push("-i".to_string());
        ffmpeg_args.push(input_video);

        ffmpeg_args.push("-i".to_string());
        ffmpeg_args.push(args.overlay_video_path.clone());

        let scale_filter = match args.resolution.as_str() {
            "1080p" => "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
            "720p" => "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
            "480p" => "scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2",
            _ => "",
        };

        let mut filter_complex = String::new();
        let use_colorkey = args.use_colorkey.unwrap_or(false);

        if !scale_filter.is_empty() {
            if use_colorkey {
                filter_complex.push_str(&format!(
                    "[0:v]{}[base]; [1:v]{},colorkey=0x00ff00:0.25:0.12[ovr]; [base][ovr]overlay=0:0",
                    scale_filter, scale_filter
                ));
            } else {
                filter_complex.push_str(&format!(
                    "[0:v]{}[base]; [1:v]{}[ovr]; [base][ovr]overlay=0:0",
                    scale_filter, scale_filter
                ));
            }
        } else {
            if use_colorkey {
                filter_complex.push_str("[1:v]colorkey=0x00ff00:0.25:0.12[ovr]; [0:v][ovr]overlay=0:0");
            } else {
                filter_complex.push_str("[0:v][1:v]overlay=0:0");
            }
        }

        if args.fade {
            let fade_out_start = (total_duration - 1.0).max(0.0);
            filter_complex.push_str(&format!(
                ",fade=t=in:st=0:d=1,fade=t=out:st={:.3}:d=1",
                fade_out_start
            ));
        }

        filter_complex.push_str("[outv]");

        // 音声のフェードフィルタを同じ -filter_complex に統合する (FFmpegは複数の -filter_complex を許容しないため)
        if args.fade {
            let fade_out_start = (total_duration - 1.0).max(0.0);
            filter_complex.push_str(&format!(
                "; [0:a]afade=t=in:st=0:d=1,afade=t=out:st={:.3}:d=1[outa]",
                fade_out_start
            ));
        }

        ffmpeg_args.push("-filter_complex".to_string());
        ffmpeg_args.push(filter_complex);

        ffmpeg_args.push("-map".to_string());
        ffmpeg_args.push("[outv]".to_string());

        if args.fade {
            ffmpeg_args.push("-map".to_string());
            ffmpeg_args.push("[outa]".to_string());
            
            ffmpeg_args.push("-c:v".to_string());
            ffmpeg_args.push("libx264".to_string());
            ffmpeg_args.push("-crf".to_string());
            ffmpeg_args.push("18".to_string());
            ffmpeg_args.push("-preset".to_string());
            ffmpeg_args.push("veryfast".to_string());
            ffmpeg_args.push("-pix_fmt".to_string());
            ffmpeg_args.push("yuv420p".to_string());
            
            ffmpeg_args.push("-c:a".to_string());
            ffmpeg_args.push("aac".to_string());
            ffmpeg_args.push("-b:a".to_string());
            ffmpeg_args.push("192k".to_string());
        } else {
            ffmpeg_args.push("-map".to_string());
            ffmpeg_args.push("0:a?".to_string());

            ffmpeg_args.push("-c:v".to_string());
            ffmpeg_args.push("libx264".to_string());
            ffmpeg_args.push("-crf".to_string());
            ffmpeg_args.push("18".to_string());
            ffmpeg_args.push("-preset".to_string());
            ffmpeg_args.push("veryfast".to_string());
            ffmpeg_args.push("-pix_fmt".to_string());
            ffmpeg_args.push("yuv420p".to_string());

            ffmpeg_args.push("-c:a".to_string());
            ffmpeg_args.push("copy".to_string());
        }
    } else {
        ffmpeg_args.push("-i".to_string());
        ffmpeg_args.push(args.overlay_video_path.clone());

        let mut vf_filters = Vec::new();
        let use_colorkey = args.use_colorkey.unwrap_or(false);
        if use_colorkey {
            vf_filters.push("colorkey=0x00ff00:0.45:0.05".to_string());
        }

        match args.resolution.as_str() {
            "1080p" => vf_filters.push("scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2".to_string()),
            "720p" => vf_filters.push("scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2".to_string()),
            "480p" => vf_filters.push("scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2".to_string()),
            _ => {}
        }

        if args.fade {
            let fade_out_start = (total_duration - 1.0).max(0.0);
            vf_filters.push(format!("fade=t=in:st=0:d=1,fade=t=out:st={:.3}:d=1", fade_out_start));
        }

        // 透過ProRes 4444の出力形式に適合させるため、明示的に format=yuva444p10le を末尾に追加
        vf_filters.push("format=yuva444p10le".to_string());

        if !vf_filters.is_empty() {
            ffmpeg_args.push("-vf".to_string());
            ffmpeg_args.push(vf_filters.join(","));
        }

        ffmpeg_args.push("-c:v".to_string());
        ffmpeg_args.push("prores_ks".to_string());
        ffmpeg_args.push("-profile:v".to_string());
        ffmpeg_args.push("4".to_string());
        ffmpeg_args.push("-vendor".to_string());
        ffmpeg_args.push("ap10".to_string());
        ffmpeg_args.push("-pix_fmt".to_string());
        ffmpeg_args.push("yuva444p10le".to_string());
    }

    ffmpeg_args.push(args.output_video_path.clone());

    println!("[FFmpeg Export Command] ffmpeg {}", ffmpeg_args.join(" "));

    let child_res = Command::new("ffmpeg")
        .args(&ffmpeg_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let mut child = match child_res {
        Ok(c) => c,
        Err(_) => {
            Command::new("/opt/homebrew/bin/ffmpeg")
                .args(&ffmpeg_args)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to start FFmpeg (also tried Homebrew path): {}", e))?
        }
    };

    let stderr = child.stderr.take().ok_or_else(|| "Failed to capture stderr".to_string())?;
    let mut reader = BufReader::new(stderr);
    let mut line_bytes = Vec::new();
    let mut buf = [0u8; 1];
    let mut last_lines: Vec<String> = Vec::new();

    while let Ok(n) = reader.read(&mut buf) {
        if n == 0 {
            break; // EOF
        }
        let b = buf[0];
        if b == b'\n' || b == b'\r' {
            if !line_bytes.is_empty() {
                if let Ok(line) = String::from_utf8(line_bytes.clone()) {
                    let trimmed = line.trim().to_string();
                    if !trimmed.is_empty() {
                        if last_lines.len() >= 25 {
                            last_lines.remove(0);
                        }
                        last_lines.push(trimmed.clone());
                    }

                    if let Some(idx) = line.find("time=") {
                        let time_part = &line[idx + 5..];
                        let end_idx = time_part.find(' ').unwrap_or(time_part.len());
                        let time_str = &time_part[..end_idx];
                        if let Some(seconds) = parse_time_to_seconds(time_str.trim()) {
                            let progress = if total_duration > 0.0 {
                                ((seconds / total_duration) * 100.0).min(100.0)
                            } else {
                                100.0
                            };
                            let _ = app_handle.emit("export-progress", progress);
                        }
                    }
                }
                line_bytes.clear();
            }
        } else {
            line_bytes.push(b);
        }
    }

    let status = child.wait().map_err(|e| format!("FFmpeg wait failed: {}", e))?;
    if !status.success() {
        let err_context = last_lines.join("\n");
        return Err(format!("FFmpeg process failed.\nFFmpeg Log:\n{}", err_context));
    }

    Ok(())
}

fn parse_time_to_seconds(time_str: &str) -> Option<f64> {
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let hours = parts[0].parse::<f64>().ok()?;
    let minutes = parts[1].parse::<f64>().ok()?;
    let seconds = parts[2].parse::<f64>().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port = start_media_server();
    println!("[Rust MediaServer] Listening on http://127.0.0.1:{}", port);

    tauri::Builder::default()
        .manage(MediaPort(port))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_media_port,
            save_project_json,
            load_project_json,
            check_file_exists,
            get_video_metadata,
            export_video,
            get_temp_dir,
            save_temp_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
