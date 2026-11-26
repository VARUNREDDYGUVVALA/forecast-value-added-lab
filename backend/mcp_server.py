"""Stdio MCP server exposing bounded analytical tools for synthetic cases."""
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from .api import scorecard
from .investigation import Stage, investigate

server = FastMCP("Forecast Lab")


@server.tool(annotations=ToolAnnotations(readOnlyHint=True), structured_output=True)
def forecast_scorecard(category: str | None = None, override_only: bool = False) -> dict[str, Any]:
    """Return matched FVA stages and eligible synthetic forecast versions."""
    return scorecard(category, override_only)


@server.tool(annotations=ToolAnnotations(readOnlyHint=True), structured_output=True)
def investigate_stage(sku: str, stage: Stage) -> dict[str, Any]:
    """Compare a forecast stage with its predecessor and include verified policy evidence."""
    return dict(investigate(sku, stage))


if __name__ == "__main__":
    server.run(transport="stdio")
