"""Bounded, read-only forecast investigation with policy and event evidence."""
from typing import Literal, TypedDict

from langgraph.graph import END, START, StateGraph

from .engine import AS_OF, CUTOFF, STAGES, demo_events, latest

Stage = Literal["ml", "promotion", "override"]
_forecasts, _actuals, _products = demo_events()

POLICIES = {
    "ml": ("FVA-01", "Compare consecutive forecast stages against the same complete actual sales."),
    "promotion": ("PROMO-01", "An error reduction measures forecast accuracy. Promotion impact requires a causal study."),
    "override": ("PLAN-01", "An override needs documented evidence and planner approval before publication."),
}


class Investigation(TypedDict, total=False):
    sku: str
    stage: Stage
    before_forecast: dict
    after_forecast: dict
    actual: dict
    before: int
    after: int
    fva: int
    policy: dict
    trace: list[str]


def intake(state: Investigation):
    try:
        index = STAGES.index(state["stage"])
        if index == 0:
            raise ValueError
        versions = latest((f for f in _forecasts if f["sku"] == state["sku"]),
                          ("sku", "target", "stage"), "issued", CUTOFF)
        actuals = latest((a for a in _actuals if a["sku"] == state["sku"]),
                         ("sku", "target"), "available", AS_OF)
        (sku, target), actual = next(iter(actuals.items()))
        before = versions[(sku, target, STAGES[index - 1])]
        after = versions.get((sku, target, state["stage"]))
        carried = after is None and state["stage"] == "override"
        if carried:
            after = before
        if not actual["complete"] or after is None:
            raise ValueError
    except (KeyError, StopIteration, ValueError) as exc:
        raise LookupError("No eligible matched evidence") from exc
    return {
        "actual": actual, "before_forecast": before, "after_forecast": after,
        "trace": ["Selected eligible forecast and actual versions."] +
                 (["Carried the promotion forecast forward because no override was issued."] if carried else []),
    }


def calculate(state: Investigation):
    observed = state["actual"]["units"]
    before = abs(state["before_forecast"]["units"] - observed)
    after = abs(state["after_forecast"]["units"] - observed)
    return {"before": before, "after": after, "fva": before - after,
            "trace": [*state["trace"], f"Compared absolute errors of {before} and {after} units."]}


def verify(state: Investigation):
    before, after, actual = (state[field] for field in ("before_forecast", "after_forecast", "actual"))
    if {(item["sku"], item["target"]) for item in (before, after, actual)} != {(state["sku"], actual["target"])}:
        raise RuntimeError("Evidence key mismatch")
    policy_id, text = POLICIES[state["stage"]]
    return {"policy": {"id": policy_id, "revision": 1, "text": text},
            "trace": [*state["trace"], f"Verified matched evidence and cited {policy_id} revision 1."]}


workflow = StateGraph(Investigation)
workflow.add_node("intake", intake)
workflow.add_node("calculate", calculate)
workflow.add_node("verify", verify)
workflow.add_edge(START, "intake")
workflow.add_edge("intake", "calculate")
workflow.add_edge("calculate", "verify")
workflow.add_edge("verify", END)
graph = workflow.compile()


def investigate(sku: str, stage: Stage) -> Investigation:
    return graph.invoke({"sku": sku, "stage": stage}, {"recursion_limit": 8})
