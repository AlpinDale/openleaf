use axum::{
    extract::{Multipart, Path, State},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::AuthUser,
    AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/project/:project_id", get(list_files))
        .route(
            "/project/:project_id/file",
            get(|| async { "ok" }).post(create_file),
        )
        .route("/project/:project_id/upload", post(upload_files))
        .route("/:id", get(get_file).put(update_file).delete(delete_file))
        .route(
            "/:id/content",
            get(get_file_content).put(update_file_content),
        )
}

#[derive(Debug, Deserialize)]
pub struct CreateFileRequest {
    pub name: String,
    pub path: String,
    pub is_folder: bool,
    pub content: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateFileRequest {
    pub name: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateContentRequest {
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct FileResponse {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub path: String,
    pub is_folder: bool,
}

#[derive(Debug, Serialize)]
pub struct FileListResponse {
    pub files: Vec<FileResponse>,
}

#[derive(Debug, Serialize)]
pub struct FileContentResponse {
    pub content: String,
}

// Helper to check if user has access to project
async fn check_project_access(
    pool: &sqlx::SqlitePool,
    project_id: &str,
    user_id: &str,
) -> Result<()> {
    let exists = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*) FROM projects p
        LEFT JOIN project_collaborators pc ON p.id = pc.project_id
        WHERE p.id = ? AND (p.owner_id = ? OR pc.user_id = ?)
        "#,
    )
    .bind(project_id)
    .bind(user_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    if exists == 0 {
        return Err(AppError::NotFound("Project not found".to_string()));
    }
    Ok(())
}

async fn list_files(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
) -> Result<Json<FileListResponse>> {
    check_project_access(&state.db.pool, &project_id, &user.id).await?;

    let files = sqlx::query_as::<_, (String, String, String, String, bool)>(
        "SELECT id, project_id, name, path, is_folder FROM files WHERE project_id = ? ORDER BY is_folder DESC, path ASC",
    )
    .bind(&project_id)
    .fetch_all(&state.db.pool)
    .await?;

    let files = files
        .into_iter()
        .map(|(id, project_id, name, path, is_folder)| FileResponse {
            id,
            project_id,
            name,
            path,
            is_folder,
        })
        .collect();

    Ok(Json(FileListResponse { files }))
}

async fn create_file(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
    Json(body): Json<CreateFileRequest>,
) -> Result<Json<FileResponse>> {
    check_project_access(&state.db.pool, &project_id, &user.id).await?;

    if body.name.trim().is_empty() {
        return Err(AppError::Validation("File name is required".to_string()));
    }

    // Check if file already exists
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM files WHERE project_id = ? AND path = ?",
    )
    .bind(&project_id)
    .bind(&body.path)
    .fetch_one(&state.db.pool)
    .await?;

    if exists > 0 {
        return Err(AppError::Validation(
            "File already exists at this path".to_string(),
        ));
    }

    let file_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    // Create in database
    sqlx::query(
        "INSERT INTO files (id, project_id, name, path, is_folder, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&file_id)
    .bind(&project_id)
    .bind(&body.name)
    .bind(&body.path)
    .bind(body.is_folder)
    .bind(&now)
    .bind(&now)
    .execute(&state.db.pool)
    .await?;

    // Create on filesystem
    let file_path = std::path::Path::new(&state.config.storage_path)
        .join(&project_id)
        .join(&body.path);

    if body.is_folder {
        std::fs::create_dir_all(&file_path)
            .map_err(|e| AppError::Internal(format!("Failed to create folder: {e}")))?;
    } else {
        // Create parent directories if needed
        if let Some(parent) = file_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::Internal(format!("Failed to create directories: {e}")))?;
        }
        let content = body.content.unwrap_or_default();
        std::fs::write(&file_path, &content)
            .map_err(|e| AppError::Internal(format!("Failed to create file: {e}")))?;
    }

    Ok(Json(FileResponse {
        id: file_id,
        project_id,
        name: body.name,
        path: body.path,
        is_folder: body.is_folder,
    }))
}

#[derive(Debug, Serialize)]
pub struct UploadResponse {
    pub uploaded: Vec<FileResponse>,
    pub errors: Vec<String>,
}

async fn upload_files(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>> {
    check_project_access(&state.db.pool, &project_id, &user.id).await?;

    let mut uploaded = Vec::new();
    let mut errors = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Failed to read multipart field: {e}")))?
    {
        let file_name = match field.file_name() {
            Some(name) => name.to_string(),
            None => {
                errors.push("File field missing filename".to_string());
                continue;
            }
        };

        // Read file data
        let data = match field.bytes().await {
            Ok(bytes) => bytes,
            Err(e) => {
                errors.push(format!("Failed to read file {file_name}: {e}"));
                continue;
            }
        };

        // Check if file already exists
        let exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM files WHERE project_id = ? AND path = ?",
        )
        .bind(&project_id)
        .bind(&file_name)
        .fetch_one(&state.db.pool)
        .await?;

        if exists > 0 {
            errors.push(format!("File {file_name} already exists"));
            continue;
        }

        let file_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        // Create in database
        if let Err(e) = sqlx::query(
            "INSERT INTO files (id, project_id, name, path, is_folder, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&file_id)
        .bind(&project_id)
        .bind(&file_name)
        .bind(&file_name)
        .bind(false)
        .bind(&now)
        .bind(&now)
        .execute(&state.db.pool)
        .await
        {
            errors.push(format!("Failed to create file record {file_name}: {e}"));
            continue;
        }

        // Write to filesystem
        let file_path = std::path::Path::new(&state.config.storage_path)
            .join(&project_id)
            .join(&file_name);

        // Create parent directories if needed
        if let Some(parent) = file_path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                errors.push(format!("Failed to create directories for {file_name}: {e}"));
                // Clean up the database entry
                let _ = sqlx::query("DELETE FROM files WHERE id = ?")
                    .bind(&file_id)
                    .execute(&state.db.pool)
                    .await;
                continue;
            }
        }

        if let Err(e) = std::fs::write(&file_path, &data) {
            errors.push(format!("Failed to write file {file_name}: {e}"));
            // Clean up the database entry
            let _ = sqlx::query("DELETE FROM files WHERE id = ?")
                .bind(&file_id)
                .execute(&state.db.pool)
                .await;
            continue;
        }

        uploaded.push(FileResponse {
            id: file_id,
            project_id: project_id.clone(),
            name: file_name.clone(),
            path: file_name,
            is_folder: false,
        });
    }

    Ok(Json(UploadResponse { uploaded, errors }))
}

