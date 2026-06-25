use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::thread;
use tauri::State;
use tiny_http::{Server, Response, Header};

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
            let url_str = request.url();
            
            // クエリパラメータ ?path= の抽出
            let path_encoded = match url_str.split("?path=").nth(1) {
                Some(p) => p,
                None => {
                    let _ = request.respond(Response::from_string("Missing path").with_status_code(400));
                    continue;
                }
            };

            // URLデコード
            let file_path_str = match urlencoding::decode(path_encoded) {
                Ok(p) => p.into_owned(),
                Err(_) => {
                    let _ = request.respond(Response::from_string("Invalid path encoding").with_status_code(400));
                    continue;
                }
            };

            let path = Path::new(&file_path_str);
            if !path.exists() {
                let _ = request.respond(Response::from_string("File not found").with_status_code(404));
                continue;
            }

            let mut file = match File::open(path) {
                Ok(f) => f,
                Err(_) => {
                    let _ = request.respond(Response::from_string("Could not open file").with_status_code(500));
                    continue;
                }
            };

            let file_size = match file.metadata() {
                Ok(meta) => meta.len(),
                Err(_) => {
                    let _ = request.respond(Response::from_string("Could not read file metadata").with_status_code(500));
                    continue;
                }
            };

            // 各種ヘッダー定義
            let cors_header = Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap();
            let accept_ranges_header = Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap();

            let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            let content_type = if ext == "mov" {
                "video/quicktime"
            } else if ext == "webm" {
                "video/webm"
            } else {
                "video/mp4"
            };
            let content_type_header = Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()).unwrap();

            // Rangeヘッダーの取得
            let mut range_header_val = None;
            for header in request.headers() {
                if header.field.as_str().as_str().eq_ignore_ascii_case("range") {
                    range_header_val = Some(header.value.as_str().to_string());
                    break;
                }
            }

            if let Some(range) = range_header_val {
                let range_str = range.replace("bytes=", "");
                let parts: Vec<&str> = range_str.split('-').collect();
                let start = parts[0].parse::<u64>().unwrap_or(0);
                let end = if parts.len() > 1 && !parts[1].is_empty() {
                    parts[1].parse::<u64>().unwrap_or(file_size - 1)
                } else {
                    file_size - 1
                };

                if start >= file_size || end >= file_size || start > end {
                    let mut response = Response::from_string("Range Not Satisfiable").with_status_code(416);
                    let content_range = format!("bytes */{}", file_size);
                    let content_range_header = Header::from_bytes(&b"Content-Range"[..], content_range.as_bytes()).unwrap();
                    response.add_header(content_range_header);
                    response.add_header(cors_header);
                    let _ = request.respond(response);
                    continue;
                }

                let chunk_size = end - start + 1;
                let mut buffer = vec![0; chunk_size as usize];
                if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut buffer).is_err() {
                    let _ = request.respond(Response::from_string("Read error").with_status_code(500));
                    continue;
                }

                let mut response = Response::from_data(buffer).with_status_code(206);
                response.add_header(cors_header);
                response.add_header(accept_ranges_header);
                response.add_header(content_type_header);
                
                let content_range = format!("bytes {}-{}/{}", start, end, file_size);
                let content_range_header = Header::from_bytes(&b"Content-Range"[..], content_range.as_bytes()).unwrap();
                response.add_header(content_range_header);

                let _ = request.respond(response);
            } else {
                let mut buffer = vec![0; file_size as usize];
                if file.read_exact(&mut buffer).is_ok() {
                    let mut response = Response::from_data(buffer).with_status_code(200);
                    response.add_header(cors_header);
                    response.add_header(content_type_header);
                    let _ = request.respond(response);
                } else {
                    let _ = request.respond(Response::from_string("Read error").with_status_code(500));
                }
            }
        }
    });

    port
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
        .invoke_handler(tauri::generate_handler![get_media_port])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
