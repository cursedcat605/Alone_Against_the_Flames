#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""校验 src/content/scenes/script.json 的完整性与自洽性。

用法：
    python tools/validate_script.py            # 有问题就 exit 1
    python tools/validate_script.py --json     # 机器可读输出（给别的脚本吃）

设计原则（和解析器一致）：
* **不猜、不掩盖**。任何偏离预期的现象都必须显式登记在 tools/overrides.json 的
  `knownGaps` 里，并写明理由；没登记的偏差一律报 ERROR 并以非零码退出。
  这样「已知的内容缺口」和「新出现的 bug」不会再混为一谈。
* 这里的检查项和 src/engine/content.test.ts、playthrough.test.ts 是**同一批不变量**，
  区别只是入口（命令行 vs vitest）。名字和名单唯一来源都是 overrides.json。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = ROOT / "src" / "content" / "scenes" / "script.json"
SKILLS_PATH = ROOT / "src" / "content" / "rules" / "skills.json"
OVERRIDES_PATH = ROOT / "tools" / "overrides.json"

KINDS = {"text", "choice", "check", "combat", "ending", "dead_end"}
LEVELS = {"regular", "hard", "extreme"}
ATTR_LABELS = {
    "力量", "体质", "体型", "敏捷", "外貌", "智力", "意志", "教育",
}
# conditions.ts 除了八项属性之外还认这两个派生值
EXTRA_CONDITION_LABELS = {"幸运", "理智"}
# 引擎的 parseDice 接受：纯数字（"1"）、单骰（"2D6"、"D6"）、多项相加（"1D3+1D4"）。
# 最初这里只写了单骰，于是 14 处合法的「失去 1 点」被报成错误 —— 校验器和剧本
# 不一致时，先怀疑校验器。
DIE_TERM = r"(?:\d*[dD]\d+|\d+)"
DICE_RE = re.compile(rf"^\s*{DIE_TERM}\s*(?:\+\s*{DIE_TERM}\s*)*$")
WHENS = {"success", "failure"}

findings: list[tuple[str, str]] = []


def err(msg: str) -> None:
    findings.append(("ERROR", msg))


def warn(msg: str) -> None:
    findings.append(("WARN", msg))


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def strip_specialty(name: str) -> str:
    return re.sub(r"[（(][^（()）]*[)）]", "", name).strip()


def build_resolvers(skills_doc: dict) -> tuple[set[str], dict[str, str]]:
    """返回 (可解析的检定型目标集合, 别名→真名)。"""
    table = skills_doc["skills"]
    aliases = dict(skills_doc.get("aliases", {}))
    resolvable = set(table) | set(ATTR_LABELS) | EXTRA_CONDITION_LABELS | {"闪避", "母语"}
    # 专攻：技能表里像「艺术与手艺」这种基名，剧本里会写成「艺术与手艺（摄影）」
    families: set[str] = set()
    for label, entry in table.items():
        fam = entry.get("family") if isinstance(entry, dict) else None
        if fam:
            families.add(fam)
    for label in list(table):
        base = strip_specialty(label)
        if base and base in table:
            families.add(base)
    return resolvable, aliases, families  # type: ignore[return-value]


def check_structure(nodes: list[dict], meta: dict, gaps: dict) -> None:
    if meta.get("nodeCount") != len(nodes):
        err(f"meta.nodeCount={meta.get('nodeCount')} 与实际条目数 {len(nodes)} 不一致")

    ids = [n["id"] for n in nodes]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        err(f"条目 id 重复：{sorted(dup)}")

    missing = {int(k) for k in gaps.get("missingNodes", {})}
    expected = set(range(1, max(ids) + 1)) - missing
    if set(ids) != expected:
        err(f"id 不连续，多出 {sorted(set(ids) - expected)}，缺少 {sorted(expected - set(ids))}")

    for n in nodes:
        where = f"条目 {n['id']}"
        if n["kind"] not in KINDS:
            err(f"{where} 的 kind「{n['kind']}」未知")
        if not (n.get("text") or "").strip():
            err(f"{where} 没有正文")
        if not (n.get("display") or "").strip():
            err(f"{where} 没有展示文本")
        if "\u0000" in (n.get("text") or ""):
            err(f"{where} 正文含 NUL 字符")
        for key in ("links", "checks", "effects"):
            if n.get(key) is None:
                err(f"{where} 缺少 {key} 字段")


