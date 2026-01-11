// LaTeX compilation service
// TODO: Implement in Phase 5

use std::path::Path;

use crate::error::{AppError, Result};

#[allow(dead_code)]
pub struct CompilerService {
    storage_path: String,
}

#[derive(Debug)]
#[allow(dead_code)]
pub struct CompileResult {
    pub success: bool,
    pub pdf_path: Option<String>,
    pub log: String,
    pub errors: Vec<CompileError>,
    pub warnings: Vec<CompileWarning>,
}

#[derive(Debug)]
#[allow(dead_code)]
pub struct CompileError {
    pub file: String,
    pub line: Option<i32>,
    pub message: String,
}

#[derive(Debug)]
#[allow(dead_code)]
pub struct CompileWarning {
    pub file: String,
    pub line: Option<i32>,
    pub message: String,
}

#[allow(dead_code)]
impl CompilerService {
    pub fn new(storage_path: String) -> Self {
        Self { storage_path }
    }

    pub async fn compile(&self, project_id: &str, main_file: &str) -> Result<CompileResult> {
        let project_path = Path::new(&self.storage_path).join(project_id);

        if !project_path.exists() {
            return Err(AppError::NotFound(format!(
                "Project {project_id} not found"
            )));
        }

        // TODO: Implement actual compilation in Phase 5
        // This will:
        // 1. Run latexmk -pdf -interaction=nonstopmode {main_file}
        // 2. Parse the log file for errors and warnings
        // 3. Return the result

        let _ = main_file; // Suppress unused warning for now

        Ok(CompileResult {
            success: false,
            pdf_path: None,
            log: "Compilation not yet implemented".to_string(),
            errors: vec![],
            warnings: vec![],
        })
    }
}
