use std::{collections::HashMap, sync::Mutex, time::Duration};

use reqwest::{Client, Method, Url, redirect::Policy};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

use crate::{desktop::Desktop, vault::Vault};

#[derive(Clone, Copy, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Gemini,
    OpenAi,
}

impl Provider {
    pub fn record(self) -> &'static [u8] {
        match self {
            Self::Gemini => b"gemini",
            Self::OpenAi => b"openai",
        }
    }

    fn endpoint(self, path: &str, method: &Method) -> Result<Url, ApiError> {
        let model_path = path.strip_prefix("models/");
        let permitted = match (self, method.as_str()) {
            (_, "GET") => model_path.is_some_and(valid_model),
            (Self::OpenAi, "POST") => path == "responses",
            (Self::Gemini, "POST") => model_path
                .and_then(|model| model.strip_suffix(":generateContent"))
                .is_some_and(valid_model),
            _ => false,
        };
        if !permitted {
            return Err(ApiError::new("BAD_REQUEST", "Rute API tidak diizinkan."));
        }
        let base = match self {
            Self::Gemini => "https://generativelanguage.googleapis.com/v1beta/",
            Self::OpenAi => "https://api.openai.com/v1/",
        };
        Url::parse(&format!("{base}{path}"))
            .map_err(|_| ApiError::new("BAD_REQUEST", "Rute API tidak valid."))
    }
}

fn valid_model(model: &str) -> bool {
    !model.is_empty() && model.len() <= 128 && model != "." && model != ".."
        && model.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

#[derive(Debug, Serialize)]
pub struct ApiError {
    code: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
}

impl ApiError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), status: None, body: None }
    }

    fn network(error: reqwest::Error) -> Self {
        if error.is_timeout() {
            Self::new("TIMEOUT", "Waktu tunggu provider habis.")
        } else {
            Self::new("NETWORK", "Koneksi ke provider gagal.")
        }
    }
}

#[derive(Default)]
struct RequestState {
    enabled: bool,
    in_flight: HashMap<String, CancellationToken>,
}

pub struct Cloud {
    client: Client,
    state: Mutex<RequestState>,
}

impl Cloud {
    pub fn new() -> Result<Self, reqwest::Error> {
        let client = Client::builder().redirect(Policy::none()).https_only(true)
            .connect_timeout(Duration::from_secs(10)).build()?;
        Ok(Self { client, state: Mutex::new(RequestState::default()) })
    }

    pub fn set_enabled(&self, enabled: bool) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.enabled = enabled;
        if !enabled {
            for token in state.in_flight.values() {
                token.cancel();
            }
        }
    }

    pub fn cancel_all(&self) {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        for token in state.in_flight.values() {
            token.cancel();
        }
    }

    fn begin(&self, request_id: String) -> Result<InFlight<'_>, ApiError> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if !state.enabled {
            return Err(ApiError::new("CLOUD_DISABLED", "Izin cloud belum aktif untuk sesi ini."));
        }
        if request_id.is_empty() || request_id.len() > 128 {
            return Err(ApiError::new("BAD_REQUEST", "ID permintaan tidak valid."));
        }
        if state.in_flight.len() >= 4 || state.in_flight.contains_key(&request_id) {
            return Err(ApiError::new("BUSY", "Masih ada permintaan yang sedang berjalan."));
        }
        let token = CancellationToken::new();
        state.in_flight.insert(request_id.clone(), token.clone());
        Ok(InFlight { cloud: self, request_id, token })
    }

    async fn send(
        &self,
        provider: Provider,
        endpoint: Url,
        method: Method,
        body: Option<Value>,
        key: Zeroizing<String>,
        timeout: Duration,
    ) -> Result<Value, ApiError> {
        let request = self.client.request(method, endpoint).timeout(timeout);
        let request = match provider {
            Provider::Gemini => request.header("x-goog-api-key", key.as_str()),
            Provider::OpenAi => request.bearer_auth(key.as_str()),
        };
        let request = if let Some(mut body) = body {
            let object = body.as_object_mut()
                .ok_or_else(|| ApiError::new("BAD_REQUEST", "Isi permintaan API harus berupa objek JSON."))?;
            if provider == Provider::OpenAi {
                object.insert("store".to_owned(), Value::Bool(false));
            }
            let bytes = serde_json::to_vec(&body)
                .map_err(|_| ApiError::new("BAD_REQUEST", "Isi permintaan API tidak valid."))?;
            if bytes.len() > 20 * 1024 * 1024 {
                return Err(ApiError::new("BAD_REQUEST", "Permintaan terlalu besar."));
            }
            request.header(reqwest::header::CONTENT_TYPE, "application/json").body(bytes)
        } else {
            request
        };
        let mut response = request.send().await.map_err(ApiError::network)?;
        let status = response.status();
        let limit = if status.is_success() { 2 * 1024 * 1024 } else { 64 * 1024 };
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(ApiError::network)? {
            let remaining = limit - bytes.len();
            if chunk.len() > remaining {
                if status.is_success() {
                    return Err(ApiError {
                        code: "MALFORMED",
                        message: "Respons provider terlalu besar.".to_owned(),
                        status: Some(status.as_u16()),
                        body: Some(String::new()),
                    });
                }
                break;
            }
            bytes.extend_from_slice(&chunk);
        }
        if !status.is_success() {
            return Err(ApiError {
                code: "HTTP",
                message: format!("Provider mengembalikan status {}.", status.as_u16()),
                status: Some(status.as_u16()),
                body: Some(String::from_utf8_lossy(&bytes).replace(key.as_str(), "[API KEY]")),
            });
        }
        serde_json::from_slice(&bytes).map_err(|_| ApiError {
            code: "MALFORMED",
            message: "Respons provider bukan JSON.".to_owned(),
            status: Some(status.as_u16()),
            body: Some(String::from_utf8_lossy(&bytes[..bytes.len().min(4096)])
                .replace(key.as_str(), "[API KEY]")),
        })
    }
}

