use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    path::Path,
    sync::{Mutex, MutexGuard},
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

pub struct Database(Mutex<Connection>);

const SCHEMA: &str = "
    PRAGMA temp_store = MEMORY;
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS workspace (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS document_index_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        fingerprint TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS document_search USING fts5(
        document_id UNINDEXED, title, text, tokenize = 'unicode61'
    );
    INSERT INTO document_search(document_search, rank) VALUES ('secure-delete', 1);
    CREATE VIRTUAL TABLE temp.turn_search USING fts5(
        session_id UNINDEXED, turn_id UNINDEXED, sequence UNINDEXED,
        speaker, text, turn_json UNINDEXED, tokenize = 'unicode61'
    );
";

impl Database {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        Self::initialize(Connection::open(path)?)
    }

    fn initialize(connection: Connection) -> rusqlite::Result<Self> {
        connection.execute_batch(SCHEMA)?;
        Ok(Self(Mutex::new(connection)))
    }

    fn connection(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.0.lock().map_err(|_| "Penyimpanan lokal tidak tersedia.".to_owned())
    }

    fn index_turn(&self, session_id: &str, turn: &Value) -> Result<(), String> {
        let id = turn.get("id").and_then(Value::as_i64).ok_or("ID giliran tidak valid.")?;
        let seq = turn.get("seq").and_then(Value::as_i64).ok_or("Urutan giliran tidak valid.")?;
        let speaker = turn.get("speaker").and_then(Value::as_str).ok_or("Pembicara tidak valid.")?;
        let text = turn.get("text").and_then(Value::as_str).ok_or("Teks giliran tidak valid.")?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(db_error)?;
        transaction.execute(
            "DELETE FROM turn_search WHERE session_id = ?1 AND turn_id = ?2",
            params![session_id, id],
        ).map_err(db_error)?;
        transaction.execute(
            "INSERT INTO turn_search (session_id, turn_id, sequence, speaker, text, turn_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![session_id, id, seq, speaker, text, turn.to_string()],
        ).map_err(db_error)?;
        transaction.commit().map_err(db_error)
    }

    fn search_turns(&self, session_id: &str, query: &str, limit: u32) -> Result<Vec<Value>, String> {
        let Some(query) = match_expression(query) else {
            return Ok(Vec::new());
        };
        let connection = self.connection()?;
        let mut statement = connection.prepare_cached(
            "SELECT turn_json FROM turn_search
             WHERE turn_search MATCH ?1 AND session_id = ?2
             ORDER BY bm25(turn_search), sequence DESC LIMIT ?3",
        ).map_err(db_error)?;
        let rows = statement.query_map(params![query, session_id, limit.min(30)], |row| row.get::<_, String>(0))
            .map_err(db_error)?;
        rows.map(|row| parse_json(&row.map_err(db_error)?)).collect()
    }

    fn upsert_document(&self, document: Document) -> Result<(), String> {
        if document.content.len() > 2 * 1024 * 1024 {
            return Err("Catatan melebihi batas 2 MB.".to_owned());
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(db_error)?;
        let mut data = workspace_data(&transaction)?.unwrap_or_else(|| serde_json::json!({}));
        let documents = data.as_object_mut().ok_or("Data ruang kerja tidak valid.")?
            .entry("documents").or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut().ok_or("Daftar dokumen lokal tidak valid.")?;
        let value = serde_json::to_value(&document).map_err(|_| "Dokumen tidak dapat disimpan.")?;
        if let Some(existing) = documents.iter_mut().find(|item| item.get("id").and_then(Value::as_str) == Some(document.id.as_str())) {
            *existing = value;
        } else {
            documents.insert(0, value);
        }
        synchronize_documents(&transaction, &data)?;
        write_workspace(&transaction, &data)?;
        transaction.commit().map_err(db_error)
    }

    fn delete_document(&self, id: &str) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(db_error)?;
        let mut data = workspace_data(&transaction)?.unwrap_or_else(|| serde_json::json!({}));
        let documents = data.as_object_mut().ok_or("Data ruang kerja tidak valid.")?
            .entry("documents").or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut().ok_or("Daftar dokumen lokal tidak valid.")?;
        documents.retain(|item| item.get("id").and_then(Value::as_str) != Some(id));
        synchronize_documents(&transaction, &data)?;
        write_workspace(&transaction, &data)?;
        transaction.commit().map_err(db_error)
    }

    fn search_documents(&self, query: &str, limit: u32) -> Result<Vec<DocumentHit>, String> {
        let Some(query) = match_expression(query) else {
            return Ok(Vec::new());
        };
        let connection = self.connection()?;
        let mut statement = connection.prepare_cached(
            "SELECT document_id, title, text FROM document_search
             WHERE document_search MATCH ?1
             ORDER BY bm25(document_search, 0.0, 0.25, 1.0), rowid LIMIT ?2",
        ).map_err(db_error)?;
        let rows = statement.query_map(params![query, limit.min(30)], |row| {
            Ok(DocumentHit { id: row.get(0)?, title: row.get(1)?, text: row.get(2)? })
        }).map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }
}

