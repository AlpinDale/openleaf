use std::net::SocketAddr;

use axum::{
    body::Body,
    http::{Request, StatusCode},
    middleware as axum_middleware,
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use tower::util::ServiceExt;
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod config;
mod db;
mod error;
mod handlers;
mod middleware;
mod routes;
mod services;

use handlers::ws::{create_document_registry, DocumentRegistry};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "openleaf_server=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Load configuration
    let config = config::Config::from_env();

    // Ensure storage directory exists
    std::fs::create_dir_all(&config.storage_path)?;

    // Initialize database
    let db = db::Database::connect(&config.database_url).await?;
    db.run_migrations().await?;

    // Create document registry for real-time collaboration
    let docs = create_document_registry();

    // Build application state
    let state = AppState {
        db,
        config: config.clone(),
        docs,
    };

    // Build protected routes (require authentication)
    let protected_routes = Router::new()
        .nest("/projects", routes::projects::router())
        .nest("/files", routes::files::router())
        .nest("/compile", routes::compile::router())
        .nest("/comments", routes::comments::router())
        .route_layer(axum_middleware::from_fn_with_state(
            state.clone(),
            middleware::auth::auth_middleware,
        ));

    // Build API router
    let api_router = Router::new()
        .nest("/auth", routes::auth::router())
        .merge(protected_routes);

    // Build main router with SPA fallback
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/ws", get(handlers::ws::ws_handler))
        .nest("/api", api_router)
        .fallback(serve_spa)
        .with_state(state)
        .layer(TraceLayer::new_for_http())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        );

    // Start server
    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!("Starting server on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health_check() -> &'static str {
    "OK"
}

async fn serve_spa(req: Request<Body>) -> Response {
    let path = req.uri().path();

    // Try to serve static file first
    let static_path = format!("static{path}");
    if std::path::Path::new(&static_path).exists() {
        let serve_dir = ServeDir::new("static");
        let res = serve_dir.oneshot(req).await.unwrap();
        return res.into_response();
    }

    // For SPA routes, serve index.html
    match tokio::fs::read("static/index.html").await {
        Ok(contents) => Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "text/html")
            .body(Body::from(contents))
            .unwrap(),
        Err(_) => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Not found"))
            .unwrap(),
    }
}

#[derive(Clone)]
pub struct AppState {
    pub db: db::Database,
    pub config: config::Config,
    pub docs: DocumentRegistry,
}
