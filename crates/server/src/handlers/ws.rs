// WebSocket handler for real-time collaboration
// Using a simple message relay approach

use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    response::Response,
};
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::{broadcast, RwLock};

use crate::AppState;

// Room state for broadcasting messages
pub struct RoomState {
    pub broadcast: broadcast::Sender<Vec<u8>>,
}

impl RoomState {
    pub fn new() -> Self {
        let (broadcast, _) = broadcast::channel(256);
        Self { broadcast }
    }
}

impl Default for RoomState {
    fn default() -> Self {
        Self::new()
    }
}

// Global room registry - keyed by "project_id:file_path"
pub type DocumentRegistry = Arc<RwLock<HashMap<String, Arc<RoomState>>>>;

pub fn create_document_registry() -> DocumentRegistry {
    Arc::new(RwLock::new(HashMap::new()))
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct WsQuery {
    pub token: Option<String>,
    pub project_id: String,
    pub file_path: String,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<WsQuery>,
    State(state): State<AppState>,
) -> Response {
    let doc_key = format!("{}:{}", query.project_id, query.file_path);
    ws.on_upgrade(move |socket| handle_socket(socket, doc_key, state))
}

async fn handle_socket(socket: WebSocket, doc_key: String, state: AppState) {
    let (sender, mut receiver) = socket.split();

    // Get or create room
    let room = {
        let mut registry = state.docs.write().await;
        if !registry.contains_key(&doc_key) {
            registry.insert(doc_key.clone(), Arc::new(RoomState::new()));
        }
        registry.get(&doc_key).unwrap().clone()
    };

    // Subscribe to room broadcasts
    let mut broadcast_rx = room.broadcast.subscribe();

    // Sender wrapped in Arc<Mutex> for sharing
    let sender = Arc::new(tokio::sync::Mutex::new(sender));
    let sender_clone = sender.clone();
    let room_clone = room.clone();

    // Task to forward broadcast messages to this client
    let broadcast_task = tokio::spawn(async move {
        while let Ok(data) = broadcast_rx.recv().await {
            let mut sender = sender_clone.lock().await;
            if sender.send(Message::Binary(data)).await.is_err() {
                break;
            }
        }
    });

    // Process incoming messages and broadcast to room
    while let Some(Ok(msg)) = receiver.next().await {
        match msg {
            Message::Binary(data) => {
                // Broadcast to all other clients in the room
                let _ = room_clone.broadcast.send(data);
            }
            Message::Text(text) => {
                // Also support text messages (JSON)
                let _ = room_clone.broadcast.send(text.into_bytes());
            }
            Message::Close(_) => break,
            Message::Ping(data) => {
                let mut sender = sender.lock().await;
                let _ = sender.send(Message::Pong(data)).await;
            }
            _ => {}
        }
    }

    broadcast_task.abort();
}
