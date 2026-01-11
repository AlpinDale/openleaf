use std::process::Command;

use axum::{
    extract::{Path, State},
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, Result},
    middleware::auth::AuthUser,
    AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/project/:project_id", post(compile_project))
        .route(
            "/project/:project_id/pdf/:filename",
            axum::routing::get(get_pdf),
        )
}

#[derive(Debug, Deserialize)]
pub struct CompileRequest {
    pub main_file: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CompileResponse {
    pub success: bool,
    pub pdf_url: Option<String>,
    pub log: String,
    pub errors: Vec<CompileError>,
    pub warnings: Vec<CompileWarning>,
}

#[derive(Debug, Serialize, Clone)]
pub struct CompileError {
    pub file: String,
    pub line: Option<i32>,
    pub message: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct CompileWarning {
    pub file: String,
    pub line: Option<i32>,
    pub message: String,
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

fn parse_latex_log(log: &str) -> (Vec<CompileError>, Vec<CompileWarning>) {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    let lines: Vec<&str> = log.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];

        // Look for error patterns
        if line.starts_with('!') {
            let message = line.trim_start_matches('!').trim().to_string();
            let mut file = String::new();
            let mut line_num = None;

            // Look back for file:line pattern
            for j in (0..i).rev() {
                let prev_line = lines[j];
                if let Some(pos) = prev_line.find(".tex:") {
                    if let Some(colon_pos) = prev_line[pos + 5..].find(':') {
                        let line_str = &prev_line[pos + 5..pos + 5 + colon_pos];
                        line_num = line_str.parse().ok();
                    } else if let Some(space_pos) = prev_line[pos + 5..].find(' ') {
                        let line_str = &prev_line[pos + 5..pos + 5 + space_pos];
                        line_num = line_str.parse().ok();
                    }
                    file = prev_line[..pos + 4].to_string();
                    // Extract just the filename
                    if let Some(last_paren) = file.rfind('(') {
                        file = file[last_paren + 1..].to_string();
                    }
                    break;
                }
            }

            errors.push(CompileError {
                file,
                line: line_num,
                message,
            });
        }

        // Look for warning patterns
        if line.contains("Warning:") || line.contains("warning:") {
            let message = line.to_string();
            warnings.push(CompileWarning {
                file: String::new(),
                line: None,
                message,
            });
        }

        i += 1;
    }

    (errors, warnings)
}

async fn compile_project(
    State(state): State<AppState>,
    user: AuthUser,
    Path(project_id): Path<String>,
    Json(body): Json<CompileRequest>,
) -> Result<Json<CompileResponse>> {
    check_project_access(&state.db.pool, &project_id, &user.id).await?;

    let project_path = std::path::Path::new(&state.config.storage_path).join(&project_id);
    let main_file = body.main_file.unwrap_or_else(|| "main.tex".to_string());

    // Check if main file exists
    let main_file_path = project_path.join(&main_file);
    if !main_file_path.exists() {
        return Err(AppError::NotFound(format!(
            "Main file '{main_file}' not found"
        )));
    }

    // Clean auxiliary files first to ensure fresh compilation
    let _ = Command::new("latexmk")
        .args(["-C", &main_file])
        .current_dir(&project_path)
        .output();

    // Run latexmk with -g to force regeneration
    let output = Command::new("latexmk")
        .args([
            "-pdf",
            "-g",
            "-interaction=nonstopmode",
            "-file-line-error",
            &main_file,
        ])
        .current_dir(&project_path)
        .output()
        .map_err(|e| AppError::Internal(format!("Failed to run latexmk: {e}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let log = format!("{stdout}\n{stderr}");

    let (errors, warnings) = parse_latex_log(&log);

    let pdf_name = main_file.replace(".tex", ".pdf");
    let pdf_path = project_path.join(&pdf_name);

    // Consider compilation successful if PDF exists, even if latexmk reported warnings
    let pdf_exists = pdf_path.exists();
    let success = pdf_exists;

    let pdf_url = if pdf_exists {
        Some(format!("/api/compile/project/{project_id}/pdf/{pdf_name}"))
    } else {
        None
    };

    Ok(Json(CompileResponse {
        success,
        pdf_url,
        log,
        errors,
        warnings,
    }))
}

#[derive(Debug, Deserialize)]
pub struct PdfParams {
    project_id: String,
    filename: String,
}

async fn get_pdf(
    State(state): State<AppState>,
    user: AuthUser,
    Path(params): Path<PdfParams>,
) -> Result<axum::response::Response> {
    use axum::body::Body;
    use axum::http::{header, Response, StatusCode};

    check_project_access(&state.db.pool, &params.project_id, &user.id).await?;

    let pdf_path = std::path::Path::new(&state.config.storage_path)
        .join(&params.project_id)
        .join(&params.filename);

    if !pdf_path.exists() || !params.filename.ends_with(".pdf") {
        return Err(AppError::NotFound("PDF not found".to_string()));
    }

    let pdf_data = tokio::fs::read(&pdf_path)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read PDF: {e}")))?;

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/pdf")
        .header(
            header::CONTENT_DISPOSITION,
            format!("inline; filename=\"{}\"", params.filename),
        )
        .body(Body::from(pdf_data))
        .map_err(|e| AppError::Internal(format!("Failed to build response: {e}")))?;

    Ok(response)
}
