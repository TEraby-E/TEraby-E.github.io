"""Remove selectable 408 cards whose titles contain 王道书.

This edits only the public task catalogue. A minimal retired-ID register keeps
old saved records readable; no personal progress or source exports are read.
Running the script repeatedly produces the same library bytes.
"""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
import json
from pathlib import Path


SUBJECTS_408 = {"ds", "co", "os", "cn"}
TITLE_MARKER = "王道书"
REGISTER_FIELDS = (
    "id", "subject_id", "estimated_minutes", "estimated_source",
    "estimate_group", "source_video_minutes",
)


def remove_book_cards(library: dict) -> tuple[dict, dict]:
    result = deepcopy(library)
    original_kept = {}
    metadata = result.setdefault("metadata", {})
    retired = {
        row["id"]: {key: row.get(key) for key in REGISTER_FIELDS}
        for row in metadata.get("retired_tasks", [])
    }
    removed = Counter()
    chapter_counts = {}
    subject_order = {subject["id"]: index for index, subject in enumerate(result["subjects"])}

    for subject in result["subjects"]:
        chapters = []
        for chapter in subject["chapters"]:
            kept = []
            for task in chapter["tasks"]:
                if subject["id"] in SUBJECTS_408 and TITLE_MARKER in task.get("title", ""):
                    registration = {key: task.get(key) for key in REGISTER_FIELDS}
                    registration["subject_id"] = subject["id"]
                    retired.setdefault(task["id"], registration)
                    removed[subject["id"]] += 1
                else:
                    original_kept[task["id"]] = deepcopy(task)
                    kept.append(task)
            chapter["tasks"] = kept
            if kept:
                chapters.append(chapter)
        subject["chapters"] = chapters
        chapter_counts[subject["id"]] = {"chapters": len(chapters), "tasks": sum(len(chapter["tasks"]) for chapter in chapters)}

    tasks = [task for subject in result["subjects"] for chapter in subject["chapters"] for task in chapter["tasks"]]
    assert len({task["id"] for task in tasks}) == len(tasks), "Duplicate active task IDs"
    assert {task["id"]: task for task in tasks} == original_kept, "Unrelated learning content changed"
    assert not set(original_kept).intersection(retired), "An active task is also registered as retired"

    metadata["subject_count"] = len(result["subjects"])
    metadata["task_count"] = len(tasks)
    metadata["chapter_count"] = sum(row["chapters"] for row in chapter_counts.values())
    metadata["counts"] = chapter_counts
    metadata["retired_tasks"] = sorted(retired.values(), key=lambda row: (subject_order.get(row["subject_id"], 999), row["id"]))
    metadata["retired_task_policy"] = "仅从408可选任务库移除标题含“王道书”的卡片；保留最小退役ID和预计用时登记，已有历史记录不清空。"
    metadata["coverage_scope"] = "coverage记录原始资料的初始导入情况；当前可选任务数量以task_count、chapter_count、counts为准，退役卡片不再供选择。"

    estimates = metadata.setdefault("estimates", {})
    estimates["known_tasks"] = sum(task.get("estimated_minutes") is not None for task in tasks)
    estimates["unknown_tasks"] = len(tasks) - estimates["known_tasks"]
    estimates["by_subject"] = {}
    for subject in result["subjects"]:
        rows = [task for chapter in subject["chapters"] for task in chapter["tasks"]]
        known = sum(task.get("estimated_minutes") is not None for task in rows)
        estimates["by_subject"][subject["id"]] = {"known": known, "unknown": len(rows) - known}
    groups = Counter(task["estimate_group"] for task in tasks if str(task.get("estimate_group") or "").startswith("shared:"))
    estimates["shared_groups"] = len(groups)
    estimates["shared_scoped_tasks"] = sum(groups.values())
    estimates["video_lengths_available"] = sum(task.get("source_video_minutes") is not None for task in tasks)

    return result, {"removed_this_run": dict(removed), "active_tasks": len(tasks), "active_chapters": metadata["chapter_count"], "retired_ids": len(retired)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, default=Path(__file__).resolve().parents[1] / "study/data/library.json")
    arguments = parser.parse_args()
    original = json.loads(arguments.library.read_text(encoding="utf-8"))
    result, summary = remove_book_cards(original)
    temporary = arguments.library.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(arguments.library)
    print(json.dumps(summary, ensure_ascii=True))


if __name__ == "__main__":
    main()
