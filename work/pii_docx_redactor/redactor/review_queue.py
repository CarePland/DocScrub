from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Optional

from .models import Decision


ACTION_TO_DECISION = {
    "Keep": Decision.KEEP,
    "Rename": Decision.RENAME,
    "Redact": Decision.REDACT,
    "Ignore": Decision.NOT_SENSITIVE,
    # Legacy aliases accepted for saved decisions and older UI paths.
    "Wrong Match": Decision.NOT_SENSITIVE,
    "Review": Decision.REVIEW,
}


DECISION_TO_ACTION = {
    Decision.KEEP: "Keep",
    Decision.RENAME: "Rename",
    Decision.REDACT: "Redact",
    Decision.REVIEW: "Ignore",
    Decision.NOT_SENSITIVE: "Ignore",
    Decision.UNDECIDED: "Keep",
}


@dataclass(frozen=True)
class QueueItem:
    key: str
    decision: Decision = Decision.UNDECIDED
    visible: bool = True

    @property
    def decided(self) -> bool:
        return self.decision != Decision.UNDECIDED


def visible_items(items: Iterable[QueueItem]) -> List[QueueItem]:
    return [item for item in items if item.visible]


def first_active_key(items: Iterable[QueueItem]) -> Optional[str]:
    visible = visible_items(items)
    for item in visible:
        if not item.decided:
            return item.key
    return visible[0].key if visible else None


def reconcile_active_key(items: Iterable[QueueItem], active_key: Optional[str]) -> Optional[str]:
    visible = visible_items(items)
    if not visible:
        return None
    if active_key and any(item.key == active_key for item in visible):
        return active_key
    return first_active_key(visible)


def move_active_key(items: Iterable[QueueItem], active_key: Optional[str], command: str, page_size: int = 8) -> Optional[str]:
    visible = visible_items(items)
    if not visible:
        return None
    active_key = reconcile_active_key(visible, active_key)
    index = next((idx for idx, item in enumerate(visible) if item.key == active_key), 0)
    if command == "ArrowDown":
        index = min(len(visible) - 1, index + 1)
    elif command == "ArrowUp":
        index = max(0, index - 1)
    elif command == "Home":
        index = 0
    elif command == "End":
        index = len(visible) - 1
    elif command == "PageDown":
        index = min(len(visible) - 1, index + page_size)
    elif command == "PageUp":
        index = max(0, index - page_size)
    return visible[index].key


def next_undecided_after_decision(items: Iterable[QueueItem], active_key: str) -> Optional[str]:
    visible = visible_items(items)
    if not visible:
        return None
    index = next((idx for idx, item in enumerate(visible) if item.key == active_key), len(visible) - 1)
    for item in visible[index + 1 :]:
        if not item.decided:
            return item.key
    for item in reversed(visible[:index]):
        if not item.decided:
            return item.key
    return visible[index].key


def shortcut_to_action(key: str, *, meta: bool = False, ctrl: bool = False, alt: bool = False, shift: bool = False) -> Optional[str]:
    if meta or ctrl or alt or shift:
        return None
    mapping = {
        "k": "Keep",
        "n": "Rename",
        "r": "Redact",
        "i": "Ignore",
    }
    return mapping.get(key.casefold())


def should_ignore_keyboard_event(target_tag: str, *, editable: bool = False) -> bool:
    if editable:
        return True
    return target_tag.lower() in {"input", "textarea", "select", "button"}