def check_links(nodes: list[dict], gaps: dict) -> None:
    ids = {n["id"] for n in nodes}
    missing = {int(k) for k in gaps.get("missingNodes", {})}
    no_outlet_registered = {int(k) for k in gaps.get("noOutlet", {})}
    note_links: list[str] = []

    for n in nodes:
        where = f"条目 {n['id']}"
        for link in n["links"]:
            to = link["to"]
            if to not in ids and to not in missing:
                err(f"{where} 的跳转目标 {to} 不存在（也没登记为缺失）")
            if to == n["id"]:
                err(f"{where} 跳到自身")
            label = (link.get("label") or "").strip()
            if "译注" in label:
                note_links.append(f"{where} 「{label}」→ {to}")
            if re.fullmatch(r"\d+", label) or len(label) == 1:
                err(f"{where} 的选项标签像噪声「{label}」")

        targets = [l["to"] for l in n["links"]]
        if len(targets) != len(set(targets)):
            # 不一定错：条目 29 的「如果你的敏捷较高」与「如果你成功了」两条分支
            # 本来就汇聚到 42（已登记）。但每多一处都值得看一眼 —— 条目 173 曾经因为
            # 译注被抽成链接而多出一个指向 193 的假分支。
            if str(n["id"]) not in gaps.get("convergingBranches", {}):
                err(f"{where} 有指向同一条目的多条跳转 {targets}（可能是多条分支汇聚，请核实后登记 convergingBranches）")

        usable = bool(n["links"]) or bool(n["checks"]) or bool(n["effects"])
        if n["kind"] in ("ending", "dead_end"):
            continue
        if not usable and n["id"] not in no_outlet_registered:
            err(f"{where}（{n['kind']}）没有任何出口，也没登记进 knownGaps.noOutlet")

    if note_links:
        err("译注被抽成了跳转选项（这是规则漏洞，不只是排版问题）：\n    " + "\n    ".join(note_links))


def resolvable_target(name: str, resolvable, aliases, families) -> bool:
    """这个检定目标能不能落到技能表/属性表里的某一项。

    查不到就意味着引擎会按 0% 结算（必失败），属于静默的规则错误。
    """
    if name in resolvable or name in aliases:
        return True
    base = strip_specialty(name)
    return base in resolvable or base in aliases or base in families


def check_checks(nodes: list[dict], resolvable, aliases, families, gaps: dict) -> None:
    endings_with_checks = {e["id"] for e in gaps.get("endingsWithChecks", [])}
    for n in nodes:
        where = f"条目 {n['id']}"
        checks = n["checks"]
        if len(checks) > 4:
            err(f"{where} 有 {len(checks)} 个检定（>4 说明解析把多段合并了）")
        for c in checks:
            skill, difficulty = c.get("skill"), c.get("difficulty")
            if not resolvable_target(skill or "", resolvable, aliases, families):
                err(f"{where} 的检定目标「{skill}」无法解析 → 会变成静默 0% 目标")
            if difficulty not in LEVELS:
                err(f"{where} 的检定难度「{difficulty}」未知")
        if n["kind"] == "ending" and checks:
            if n["id"] not in endings_with_checks:
                warn(f"{where} 是结局却带检定 {[c.get('skill') for c in checks]}，未登记在 knownGaps.endingsWithChecks")

    # 效果的前提必须能被兑现。引擎在「进入节点 / 检定成功 / 检定失败」三个时机
    # 挑着结算（effects.ts 的 selectEffects），所以带前提的效果必须**恰好对应一个检定**，
    # 否则那个前提永远不会被触发，效果就静默丢失了。
    for n in nodes:
        where = f"条目 {n['id']}"
        for e in n["effects"]:
            when = e.get("when")
            if when is not None and when not in WHENS:
                err(f"{where} 的效果前提「{when}」未知")
            if when is not None and len(n["checks"]) != 1:
                err(f"{where} 有带前提（{when}）的效果，但本条目只有 {len(n['checks'])} 个检定，前提永远无法触发")
            if when == "failure":
                # 引擎按最终结果结算，孤注一掷不会回滚已经结算的失败后果
                if not all(c["skill"] in ("理智", "幸运") for c in n["checks"]):
                    err(f"{where} 的失败前提效果挂在可孤注一掷的检定上 → 重掷会重复结算")


