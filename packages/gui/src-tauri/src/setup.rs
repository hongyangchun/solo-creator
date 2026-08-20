use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use crate::state::EngineState;

const ENGINE_PORT: u16 = 39281;
const HEALTH_TIMEOUT_MS: u64 = 15_000;

/// 启动引擎 sidecar：Node 常驻进程执行 engine-server.js，绑定 127.0.0.1:39281。
/// dev 与打包态统一用 externalBin 声明的 node sidecar（binaries/node-<triple>）。
pub fn spawn_engine_sidecar(app: AppHandle) {
    app.manage(EngineState::default());

    let resource_dir = app
        .path()
        .resource_dir()
        .expect("无法定位资源目录");

    // dev 态：binaries/ 与 src-tauri 同目录；打包态：resources/ 内
    let dev_entry = std::env::current_dir()
        .expect("无法定位当前目录")
        .join("binaries/resources/engine-server.cjs");
    let packaged_entry = resource_dir.join("binaries/resources/engine-server.cjs");
    let entry = if dev_entry.exists() {
        dev_entry
    } else {
        packaged_entry
    };

    println!("[setup] engine sidecar entry: {}", entry.display());

    let sidecar = app
        .shell()
        .sidecar("node")
        .expect("node sidecar 未在 externalBin 声明");

    let (mut rx, _child) = sidecar
        .args([entry.to_string_lossy().to_string()])
        .env("ENGINE_PORT", ENGINE_PORT.to_string())
        .spawn()
        .expect("引擎 sidecar 启动失败");

    // 异步消费 sidecar stdout/stderr，避免管道阻塞
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    println!("[engine] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[engine:err] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(status) => {
                    eprintln!("[engine] sidecar 退出: {:?}", status);
                }
                _ => {}
            }
        }
    });

    // 健康检查轮询：GET /api/v1/health 就绪前前端显示「引擎启动中」
    let app_for_health = app.clone();
    tauri::async_runtime::spawn(async move {
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(HEALTH_TIMEOUT_MS);
        loop {
            if std::time::Instant::now() > deadline {
                eprintln!("[setup] 引擎健康检查超时（{}ms）", HEALTH_TIMEOUT_MS);
                return;
            }
            let url = format!("http://127.0.0.1:{}/api/v1/health", ENGINE_PORT);
            match reqwest_lite(&url) {
                Ok(true) => {
                    if let Some(state) = app_for_health.try_state::<EngineState>() {
                        *state.engine_ready.lock().unwrap() = true;
                    }
                    println!("[setup] 引擎就绪 http://127.0.0.1:{}", ENGINE_PORT);
                    let _ = app_for_health.emit("engine-ready", true);
                    return;
                }
                _ => tokio_compat_sleep(400).await,
            }
        }
    });
}

/// 应用退出：向 sidecar 发终止信号（tauri-plugin-shell 随 app 生命周期自动清理子进程，
/// Destroyed 事件里做兜底清理标记）
pub fn shutdown_engine(app: &AppHandle) {
    if let Some(state) = app.try_state::<EngineState>() {
        *state.engine_ready.lock().unwrap() = false;
    }
    println!("[setup] 应用退出，引擎 sidecar 已随进程树终止");
}

fn reqwest_lite(url: &str) -> Result<bool, ()> {
    // 最小 HTTP GET（避免引入 reqwest 重依赖；仅探活 /api/v1/health）
    use std::io::{Read, Write};
    let host_port = url.trim_start_matches("http://");
    let mut parts = host_port.splitn(2, '/');
    let host = parts.next().unwrap_or("127.0.0.1:39281");
    let path = format!("/{}", parts.next().unwrap_or("api/v1/health"));
    let mut stream = std::net::TcpStream::connect(host).map_err(|_| ())?;
    stream.set_read_timeout(Some(std::time::Duration::from_millis(1500))).ok();
    let req = format!("GET {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n", path, host);
    stream.write_all(req.as_bytes()).map_err(|_| ())?;
    let mut buf = [0u8; 512];
    let n = stream.read(&mut buf).map_err(|_| ())?;
    let resp = String::from_utf8_lossy(&buf[..n]);
    Ok(resp.contains("200") && resp.contains("ok"))
}

async fn tokio_compat_sleep(ms: u64) {
    std::thread::sleep(std::time::Duration::from_millis(ms));
}