#[derive(Deserialize, Serialize)]
pub struct Document {
    id: String,
    name: String,
    content: String,
    #[serde(default, rename = "updatedAt", skip_serializing_if = "Option::is_none")]
    updated_at: Option<String>,
}

#[derive(Serialize)]
pub struct DocumentHit {
    id: String,
    title: String,
    text: String,
}

fn db_error(_: rusqlite::Error) -> String {
    "Operasi penyimpanan SQLite gagal.".to_owned()
}

fn parse_json(text: &str) -> Result<Value, String> {
    serde_json::from_str(text).map_err(|_| "Data lokal tidak dapat dibaca.".to_owned())
}

fn workspace_data(connection: &Connection) -> Result<Option<Value>, String> {
    let data: Option<String> = connection.query_row(
        "SELECT data FROM workspace WHERE id = 1", [], |row| row.get(0),
    ).optional().map_err(db_error)?;
    data.as_deref().map(parse_json).transpose()
}

fn write_workspace(connection: &Connection, data: &Value) -> Result<(), String> {
    connection.execute(
        "INSERT INTO workspace (id, data) VALUES (1, ?1)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data", [data.to_string()],
    ).map_err(db_error)?;
    Ok(())
}

fn save_preferences(connection: &Connection, mut data: Value) -> Result<(), String> {
    let object = data.as_object_mut().ok_or("Data ruang kerja tidak valid.")?;
    if let Some(documents) = workspace_data(connection)?.and_then(|saved| saved.get("documents").cloned()) {
        object.insert("documents".to_owned(), documents);
    }
    synchronize_documents(connection, &data)?;
    write_workspace(connection, &data)
}

// The workspace document list is canonical. Reconcile the derived index in the
// same transaction as saving it, and recover interrupted imports when loading.
fn synchronize_documents(connection: &Connection, data: &Value) -> Result<(), String> {
    let documents = data.get("documents").cloned().unwrap_or_else(|| Value::Array(Vec::new()));
    let encoded = documents.to_string();
    let mut hasher = DefaultHasher::new();
    encoded.hash(&mut hasher);
    let fingerprint = format!("v1-{:016x}", hasher.finish());
    let current: Option<String> = connection.query_row(
        "SELECT fingerprint FROM document_index_state WHERE id = 1", [], |row| row.get(0),
    ).optional().map_err(db_error)?;
    if current.as_deref() == Some(fingerprint.as_str()) {
        return Ok(());
    }
    let documents: Vec<Document> = serde_json::from_value(documents)
        .map_err(|_| "Daftar dokumen lokal tidak valid.".to_owned())?;
    connection.execute("DELETE FROM document_search", []).map_err(db_error)?;
    let mut insert = connection.prepare_cached(
        "INSERT INTO document_search (document_id, title, text) VALUES (?1, ?2, ?3)",
    ).map_err(db_error)?;
    for document in documents {
        if document.content.len() > 2 * 1024 * 1024 {
            return Err("Catatan melebihi batas 2 MB.".to_owned());
        }
        for chunk in split_document(&document.content) {
            insert.execute(params![&document.id, &document.name, chunk]).map_err(db_error)?;
        }
    }
    connection.execute(
        "INSERT INTO document_index_state (id, fingerprint) VALUES (1, ?1)
         ON CONFLICT(id) DO UPDATE SET fingerprint = excluded.fingerprint", [fingerprint],
    ).map_err(db_error)?;
    Ok(())
}

