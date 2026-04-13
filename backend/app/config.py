from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env.local",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Evidence CoPilot Analysis API"
    api_prefix: str = "/api/v1"
    environment: str = Field(default="development", alias="ECP_ENV")
    cors_origins: List[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3100",
            "http://127.0.0.1:3100",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
        alias="ECP_CORS_ORIGINS",
    )
    cors_origin_regex: str = Field(
        default=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        alias="ECP_CORS_ORIGIN_REGEX",
    )
    workspace_store_dir: str = Field(
        default=str(Path(__file__).resolve().parents[2] / ".app-data" / "analysis-workspaces"),
        alias="ECP_WORKSPACE_STORE_DIR",
    )
    analysis_agent_store_dir: str = Field(
        default=str(Path(__file__).resolve().parents[2] / ".app-data" / "analysis-agent-runs"),
        alias="ECP_ANALYSIS_AGENT_STORE_DIR",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
