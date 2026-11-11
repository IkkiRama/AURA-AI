use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::PathBuf,
    sync::{Mutex, MutexGuard},
};

use argon2::{Algorithm, Argon2, Params, Version};
use serde::Serialize;
use tauri::State;
use tauri_plugin_stronghold::stronghold::Stronghold;
use zeroize::Zeroizing;

use crate::cloud::{Cloud, Provider};

const CLIENT: &[u8] = b"aura-api";
const VAULT_ERROR: &str = "Brankas lokal tidak tersedia.";

pub struct Vault {
    directory: PathBuf,
    unlocked: Mutex<Option<Stronghold>>,
}

#[derive(Serialize)]
pub struct VaultStatus {
    initialized: bool,
    unlocked: bool,
    gemini: bool,
    openai: bool,
}

impl Vault {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory, unlocked: Mutex::new(None) }
    }

    fn instance(&self) -> Result<MutexGuard<'_, Option<Stronghold>>, String> {
        self.unlocked.lock().map_err(|_| VAULT_ERROR.to_owned())
    }

    fn salt(&self, initialized: bool) -> Result<[u8; 16], String> {
        let path = self.directory.join("vault.salt");
        match fs::read(&path) {
            Ok(bytes) => bytes.try_into().map_err(|_| "Salt brankas tidak valid.".to_owned()),
            Err(err) if err.kind() == ErrorKind::NotFound && !initialized => {
                let mut salt = [0; 16];
                getrandom::fill(&mut salt).map_err(|_| VAULT_ERROR.to_owned())?;
                let mut file = OpenOptions::new().write(true).create_new(true).open(&path)
                    .map_err(|_| VAULT_ERROR.to_owned())?;
                if file.write_all(&salt).and_then(|_| file.sync_all()).is_err() {
                    drop(file);
                    let _ = fs::remove_file(path);
                    return Err(VAULT_ERROR.to_owned());
                }
                Ok(salt)
            }
            Err(_) => Err("Salt brankas tidak dapat dibaca.".to_owned()),
        }
    }

    fn unlock(&self, password: Zeroizing<String>) -> Result<(), String> {
        let mut instance = self.instance()?;
        if instance.is_some() {
            return Ok(());
        }
        if password.chars().count() < 8 || password.len() > 1024 {
            return Err("Gunakan kata sandi brankas antara 8 dan 1024 karakter.".to_owned());
        }
        let path = self.directory.join("vault.hold");
        let initialized = path.try_exists().map_err(|_| VAULT_ERROR.to_owned())?;
        let salt = self.salt(initialized)?;
        let parameters = Params::new(64 * 1024, 3, 1, Some(32))
            .map_err(|_| VAULT_ERROR.to_owned())?;
        let mut key = Zeroizing::new([0; 32]);
        Argon2::new(Algorithm::Argon2id, Version::V0x13, parameters)
            .hash_password_into(password.as_bytes(), &salt, &mut *key)
            .map_err(|_| VAULT_ERROR.to_owned())?;
        let stronghold = Stronghold::new(&path, key.to_vec())
            .map_err(|_| "Kata sandi salah atau berkas brankas tidak dapat dibaca.".to_owned())?;
        if initialized {
            stronghold.load_client(CLIENT).map_err(|_| VAULT_ERROR.to_owned())?;
        } else {
            stronghold.create_client(CLIENT).map_err(|_| VAULT_ERROR.to_owned())?;
            stronghold.save().map_err(|_| "Brankas gagal disimpan.".to_owned())?;
        }
        *instance = Some(stronghold);
        Ok(())
    }

    pub fn lock(&self) -> Result<(), String> {
        let mut instance = self.instance()?;
        if let Some(stronghold) = instance.take() {
            stronghold.clear().map_err(|_| VAULT_ERROR.to_owned())?;
        }
        Ok(())
    }

    fn status(&self) -> Result<VaultStatus, String> {
        let instance = self.instance()?;
        let initialized = self.directory.join("vault.hold").try_exists()
            .map_err(|_| VAULT_ERROR.to_owned())?;
        let Some(stronghold) = instance.as_ref() else {
            return Ok(VaultStatus { initialized, unlocked: false, gemini: false, openai: false });
        };
        let client = stronghold.get_client(CLIENT).map_err(|_| VAULT_ERROR.to_owned())?;
        let store = client.store();
        let has = |provider: Provider| {
            store.get(provider.record()).map(|record| record.map(Zeroizing::new).is_some())
                .map_err(|_| VAULT_ERROR.to_owned())
        };
        Ok(VaultStatus {
            initialized,
            unlocked: true,
            gemini: has(Provider::Gemini)?,
            openai: has(Provider::OpenAi)?,
        })
    }

    fn set(&self, provider: Provider, key: Zeroizing<String>) -> Result<(), String> {
        let key = key.trim();
        if key.len() > 1024 || key.bytes().any(|byte| !byte.is_ascii_graphic()) {
            return Err("Format API key tidak valid.".to_owned());
        }
        let instance = self.instance()?;
        let stronghold = instance.as_ref().ok_or("Buka brankas API terlebih dahulu.")?;
        let client = stronghold.get_client(CLIENT).map_err(|_| VAULT_ERROR.to_owned())?;
        let store = client.store();
        let record = provider.record();
        let previous = if key.is_empty() {
            store.delete(record)
        } else {
            store.insert(record.to_vec(), key.as_bytes().to_vec(), None)
        }.map_err(|_| VAULT_ERROR.to_owned())?.map(Zeroizing::new);

        if stronghold.save().is_err() {
            match previous {
                Some(bytes) => {
                    let _ = store.insert(record.to_vec(), bytes.to_vec(), None).map(|old| old.map(Zeroizing::new));
                }
                None => {
                    let _ = store.delete(record).map(|old| old.map(Zeroizing::new));
                }
            }
            return Err("Perubahan API key gagal disimpan.".to_owned());
        }
        Ok(())
    }

    pub fn key(&self, provider: Provider) -> Result<Option<Zeroizing<String>>, String> {
        let instance = self.instance()?;
        let Some(stronghold) = instance.as_ref() else {
            return Ok(None);
        };
        let client = stronghold.get_client(CLIENT).map_err(|_| VAULT_ERROR.to_owned())?;
        client.store().get(provider.record()).map_err(|_| VAULT_ERROR.to_owned())?
            .map(|value| {
                let value = Zeroizing::new(value);
                std::str::from_utf8(&value)
                    .map(|text| Zeroizing::new(text.to_owned()))
                    .map_err(|_| VAULT_ERROR.to_owned())
            })
            .transpose()
    }
}

