"""Portable taxonomy: exact verified metadata first, conservative names second."""
from __future__ import annotations
from functools import lru_cache
import json
from pathlib import Path
import re

RULES_ROOT = Path(__file__).resolve().parent / "rules"


@lru_cache(maxsize=1)
def metadata():
    return json.loads((RULES_ROOT / "classification.json").read_text(encoding="utf-8"))


def classify(name: str, payload_hash: str, container: str = "") -> dict:
    known = metadata().get(name + ":" + payload_hash)
    if known:
        return {**known, "category": list(known["category"]), "tags": list(known["tags"])}
    category, kind, label = ["待确认", "用途待确认"], "sfx", name
    tags = []
    upper = name.upper()
    if upper.startswith("BGM_"):
        kind, label = "music", "背景音乐"
        section = next((v for k, v in [("DUEL", "决斗"), ("SOLO", "单人剧情"), ("TUTORIAL", "教程"), ("MENU", "菜单与主页"), ("HOME", "菜单与主页")] if k in upper), "其他场景")
        category = ["背景音乐", section]
    elif upper.startswith(("V_", "VOICE_")) or "/voice/" in container.lower():
        kind, label = "voice", "剧情语音"
        match = re.search(r"GATE\d+", upper)
        category = ["语音", match.group() if match else "章节待确认"]
    elif upper.startswith(("SE_SMN", "SE_SUMMON", "SE_LAND", "SE_MONSTER_CUTIN")):
        label = "落地" if upper.startswith("SE_LAND") else "召唤过程"
        category = ["决斗音效", "召唤与登场", label]
        for fragment, title in [("LINK", "连接召唤"), ("XYZ", "超量召唤"), ("SYNCHRO", "同调召唤"), ("FUSION", "融合召唤"), ("RITUAL", "仪式召唤"), ("PENDULUM", "灵摆召唤")]:
            if fragment in upper:
                tags.append(title)
    elif upper.startswith("SE_FIELD") or "/se_field/" in container.lower():
        category, label = ["场地与伙伴", "场地"], "场地"
    elif re.match(r"SE_M\d", upper) or "/se_mate/" in container.lower():
        category, label = ["场地与伙伴", "伙伴"], "伙伴"
    elif upper.startswith(("SE_MENU", "SE_SYS", "SE_TITLE", "SE_POPUP", "SE_CONFIRM")):
        category, label = ["界面与其他演出", "菜单与提示"], "菜单与提示"
    elif "/se_duel/" in container.lower():
        category = ["决斗音效", "决斗过程", "用途待确认"]
    return {"title": label if label == name else label + " · " + name, "kind": kind, "form": "独立片段", "category": category,
            "tags": list(dict.fromkeys([*tags, *category])), "description": "根据资源名称推断分类，可自由修改。"}
