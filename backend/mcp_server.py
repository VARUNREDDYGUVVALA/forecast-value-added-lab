"""Stdio MCP server exposing bounded analytical tools for synthetic cases."""
from mcp.server.fastmcp import FastMCP

from .api import scorecard
from .investigation import Stage, investigate

server = FastMCP("Forecast Lab")


@server.tool()
def forecast_scorecard(category: str | None = None, override_only: bool = False) -> dict:
    """Return matched FVA stages and eligible synthetic forecast versions."""
    return scorecard(category, override_only)


@server.tool()
def investigate_stage(sku: str, stage: Stage) -> dict:
    """Compare a forecast stage with its predecessor and include verified policy evidence."""
    return dict(investigate(sku, stage))


if __name__ == "__main__":
    server.run(transport="stdio")
