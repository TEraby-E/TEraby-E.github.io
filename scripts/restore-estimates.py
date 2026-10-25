"""Restore study estimates from explicitly supplied private source exports.

Usage:
  python scripts/restore-estimates.py --source-dir PATH_TO_PRIVATE_EXPORTS

The source directory is a development input, not part of the website. This script
copies neither timetable dates nor personal check-in records into the release.
Task IDs and all existing learning content remain unchanged. Run again with the
same inputs to obtain the same library.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import re


ESTIMATE_FIELDS = ("estimated_minutes", "estimated_source", "estimate_group", "source_video_minutes")
DURATION = re.compile(r"(?:限时|约|共计|计时)?\s*\d+(?:\.\d+)?(?:[—–－\-~～至]\d+(?:\.\d+)?)?\s*(?:minutes?|mins?|分钟|小时)", re.I)
DAY_SEGMENT = re.compile(r"(?:知识点|习题)?第\d+\s*/\s*\d+天")


def digest(*parts: object) -> str:
    value = json.dumps(parts, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:20]


def canonical_text(value: object) -> str:
    """Match the original chapter-library builder's source reference keys."""
    if value is None:
        return ""
    text = str(value).replace("\r\n", "\n").strip()
    for phrase in (
        "只推进本日知识点课段；观看、暂停推导和整理定义公式均计入本时段。",
        "不另开一场固定周期测试。", "按当前章节进度完成练习。",
        "按当前实际完成进度续做。", "剩余时间", "续学日不重复计为新题。",
        "；本日用于已做题巩固。", "不在本时段看解析", "连续计时", "继续计时",
    ):
        text = text.replace(phrase, "")
    text = re.sub(r"截至\d{4}-\d{2}-\d{2}", "", text)
    text = re.sub(r"\d{4}-\d{2}-\d{2}", "", text)
    text = DURATION.sub("", text)
    text = DAY_SEGMENT.sub("", text)
    text = re.sub(r"(?:建议|计划|预计)\s*\d+天", "", text)
    text = re.sub(r"任务[12]｜", "", text)
    text = text.replace("本日重点", "学习重点").replace("本日", "本次")
    text = text.replace("今天", "本次").replace("当天", "本次").replace("当日", "本次")
    text = text.replace("本周", "当前").replace("当周", "对应").replace("本时段", "本次练习")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[；;]\s*[；;]", "；", text)
    text = re.sub(r"。\s*。", "。", text)
    text = re.sub(r"｜\s*｜", "｜", text)
    return text.strip(" \n｜；;。，、：")


def minute_value(value: object) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        return None
    return int(value) if float(value).is_integer() else float(value)


def video_minutes(value: object) -> int | float | None:
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|分钟|h(?:our)?s?|小时)\s*", str(value or ""), re.I)
    if not match:
        return None
    number = float(match.group(1)) * (60 if match.group(2).lower().startswith("h") or match.group(2) == "小时" else 1)
    return minute_value(number)


def unique_rows(rows: list[dict]) -> list[dict]:
    seen, result = set(), []
    for row in rows:
        key = (row["_date"], row["topic"], row["action"], row["minutes"])
        if key not in seen:
            seen.add(key)
            result.append(row)
    return result


def plan_estimate(rows: list[dict]) -> tuple[int | float | None, str]:
    rows = unique_rows(rows)
    if not rows:
        return None, "原资料未提供预计用时"
    # A numbered 1/N, 2/N course is one complete merged learning task.
    if any(DAY_SEGMENT.search(row["topic"]) for row in rows):
        segments = defaultdict(list)
        for row in rows:
            segments[row["topic"]].append(row)
        total = 0
        for segment in segments.values():
            first_date = min(row["_date"] for row in segment)
            total += sum(row["minutes"] for row in segment if row["_date"] == first_date)
        return minute_value(total), "原计划分段用时合计"
    # These chapter assessments were deliberately fitted across adjacent days.
    if rows[0]["subject"] == "408·数据结构" and canonical_text(rows[0]["topic"]).startswith("章节检测"):
        return minute_value(sum(row["minutes"] for row in rows)), "原计划分段用时合计"
    # Recurring reviews are reusable activities, not the sum of every recurrence.
    first_date = min(row["_date"] for row in rows)
    total = sum(row["minutes"] for row in rows if row["_date"] == first_date)
    recurrent = any(row["_date"] != first_date for row in rows)
    return minute_value(total), "原计划单次预计用时（首次安排）" if recurrent else "原计划预计用时"


def source_estimate(rows: list[dict]) -> tuple[int | float | None, str]:
    progress = [row for row in rows if row.get("source_progress")]
    if progress:
        # Original source tasks can span days. Later redo blocks lack this
        # progress record and must never inflate the first-learning estimate.
        ends = [row["source_progress"]["completed_minutes_before"] + row["source_progress"]["allocated_minutes"] for row in progress]
        return minute_value(max(ends)), "原计划分段用时合计" if len(progress) > 1 else "原计划预计用时"
    if not rows:
        return None, "原资料未提供预计用时"
    # Network-photo tasks have no progress metadata. Use only the original
    # learning topic; later acceptance checks and application-redo rows differ.
    original_topic = rows[0]["topic"]
    original_rows = [row for row in rows if row["topic"] == original_topic]
    return plan_estimate(original_rows)


