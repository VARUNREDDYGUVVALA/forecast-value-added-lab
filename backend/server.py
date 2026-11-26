"""Single-origin deployment of the API and built browser application."""
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from .api import app

app.mount("/", StaticFiles(directory=Path(__file__).resolve().parents[1] / "dist", html=True), name="dashboard")