fn match_expression(query: &str) -> Option<String> {
    let terms = query.split(" OR ").map(|part| {
        part.strip_prefix('"')?.strip_suffix("\"*")
    }).collect::<Option<Vec<_>>>();
    let terms = terms.unwrap_or_else(|| query.split(|c: char| !c.is_alphanumeric()).collect());
    let terms: Vec<_> = terms.into_iter()
        .filter(|term| term.chars().take(3).count() == 3 && term.chars().all(char::is_alphanumeric))
        .take(12)
        .map(|term| format!("\"{}\"*", term.chars().take(80).collect::<String>()))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" OR "))
}

fn split_document(text: &str) -> Vec<String> {
    const MAX_CHARS: usize = 800;
    const OVERLAP: usize = 120;
    const SEARCH_BOUNDARY: usize = 150;

    let chars: Vec<_> = text.trim().chars().collect();
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < chars.len() {
        let mut end = (start + MAX_CHARS).min(chars.len());
        if end < chars.len() {
            let boundary = end - SEARCH_BOUNDARY;
            if let Some(offset) = chars[boundary..end].iter().rposition(|c| c.is_whitespace()) {
                end = boundary + offset + 1;
            }
        }
        let chunk: String = chars[start..end].iter().collect();
        let chunk = chunk.trim();
        if !chunk.is_empty() {
            chunks.push(chunk.to_owned());
        }
        if end == chars.len() {
            break;
        }
        start = end - OVERLAP;
        while start < end && !chars[start].is_whitespace() {
            start += 1;
        }
    }
    chunks
}

#[tauri::command]
pub fn db_load(db: State<'_, Database>) -> Result<Option<Value>, String> {
    let mut connection = db.connection()?;
    let transaction = connection.transaction().map_err(db_error)?;
    let data = workspace_data(&transaction)?;
    if let Some(data) = &data {
        synchronize_documents(&transaction, data)?;
    } else {
        synchronize_documents(&transaction, &Value::Null)?;
    }
    transaction.commit().map_err(db_error)?;
    Ok(data)
}

#[tauri::command]
pub fn db_save(db: State<'_, Database>, data: Value) -> Result<(), String> {
    let mut connection = db.connection()?;
    let transaction = connection.transaction().map_err(db_error)?;
    save_preferences(&transaction, data)?;
    transaction.commit().map_err(db_error)
}

#[tauri::command]
pub fn db_index_turn(db: State<'_, Database>, session_id: String, turn: Value) -> Result<(), String> {
    db.index_turn(&session_id, &turn)
}

#[tauri::command]
pub fn db_clear_turns(db: State<'_, Database>, session_id: String) -> Result<(), String> {
    db.connection()?.execute("DELETE FROM turn_search WHERE session_id = ?1", [session_id])
        .map_err(db_error)?;
    Ok(())
}

#[tauri::command]
pub fn db_search_turns(db: State<'_, Database>, session_id: String, query: String, limit: u32) -> Result<Vec<Value>, String> {
    db.search_turns(&session_id, &query, limit)
}

#[tauri::command]
pub fn db_upsert_document(db: State<'_, Database>, document: Document) -> Result<(), String> {
    db.upsert_document(document)
}

#[tauri::command]
pub fn db_delete_document(db: State<'_, Database>, id: String) -> Result<(), String> {
    db.delete_document(&id)
}

#[tauri::command]
pub fn db_search_documents(db: State<'_, Database>, query: String, limit: u32) -> Result<Vec<DocumentHit>, String> {
    db.search_documents(&query, limit)
}