async fn get_file(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<FileResponse>> {
    let file = sqlx::query_as::<_, (String, String, String, String, bool)>(
        "SELECT id, project_id, name, path, is_folder FROM files WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("File not found".to_string()))?;

    let (id, project_id, name, path, is_folder) = file;

    check_project_access(&state.db.pool, &project_id, &user.id).await?;

    Ok(Json(FileResponse {
        id,
        project_id,
        name,
        path,
        is_folder,
    }))
}

async fn update_file(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(body): Json<UpdateFileRequest>,
) -> Result<Json<FileResponse>> {
    let file = sqlx::query_as::<_, (String, String, String, String, bool)>(
        "SELECT id, project_id, name, path, is_folder FROM files WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("File not found".to_string()))?;

    let (file_id, project_id, mut name, mut path, is_folder) = file;

    check_project_access(&state.db.pool, &project_id, &user.id).await?;

    let old_path = path.clone();

    if let Some(new_name) = body.name {
        name = new_name;
    }
    if let Some(new_path) = body.path {
        path = new_path;
    }

    // Update in database
    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE files SET name = ?, path = ?, updated_at = ? WHERE id = ?")
        .bind(&name)
        .bind(&path)
        .bind(now)
        .bind(&file_id)
        .execute(&state.db.pool)
        .await?;

    // Rename on filesystem if path changed
    if old_path != path {
        let old_file_path = std::path::Path::new(&state.config.storage_path)
            .join(&project_id)
            .join(&old_path);
        let new_file_path = std::path::Path::new(&state.config.storage_path)
            .join(&project_id)
            .join(&path);

        if let Some(parent) = new_file_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::Internal(format!("Failed to create directories: {e}")))?;
        }

        std::fs::rename(&old_file_path, &new_file_path)
            .map_err(|e| AppError::Internal(format!("Failed to rename file: {e}")))?;
    }

    Ok(Json(FileResponse {
        id: file_id,
        project_id,
        name,
        path,
        is_folder,
    }))
}

async fn delete_file(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<()>> {
    let file = sqlx::query_as::<_, (String, String, bool)>(
        "SELECT project_id, path, is_folder FROM files WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("File not found".to_string()))?;

    let (project_id, path, is_folder) = file;

    check_project_access(&state.db.pool, &project_id, &user.id).await?;

    // Delete from filesystem
    let file_path = std::path::Path::new(&state.config.storage_path)
        .join(&project_id)
        .join(&path);

    if file_path.exists() {
        if is_folder {
            std::fs::remove_dir_all(&file_path)
                .map_err(|e| AppError::Internal(format!("Failed to delete folder: {e}")))?;
        } else {
            std::fs::remove_file(&file_path)
                .map_err(|e| AppError::Internal(format!("Failed to delete file: {e}")))?;
        }
    }

    // Delete from database
    sqlx::query("DELETE FROM files WHERE id = ?")
        .bind(&id)
        .execute(&state.db.pool)
        .await?;

    // If folder, delete all children
    if is_folder {
        sqlx::query("DELETE FROM files WHERE project_id = ? AND path LIKE ?")
            .bind(&project_id)
            .bind(format!("{path}/%"))
            .execute(&state.db.pool)
            .await?;
    }

    Ok(Json(()))
}

async fn get_file_content(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<FileContentResponse>> {
    let file = sqlx::query_as::<_, (String, String, bool)>(
        "SELECT project_id, path, is_folder FROM files WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("File not found".to_string()))?;

    let (project_id, path, is_folder) = file;

    if is_folder {
        return Err(AppError::BadRequest(
            "Cannot get content of a folder".to_string(),
        ));
    }

    check_project_access(&state.db.pool, &project_id, &user.id).await?;

    let file_path = std::path::Path::new(&state.config.storage_path)
        .join(&project_id)
        .join(&path);

    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| AppError::Internal(format!("Failed to read file: {e}")))?;

    Ok(Json(FileContentResponse { content }))
}

async fn update_file_content(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(body): Json<UpdateContentRequest>,
) -> Result<Json<FileContentResponse>> {
    let file = sqlx::query_as::<_, (String, String, bool)>(
        "SELECT project_id, path, is_folder FROM files WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("File not found".to_string()))?;

    let (project_id, path, is_folder) = file;

    if is_folder {
        return Err(AppError::BadRequest(
            "Cannot set content of a folder".to_string(),
        ));
    }

    check_project_access(&state.db.pool, &project_id, &user.id).await?;

    let file_path = std::path::Path::new(&state.config.storage_path)
        .join(&project_id)
        .join(&path);

    std::fs::write(&file_path, &body.content)
        .map_err(|e| AppError::Internal(format!("Failed to write file: {e}")))?;

    // Update timestamp
    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE files SET updated_at = ? WHERE id = ?")
        .bind(now)
        .bind(&id)
        .execute(&state.db.pool)
        .await?;

    Ok(Json(FileContentResponse {
        content: body.content,
    }))
}
