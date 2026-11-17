use std::{
    fs::{self, File, Metadata, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{Arc, Mutex, MutexGuard},
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::os::windows::{fs::{MetadataExt, OpenOptionsExt}, process::CommandExt};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State, WebviewWindow, ipc::{InvokeBody, Request}};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

const ENGINE_VERSION: &str = "whisper-v1.8.3";
const EXECUTABLE: &str = "whisper-cli.exe";
const MODEL: &str = "ggml-base-q5_1.bin";
const SAMPLE_RATE: u32 = 16_000;
const PCM_BYTES_PER_SECOND: usize = SAMPLE_RATE as usize * 2;
const PCM_MIN: usize = PCM_BYTES_PER_SECOND / 2;
const PCM_MAX: usize = PCM_BYTES_PER_SECOND * 12;
const TRANSCRIPT_MAX: usize = 16 * 1024;
const DEADLINE: Duration = Duration::from_secs(22);
const POLL: Duration = Duration::from_millis(25);
const INACTIVE: &str = "Aktifkan mikrofon di panel jawaban dalam sesi aktif.";
const STOPPED: &str = "Transkripsi lokal dihentikan.";
const BUSY: &str = "Transkripsi lokal masih memproses cuplikan sebelumnya.";
const ASSETS_ERROR: &str = "Berkas Whisper lokal belum lengkap atau tidak lolos verifikasi.";
const ENGINE_ERROR: &str = "Mesin Whisper lokal tidak dapat memproses audio.";

// Official whisper-bin-x64.zip v1.8.3 CPU release and multilingual base-q5_1.
const ASSETS: [(&str, u64, &str); 6] = [
    (EXECUTABLE, 480768, "0ff971e410240a0b97117432d771245698f376e06105c011959d2bfc4bb23311"),
    ("ggml.dll", 67584, "bcfeaf6e5b59c315fc36e290715aa7a84b22461e968543c13dfcf57df7b1b81d"),
    ("ggml-base.dll", 536064, "61c9c57f49f380896ed54ed3f71735e10a2d986f482c2b0a55e72b47f731b193"),
    ("ggml-cpu.dll", 683008, "eb2f1d023e51c40b27463b5ab165600eb48cb60323740f400b1b62e1c8706c56"),
    ("whisper.dll", 483840, "4037a6567fbb08fc7efda18e4d128a95df9c31ba171af20439d1a93b785d007e"),
    (MODEL, 59707625, "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898"),
];

struct Engine {
    directory: PathBuf,
    // Windows handles share reads with the CLI but deny modification/replacement while active.
    _verified_files: Vec<File>,
}

struct Lease {
    engine: Engine,
    token: CancellationToken,
}

#[derive(Default)]
struct Gate {
    allowed: bool,
    epoch: u64,
    lease: Option<Arc<Lease>>,
    busy: bool,
}

#[derive(Default)]
pub struct Speech {
    gate: Arc<Mutex<Gate>>,
}

fn lock(gate: &Mutex<Gate>) -> MutexGuard<'_, Gate> {
    gate.lock().unwrap_or_else(|error| error.into_inner())
}

fn revoke(gate: &mut Gate) {
    gate.epoch = gate.epoch.wrapping_add(1);
    if let Some(lease) = gate.lease.take() {
        lease.token.cancel();
    }
}

impl Speech {
    pub fn cancel(&self) {
        revoke(&mut lock(&self.gate));
    }

    pub fn is_active(&self) -> bool {
        lock(&self.gate).lease.is_some()
    }

    pub fn is_idle_for_update(&self) -> bool {
        let gate = lock(&self.gate);
        gate.lease.is_none() && !gate.busy
    }

    pub fn permit(&self, allowed: bool) {
        let mut gate = lock(&self.gate);
        gate.allowed = allowed;
        if !allowed {
            revoke(&mut gate);
        }
    }

