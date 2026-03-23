"""Application configuration via environment variables."""

from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # --- Groq (LLM response generation) ---
    groq_api_key: str = ""

    # --- Google Gemini (OCR + Vision Agent — free tier) ---
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash-lite"  # Free-tier model for OCR/vision (15 RPM, 1000/day)
    gemini_rpm_limit: int = 8                      # Conservative limit (well under 15 RPM free tier)

    # --- JWT (set via .env) ---
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480  # 8 hours

    # --- File Storage ---
    upload_dir: str = str(Path(__file__).resolve().parent / "uploads")

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
