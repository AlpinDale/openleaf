use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{extract::State, routing::post, Json, Router};
use chrono::Utc;
use jsonwebtoken::{encode, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
}

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub name: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserResponse,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: String,
    pub email: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String, // user id
    pub email: String,
    pub name: String,
    pub exp: usize,
}

fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|_| AppError::Internal("Failed to hash password".to_string()))
}

fn verify_password(password: &str, hash: &str) -> Result<bool> {
    let parsed_hash = PasswordHash::new(hash)
        .map_err(|_| AppError::Internal("Invalid password hash".to_string()))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

fn create_token(user_id: &str, email: &str, name: &str, secret: &str) -> Result<String> {
    let expiration = Utc::now()
        .checked_add_signed(chrono::Duration::days(7))
        .expect("valid timestamp")
        .timestamp() as usize;

    let claims = Claims {
        sub: user_id.to_string(),
        email: email.to_string(),
        name: name.to_string(),
        exp: expiration,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|_| AppError::Internal("Failed to create token".to_string()))
}

async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>> {
    // Validate input
    if body.email.is_empty() || !body.email.contains('@') {
        return Err(AppError::Validation("Invalid email address".to_string()));
    }
    if body.name.is_empty() {
        return Err(AppError::Validation("Name is required".to_string()));
    }
    if body.password.len() < 8 {
        return Err(AppError::Validation(
            "Password must be at least 8 characters".to_string(),
        ));
    }

    // Check if user already exists
    let existing = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE email = ?")
        .bind(&body.email)
        .fetch_one(&state.db.pool)
        .await?;

    if existing > 0 {
        return Err(AppError::Validation("Email already registered".to_string()));
    }

    // Hash password
    let password_hash = hash_password(&body.password)?;

    // Create user
    let user_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&user_id)
    .bind(&body.email)
    .bind(&body.name)
    .bind(&password_hash)
    .bind(&now)
    .execute(&state.db.pool)
    .await?;

    // Create token
    let token = create_token(&user_id, &body.email, &body.name, &state.config.jwt_secret)?;

    Ok(Json(AuthResponse {
        token,
        user: UserResponse {
            id: user_id,
            email: body.email,
            name: body.name,
        },
    }))
}

async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<AuthResponse>> {
    // Find user by email
    let user = sqlx::query_as::<_, (String, String, String, String)>(
        "SELECT id, email, name, password_hash FROM users WHERE email = ?",
    )
    .bind(&body.email)
    .fetch_optional(&state.db.pool)
    .await?
    .ok_or(AppError::Unauthorized)?;

    let (user_id, email, name, password_hash) = user;

    // Verify password
    if !verify_password(&body.password, &password_hash)? {
        return Err(AppError::Unauthorized);
    }

    // Create token
    let token = create_token(&user_id, &email, &name, &state.config.jwt_secret)?;

    Ok(Json(AuthResponse {
        token,
        user: UserResponse {
            id: user_id,
            email,
            name,
        },
    }))
}