    fn activation_epoch(&self) -> Result<u64, String> {
        let gate = lock(&self.gate);
        gate.allowed.then_some(gate.epoch).ok_or_else(|| INACTIVE.into())
    }

    fn open_lease(&self, epoch: u64, engine: Engine) -> Result<(), String> {
        let mut gate = lock(&self.gate);
        if !gate.allowed || gate.epoch != epoch {
            return Err(STOPPED.into());
        }
        revoke(&mut gate);
        gate.lease = Some(Arc::new(Lease { engine, token: CancellationToken::new() }));
        Ok(())
    }

    fn begin(&self) -> Result<Work, String> {
        let mut gate = lock(&self.gate);
        let lease = gate.lease.clone().ok_or_else(|| INACTIVE.to_owned())?;
        if gate.busy {
            return Err(BUSY.into());
        }
        gate.busy = true;
        Ok(Work { gate: Arc::clone(&self.gate), lease })
    }
}

struct Work {
    gate: Arc<Mutex<Gate>>,
    lease: Arc<Lease>,
}

impl Drop for Work {
    fn drop(&mut self) {
        lock(&self.gate).busy = false;
    }
}

fn check_window(window: &WebviewWindow, allowed: &[&str]) -> Result<(), String> {
    allowed.contains(&window.label()).then_some(()).ok_or_else(|| INACTIVE.into())
}

fn engine_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_local_data_dir().map(|path| path.join("speech").join(ENGINE_VERSION))
        .map_err(|_| ASSETS_ERROR.into())
}

fn plain_metadata(path: &Path) -> io::Result<Metadata> {
    let metadata = fs::symlink_metadata(path)?;
    #[cfg(windows)]
    let reparse = metadata.file_attributes() & 0x400 != 0;
    #[cfg(not(windows))]
    let reparse = metadata.file_type().is_symlink();
    if reparse {
        return Err(io::ErrorKind::InvalidData.into());
    }
    Ok(metadata)
}

fn check_layout(directory: &Path) -> io::Result<()> {
    let parent = directory.parent().ok_or(io::ErrorKind::InvalidInput)?;
    if !plain_metadata(parent)?.is_dir() || !plain_metadata(directory)?.is_dir() {
        return Err(io::ErrorKind::InvalidData.into());
    }
    for entry in fs::read_dir(directory)? {
        let name = entry?.file_name().to_string_lossy().to_ascii_lowercase();
        let dll_or_sidecar = name.ends_with(".dll") || name.ends_with(".local") || name.ends_with(".manifest");
        if dll_or_sidecar && !ASSETS.iter().any(|(expected, _, _)| *expected == name) {
            return Err(io::ErrorKind::InvalidData.into());
        }
    }
    for (name, bytes, _) in ASSETS {
        let metadata = plain_metadata(&directory.join(name))?;
        if !metadata.is_file() || metadata.len() != bytes {
            return Err(io::ErrorKind::InvalidData.into());
        }
    }
    Ok(())
}

fn verified_engine(directory: PathBuf) -> io::Result<Engine> {
    check_layout(&directory)?;
    let mut verified_files = Vec::with_capacity(ASSETS.len());
    for (name, size, expected) in ASSETS {
        let path = directory.join(name);
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(windows)]
        options.share_mode(1);
        let file = options.open(path)?;
        if file.metadata()?.len() != size {
            return Err(io::ErrorKind::InvalidData.into());
        }
        let mut hasher = Sha256::new();
        if io::copy(&mut (&file).take(size), &mut hasher)? != size || format!("{:x}", hasher.finalize()) != expected {
            return Err(io::ErrorKind::InvalidData.into());
        }
        verified_files.push(file);
    }
    Ok(Engine { directory, _verified_files: verified_files })
}

#[tauri::command]
pub fn speech_permit(window: WebviewWindow, speech: State<'_, Speech>, allowed: bool) -> Result<(), String> {
    check_window(&window, &["main"])?;
    speech.permit(allowed);
    Ok(())
}