def check_effects(nodes: list[dict], resolvable, aliases, families, gaps: dict) -> None:
    for n in nodes:
        where = f"条目 {n['id']}"
        for e in n["effects"]:
            kind = e.get("kind")
            if kind in ("hp", "san"):
                if not DICE_RE.match(str(e.get("value", ""))):
                    err(f"{where} 的 {kind} 效果「{e.get('value')}」不是可掷的骰式")
            elif kind == "tick":
                name = str(e.get("skill", ""))
                base = strip_specialty(name)
                if name not in resolvable and name not in aliases and base not in families:
                    err(f"{where} 的 tick 效果引用「{name}」，技能表里找不到")
            else:
                warn(f"{where} 有未识别的效果类型「{kind}」")


def check_conditions(nodes: list[dict], resolvable, gaps: dict) -> None:
    known = ATTR_LABELS | EXTRA_CONDITION_LABELS | set(resolvable)
    for n in nodes:
        for link in n["links"]:
            cond = link.get("condition")
            if not cond:
                continue
            attr = cond.get("attr")
            if attr not in known:
                err(f"条目 {n['id']} 的条件引用了未知属性「{attr}」")


def check_graph(nodes: list[dict], gaps: dict) -> tuple[set[int], set[int]]:
    ids = {n["id"] for n in nodes}
    incoming: dict[int, list[int]] = {i: [] for i in ids}
    for n in nodes:
        for link in n["links"]:
            if link["to"] in incoming:
                incoming[link["to"]].append(n["id"])

    orphans = sorted(i for i in ids if not incoming[i] and i != 1)
    registered_orphans = sorted(gaps.get("orphans", []))
    if orphans != registered_orphans:
        err(f"无入边条目与登记不符：实际 {orphans} / 登记 {registered_orphans}")

    # 静态可达性（不含相对跳转，见 README 的「内容缺口」）
    seen: set[int] = set()
    stack = [1]
    by_id = {n["id"]: n for n in nodes}
    while stack:
        cur = stack.pop()
        if cur in seen or cur not in by_id:
            continue
        seen.add(cur)
        for link in by_id[cur]["links"]:
            stack.append(link["to"])

    unreachable = sorted(ids - seen)
    registered = sorted(gaps.get("unreachable", []))
    if unreachable != registered:
        err(f"不可达条目与登记不符：实际 {unreachable} / 登记 {registered}")

    zero_in = {i for i in ids if not incoming[i] and i != 1}
    if not zero_in <= set(registered):
        err(f"零入边条目未全部落在不可达名单里：{sorted(zero_in - set(registered))}")

    return seen, unreachable


def check_typography(nodes: list[dict], gaps: dict) -> None:
    cjk_space = re.compile(r"[\u4e00-\u9fff] +[\u4e00-\u9fff]")
    for n in nodes:
        where = f"条目 {n['id']}"
        display = n["display"]
        open_p = display.count("（") + display.count("(")
        close_p = display.count("）") + display.count(")")
        if open_p != close_p:
            err(f"{where} 正文括号不成对（{open_p} 开 / {close_p} 闭），译注可能被剥掉了半句")
        for para in display.split("\n"):
            s = para.strip()
            if not s:
                continue
            if s in ("）", ")", "。）"):
                err(f"{where} 有只剩下右括号的孤段")
            if cjk_space.search(para):
                warn(f"{where} 中文之间残留空格")

    # 破折号是句中符号，不能被当段落边界
    for n in nodes:
        paras = n["display"].split("\n")
        for i, para in enumerate(paras[:-1]):
            if para.rstrip().endswith("—"):
                err(f"条目 {n['id']} 第 {i + 1} 段以破折号结尾（句子被劈开了）")


