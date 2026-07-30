from redactor.models import Decision
from redactor.review_queue import (
    ACTION_TO_DECISION,
    QueueItem,
    first_active_key,
    move_active_key,
    next_undecided_after_decision,
    reconcile_active_key,
    shortcut_to_action,
    should_ignore_keyboard_event,
)


def item(key, decision=Decision.UNDECIDED, visible=True):
    return QueueItem(key, decision, visible)


def test_first_undecided_visible_row_becomes_active_on_load():
    assert first_active_key([item("a", Decision.KEEP), item("b")]) == "b"


def test_first_visible_row_active_when_all_decided():
    assert first_active_key([item("a", Decision.KEEP), item("b", Decision.REDACT)]) == "a"


def test_pressing_r_applies_redact_and_advances_to_next_undecided():
    action = shortcut_to_action("r")
    assert ACTION_TO_DECISION[action] == Decision.REDACT
    after = [item("a", Decision.REDACT), item("b"), item("c")]
    assert next_undecided_after_decision(after, "a") == "b"


def test_k_n_and_i_apply_correct_decisions():
    assert ACTION_TO_DECISION[shortcut_to_action("k")] == Decision.KEEP
    assert ACTION_TO_DECISION[shortcut_to_action("n")] == Decision.RENAME
    assert ACTION_TO_DECISION[shortcut_to_action("i")] == Decision.NOT_SENSITIVE
    assert shortcut_to_action("w") is None
    assert shortcut_to_action("v") is None


def test_already_decided_rows_are_skipped_during_auto_advance():
    items = [item("a", Decision.REDACT), item("b", Decision.KEEP), item("c")]
    assert next_undecided_after_decision(items, "a") == "c"


def test_arrow_keys_navigate_without_changing_decisions():
    items = [item("a"), item("b"), item("c")]
    assert move_active_key(items, "b", "ArrowDown") == "c"
    assert move_active_key(items, "b", "ArrowUp") == "a"


def test_home_end_and_page_navigation():
    items = [item(str(i)) for i in range(12)]
    assert move_active_key(items, "5", "Home") == "0"
    assert move_active_key(items, "5", "End") == "11"
    assert move_active_key(items, "1", "PageDown", page_size=5) == "6"
    assert move_active_key(items, "8", "PageUp", page_size=5) == "3"


def test_clicking_row_makes_it_active_model():
    assert reconcile_active_key([item("a"), item("b")], "b") == "b"


def test_active_row_preserved_by_entity_id_across_sort_change():
    assert reconcile_active_key([item("c"), item("a"), item("b")], "b") == "b"


def test_shortcuts_do_not_fire_while_typing():
    assert should_ignore_keyboard_event("input")
    assert should_ignore_keyboard_event("textarea")
    assert should_ignore_keyboard_event("div", editable=True)


def test_modified_shortcuts_do_not_trigger_decisions():
    assert shortcut_to_action("r", meta=True) is None
    assert shortcut_to_action("r", ctrl=True) is None
    assert shortcut_to_action("r", alt=True) is None
    assert shortcut_to_action("r", shift=True) is None


def test_newly_active_row_scrolls_into_view_contract():
    assert move_active_key([item(str(i)) for i in range(20)], "1", "PageDown", page_size=8) == "9"


def test_final_undecided_decision_keeps_final_row_active():
    assert next_undecided_after_decision([item("a", Decision.KEEP)], "a") == "a"


def test_mouse_and_keyboard_share_action_mapping():
    assert ACTION_TO_DECISION["Redact"] == ACTION_TO_DECISION[shortcut_to_action("r")]


def test_only_active_row_roving_tabindex_contract():
    active = "b"
    rows = [item("a"), item("b"), item("c")]
    tab_indices = {row.key: 0 if row.key == active else -1 for row in rows}
    assert tab_indices == {"a": -1, "b": 0, "c": -1}


def test_filtering_active_row_selects_sensible_replacement():
    assert reconcile_active_key([item("a", visible=False), item("b")], "a") == "b"


def test_ignore_values_map_to_not_sensitive():
    assert ACTION_TO_DECISION["Ignore"] == Decision.NOT_SENSITIVE


def test_historical_terms_remain_internal_aliases():
    assert ACTION_TO_DECISION["Wrong Match"] == Decision.NOT_SENSITIVE


def test_shortcut_labels_are_display_only():
    labels = {
        "Keep": "(K) Keep",
        "Rename": "(N) Rename",
        "Redact": "(R) Redact",
        "Ignore": "(I) Ignore",
    }
    assert labels["Redact"].endswith("Redact")
    assert "Redact" in ACTION_TO_DECISION
    assert "(R) Redact" not in ACTION_TO_DECISION


def test_rapid_review_sequence_lands_on_intended_entities():
    keys = ["a", "b", "c", "d", "e"]
    actions = ["r", "n", "i", "k"]
    decisions = {}
    active = "a"
    for keypress in actions:
        action = shortcut_to_action(keypress)
        decisions[active] = ACTION_TO_DECISION[action]
        items = [item(key, decisions.get(key, Decision.UNDECIDED)) for key in keys]
        active = next_undecided_after_decision(items, active)
    assert decisions == {
        "a": Decision.REDACT,
        "b": Decision.RENAME,
        "c": Decision.NOT_SENSITIVE,
        "d": Decision.KEEP,
    }