#[tauri::command]
pub fn speech_engine_ready(window: WebviewWindow, app: AppHandle) -> Result<bool, String> {
    check_window(&window, &["main", "answer"])?;
    Ok(check_layout(&engine_path(&app)?).is_ok())
}

#[tauri::command]
pub async fn speech_activate(window: WebviewWindow, app: AppHandle, speech: State<'_, Speech>) -> Result<(), String> {
    check_window(&window, &["answer"])?;
    let epoch = speech.activation_epoch()?;
    let directory = engine_path(&app)?;
    let engine = tauri::async_runtime::spawn_blocking(move || verified_engine(directory)).await
        .map_err(|_| ASSETS_ERROR)?.map_err(|_| ASSETS_ERROR)?;
    speech.open_lease(epoch, engine)
}

#[tauri::command]
pub fn speech_stop(window: WebviewWindow, speech: State<'_, Speech>) -> Result<(), String> {
    check_window(&window, &["main", "answer"])?;
    speech.cancel();
    Ok(())
}

fn make_wav(pcm: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    if !(PCM_MIN..=PCM_MAX).contains(&pcm.len()) || !pcm.len().is_multiple_of(2) {
        return Err("Cuplikan mikrofon harus berupa PCM mono 16 kHz sepanjang 0,5–12 detik.".into());
    }
    let size = pcm.len() as u32;
    let mut wav = Zeroizing::new(Vec::with_capacity(44 + pcm.len()));
    wav.extend(b"RIFF");
    wav.extend((size + 36).to_le_bytes());
    wav.extend(b"WAVEfmt ");
    wav.extend(16u32.to_le_bytes());
    wav.extend(1u16.to_le_bytes()); // PCM format
    wav.extend(1u16.to_le_bytes()); // mono
    wav.extend(SAMPLE_RATE.to_le_bytes());
    wav.extend((SAMPLE_RATE * 2).to_le_bytes());
    wav.extend(2u16.to_le_bytes());
    wav.extend(16u16.to_le_bytes());
    wav.extend(b"data");
    wav.extend(size.to_le_bytes());
    wav.extend(pcm);
    Ok(wav)
}

fn wait_for(child: &mut Child, token: &CancellationToken, timeout: Duration) -> Result<ExitStatus, String> {
    let start = Instant::now();
    loop {
        if token.is_cancelled() {
            return Err(STOPPED.into());
        }
        if let Some(status) = child.try_wait().map_err(|_| ENGINE_ERROR)? {
            return Ok(status);
        }
        if start.elapsed() >= timeout {
            return Err("Waktu transkripsi lokal habis.".into());
        }
        thread::sleep(POLL);
    }
}

