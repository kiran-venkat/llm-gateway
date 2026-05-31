from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    LIVEKIT_URL: str = "ws://localhost:7880"
    LIVEKIT_API_KEY: str = "devkey"
    LIVEKIT_API_SECRET: str = "secret"
    DEEPGRAM_API_KEY: str
    GATEWAY_URL: str = "http://localhost:3000"
    GATEWAY_API_KEY: str
    GATEWAY_MODEL: str = "claude-haiku-4-5-20251001"
    LOG_LEVEL: str = "INFO"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()


def get_settings() -> Settings:
    return settings