def restore(library: dict, source_dir: Path) -> dict:
    read = lambda name: json.loads((source_dir / name).read_text(encoding="utf-8"))
    days = read("shifted_wangdao_blocks.json")
    by_source, by_reference = defaultdict(list), defaultdict(list)
    videos = {}
    for day in days:
        for original in day["blocks"]:
            row = dict(original, _date=day["date"])
            if minute_value(row.get("minutes")) is None:
                raise ValueError("Source block contains an invalid minute value")
            if row.get("source_id"):
                by_source[row["source_id"]].append(row)
                fields = row.get("source_fields") or {}
                video = video_minutes(fields.get("reference_quantity") or fields.get("quantity"))
                if video is not None:
                    videos.setdefault(row["source_id"], video)
            else:
                reference = "plan:" + digest(row["subject"], canonical_text(row["topic"]), canonical_text(row["action"]))
                by_reference[reference].append(row)
    for row in read("comp_org_extracted.json"):
        video = video_minutes(row.get("quantity"))
        if video is not None:
            videos.setdefault(row["id"], video)

    flat = [task for subject in library["subjects"] for chapter in subject["chapters"] for task in chapter["tasks"]]
    original_content = [{key: value for key, value in task.items() if key not in ESTIMATE_FIELDS} for task in flat]
    unmatched = []
    counts = {}
    for subject in library["subjects"]:
        known = unknown = 0
        for chapter in subject["chapters"]:
            for task in chapter["tasks"]:
                source_id = task.get("source_id")
                references = task.get("source_refs") or []
                if source_id:
                    minutes, source = source_estimate(by_source.get(source_id, []))
                elif references:
                    estimates = [plan_estimate(by_reference.get(reference, [])) for reference in references]
                    missing = [reference for reference in references if reference not in by_reference]
                    unmatched.extend(missing)
                    minutes = minute_value(sum(estimate[0] for estimate in estimates)) if all(estimate[0] is not None for estimate in estimates) else None
                    source = "原计划分段用时合计" if len(estimates) > 1 else estimates[0][1]
                else:
                    minutes, source = None, "原资料未提供预计用时"
                video = videos.get(source_id)
                if minutes is None and video is not None:
                    minutes, source = video, "原视频时长（未含其他学习用时）"
                shared = bool(task.get("scope") and references)
                group = "shared:" + digest(sorted(references)) if shared else task["id"]
                if shared and minutes is not None:
                    source = "共享原任务预计用时（整项）"
                task.update(estimated_minutes=minutes, estimated_source=source, estimate_group=group, source_video_minutes=video)
                known += minutes is not None
                unknown += minutes is None
        counts[subject["id"]] = {"known": known, "unknown": unknown}
    if unmatched:
        raise ValueError(f"Cannot match {len(set(unmatched))} source references; no output written")
    after_content = [{key: value for key, value in task.items() if key not in ESTIMATE_FIELDS} for task in flat]
    assert original_content == after_content, "Learning content was unexpectedly changed"
    assert len({task["id"] for task in flat}) == len(flat)
    shared_groups = Counter(task["estimate_group"] for task in flat if task["estimate_group"].startswith("shared:"))
    library["metadata"]["duration_policy"] = "预计用时恢复自原计划；连续课段合计，重复复做不累计；共享整项按estimate_group仅计一次。视频原长单列，缺失值为null，不推测实际学习时长。"
    library["metadata"]["estimates"] = {
        "source_files": ["shifted_wangdao_blocks.json", "comp_org_extracted.json"],
        "known_tasks": sum(row["known"] for row in counts.values()),
        "unknown_tasks": sum(row["unknown"] for row in counts.values()),
        "by_subject": counts,
        "shared_groups": len(shared_groups),
        "shared_scoped_tasks": sum(shared_groups.values()),
        "video_lengths_available": sum(task["source_video_minutes"] is not None for task in flat),
        "notes": [
            "首次学习中跨日拆分的source_progress按最大已完成端点恢复，后续复做不重复累计。",
            "合并课程的不同原课段相加；周期性重复复习保留首次完整安排，不累计整个时间表中的重复次数。",
            "拆为多个学科的同一原整卷/复盘保留共享整项时间；只选择其中一科时，原资料未提供该科单独分配时间。",
            "source_video_minutes仅表示原视频长度；estimated_minutes优先使用原计划包含观看、练习及整理的预计用时。",
        ],
    }
    return library


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path, help="Private source export directory; never copied to the website")
    parser.add_argument("--library", type=Path, default=Path(__file__).resolve().parents[1] / "study/data/library.json")
    arguments = parser.parse_args()
    library = json.loads(arguments.library.read_text(encoding="utf-8"))
    restored = restore(library, arguments.source_dir)
    output = json.dumps(restored, ensure_ascii=False, indent=2) + "\n"
    temporary = arguments.library.with_suffix(".json.tmp")
    temporary.write_text(output, encoding="utf-8")
    temporary.replace(arguments.library)
    print(json.dumps(restored["metadata"]["estimates"], ensure_ascii=True))


if __name__ == "__main__":
    main()