def check_routing(nodes: list[dict], gaps: dict) -> None:
    """掷完骰子能不能自动把玩家带走？

    这是**规则自动化**的核心不变量。原文里检定的分支有五种写法（成功/失败、
    通过/没有通过、胜出/落败、大失败、孤注一掷），外加「兜底出口」（成功失败走
    同一条路）。解析器漏认任何一种，那条链接就拿不到 outcome 标记，引擎配对不上，
    只能弹出「请自己选通没通过」——玩家得替引擎做规则判断。

    这里按引擎（src/engine/state.ts 的 analyze）的同一套规则重算一遍：
      唯一的检定 + 每组结果至多一条链接 → 必须能定出成功与失败两条路
    定不出来的条目必须登记在 knownGaps.manualRoute 里，多一个就报 ERROR。

    历史：这一项从缺的时候，14 个条目退化成了手点，其中包括只写「通过/没有通过」
    的条目 134 —— 玩家掷出大失败还得自己宣布「我没通过」。
    """
    manual = {int(k) for k in gaps.get("manualRoute", {})}
    found: list[int] = []

    for n in nodes:
        # 结局/死路没有下一站，掷骰只为结算效果，不算问题
        if n["kind"] in ("ending", "dead_end") or not n["checks"]:
            continue
        routable = len(n["checks"]) == 1
        groups: dict[str, int] = {}
        for link in n["links"]:
            outcome = link.get("outcome")
            if not outcome or link.get("condition"):
                continue
            groups[outcome] = groups.get(outcome, 0) + 1
            if groups[outcome] > 1:
                routable = False
        if not routable:
            found.append(n["id"])
            continue
        if groups.get("always"):
            continue  # 兜底出口：成功失败同路，两边都有落点
        if not groups.get("success") or not groups.get("failure"):
            found.append(n["id"])

    unregistered = [i for i in found if i not in manual]
    stale = sorted(manual - set(found))
    if unregistered:
        err(
            "掷完骰子无法自动结算的检定（玩家得自己判通没通过）："
            f"{sorted(unregistered)}。多半是解析器漏认了某种分支措辞"
            "（见 txt_to_scenes.py 的 detect_links），请先核对正文；"
            "若确实是原书没有唯一分支，才登记到 overrides.json 的 knownGaps.manualRoute。"
        )
    if stale:
        warn(f"knownGaps.manualRoute 里的条目 {stale} 现在能自动结算了，请从名单里删掉")


def main() -> int:
    ap = argparse.ArgumentParser(description="校验 script.json 的完整性")
    ap.add_argument("--json", action="store_true", help="以 JSON 输出结果")
    args = ap.parse_args()

    script = load_json(SCRIPT_PATH)
    skills_doc = load_json(SKILLS_PATH)
    overrides = load_json(OVERRIDES_PATH)
    gaps = overrides.get("knownGaps", {})

    nodes = script["nodes"]
    resolvable, aliases, families = build_resolvers(skills_doc)  # type: ignore[misc]

    check_structure(nodes, script.get("meta", {}), gaps)
    check_links(nodes, gaps)
    check_checks(nodes, resolvable, aliases, families, gaps)
    check_effects(nodes, resolvable, aliases, families, gaps)
    check_conditions(nodes, resolvable, gaps)
    check_routing(nodes, gaps)
    seen, unreachable = check_graph(nodes, gaps)
    check_typography(nodes, gaps)

    if args.json:
        print(json.dumps(
            {"findings": [{"level": lv, "message": m} for lv, m in findings],
             "reachable": len(seen), "unreachable": len(unreachable)},
            ensure_ascii=False, indent=2))
    else:
        print(f"向火独行 · 剧本校验")
        print(f"条目 {len(nodes)} 条｜静态可达 {len(seen)} 条｜不可达 {len(unreachable)} 条")
        print(f"检定点 {sum(len(n['checks']) for n in nodes)} 个｜"
              f"跳转 {sum(len(n['links']) for n in nodes)} 个")
        print()
        if not findings:
            print("全部检查通过。")
        for level, msg in findings:
            print(f"[{level}] {msg}")
        errors = sum(1 for lv, _ in findings if lv == "ERROR")
        warns = sum(1 for lv, _ in findings if lv == "WARN")
        print()
        print(f"结论：{errors} 个错误、{warns} 个警告。")
        if errors:
            print("错误意味着剧本可能已经被改坏，或出现了尚未登记的缺口——请核实后再登记。")

    return 1 if any(lv == "ERROR" for lv, _ in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
