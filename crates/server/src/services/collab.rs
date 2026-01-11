// Real-time collaboration service using yrs (Yjs Rust)
// TODO: Implement full collaboration in future version

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::RwLock;
use yrs::{Doc, GetString, Transact};

#[allow(dead_code)]
pub struct CollabService {
    documents: Arc<RwLock<HashMap<String, Arc<Doc>>>>,
}

#[allow(dead_code)]
impl CollabService {
    pub fn new() -> Self {
        Self {
            documents: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn get_or_create_doc(&self, project_id: &str, file_path: &str) -> Arc<Doc> {
        let key = format!("{project_id}:{file_path}");

        {
            let docs = self.documents.read().await;
            if let Some(doc) = docs.get(&key) {
                return Arc::clone(doc);
            }
        }

        let mut docs = self.documents.write().await;
        let doc = Arc::new(Doc::new());
        docs.insert(key, Arc::clone(&doc));
        doc
    }

    pub async fn get_text(&self, project_id: &str, file_path: &str) -> String {
        let doc = self.get_or_create_doc(project_id, file_path).await;
        let text = doc.get_or_insert_text("content");
        let result = text.get_string(&doc.transact());
        result
    }

    pub async fn remove_doc(&self, project_id: &str, file_path: &str) {
        let key = format!("{project_id}:{file_path}");
        let mut docs = self.documents.write().await;
        docs.remove(&key);
    }
}

impl Default for CollabService {
    fn default() -> Self {
        Self::new()
    }
}