#[tauri::command]
pub async fn vault_unlock(vault: State<'_, Vault>, password: String) -> Result<(), String> {
    vault.unlock(Zeroizing::new(password))
}

#[tauri::command]
pub async fn vault_status(vault: State<'_, Vault>) -> Result<VaultStatus, String> {
    vault.status()
}

#[tauri::command]
pub async fn vault_set(vault: State<'_, Vault>, provider: Provider, key: String) -> Result<(), String> {
    vault.set(provider, Zeroizing::new(key))
}

#[tauri::command]
pub fn vault_lock(vault: State<'_, Vault>, cloud: State<'_, Cloud>) -> Result<(), String> {
    cloud.cancel_all();
    vault.lock()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
            let path = std::env::temp_dir().join(format!("aura-vault-test-{}-{unique}", std::process::id()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn saves_locks_reopens_and_deletes_provider_keys() {
        let directory = TestDirectory::new();
        let vault = Vault::new(directory.0.clone());
        let password = || Zeroizing::new("local-test-passphrase".to_owned());
        assert!(!vault.status().unwrap().initialized);
        assert!(vault.unlock(Zeroizing::new("short".to_owned())).is_err());
        vault.unlock(password()).unwrap();
        vault.set(Provider::Gemini, Zeroizing::new("test-gemini-key".to_owned())).unwrap();
        vault.set(Provider::OpenAi, Zeroizing::new("test-openai-key".to_owned())).unwrap();
        assert!(vault.status().unwrap().gemini);
        assert!(vault.status().unwrap().openai);
        vault.lock().unwrap();
        assert!(!vault.status().unwrap().unlocked);
        assert!(vault.key(Provider::Gemini).unwrap().is_none());
        assert!(vault.unlock(Zeroizing::new("incorrect-password".to_owned())).is_err());

        let reopened = Vault::new(directory.0.clone());
        reopened.unlock(password()).unwrap();
        assert_eq!(reopened.key(Provider::Gemini).unwrap().unwrap().as_str(), "test-gemini-key");
        assert_eq!(reopened.key(Provider::OpenAi).unwrap().unwrap().as_str(), "test-openai-key");
        reopened.set(Provider::Gemini, Zeroizing::new(String::new())).unwrap();
        assert!(!reopened.status().unwrap().gemini);
        assert!(reopened.status().unwrap().openai);
        reopened.lock().unwrap();
        reopened.unlock(password()).unwrap();
        assert!(reopened.key(Provider::Gemini).unwrap().is_none());
        reopened.lock().unwrap();
    }
}
