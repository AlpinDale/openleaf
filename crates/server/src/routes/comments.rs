use axum::{
    extract::{Path, State},
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
        .route("/project/:project_id", get(list_comments))
        .route("/project/:project_id/file", get(list_file_comments))
        .route("/", post(create_comment))
        .route("/:id", get(get_comment).delete(delete_comment))
        .route("/:id/resolve", post(resolve_comment))
}

#[derive(Debug, Deserialize)]
pub struct CreateCommentRequest {
    pub project_id: String,
    pub file_path: String,
    pub content: String,
    pub line_start: i32,
    pub line_end: i32,
}

#[derive(Debug, Deserialize)]
pub struct FileCommentsQuery {
    pub file_path: String,
}

#[derive(Debug, Serialize)]
pub struct CommentResponse {
    pub id: String,
    pub project_id: String,
    pub file_path: String,
    pub author_id: String,
    pub author_name: String,
    pub content: String,
    pub line_start: i32,
    pub line_end: i32,
    pub resolved: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct CommentsListResponse {
    pub comments: Vec<CommentResponse>,
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

async fn list_comments(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
) -> Result<Json<CommentsListResponse>> {
    check_project_access(&state.db.pool, &project_id, &user.id).await?;

    let comments = sqlx::query_as::<_, (String, String, String, String, String, String, i32, i32, bool, String)>(
        r#"
        SELECT c.id, c.project_id, c.file_path, c.author_id, u.name, c.content, c.line_start, c.line_end, c.resolved, c.created_at
        FROM comments c
        JOIN users u ON c.author_id = u.id
        WHERE c.project_id = ?
        ORDER BY c.created_at DESC
        "#,
    )
    .bind(&project_id)
    .fetch_all(&state.db.pool)
    .await?;

    let comments = comments
        .into_iter()
        .map(
            |(
                id,
                project_id,
                file_path,
                author_id,
                author_name,
                content,
                line_start,
                line_end,
                resolved,
                created_at,
            )| {
                CommentResponse {
                    id,
                    project_id,
                    file_path,
                    author_id,
                    author_name,
                    content,
                    line_start,
                    line_end,
                    resolved,
                    created_at,
                }
            },
        )
        .collect();

    Ok(Json(CommentsListResponse { comments }))
}

async fn list_file_comments(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
    axum::extract::Query(query): axum::extract::Query<FileCommentsQuery>,
) -> Result<Json<CommentsListResponse>> {
    check_project_access(&state.db.pool, &project_id, &user.id).await?;

    let comments = sqlx::query_as::<_, (String, String, String, String, String, String, i32, i32, bool, String)>(
        r#"
        SELECT c.id, c.project_id, c.file_path, c.author_id, u.name, c.content, c.line_start, c.line_end, c.resolved, c.created_at
        FROM comments c
        JOIN users u ON c.author_id = u.id
        WHERE c.project_id = ? AND c.file_path = ?
        ORDER BY c.line_start ASC, c.created_at ASC
        "#,
    )
    .bind(&project_id)
    .bind(&query.file_path)
    .fetch_all(&state.db.pool)
    .await?;

    let comments = comments
        .into_iter()
        .map(
            |(
                id,
                project_id,
                file_path,
                author_id,
                author_name,
                content,
                line_start,
                line_end,
                resolved,
                created_at,
            )| {
                CommentResponse {
                    id,
                    project_id,
                    file_path,
                    author_id,
                    author_name,
                    content,
                    line_start,
                    line_end,
                    resolved,
                    created_at,
                }
            },
        )
        .collect();

    Ok(Json(CommentsListResponse { comments }))
}

async fn create_comment(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateCommentRequest>,
) -> Result<Json<CommentResponse>> {
    check_project_access(&state.db.pool, &body.project_id, &user.id).await?;

    if body.content.trim().is_empty() {
        return Err(AppError::Validation(
            "Comment content is required".to_string(),
        ));
    }

    if body.line_start < 1 || body.line_end < body.line_start {
        return Err(AppError::Validation("Invalid line range".to_string()));
    }

    let comment_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO comments (id, project_id, file_path, author_id, content, line_start, line_end, resolved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&comment_id)
    .bind(&body.project_id)
    .bind(&body.file_path)
    .bind(&user.id)
    .bind(&body.content)
    .bind(body.line_start)
    .bind(body.line_end)
    .bind(false)
    .bind(&now)
    .execute(&state.db.pool)
    .await?;

    Ok(Json(CommentResponse {
        id: comment_id,
        project_id: body.project_id,
        file_path: body.file_path,
        author_id: user.id.clone(),
        author_name: user.name,
        content: body.content,
        line_start: body.line_start,
        line_end: body.line_end,
        resolved: false,
        created_at: now,
    }))
}

async fn get_comment(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<CommentResponse>> {
    let comment = sqlx::query_as::<_, (String, String, String, String, String, String, i32, i32, bool, String)>(
        r#"
        SELECT c.id, c.project_id, c.file_path, c.author_id, u.name, c.content, c.line_start, c.line_end, c.resolved, c.created_at
        FROM comments c
        JOIN users u ON c.author_id = u.id
        WHERE c.id = ?
        "#,
    )
    .bind(&id)
    .fetch_optional(&state.db.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Comment not found".to_string()))?;

    let (
        id,
        project_id,
        file_path,
        author_id,
        author_name,
        content,
        line_start,
        line_end,
        resolved,
        created_at,
    ) = comment;

    check_project_access(&state.db.pool, &project_id, &user.id).await?;

    Ok(Json(CommentResponse {
        id,
        project_id,
        file_path,
        author_id,
        author_name,
        content,
        line_start,
        line_end,
        resolved,
        created_at,
    }))
}

async fn delete_comment(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<()>> {
    let comment = sqlx::query_as::<_, (String, String)>(
        "SELECT project_id, author_id FROM comments WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Comment not found".to_string()))?;

    let (project_id, author_id) = comment;

    // Only author or project owner can delete
    let is_owner =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM projects WHERE id = ? AND owner_id = ?")
            .bind(&project_id)
            .bind(&user.id)
            .fetch_one(&state.db.pool)
            .await?;

    if author_id != user.id && is_owner == 0 {
        return Err(AppError::Forbidden(
            "Cannot delete this comment".to_string(),
        ));
    }

    sqlx::query("DELETE FROM comments WHERE id = ?")
        .bind(&id)
        .execute(&state.db.pool)
        .await?;

    Ok(Json(()))
}

async fn resolve_comment(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<CommentResponse>> {
    let comment = sqlx::query_as::<_, (String,)>("SELECT project_id FROM comments WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.db.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Comment not found".to_string()))?;

    let (project_id,) = comment;
    check_project_access(&state.db.pool, &project_id, &user.id).await?;

    sqlx::query("UPDATE comments SET resolved = 1 WHERE id = ?")
        .bind(&id)
        .execute(&state.db.pool)
        .await?;

    // Return updated comment
    get_comment(State(state), user, Path(id)).await
}
