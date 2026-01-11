// File storage service
// TODO: Implement in Phase 3

use std::path::PathBuf;

use tokio::fs;

use crate::error::{AppError, Result};

#[allow(dead_code)]
pub struct StorageService {
    base_path: PathBuf,
}

#[allow(dead_code)]
impl StorageService {
    pub fn new(base_path: String) -> Self {
        Self {
            base_path: PathBuf::from(base_path),
        }
    }

    pub async fn init(&self) -> Result<()> {
        fs::create_dir_all(&self.base_path)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to create storage directory: {e}")))?;
        Ok(())
    }

    pub fn project_path(&self, project_id: &str) -> PathBuf {
        self.base_path.join(project_id)
    }

    pub fn file_path(&self, project_id: &str, file_path: &str) -> PathBuf {
        self.base_path.join(project_id).join(file_path)
    }

    pub async fn create_project_dir(&self, project_id: &str) -> Result<()> {
        let path = self.project_path(project_id);
        fs::create_dir_all(&path)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to create project directory: {e}")))?;
        Ok(())
    }

    pub async fn delete_project_dir(&self, project_id: &str) -> Result<()> {
        let path = self.project_path(project_id);
        if path.exists() {
            fs::remove_dir_all(&path).await.map_err(|e| {
                AppError::Internal(format!("Failed to delete project directory: {e}"))
            })?;
        }
        Ok(())
    }

    pub async fn write_file(&self, project_id: &str, file_path: &str, content: &str) -> Result<()> {
        let path = self.file_path(project_id, file_path);

        // Create parent directories if needed
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::Internal(format!("Failed to create directories: {e}")))?;
        }

        fs::write(&path, content)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to write file: {e}")))?;

        Ok(())
    }

    pub async fn read_file(&self, project_id: &str, file_path: &str) -> Result<String> {
        let path = self.file_path(project_id, file_path);

        if !path.exists() {
            return Err(AppError::NotFound(format!("File not found: {file_path}")));
        }

        fs::read_to_string(&path)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to read file: {e}")))
    }

    pub async fn delete_file(&self, project_id: &str, file_path: &str) -> Result<()> {
        let path = self.file_path(project_id, file_path);

        if path.exists() {
            if path.is_dir() {
                fs::remove_dir_all(&path)
                    .await
                    .map_err(|e| AppError::Internal(format!("Failed to delete directory: {e}")))?;
            } else {
                fs::remove_file(&path)
                    .await
                    .map_err(|e| AppError::Internal(format!("Failed to delete file: {e}")))?;
            }
        }

        Ok(())
    }

    pub async fn create_folder(&self, project_id: &str, folder_path: &str) -> Result<()> {
        let path = self.file_path(project_id, folder_path);
        fs::create_dir_all(&path)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to create folder: {e}")))?;
        Ok(())
    }

    pub async fn rename(&self, project_id: &str, old_path: &str, new_path: &str) -> Result<()> {
        let old = self.file_path(project_id, old_path);
        let new = self.file_path(project_id, new_path);

        if !old.exists() {
            return Err(AppError::NotFound(format!("Path not found: {old_path}")));
        }

        // Create parent directories for new path if needed
        if let Some(parent) = new.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::Internal(format!("Failed to create directories: {e}")))?;
        }

        fs::rename(&old, &new)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to rename: {e}")))?;

        Ok(())
    }
}
