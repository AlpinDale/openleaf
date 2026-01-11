use axum::{
    extract::{Path, State},
    routing::get,
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
        .route("/", get(list_projects).post(create_project))
        .route("/:id", get(get_project).delete(delete_project))
        .route(
            "/:id/collaborators",
            get(list_collaborators).post(add_collaborator),
        )
        .route(
            "/:id/collaborators/:user_id",
            axum::routing::delete(remove_collaborator),
        )
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct ProjectResponse {
    pub id: String,
    pub name: String,
    pub owner_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct ProjectListResponse {
    pub projects: Vec<ProjectResponse>,
}

async fn list_projects(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<ProjectListResponse>> {
    // Get projects owned by user or shared with user
    let projects = sqlx::query_as::<_, (String, String, String, String, String)>(
        r#"
        SELECT DISTINCT p.id, p.name, p.owner_id, p.created_at, p.updated_at
        FROM projects p
        LEFT JOIN project_collaborators pc ON p.id = pc.project_id
        WHERE p.owner_id = ? OR pc.user_id = ?
        ORDER BY p.updated_at DESC
        "#,
    )
    .bind(&user.id)
    .bind(&user.id)
    .fetch_all(&state.db.pool)
    .await?;

    let projects = projects
        .into_iter()
        .map(
            |(id, name, owner_id, created_at, updated_at)| ProjectResponse {
                id,
                name,
                owner_id,
                created_at,
                updated_at,
            },
        )
        .collect();

    Ok(Json(ProjectListResponse { projects }))
}

async fn create_project(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateProjectRequest>,
) -> Result<Json<ProjectResponse>> {
    if body.name.trim().is_empty() {
        return Err(AppError::Validation("Project name is required".to_string()));
    }

    let project_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO projects (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&project_id)
    .bind(&body.name)
    .bind(&user.id)
    .bind(&now)
    .bind(&now)
    .execute(&state.db.pool)
    .await?;

    // Create project directory
    let project_path = std::path::Path::new(&state.config.storage_path).join(&project_id);
    std::fs::create_dir_all(&project_path)
        .map_err(|e| AppError::Internal(format!("Failed to create project directory: {e}")))?;

    // Create default main.tex file
    let main_tex_content = r#"\documentclass{article}
\usepackage[utf8]{inputenc}

\title{Untitled Document}
\author{}
\date{\today}

\begin{document}

\maketitle

\section{Introduction}

Your content here.

\end{document}
"#;

    let main_tex_path = project_path.join("main.tex");
    std::fs::write(&main_tex_path, main_tex_content)
        .map_err(|e| AppError::Internal(format!("Failed to create main.tex: {e}")))?;

    // Add file to database
    let file_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO files (id, project_id, name, path, is_folder, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&file_id)
    .bind(&project_id)
    .bind("main.tex")
    .bind("main.tex")
    .bind(false)
    .bind(&now)
    .bind(&now)
    .execute(&state.db.pool)
    .await?;

    Ok(Json(ProjectResponse {
        id: project_id,
        name: body.name,
        owner_id: user.id,
        created_at: now.clone(),
        updated_at: now,
    }))
}

async fn get_project(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ProjectResponse>> {
    // Check if user has access to project
    let project = sqlx::query_as::<_, (String, String, String, String, String)>(
        r#"
        SELECT DISTINCT p.id, p.name, p.owner_id, p.created_at, p.updated_at
        FROM projects p
        LEFT JOIN project_collaborators pc ON p.id = pc.project_id
        WHERE p.id = ? AND (p.owner_id = ? OR pc.user_id = ?)
        "#,
    )
    .bind(&id)
    .bind(&user.id)
    .bind(&user.id)
    .fetch_optional(&state.db.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    let (id, name, owner_id, created_at, updated_at) = project;

    Ok(Json(ProjectResponse {
        id,
        name,
        owner_id,
        created_at,
        updated_at,
    }))
}

async fn delete_project(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<()>> {
    // Only owner can delete project
    let project = sqlx::query_as::<_, (String,)>("SELECT owner_id FROM projects WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.db.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.0 != user.id {
        return Err(AppError::Forbidden(
            "Only the owner can delete this project".to_string(),
        ));
    }

    // Delete project directory
    let project_path = std::path::Path::new(&state.config.storage_path).join(&id);
    if project_path.exists() {
        std::fs::remove_dir_all(&project_path)
            .map_err(|e| AppError::Internal(format!("Failed to delete project directory: {e}")))?;
    }

    // Delete from database (cascades to files and comments)
    sqlx::query("DELETE FROM projects WHERE id = ?")
        .bind(&id)
        .execute(&state.db.pool)
        .await?;

    Ok(Json(()))
}

// Collaborator types
#[derive(Debug, Deserialize)]
pub struct AddCollaboratorRequest {
    pub email: String,
    pub role: String, // "editor" or "viewer"
}

#[derive(Debug, Serialize)]
pub struct CollaboratorResponse {
    pub user_id: String,
    pub user_name: String,
    pub user_email: String,
    pub role: String,
}

#[derive(Debug, Serialize)]
pub struct CollaboratorsListResponse {
    pub collaborators: Vec<CollaboratorResponse>,
}

#[derive(Debug, Deserialize)]
pub struct CollaboratorPathParams {
    pub id: String,
    pub user_id: String,
}

async fn list_collaborators(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
) -> Result<Json<CollaboratorsListResponse>> {
    // Check if user has access to project
    let exists = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*) FROM projects p
        LEFT JOIN project_collaborators pc ON p.id = pc.project_id
        WHERE p.id = ? AND (p.owner_id = ? OR pc.user_id = ?)
        "#,
    )
    .bind(&project_id)
    .bind(&user.id)
    .bind(&user.id)
    .fetch_one(&state.db.pool)
    .await?;

    if exists == 0 {
        return Err(AppError::NotFound("Project not found".to_string()));
    }

    let collaborators = sqlx::query_as::<_, (String, String, String, String)>(
        r#"
        SELECT u.id, u.name, u.email, pc.role
        FROM project_collaborators pc
        JOIN users u ON pc.user_id = u.id
        WHERE pc.project_id = ?
        ORDER BY u.name ASC
        "#,
    )
    .bind(&project_id)
    .fetch_all(&state.db.pool)
    .await?;

    let collaborators = collaborators
        .into_iter()
        .map(
            |(user_id, user_name, user_email, role)| CollaboratorResponse {
                user_id,
                user_name,
                user_email,
                role,
            },
        )
        .collect();

    Ok(Json(CollaboratorsListResponse { collaborators }))
}

async fn add_collaborator(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
    Json(body): Json<AddCollaboratorRequest>,
) -> Result<Json<CollaboratorResponse>> {
    // Only owner can add collaborators
    let project = sqlx::query_as::<_, (String,)>("SELECT owner_id FROM projects WHERE id = ?")
        .bind(&project_id)
        .fetch_optional(&state.db.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.0 != user.id {
        return Err(AppError::Forbidden(
            "Only the owner can manage collaborators".to_string(),
        ));
    }

    // Validate role
    if body.role != "editor" && body.role != "viewer" {
        return Err(AppError::Validation(
            "Role must be 'editor' or 'viewer'".to_string(),
        ));
    }

    // Find user by email
    let target_user = sqlx::query_as::<_, (String, String, String)>(
        "SELECT id, name, email FROM users WHERE email = ?",
    )
    .bind(&body.email)
    .fetch_optional(&state.db.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    let (target_user_id, target_user_name, target_user_email) = target_user;

    // Cannot add yourself
    if target_user_id == user.id {
        return Err(AppError::Validation(
            "Cannot add yourself as a collaborator".to_string(),
        ));
    }

    // Check if already a collaborator
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM project_collaborators WHERE project_id = ? AND user_id = ?",
    )
    .bind(&project_id)
    .bind(&target_user_id)
    .fetch_one(&state.db.pool)
    .await?;

    if exists > 0 {
        // Update role instead
        sqlx::query(
            "UPDATE project_collaborators SET role = ? WHERE project_id = ? AND user_id = ?",
        )
        .bind(&body.role)
        .bind(&project_id)
        .bind(&target_user_id)
        .execute(&state.db.pool)
        .await?;
    } else {
        sqlx::query(
            "INSERT INTO project_collaborators (project_id, user_id, role) VALUES (?, ?, ?)",
        )
        .bind(&project_id)
        .bind(&target_user_id)
        .bind(&body.role)
        .execute(&state.db.pool)
        .await?;
    }

    Ok(Json(CollaboratorResponse {
        user_id: target_user_id,
        user_name: target_user_name,
        user_email: target_user_email,
        role: body.role,
    }))
}

async fn remove_collaborator(
    State(state): State<AppState>,
    user: AuthUser,
    Path(params): Path<CollaboratorPathParams>,
) -> Result<Json<()>> {
    // Only owner can remove collaborators (or user can remove themselves)
    let project = sqlx::query_as::<_, (String,)>("SELECT owner_id FROM projects WHERE id = ?")
        .bind(&params.id)
        .fetch_optional(&state.db.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Project not found".to_string()))?;

    if project.0 != user.id && params.user_id != user.id {
        return Err(AppError::Forbidden(
            "Cannot remove this collaborator".to_string(),
        ));
    }

    sqlx::query("DELETE FROM project_collaborators WHERE project_id = ? AND user_id = ?")
        .bind(&params.id)
        .bind(&params.user_id)
        .execute(&state.db.pool)
        .await?;

    Ok(Json(()))
}
