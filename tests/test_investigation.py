import asyncio
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from fastapi.testclient import TestClient
from backend.api import app
from backend.investigation import investigate


def test_graph_verifies_yogurt_version_and_policy():
    result = investigate("YGT-1001", "override")
    assert (result["before"], result["after"], result["fva"]) == (20, 200, -180)
    assert result["policy"]["id"] == "PLAN-01"
    assert len(result["trace"]) == 3


def test_graph_handles_unchanged_forecast():
    result = investigate("CRS-1006", "override")
    assert result["fva"] == 0
    assert "Carried" in result["trace"][1]


def test_investigation_rejects_unknown_product_and_unapproved_stage():
    client = TestClient(app)
    assert client.post("/api/investigate", json={"sku": "unknown", "stage": "override"}).status_code == 404
    assert client.post("/api/investigate", json={"sku": "YGT-1001", "stage": "publish"}).status_code == 422


def test_mcp_transport_tool_shapes_and_numeric_result():
    async def check():
        parameters = StdioServerParameters(command=sys.executable, args=["-m", "backend.mcp_server"])
        async with stdio_client(parameters) as (reader, writer):
            async with ClientSession(reader, writer) as session:
                await session.initialize()
                tools = await session.list_tools()
                assert {tool.name for tool in tools.tools} == {"forecast_scorecard", "investigate_stage"}
                result = await session.call_tool("investigate_stage", {"sku": "YGT-1001", "stage": "ml"})
                assert not result.isError
                assert result.structuredContent["fva"] == 150

    asyncio.run(check())