#[tauri::command]
pub fn db_clear(db: State<'_, Database>) -> Result<(), String> {
    let mut connection = db.connection()?;
    let transaction = connection.transaction().map_err(db_error)?;
    transaction.execute("DELETE FROM workspace", []).map_err(db_error)?;
    transaction.execute("DELETE FROM document_search", []).map_err(db_error)?;
    transaction.execute("DELETE FROM document_index_state", []).map_err(db_error)?;
    transaction.execute("DELETE FROM turn_search", []).map_err(db_error)?;
    transaction.commit().map_err(db_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn searches_old_turns_and_keeps_sessions_separate() {
        let db = Database::initialize(Connection::open_in_memory().unwrap()).unwrap();
        for seq in 1..=40 {
            let text = if seq == 3 { "Pengiriman hemat anggaran" } else { "Lanjutkan pembahasan" };
            let turn = json!({ "id": seq, "seq": seq, "speaker": "Unknown", "text": text });
            db.index_turn("active", &turn).unwrap();
        }
        db.index_turn("other", &json!({
            "id": 41, "seq": 41, "speaker": "Unknown", "text": "Pengiriman ditunda"
        })).unwrap();

        let hits = db.search_turns("active", "\"pengirim\"* OR \"anggaran\"*", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0]["id"].as_u64(), Some(3));
    }

    #[test]
    fn updates_and_deletes_document_chunks() {
        let db = Database::initialize(Connection::open_in_memory().unwrap()).unwrap();
        let document = |text: &str| Document {
            id: "catatan".to_owned(),
            name: "catatan.md".to_owned(),
            content: format!("{} {text}", "kata ".repeat(500)),
            updated_at: None,
        };
        db.upsert_document(document("rekonsiliasi")).unwrap();
        let hits = db.search_documents("\"rekonsiliasi\"*", 5).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "catatan.md");
        assert!(hits[0].text.contains("rekonsiliasi"));

        db.upsert_document(document("pembukuan")).unwrap();
        assert!(db.search_documents("rekonsiliasi", 5).unwrap().is_empty());
        assert_eq!(db.search_documents("pembukuan", 5).unwrap().len(), 1);
        db.delete_document("catatan").unwrap();
        assert!(db.search_documents("pembukuan", 5).unwrap().is_empty());
    }

    #[test]
    fn document_commits_survive_stale_preferences_and_failed_updates() {
        let db = Database::initialize(Connection::open_in_memory().unwrap()).unwrap();
        let saved = json!({"documents": [{
            "id": "catatan", "name": "catatan.txt", "content": "Fakta terverifikasi rekonsiliasi"
        }]});
        {
            let mut connection = db.connection().unwrap();
            let transaction = connection.transaction().unwrap();
            save_preferences(&transaction, saved.clone()).unwrap();
            transaction.commit().unwrap();
        }
        db.upsert_document(Document {
            id: "catatan".to_owned(), name: "catatan.txt".to_owned(), content: "Perubahan tersimpan atomik".to_owned(),
            updated_at: Some("2026-11-11T00:00:00Z".to_owned()),
        }).unwrap();
        assert_eq!(db.search_documents("perubahan", 5).unwrap().len(), 1);
        {
            let mut connection = db.connection().unwrap();
            let transaction = connection.transaction().unwrap();
            save_preferences(&transaction, saved).unwrap();
            transaction.commit().unwrap();
            let persisted = workspace_data(&connection).unwrap().unwrap();
            assert_eq!(persisted["documents"][0]["updatedAt"], "2026-11-11T00:00:00Z");
        }
        assert_eq!(db.search_documents("perubahan", 5).unwrap().len(), 1);
        assert!(db.search_documents("rekonsiliasi", 5).unwrap().is_empty());

        let invalid = json!({"documents": [{
            "id": "oversized", "name": "invalid.txt", "content": "x".repeat(2 * 1024 * 1024 + 1)
        }]});
        {
            let mut connection = db.connection().unwrap();
            let transaction = connection.transaction().unwrap();
            assert!(synchronize_documents(&transaction, &invalid).is_err());
        }
        assert_eq!(db.search_documents("perubahan", 5).unwrap().len(), 1);
        db.delete_document("catatan").unwrap();
        let connection = db.connection().unwrap();
        let persisted = workspace_data(&connection).unwrap().unwrap();
        assert_eq!(persisted["documents"].as_array().unwrap().len(), 0);
    }
}