fn run_engine(lease: &Lease, wav: Zeroizing<Vec<u8>>, language: &str) -> Result<String, String> {
    if lease.token.is_cancelled() {
        return Err(STOPPED.into());
    }
    let directory = &lease.engine.directory;
    // An explicit executable and model plus a cleared environment keep lookup limited.
    let mut command = Command::new(directory.join(EXECUTABLE));
    command.current_dir(directory).env_clear();
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = command.args(["-f", "-", "-m"]).arg(directory.join(MODEL))
        // With stdin input, the default output name is "-". A different name
        // keeps the normal stdout callback without selecting any file output.
        .args(["-np", "-nt", "-ng", "-bs", "1", "-bo", "1", "-nf", "-sns", "-l", language, "-of", "aura-no-output-file"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()
        .map_err(|_| ENGINE_ERROR)?;
    let (Some(mut stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(ENGINE_ERROR.into());
    };

    thread::scope(|scope| {
        // Pipe writes can block when inference dies before reading. The coordinator
        // keeps ownership of the child so cancellation can close both pipes.
        let writer = scope.spawn(move || stdin.write_all(&wav));
        let reader = scope.spawn(move || {
            let mut output = Zeroizing::new(Vec::new());
            stdout.take(TRANSCRIPT_MAX as u64 + 1).read_to_end(&mut output)?;
            Ok::<_, io::Error>(output)
        });
        let status = wait_for(&mut child, &lease.token, DEADLINE);
        if status.is_err() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let status = status?;
        if !status.success() || lease.token.is_cancelled() {
            return Err(if lease.token.is_cancelled() { STOPPED } else { ENGINE_ERROR }.into());
        }
        writer.join().map_err(|_| ENGINE_ERROR)?.map_err(|_| ENGINE_ERROR)?;
        let output = reader.join().map_err(|_| ENGINE_ERROR)?.map_err(|_| ENGINE_ERROR)?;
        if output.len() > TRANSCRIPT_MAX {
            return Err(ENGINE_ERROR.into());
        }
        let transcript = std::str::from_utf8(&output).map_err(|_| ENGINE_ERROR)?.trim();
        if transcript.starts_with('[') && transcript.ends_with(']') && !transcript.contains('\n') {
            Ok(String::new())
        } else {
            Ok(transcript.split_whitespace().collect::<Vec<_>>().join(" "))
        }
    })
}

#[tauri::command]
pub async fn speech_transcribe(window: WebviewWindow, speech: State<'_, Speech>, request: Request<'_>) -> Result<String, String> {
    check_window(&window, &["answer"])?;
    let language = match request.headers().get("x-aura-speech-language").and_then(|header| header.to_str().ok()) {
        Some("id") => "id",
        Some("en") => "en",
        _ => return Err("Bahasa transkripsi lokal tidak didukung.".into()),
    };
    let InvokeBody::Raw(pcm) = request.body() else {
        return Err("Badan permintaan mikrofon harus berupa audio biner.".into());
    };
    let work = speech.begin()?;
    let wav = make_wav(pcm)?;
    tauri::async_runtime::spawn_blocking(move || {
        let transcript = run_engine(&work.lease, wav, language)?;
        if work.lease.token.is_cancelled() { Err(STOPPED.into()) } else { Ok(transcript) }
    }).await.map_err(|_| ENGINE_ERROR)?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_engine() -> Engine {
        Engine { directory: PathBuf::new(), _verified_files: Vec::new() }
    }

    #[test]
    fn makes_pcm16_mono_wav_and_rejects_invalid_lengths() {
        let pcm = vec![0x28; PCM_MIN];
        let wav = make_wav(&pcm).unwrap();
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(&wav[8..16], b"WAVEfmt ");
        assert_eq!(&wav[20..28], &[1, 0, 1, 0, 0x80, 0x3e, 0, 0]);
        assert_eq!(&wav[36..40], b"data");
        assert_eq!(&wav[44..], pcm);
        assert!(make_wav(&vec![0; PCM_MIN - 2]).is_err());
        assert!(make_wav(&vec![0; PCM_MIN + 1]).is_err());
        assert!(make_wav(&vec![0; PCM_MAX + 2]).is_err());
    }

    #[test]
    fn cancellation_revokes_pending_and_active_leases_and_waits_for_the_worker() {
        let speech = Speech::default();
        assert!(speech.is_idle_for_update());
        assert!(speech.activation_epoch().is_err());
        speech.permit(true);
        let pending = speech.activation_epoch().unwrap();
        speech.permit(false);
        speech.permit(true);
        assert!(speech.open_lease(pending, fixture_engine()).is_err());
        speech.open_lease(speech.activation_epoch().unwrap(), fixture_engine()).unwrap();
        assert!(speech.is_active());
        let work = speech.begin().unwrap();
        assert!(speech.begin().is_err());
        speech.cancel();
        assert!(work.lease.token.is_cancelled());
        assert!(!speech.is_active());
        assert!(!speech.is_idle_for_update());
        drop(work);
        assert!(speech.is_idle_for_update());
        assert!(speech.begin().is_err());
    }
}