struct InFlight<'a> {
    cloud: &'a Cloud,
    request_id: String,
    token: CancellationToken,
}

impl Drop for InFlight<'_> {
    fn drop(&mut self) {
        let mut state = self.cloud.state.lock().unwrap_or_else(|e| e.into_inner());
        state.in_flight.remove(&self.request_id);
    }
}

#[tauri::command]
pub fn session_set_cloud(app: AppHandle, cloud: State<'_, Cloud>, enabled: bool) -> Result<(), ApiError> {
    if enabled && app.state::<Desktop>().is_background() {
        return Err(ApiError::new("CLOUD_DISABLED", "Tampilkan AURA untuk mengaktifkan cloud."));
    }
    cloud.set_enabled(enabled);
    Ok(())
}

#[tauri::command]
pub fn provider_cancel(cloud: State<'_, Cloud>, request_id: String) {
    let state = cloud.state.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(token) = state.in_flight.get(&request_id) {
        token.cancel();
    }
}

#[tauri::command]
pub async fn provider_request(
    cloud: State<'_, Cloud>,
    vault: State<'_, Vault>,
    request_id: String,
    provider: Provider,
    path: String,
    body: Option<Value>,
    method: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<Value, ApiError> {
    let method = match method.as_deref() {
        Some("GET") => Method::GET,
        Some("POST") => Method::POST,
        None if body.is_some() => Method::POST,
        None => Method::GET,
        _ => return Err(ApiError::new("BAD_REQUEST", "Metode API tidak diizinkan.")),
    };
    if body.is_some() != (method == Method::POST) {
        return Err(ApiError::new("BAD_REQUEST", "Isi permintaan tidak sesuai dengan metode API."));
    }
    let endpoint = provider.endpoint(&path, &method)?;
    let request = cloud.begin(request_id)?;
    let key = vault.key(provider)
        .map_err(|message| ApiError::new("VAULT_ERROR", message))?
        .ok_or_else(|| ApiError::new("NO_KEY", "Buka brankas dan tambahkan API key untuk provider ini."))?;
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(30_000).clamp(1000, 120_000));
    tokio::select! {
        biased;
        _ = request.token.cancelled() => Err(ApiError::new("CANCELLED", "Permintaan dibatalkan.")),
        result = cloud.send(provider, endpoint, method, body, key, timeout) => result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unlisted_hosts_and_routes() {
        assert!(Provider::OpenAi.endpoint("responses", &Method::POST).is_ok());
        assert!(Provider::OpenAi.endpoint("models/gpt-5.2", &Method::GET).is_ok());
        assert!(Provider::Gemini.endpoint("models/gemini-2.5-flash:generateContent", &Method::POST).is_ok());
        for path in ["https://example.com", "../responses", "models/..", "models/model?key=value"] {
            assert!(Provider::OpenAi.endpoint(path, &Method::POST).is_err());
            assert!(Provider::Gemini.endpoint(path, &Method::GET).is_err());
        }
    }

    #[test]
    fn starts_disabled_and_cancels_pending_requests_when_disabled() {
        let cloud = Cloud::new().unwrap();
        assert!(cloud.begin("standby".to_owned()).is_err());
        cloud.set_enabled(true);
        let pending = cloud.begin("active".to_owned()).unwrap();
        assert!(!pending.token.is_cancelled());
        cloud.set_enabled(false);
        assert!(pending.token.is_cancelled());
        assert!(cloud.begin("paused".to_owned()).is_err());
    }
}
