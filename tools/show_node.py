"""查看解析后的剧本，用于人工核查。

跑法：
    python tools/show_node.py --roots           # 只列出"真断点"：无人指向的孤立条目
    python tools/show_node.py --summary
    python tools/show_node.py --node 43 73 74  # 打印某几个条目的完整解析结果
    python tools/show_node.py --incoming 27    # 谁指向 27
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "src" / "content" / "scenes" / "script.json"


def load():
    data = json.loads(SCRIPT.read_text(encoding="utf-8"))
    nodes = data["nodes"]
    by_id = {n["id"]: n for n in nodes}
    return data, nodes, by_id


def incoming_map(nodes):
    inc: dict[int, list[tuple[int, str | None]]] = {}
    for n in nodes:
        for l in n["links"]:
            inc.setdefault(l["to"], []).append((n["id"], l.get("label")))
    return inc


def orphans(nodes):
    by_id = {n["id"]: n for n in nodes}
    reach = {1}
    stack = [1]
    while stack:
        cur = stack.pop()
        for l in by_id.get(cur, {}).get("links", []):
            if l["to"] in by_id and l["to"] not in reach:
                reach.add(l["to"])
                stack.append(l["to"])
    return sorted(set(by_id) - reach)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--summary", action="store_true")
    ap.add_argument("--roots", action="store_true")
    ap.add_argument("--node", type=int, nargs="*")
    ap.add_argument("--incoming", type=int)
    args = ap.parse_args()

    data, nodes, by_id = load()

    if args.summary:
        print(f"条目数 {len(nodes)}  链接数 {sum(len(n['links']) for n in nodes)}")
        print(f"孤立条目 {len(orphans(nodes))} 个")
        return

    if args.incoming is not None:
        inc = incoming_map(nodes)
        srcs = inc.get(args.incoming, [])
        print(f"指向 {args.incoming} 的条目共 {len(srcs)} 个：")
        for sid, label in srcs:
            print(f"  {sid}  (按钮文案: {label})")
        return

    if args.roots:
        inc = incoming_map(nodes)
        orph = orphans(nodes)
        roots = [i for i in orph if not inc.get(i)]
        print(f"孤立条目 {len(orph)} 个，其中**无人指向**的真断点 {len(roots)} 个：")
        for i in roots:
            n = by_id[i]
            print(f"  #{i:<4} kind={n['kind']:<8} 正文首句: {n['text'][:40]}")
        print()
        print("其余孤立条目（只是被上面的断点连带隔离）：")
        print("  " + ", ".join(str(i) for i in orph if inc.get(i)))
        return

    if args.node:
        for i in args.node:
            n = by_id.get(i)
            if not n:
                print(f"#{i} 不存在")
                continue
            print("=" * 70)
            print(f"#{i}  kind={n['kind']}  checks={n['checks']}  effects={n['effects']}")
            print("-" * 70)
            print("原文:")
            print(n["text"])
            print("-" * 70)
            print("展示文本(去掉跳转句):")
            print(n["display"])
            print("-" * 70)
            print("链接:")
            for l in n["links"]:
                extra = {k: v for k, v in l.items() if k not in ("label", "to")}
                print(f"  → {l['to']:<4} label={l['label']!r} {extra if extra else ''}")
            print()
        return

    ap.print_help()


if __name__ == "__main__":
    main()
