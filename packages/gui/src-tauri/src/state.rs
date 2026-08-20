use std::sync::Mutex;

/// 引擎 sidecar 运行态（进程句柄与就绪状态）
#[derive(Default)]
pub struct EngineState {
    pub engine_ready: Mutex<bool>,
}
