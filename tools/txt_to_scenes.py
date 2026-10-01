"""把《向火独行》的纯文本剧本解析成结构化 JSON。

输入：向火独行_ver15.txt（PDF 线性化后的文本，由用户从 docx 转出）
输出：src/content/scenes/script.json
     + tools/_parse_report.txt（异常报告，供人工复核）

解析策略（重要设计取舍）
------------------------
剧本是 PDF 双栏排版被"顺序"读出来的结果，因此存在**正文位移**：
条目 48 的编号出现在条目 50 之前，但它的正文被排到了 50 的正文之后。
（证据：条目 36 说"攀爬检定成功转到 48"，而那段被位移的正文正好是攀爬成功段落。）

所以本解析器**不猜测**，只做两件事：
  1. 用"编号行 = 条目正文起点"这条确定性规则切分，得到 nodes[i].text
  2. 把所有可疑之处（空正文、乱序编号、一个条目出现多个终止跳转）
     写进报告文件，并支持用 tools/overrides.json 做**显式、可审计**的修补

这样异常永远是被"报告 + 人工确认"，而不是被静默吞掉。

跑法：python tools/txt_to_scenes.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "向火独行_ver15.txt"
OUT_DIR = ROOT / "src" / "content" / "scenes"
OUT_JSON = OUT_DIR / "script.json"
OVERRIDES = ROOT / "tools" / "overrides.json"
REPORT = ROOT / "tools" / "_parse_report.txt"

# --- 词法规则 -------------------------------------------------------------

# 条目编号行：单独一行，纯数字，可能带一个 # （原文注释说"标题后有一个不可见的井号"）
RE_HEADER = re.compile(r"^(\d{1,3})\s*#?$")
# 页码行：罗马数字（IV / VII / LIII / XXXVIII ...）
# 上限给到 8 是因为本书页码排到 XXXVIII（7 个字符）。原来写 {1,6}，
# 结果 XXXVIII 这一行没被丢掉，直接混进条目 191 的正文末尾。
RE_ROMAN = re.compile(r"^[IVXLCDM]{1,8}$")
# 页眉行：PDF 每一页顶部重复的书名
PAGE_HEADERS = {"ALONE AGAINST THE FLAMES", "向火独行"}
# 汉化组水印：夹在正文中间（源文件 510 / 1025 / 1544 行），
# 不滤掉就会直接混进条目 191 之类的正文末尾，读者会以为它是剧情的一部分。
WATERMARK = re.compile(r"^.{0,6}(?:个人)?汉化$|^汉化\s*[:：]\s*.{1,12}$")
# 跳转：转到 / 翻到 + 编号
# 用 [转翻]\s*到 而不是 (?:转到|翻到)：PDF 抽文里会出现「转 到 104」这种把关键词
# 拆开的逐字空格。normalize_cjk_spacing() 已经会在多数情况下把它合起来，
# 但条目边界恰好落在「转」和「到」之间时仍需这个正则兜底。
RE_GOTO = re.compile(r"[转翻]\s*到\s*(\d{1,3})")
# 检定：「技能名」检定 / “属性名”检定 / 检定（难度前缀：困难 / 极难）
# 这里只需要一个正则：属性名（力量/敏捷/理智…）本身就符合「引号 + 1~12 字 + 检定」，
# 所以不要再写第二个属性专用正则 —— 两个都跑会把每条属性检定数成两次，
# 而引擎只在「本条目恰好 1 个检定」时自动结算，翻倍会直接干掉自动结算。
RE_CHECK_SKILL = re.compile(r"[「“\"]([^」”\"]{1,12})[」”\"]\s*(?:检定|检订)")
RE_CHECK_DIFF = re.compile(r"(极难|困难)\s*(?:难度)?\s*(?:的)?\s*(?:[「“\"][^」”\"]+[」”\"]\s*)?检定")
# 伤害 / 恢复数值：1D3 / 1D6 / 2D6 / 1D4 / 1D2 / 纯数字
DICE = r"\d+D\d+|\d+"
RE_LOSE_SAN = re.compile(rf"(?:失去|损失)\s*({DICE})\s*点\s*(?:理智值|理智|SAN)")
RE_LOSE_HP = re.compile(rf"(?:失去|损失|受到|造成)\s*({DICE})\s*点\s*(?:生命值|体力|HP|伤害)")
RE_GAIN_HP = re.compile(rf"回复\s*({DICE})\s*点\s*(?:生命值|体力|HP)")
RE_GAIN_SAN = re.compile(rf"回复\s*({DICE})\s*点\s*(?:理智值|理智|SAN)")
RE_TICK = re.compile(r"[「“\"]([^」”\"]{1,12})[」”\"]\s*技能?左边的小方框里打勾")
RE_ENDING = re.compile(r"【剧终】")

# 条件跳转：如果你的“体型”是40，转到23 / 高于 40
RE_COND_NUM = re.compile(
    r"你的[“\"]([^”\"]{1,6})[”\"]\s*(是|等于|高于|大于|大于等于|低于|小于|小于等于|不超过|至少)\s*(\d+)"
)

# 段落换行判定：上一段以这些字符结尾 => 视为换段，否则视为 PDF 折行（直接拼接）
#
# 破折号（—）**故意不在此列**：源文件里 16 处以 —— 结尾的行全是句中破折号，
# 下一行是同一句的延续（「你两脚一软——」/「失去 1D3 点理智值。」），
# 曾把它当段落边界，结果是每处悬念都多断一段。
PARA_END = "。！？…”』】）"

# CJK 字符集（含全角标点），用于消除逐字空格
CJK = r"\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef"
# PDF 里部分条目被逐字加了空格（像表格单元格/旋转文本），例如：
#   「要 接 受 饮 料， 转 到 104。 要 拒 绝， 转 到113。」
# 这会同时毁掉显示文本（读者看到「要 接 受 饮 料」）和词法识别
# （RE_GOTO 匹配不到「转 到 104」，于是条目 104/113/140/147 等变成孤岛）。
# 只删除「两侧都是中日韩字符」的空格，因此中英混排的「第 11 页」不受影响。
RE_CJK_SPACE = re.compile(rf"([{CJK}])[ \t\u3000]+(?=[{CJK}])")


def normalize_cjk_spacing(line: str) -> str:
    prev = None
    while prev != line:
        prev = line
        line = RE_CJK_SPACE.sub(r"\1", line)
    return line


def read_lines() -> list[str]:
    text = SRC.read_text(encoding="utf-8-sig")
    raw = text.splitlines()
    out = []
    for line in raw:
        # 去掉零宽字符与首尾空白
        line = line.replace("\u200b", "").replace("\ufeff", "").strip()
        if not line:
            continue
        out.append(normalize_cjk_spacing(line))
    return out


def split_sentences(paragraph: str) -> list[str]:
    """按中文句末标点切句，保留标点。"""
    out: list[str] = []
    buf = ""
    for ch in paragraph:
        buf += ch
        if ch in "。！？":
            out.append(buf)
            buf = ""
    if buf:
        out.append(buf)
    return out


def paren_depth(s: str) -> int:
    """未闭合的括号数。译注（…）会跨 PDF 的视觉行，行内的句号不代表段落结束。"""
    return s.count("（") + s.count("(") - s.count("）") - s.count(")")


def join_lines(lines: list[str]) -> str:
    """把 PDF 的视觉换行拼回段落。

    规则：上一行以句末标点结尾 => 换段（\\n）；否则是折行 => 直接拼接。
    两个例外：
      1. 括号没闭合时不换段 —— 否则「（译注：……检定。）」会被从中间劈开，
         单独的「）」会自成一个段落（条目 173 / 262 真实出现过）。
      2. 破折号不算句末标点，见 PARA_END 的注释。
    """
    paras: list[str] = []
    buf = ""
    for line in lines:
        if not buf:
            buf = line
        elif paren_depth(buf) == 0 and buf.endswith(tuple(PARA_END)):
            paras.append(buf)
            buf = line
        else:
            buf += line
    if buf:
        paras.append(buf)
    return "\n".join(paras)


def parse_nodes(lines: list[str]) -> tuple[list[dict], list[str]]:
    notes: list[str] = []

    # 1) 跳过前言：定位第一个"1"编号行
    start = None
    for i, line in enumerate(lines):
        if i > 5 and RE_HEADER.match(line) and line.rstrip("#").strip() == "1":
            start = i
            break
    if start is None:
        raise SystemExit("找不到条目 1 的编号行，剧本格式可能变了")
    body = lines[start:]

    # 2) 截断到附录
    for i, line in enumerate(body):
        if line.startswith("附录一"):
            body = body[:i]
            break

    # 3) 过滤页码/页眉/水印（在切分之前，避免它们混进正文）
    clean: list[str] = []
    dropped = 0
    dropped_marks = 0
    for line in body:
        if line in PAGE_HEADERS or RE_ROMAN.match(line):
            dropped += 1
            continue
        if WATERMARK.match(line):
            dropped_marks += 1
            continue
        clean.append(line)
    notes.append(f"丢弃页码/页眉行 {dropped} 行、水印行 {dropped_marks} 行")

    # 4) 按编号行切分
    nodes: list[dict] = []
    current: dict | None = None
    for line in clean:
        m = RE_HEADER.match(line)
        if m:
            current = {"id": int(m.group(1)), "lines": []}
            nodes.append(current)
        elif current is not None:
            current["lines"].append(line)
        else:
            notes.append(f"编号出现前的游离正文（已忽略）：{line[:30]}…")

    return nodes, notes


def detect_links(text: str) -> tuple[list[dict], str]:
    """返回 (links, display_text)。

    links:  {label, to, condition?}
    display_text: 原文本去掉跳转句子后的版本，供 UI 渲染（跳转改为按钮）
    """
    links: list[dict] = []
    kept_paragraphs: list[str] = []
    has_success_branch = "如果你成功了" in text or "检定成功" in text

    for paragraph in text.split("\n"):
        kept: list[str] = []
        depth = 0
        for sent in split_sentences(paragraph):
            # 括注里的句子不是游戏规则，绝不能变按钮。
            #
            # 译注是译者加的说明，里面往往带「转到 193」这种字样。以前把它照常
            # 抽成跳转，结果是：界面多一个标签被截断的假按钮
            # （「（译注：如果你没有受过重伤但 HP 归零」），而且**可以绕过检定直接通关**
            # ——条目 173/235/262 都是近身战斗，玩家能跳过「体质」检定跳去结局。
            # 同时被剥掉那半句后，正文只剩一个孤零零的「）」。
            #
            # 判据用括号深度，而不是「整行以译注开头就丢掉」：
            # 条目 2 是「（译注：如果你的 HP 归零）你可以回复 1点生命值。现在转到 108。」，
            # 括号在句子中间就闭合了，那个 转到 108 是货真价实的出口，必须保留。
            is_parenthetical = depth > 0 or sent.lstrip().startswith(("（译注", "(译注"))
            depth += paren_depth(sent)
            if is_parenthetical:
                kept.append(sent)
                continue

            m = RE_GOTO.search(sent)
            if not m:
                kept.append(sent)
                continue

            to = int(m.group(1))
            label = sent[: m.start()].strip(" ，,。、：:")
            # 去掉"如果你成功了"这类前缀后剩下的引导语
            label = label.strip()
            link: dict = {"label": label or None, "to": to}

            cond = RE_COND_NUM.search(sent)
            if cond:
                link["condition"] = {
                    "attr": cond.group(1),
                    "op": {"是": "eq", "等于": "eq", "高于": "gt", "大于": "gt",
                           "大于等于": "gte", "低于": "lt", "小于": "lt",
                           "小于等于": "lte", "不超过": "lte", "至少": "gte"}[cond.group(2)],
                    "value": int(cond.group(3)),
                }
            # 成功/失败分支标记（供引擎自动结算检定）
            # 「否则转到 25」是最常见的失败写法（条目 34/57/87/96/133/178）。只认
            # 「失败」会让这些条目失去失败分支，而引擎只在「恰好 1 成功 + ≤1 失败」时
            # 自动结算 —— 于是把「否则」降级成普通按钮，玩家要么手点要么被卡住。
            # 判据用结构信号：本条正文里必须存在「如果你成功了」，否则「否则」可能只是
            # 「你也可以……」的意思（条目 266），那种情况让玩家自己选。
            # （译注不可能走到这里：上面 is_parenthetical 已经拦掉了。）
            if "成功" in label and "失败" not in label:
                link["outcome"] = "success"
            elif "失败" in label or ("否则" in label and has_success_branch):
                link["outcome"] = "failure"
            elif "孤注一掷" in label:
                link["outcome"] = "push"

            links.append(link)

        if kept:
            kept_paragraphs.append("".join(kept))

    display = "\n".join(p for p in kept_paragraphs if p.strip())
    return links, display


def detect_kind(node: dict, links: list[dict], text: str) -> str:
    has_check = bool(RE_CHECK_SKILL.search(text) or RE_CHECK_DIFF.search(text))
    # 【剧终】未必是本条目的结局，它可能是**条件性死亡**。例：条目 65
    #   「如果你的生命值因此归零，你就会失去意识，被烈焰烧死！【剧终】。
    #     否则，进行一次“力量”检定。如果你成功了，转到 93。如果你失败了，转到 77。」
    # 这种条目有检定也有出口，是实打实的 check 节点。把它判成 ending 会让
    # 引擎直接终局（丢掉后面的检定与分支），也会让「结局不该带检定」的约束失败。
    # 所以结局的判据是「有【剧终】且**没有任何出口**」。
    # 例外说明：条目 171 是尾声，正文里有最终理智检定但两个结果都不跳转
    # （「如果你成功了，失去 1 点理智值。如果你失败了，失去 1D4 点理智值。……【剧终】」），
    # 因此它同样是结局；那次检定当前只作为正文保留，不会被引擎结算。
    if RE_ENDING.search(text) and not links:
        return "ending"
    if "战斗轮" in text or "对抗检定" in text:
        return "combat"
    # 只看 RE_CHECK_SKILL：属性名也在它的覆盖范围内（见 detect_checks 的注释）
    if has_check:
        return "check"
    if len(links) > 1:
        return "choice"
    if links:
        return "text"
    return "dead_end"  # 无出口且非结局 => 需要人工确认


def detect_checks(text: str) -> list[dict]:
    """抽取本条目里的检定。

    注意：**不要**再单独跑一遍「属性专用正则」。属性名（力量/敏捷/理智…）本身
    就符合 RE_CHECK_SKILL 的「引号 + 1~12 字 + 检定」，两个正则都跑的话
    每一条属性检定会被数成两次，检定数全部翻倍。
    而引擎只在「本条目恰好 1 个检定」时才自动结算，翻倍会让所有检定节点
    都退化成「手动挑分支」。
    """
    out: list[dict] = []
    seen: set[str] = set()
    for m in RE_CHECK_SKILL.finditer(text):
        skill = m.group(1).strip()
        if skill in seen:
            continue
        seen.add(skill)
        out.append({"skill": skill, "difficulty": "regular"})
    if out:
        # 难度前缀只出现一次，作用于本条目内的所有检定
        d = RE_CHECK_DIFF.search(text)
        if d:
            diff = "extreme" if d.group(1) == "极难" else "hard"
            for c in out:
                c["difficulty"] = diff
    return out


def sentence_at(text: str, start: int, end: int) -> str:
    """取 start..end 这一段所在的整句（以。！？或换行为界）。"""
    left = max(text.rfind(c, 0, start) for c in "。！？\n") + 1
    rights = [p for p in (text.find(c, end) for c in "。！？\n") if p != -1]
    right = min(rights) if rights else len(text)
    return text[left:right + 1].strip()


# 「怎么用 D6 模拟 D2」这类说明句：里面写着「表示失去 1 点理智值」，
# 但那是教玩家掷骰，不是玩家的损失。命中就会让角色一次性掉 1+2 点理智。
RE_EXPLANATORY = re.compile(r"普通六面骰|表示失去|表示回复|小数进位")
# 怪物数据块：「它的「爪击」技能为 35%（半值 17%…），每次攻击成功后都能造成 2D6 点伤害」。
# 这是**敌人**的伤害，照抄会让玩家一进战斗条目就先掉 2D6+1D8 点生命值。
RE_STAT_BLOCK = re.compile(r"技能[为是]\s*\d+\s*%|[（(]半值")


def detect_effects(text: str, report: list[str] | None = None) -> list[dict]:
    """抽取本条目里的数值效果。

    两条规则，都必须在报告里留下痕迹（宁可吵，不可静）：
    * 效果写在「如果你成功了／失败了」的从句里 → 记 when，由引擎在检定结算后应用。
      漏掉这一步的后果是双向的：结局 171 曾同时扣成功与失败两份理智。
    * 说明句与怪物数据块里的数字 → **丢弃**，并在报告里列出被丢掉的原文，
      供人工复核。宁可少扣一次，也不要在无声中把角色算错。
    """
    eff: list[dict] = []

    def add(item: dict, sent: str) -> None:
        if RE_EXPLANATORY.search(sent) or RE_STAT_BLOCK.search(sent):
            if report is not None:
                report.append(f"已忽略说明/数据句里的数值（{item.get('kind')} "
                              f"{item.get('value') or item.get('skill')}）: 「{sent[:60]}」")
            return
        has_fail, has_succ = "失败" in sent, "成功" in sent
        # 「成功后」常是怪物攻击命中，不是玩家的检定：上面的 RE_STAT_BLOCK 已经先拦了。
        if has_fail and not has_succ:
            item["when"] = "failure"
        elif has_succ and not has_fail:
            item["when"] = "success"
        elif has_fail and has_succ and report is not None:
            report.append(f"效果所在句子同时提到成功与失败，未标注 when（需人工确认）: 「{sent[:60]}」")
        eff.append(item)

    for m in RE_LOSE_SAN.finditer(text):
        add({"kind": "san", "op": "lose", "value": m.group(1)}, sentence_at(text, m.start(), m.end()))
    for m in RE_LOSE_HP.finditer(text):
        add({"kind": "hp", "op": "lose", "value": m.group(1)}, sentence_at(text, m.start(), m.end()))
    for m in RE_GAIN_HP.finditer(text):
        add({"kind": "hp", "op": "gain", "value": m.group(1)}, sentence_at(text, m.start(), m.end()))
    for m in RE_GAIN_SAN.finditer(text):
        add({"kind": "san", "op": "gain", "value": m.group(1)}, sentence_at(text, m.start(), m.end()))
    for m in RE_TICK.finditer(text):
        add({"kind": "tick", "skill": m.group(1)}, sentence_at(text, m.start(), m.end()))
    return eff


def apply_overrides(nodes: list[dict], overrides: dict) -> list[str]:
    """按 tools/overrides.json 显式搬运被 PDF 排版打散的段落。"""
    notes: list[str] = []
    by_id = {n["id"]: n for n in nodes}
    for rule in overrides.get("moveParagraphs", []):
        frm, to, match = by_id.get(rule["fromNode"]), by_id.get(rule["toNode"]), rule["match"]
        if frm is None or to is None:
            notes.append(f"[override 失败] 节点不存在: {rule}")
            continue
        paras = frm["text"].split("\n")
        idx = next((i for i, p in enumerate(paras) if match in p), None)
        if idx is None:
            notes.append(f"[override 失败] 在 {rule['fromNode']} 中找不到 {match!r}")
            continue
        moved = paras[idx:]
        frm["text"] = "\n".join(paras[:idx])
        to["text"] = "\n".join(moved + ([to["text"]] if to["text"] else []))
        notes.append(f"[override] 把 {rule['fromNode']} 中 {len(moved)} 段搬运到 {rule['toNode']}")
    return notes


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"找不到剧本：{SRC}")

    lines = read_lines()
    raw_nodes, notes = parse_nodes(lines)

    nodes: list[dict] = []
    for n in raw_nodes:
        nodes.append({"id": n["id"], "text": join_lines(n["lines"])})

    overrides = json.loads(OVERRIDES.read_text(encoding="utf-8")) if OVERRIDES.exists() else {}
    notes += apply_overrides(nodes, overrides)

    # 组装
    out: list[dict] = []
    seen: dict[int, int] = {}
    effect_report: list[str] = []
    for n in nodes:
        nid = n["id"]
        seen[nid] = seen.get(nid, 0) + 1
        links, display = detect_links(n["text"])
        node_effect_report: list[str] = []
        out.append({
            "id": nid,
            "kind": detect_kind(n, links, n["text"]),
            "text": n["text"],
            "display": display,
            "links": links,
            "checks": detect_checks(n["text"]),
            "effects": detect_effects(n["text"], node_effect_report),
        })
        effect_report += [f"条目 {nid}: {m}" for m in node_effect_report]

    # --- 异常报告 ---------------------------------------------------------
    warns: list[str] = []
    ids = [n["id"] for n in out]
    dup = [i for i, c in seen.items() if c > 1]
    if dup:
        warns.append(f"重复编号: {sorted(dup)}")
    missing = sorted(set(range(1, max(ids) + 1)) - set(ids))
    if missing:
        warns.append(f"缺失编号 ({len(missing)} 个): {missing}")

    order_bad = [(ids[i - 1], ids[i]) for i in range(1, len(ids)) if ids[i] < ids[i - 1]]
    if order_bad:
        warns.append(f"编号乱序 {len(order_bad)} 处: {order_bad}")

    empty = [n["id"] for n in out if not n["text"].strip()]
    if empty:
        warns.append(f"正文为空: {empty}")

    dead = [n["id"] for n in out if n["kind"] == "dead_end"]
    if dead:
        warns.append(f"无出口且非结局（需人工确认）: {dead}")

    targets = {l["to"] for n in out for l in n["links"]}
    dangling = sorted(targets - set(ids))
    if dangling:
        warns.append(f"断链（跳转到不存在的条目）: {dangling}")

    reachable = {1}
    frontier = [1]
    by_id = {n["id"]: n for n in out}
    while frontier:
        cur = frontier.pop()
        for l in by_id.get(cur, {}).get("links", []):
            if l["to"] not in reachable and l["to"] in by_id:
                reachable.add(l["to"])
                frontier.append(l["to"])
    orphan = sorted(set(ids) - reachable)
    if orphan:
        warns.append(f"孤立条目（从 1 到不了，{len(orphan)} 个）: {orphan}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "meta": {
            "title": "向火独行",
            "system": "Call of Cthulhu 7e",
            "source": SRC.name,
            "nodeCount": len(out),
        },
        "nodes": out,
    }
    OUT_JSON.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    kind_count: dict[str, int] = {}
    for n in out:
        kind_count[n["kind"]] = kind_count.get(n["kind"], 0) + 1

    report = [
        f"条目总数: {len(out)}  编号范围: {min(ids)}-{max(ids)}",
        f"链接总数: {sum(len(n['links']) for n in out)}",
        "条目类型分布: " + ", ".join(f"{k}={v}" for k, v in sorted(kind_count.items())),
        f"带前提的效果（when: success/failure）: "
        f"{sum(1 for n in out for e in n['effects'] if e.get('when'))} 个",
        f"无条件效果: {sum(1 for n in out for e in n['effects'] if not e.get('when'))} 个",
        "",
        "== 解析说明 ==",
        *notes,
        "",
        "== 效果复核（说明句/怪物数据里被丢掉的数字） ==",
        *(effect_report if effect_report else ["（无）"]),
        "",
        "== 警告 ==",
        *(warns if warns else ["（无）"]),
    ]
    REPORT.write_text("\n".join(report), encoding="utf-8")
    print(f"OK 写入 {OUT_JSON.relative_to(ROOT)}")
    print(f"OK 写入 {REPORT.relative_to(ROOT)}")
    print(report[0] + " | " + report[2] + f" | 警告 {len(warns)} 条")


if __name__ == "__main__":
    main()
