from __future__ import annotations

import tempfile
import json
import html
from hashlib import sha1
from pathlib import Path

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

from redactor.audit import write_audit_csv
from redactor.candidate_quality import apply_candidate_quality
from redactor.decisions import build_default_decisions, decisions_from_json, decisions_to_json
from redactor.detectors import detect_all_candidates
from redactor.docx_reader import extract_docx_metadata, iter_docx_text_blocks, load_docx, sha256_file
from redactor.docx_writer import rescan_for_originals, write_redacted_docx
from redactor.models import Decision, OccurrenceDecision
from redactor.review_queue import ACTION_TO_DECISION, QueueItem, next_undecided_after_decision


st.set_page_config(page_title="Local DOCX PII Redactor", layout="wide")

APP_BUILD = "build 2026.07.24.20"
REVIEW_ACTIONS = ["Keep", "Rename", "Redact", "Ignore"]
REVIEW_ACTION_LABELS = {
    "Keep": "K Keep",
    "Rename": "N Rename",
    "Redact": "R Redact",
    "Ignore": "I Ignore",
}
REVIEW_ACTION_HELP = {
    "Keep": "Keep",
    "Rename": "Rename",
    "Redact": "Redact",
    "Ignore": "Ignore",
}
STATE_DIR = Path(".local_state")
LAST_DOCX_PATH = STATE_DIR / "last_upload.docx"
LAST_STATE_PATH = STATE_DIR / "last_review_state.json"


def output_paths(input_path: Path) -> tuple[Path, Path, Path]:
    stem = input_path.stem
    folder = input_path.parent
    return (
        folder / f"{stem}_redacted.docx",
        folder / f"{stem}_redaction_log.csv",
        folder / f"{stem}_decisions.json",
    )


def clear_local_state():
    for path in (LAST_DOCX_PATH, LAST_STATE_PATH):
        if path.exists():
            path.unlink()


def save_local_state(filename: str, file_bytes: bytes, file_hash: str, candidates, decisions):
    STATE_DIR.mkdir(exist_ok=True)
    LAST_DOCX_PATH.write_bytes(file_bytes)
    LAST_STATE_PATH.write_text(
        json.dumps(
            {
                "filename": filename,
                "file_hash": file_hash,
                "decisions": decisions_to_json(decisions),
                "type_overrides": {
                    candidate.key: candidate.detected_type for candidate in candidates
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def load_local_state():
    if not LAST_DOCX_PATH.exists() or not LAST_STATE_PATH.exists():
        return None
    data = json.loads(LAST_STATE_PATH.read_text(encoding="utf-8"))
    return {
        "filename": data["filename"],
        "file_hash": data["file_hash"],
        "file_bytes": LAST_DOCX_PATH.read_bytes(),
        "decisions": data.get("decisions", {}),
        "type_overrides": data.get("type_overrides", {}),
    }


def apply_saved_review_state(candidates, saved_state):
    decisions = build_default_decisions(candidates)
    saved_decisions = decisions_from_json(saved_state.get("decisions", {}))
    decisions.update(saved_decisions)
    type_overrides = saved_state.get("type_overrides", {})
    for candidate in candidates:
        if candidate.key in type_overrides:
            candidate.detected_type = type_overrides[candidate.key]
            for occurrence in candidate.occurrences:
                occurrence.detected_type = candidate.detected_type
    return decisions


def candidate_dataframe(candidates, decisions):
    rows = []
    for candidate in candidates:
        decision = decisions[candidate.key]
        table_decision = decision.decision
        if table_decision == Decision.UNDECIDED:
            table_decision = Decision.KEEP
        replacement_display = decision.replacement or ""
        if table_decision == Decision.KEEP:
            replacement_display = ""
        elif table_decision == Decision.NOT_SENSITIVE:
            replacement_display = "(not used)"
        rows.append(
            {
                "Item": candidate.text,
                "type": candidate.detected_type,
                "count": candidate.count,
                "Ignore": table_decision == Decision.NOT_SENSITIVE,
                "Keep": table_decision == Decision.KEEP,
                "Rename": table_decision == Decision.RENAME,
                "Redact": table_decision == Decision.REDACT,
                "Replace With": replacement_display,
                "source": candidate.source,
                "confidence": candidate.confidence,
                "key": candidate.key,
            }
        )
    return pd.DataFrame(rows)


def decision_to_action(decision: Decision) -> str:
    if decision == Decision.NOT_SENSITIVE:
        return "Ignore"
    if decision == Decision.RENAME:
        return "Rename"
    if decision == Decision.REDACT:
        return "Redact"
    if decision == Decision.REVIEW:
        return "Ignore"
    return "Keep"


def review_action_label(action: str) -> str:
    return REVIEW_ACTION_LABELS.get(action, action)


def review_action_from_value(value: str | None) -> str:
    if not value:
        return "Keep"
    if value == "NS":
        return "Ignore"
    for action, label in REVIEW_ACTION_LABELS.items():
        if value == action or value == label:
            return action
    return "Keep"


def stable_ui_key(value: str) -> str:
    return sha1(value.encode("utf-8")).hexdigest()[:12]


def queue_decision_name(decision: Decision) -> str:
    if decision == Decision.UNDECIDED:
        return "Undecided"
    return decision_to_action(decision)


def advance_review_queue(candidate_key: str, decisions):
    visible_keys = st.session_state.get("review-visible-keys", [])
    if not visible_keys:
        st.session_state["review-active-key"] = candidate_key
        return
    items = [
        QueueItem(key, decisions[key].decision if key in decisions else Decision.UNDECIDED)
        for key in visible_keys
    ]
    st.session_state["review-active-key"] = (
        next_undecided_after_decision(items, candidate_key) or candidate_key
    )


def save_current_review_state():
    if all(key in st.session_state for key in ("filename", "file_bytes", "file_hash")):
        save_local_state(
            st.session_state.filename,
            st.session_state.file_bytes,
            st.session_state.file_hash,
            st.session_state.get("candidates", []),
            st.session_state.get("decisions", {}),
        )


def apply_review_action(candidate_key: str, action: str, advance: bool = True):
    decisions = st.session_state.get("decisions", {})
    decision = decisions.get(candidate_key)
    if not decision:
        return
    clean_action = review_action_from_value(action)
    decision.decision = ACTION_TO_DECISION.get(clean_action, Decision.KEEP)
    save_current_review_state()
    if advance:
        advance_review_queue(candidate_key, decisions)


def persist_review_row(candidate_key: str):
    candidates = st.session_state.get("candidates", [])
    decisions = st.session_state.get("decisions", {})
    decision = decisions.get(candidate_key)
    if not decision:
        return

    ui_key = stable_ui_key(candidate_key)
    type_key = f"review-type-{ui_key}"
    replacement_key = f"review-replacement-{ui_key}"

    action = None if decision.decision == Decision.UNDECIDED else decision_to_action(decision.decision)

    replacement_value = str(st.session_state.get(replacement_key, "") or "").strip()
    if action in {"Rename", "Redact"} and replacement_value and replacement_value != "(not used)":
        decision.replacement = replacement_value

    for candidate in candidates:
        if candidate.key == candidate_key:
            updated_type = st.session_state.get(type_key, candidate.detected_type)
            candidate.detected_type = updated_type
            for occurrence in candidate.occurrences:
                occurrence.detected_type = updated_type
            break

    save_current_review_state()


def render_keyboard_queue_helper(active_key: str | None):
    active_key_json = json.dumps(active_key)
    helper_script = (
        """
        <script>
        (() => {
          const parentDoc = window.parent.document;
          const helperKey = "__piiReviewQueueHelper";
          const serverActiveKey = __SERVER_ACTIVE_KEY__;
          const keyMap = { k: "K Keep", n: "N Rename", r: "R Redact", i: "I Ignore" };
          const navKeys = new Set(["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"]);
          let deciding = false;

          if (window.parent[helperKey]?.cleanup) {
            window.parent[helperKey].cleanup();
          }

          function isTypingTarget(target) {
            if (!target) return false;
            const tag = (target.tagName || "").toLowerCase();
            return tag === "input" || tag === "textarea" || tag === "select" ||
              target.isContentEditable ||
              Boolean(target.closest?.("[contenteditable='true'], [role='dialog']"));
          }

          function rows() {
            return Array.from(parentDoc.querySelectorAll(".review-queue-marker"))
              .map((marker) => {
                const row = marker.closest("div[class*='st-key-review-row-']");
                return row ? { marker, row, key: marker.dataset.entityKey } : null;
              })
              .filter(Boolean)
              .filter((item) => item.row.offsetParent !== null);
          }

          function setActive(key, { scroll = true } = {}) {
            const list = rows();
            if (!list.length) return null;
            let target = list.find((item) => item.key === key);
            if (!target) {
              target = list.find((item) => item.marker.dataset.decision === "Undecided") || list[0];
            }
            list.forEach((item) => {
              const isActive = item.key === target.key;
              item.row.classList.toggle("review-queue-active-row", isActive);
              item.row.setAttribute("tabindex", isActive ? "0" : "-1");
              item.row.setAttribute("role", "listitem");
              item.marker.dataset.active = isActive ? "true" : "false";
            });
            window.parent.__piiReviewQueueActiveKey = target.key;
            if (scroll) target.row.scrollIntoView({ block: "nearest" });
            target.row.focus({ preventScroll: true });
            return target;
          }

          function currentActive() {
            const list = rows();
            return list.find((item) => item.key === window.parent.__piiReviewQueueActiveKey) ||
              list.find((item) => item.marker.dataset.decision === "Undecided") ||
              list[0] || null;
          }

          function move(command) {
            const list = rows();
            if (!list.length) return;
            const active = currentActive();
            let index = Math.max(0, list.findIndex((item) => item.key === active.key));
            const pageSize = Math.max(4, Math.floor(window.parent.innerHeight / 110));
            if (command === "ArrowDown") index = Math.min(list.length - 1, index + 1);
            if (command === "ArrowUp") index = Math.max(0, index - 1);
            if (command === "Home") index = 0;
            if (command === "End") index = list.length - 1;
            if (command === "PageDown") index = Math.min(list.length - 1, index + pageSize);
            if (command === "PageUp") index = Math.max(0, index - pageSize);
            setActive(list[index].key);
          }

          function decide(shortLabel) {
            if (deciding) return;
            const active = currentActive();
            if (!active) return;
            const button = Array.from(active.row.querySelectorAll("button"))
              .find((candidate) => candidate.textContent.trim() === shortLabel);
            if (!button) return;
            deciding = true;
            window.setTimeout(() => { deciding = false; }, 1000);
            button.click();
          }

          function onClick(event) {
            const marker = event.target.closest?.("div[class*='st-key-review-row-']")?.querySelector(".review-queue-marker");
            if (marker) setActive(marker.dataset.entityKey, { scroll: false });
          }

          function onKeyDown(event) {
            if (isTypingTarget(event.target)) return;
            if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
            const shortLabel = keyMap[event.key.toLowerCase()];
            if (shortLabel) {
              event.preventDefault();
              decide(shortLabel);
              return;
            }
            if (navKeys.has(event.key)) {
              event.preventDefault();
              move(event.key);
            }
          }

          parentDoc.addEventListener("click", onClick, true);
          parentDoc.addEventListener("keydown", onKeyDown, true);
          window.parent[helperKey] = {
            cleanup: () => {
              parentDoc.removeEventListener("click", onClick, true);
              parentDoc.removeEventListener("keydown", onKeyDown, true);
            }
          };

          const existing = serverActiveKey || window.parent.__piiReviewQueueActiveKey;
          setTimeout(() => setActive(existing), 50);
        })();
        </script>
        """.replace("__SERVER_ACTIVE_KEY__", active_key_json)
    )
    components.html(helper_script, height=0)


def stateful_selectbox(container, label: str, options: list[str], default: str, key: str, **kwargs):
    if key in st.session_state:
        return container.selectbox(label, options, key=key, **kwargs)
    index = options.index(default) if default in options else 0
    return container.selectbox(label, options, index=index, key=key, **kwargs)


def stateful_text_input(container, label: str, default: str, key: str, **kwargs):
    if key in st.session_state:
        return container.text_input(label, key=key, **kwargs)
    return container.text_input(label, value=default, key=key, **kwargs)


def render_decision_table(candidates, decisions):
    st.markdown(
        """
        <style>
        .review-queue-active-row {
          border-color: #2563eb !important;
          box-shadow: inset 4px 0 0 #2563eb, 0 0 0 1px rgba(37, 99, 235, 0.2) !important;
          background-color: #eff6ff !important;
        }
        .review-queue-active-row:focus {
          outline: 2px solid #2563eb;
          outline-offset: 2px;
        }
        div[class*="st-key-review-row-even"] {
          background-color: #f7fbff;
          border-color: #d8e4f0;
        }
        div[class*="st-key-review-row-odd"] {
          background-color: #ffffff;
          border-color: #e5e7eb;
        }
        div[class*="st-key-review-row-even"],
        div[class*="st-key-review-row-odd"] {
          padding: 0.35rem 0.55rem 0.55rem 0.55rem;
          margin-bottom: 0.35rem;
        }
        div[class*="st-key-review-row-even"] [data-testid="stHorizontalBlock"],
        div[class*="st-key-review-row-odd"] [data-testid="stHorizontalBlock"] {
          align-items: center;
        }
        .review-row-entity {
          font-weight: 650;
          font-size: 1.02rem;
          line-height: 1.25;
        }
        .review-row-meta {
          color: #5f6b7a;
          font-size: 0.86rem;
          margin-top: 0.12rem;
        }
        div[class*="st-key-review-row-"] div[data-testid="stButton"] button {
          min-width: 4.8rem;
          width: 100%;
          padding-left: 0.5rem;
          padding-right: 0.5rem;
          white-space: nowrap;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )
    type_options = sorted(
        {candidate.detected_type for candidate in candidates}
        | {"person", "email", "phone", "cin", "long_numeric_id", "other_identifier"}
    )
    search_cols = st.columns([2, 1, 1, 1])
    with search_cols[0]:
        search = st.text_input("Filter review rows", key="review-table-search")
    with search_cols[1]:
        type_filter = st.selectbox("Type", ["All"] + type_options, key="review-type-filter")
    with search_cols[2]:
        sort_by = st.selectbox("Sort", ["Count", "Item", "Type"], key="review-sort")
    with search_cols[3]:
        descending = st.checkbox("Descending", value=True, key="review-sort-desc")

    visible_candidates = list(candidates)
    if search:
        visible_candidates = [
            candidate
            for candidate in visible_candidates
            if search.casefold() in candidate.text.casefold()
        ]
    if type_filter != "All":
        visible_candidates = [
            candidate for candidate in visible_candidates if candidate.detected_type == type_filter
        ]
    if sort_by == "Count":
        visible_candidates.sort(key=lambda candidate: candidate.count, reverse=descending)
    elif sort_by == "Item":
        visible_candidates.sort(key=lambda candidate: candidate.text.casefold(), reverse=descending)
    else:
        visible_candidates.sort(key=lambda candidate: candidate.detected_type, reverse=descending)

    visible_keys = [candidate.key for candidate in visible_candidates]
    st.session_state["review-visible-keys"] = visible_keys
    active_key = st.session_state.get("review-active-key")
    if active_key not in visible_keys:
        active_key = next(
            (
                candidate.key
                for candidate in visible_candidates
                if decisions[candidate.key].decision == Decision.UNDECIDED
            ),
            visible_keys[0] if visible_keys else None,
        )
        st.session_state["review-active-key"] = active_key

    st.caption(f"Showing {len(visible_candidates)} of {len(candidates)} candidates.")
    st.caption("Keyboard: K Keep, N Rename, R Redact, I Ignore. Arrow keys move the active row.")
    render_keyboard_queue_helper(active_key)

    for row_index, candidate in enumerate(visible_candidates):
        decision = decisions[candidate.key]
        ui_key = stable_ui_key(candidate.key)
        action = None if decision.decision == Decision.UNDECIDED else decision_to_action(decision.decision)
        replacement_display = decision.replacement or ""
        if action == "Keep":
            replacement_display = ""
        elif action == "Ignore":
            replacement_display = "(not used)"

        row_style = "even" if row_index % 2 == 0 else "odd"
        with st.container(border=True, key=f"review-row-{row_style}-{ui_key}"):
            st.markdown(
                f'<span class="review-queue-marker" data-entity-key="{html.escape(candidate.key, quote=True)}" data-decision="{queue_decision_name(decision.decision)}" aria-hidden="true"></span>',
                unsafe_allow_html=True,
            )
            row = st.columns([1.45, 0.64, 3.85, 2.25], gap="small")
            entity_text = html.escape(candidate.text)
            source_text = html.escape(candidate.source)
            confidence_text = html.escape(candidate.confidence)
            row[0].markdown(
                f"""
                <div class="review-row-entity">{entity_text}</div>
                <div class="review-row-meta">{candidate.count} occurrence(s) · {source_text} · {confidence_text}</div>
                """,
                unsafe_allow_html=True,
            )
            edited_type = stateful_selectbox(
                row[1],
                "Type",
                type_options,
                candidate.detected_type,
                label_visibility="collapsed",
                key=f"review-type-{ui_key}",
                on_change=persist_review_row,
                args=(candidate.key,),
            )
            decision_buttons = row[2].columns([0.9, 1.05, 1.15, 1.05, 1.8], gap="small")
            for action_index, review_action in enumerate(REVIEW_ACTIONS):
                decision_buttons[action_index].button(
                    review_action_label(review_action),
                    key=f"review-action-button-{stable_ui_key(review_action)}-{ui_key}",
                    help=REVIEW_ACTION_HELP[review_action],
                    type="primary" if action == review_action else "secondary",
                    on_click=apply_review_action,
                    args=(candidate.key, review_action, True),
                )
            stateful_text_input(
                row[3],
                "Replace With",
                replacement_display,
                disabled=action in {None, "Keep", "Ignore"},
                label_visibility="collapsed",
                key=f"review-replacement-{ui_key}",
                on_change=persist_review_row,
                args=(candidate.key,),
            )
    st.caption("Choices are saved locally as you change them.")


def not_pii_report_dataframe(candidates, decisions, input_sha256: str):
    rows = []
    for candidate in candidates:
        decision = decisions[candidate.key]
        if decision.decision != Decision.NOT_SENSITIVE:
            continue
        rows.append(
            {
                "candidate": candidate.text,
                "type": candidate.detected_type,
                "source": candidate.source,
                "confidence": candidate.confidence,
                "occurrence_count": candidate.count,
                "locations": "; ".join(sorted({occurrence.location for occurrence in candidate.occurrences})[:10]),
                "context_snippets": " | ".join(candidate.contexts),
                "input_file_sha256": input_sha256,
            }
        )
    return pd.DataFrame(rows)


def render_not_pii_report(candidates, decisions, input_sha256: str):
    st.subheader("Optional Ignore Report")
    st.write(
        "This creates a static local report of rows marked Ignore. "
        "Nothing is sent automatically."
    )

    report_key = f"not_pii_report_snapshot_{input_sha256}"
    button_cols = st.columns([1, 1, 3])
    with button_cols[0]:
        generate_report = st.button("Generate report preview")
    with button_cols[1]:
        refresh_report = st.button("Refresh report preview")

    if generate_report or refresh_report:
        report_df = not_pii_report_dataframe(candidates, decisions, input_sha256)
        st.session_state[report_key] = report_df.to_dict(orient="records")

    if report_key not in st.session_state:
        st.info("Generate a preview when you want to check a static Ignore report.")
        return

    report_df = pd.DataFrame(st.session_state[report_key])
    if report_df.empty:
        st.info("The saved report preview is empty. No candidates were marked Ignore when it was generated.")
        return

    st.write(
        "Static preview. It will not change while you keep reviewing unless you click Refresh report preview. "
        "Check it before sharing; it may include candidate text and context snippets from your document."
    )
    st.dataframe(report_df, use_container_width=True, hide_index=True)
    csv_bytes = report_df.to_csv(index=False).encode("utf-8")
    json_bytes = report_df.to_json(orient="records", indent=2).encode("utf-8")
    st.download_button("Download Ignore report CSV", csv_bytes, "ignore_report.csv", "text/csv")
    st.download_button("Download Ignore report JSON", json_bytes, "ignore_report.json", "application/json")


def scan_docx(path: Path, use_spacy: bool):
    document = load_docx(path)
    blocks = iter_docx_text_blocks(document)
    return apply_candidate_quality(detect_all_candidates(blocks, use_spacy=use_spacy))


def render_candidate_editor(candidates, decisions, detected_type: str):
    filtered = [candidate for candidate in candidates if candidate.detected_type == detected_type]
    if not filtered:
        st.info("No candidates found in this category.")
        return

    search = st.text_input("Search", key=f"search-{detected_type}")
    if search:
        filtered = [candidate for candidate in filtered if search.casefold() in candidate.text.casefold()]

    bulk_cols = st.columns([1, 1, 4])
    with bulk_cols[0]:
        if st.button("Redact visible", key=f"bulk-redact-{detected_type}"):
            for candidate in filtered:
                decisions[candidate.key].decision = Decision.REDACT
            st.rerun()
    with bulk_cols[1]:
        if st.button("Keep visible", key=f"bulk-keep-{detected_type}"):
            for candidate in filtered:
                decisions[candidate.key].decision = Decision.KEEP
            st.rerun()

    for candidate in filtered:
        decision = decisions[candidate.key]
        with st.expander(f"{candidate.text} · {candidate.count} occurrence(s)", expanded=False):
            c1, c2, c3 = st.columns([1.2, 1.2, 2])
            with c1:
                decision.decision = Decision(
                    st.selectbox(
                        "Decision",
                        [item.value for item in Decision],
                        index=[item.value for item in Decision].index(decision.decision.value),
                        key=f"decision-{candidate.key}",
                    )
                )
            with c2:
                decision.replacement = st.text_input(
                    "Replacement label",
                    value=decision.replacement or "",
                    key=f"replacement-{candidate.key}",
                )
            with c3:
                st.write(f"Source: {candidate.source}; confidence: {candidate.confidence}")
                st.write("Locations: " + "; ".join(sorted({o.location for o in candidate.occurrences})[:5]))

            st.write("Context snippets")
            for snippet in candidate.contexts:
                st.code(snippet, language=None)

            if decision.decision == Decision.REVIEW:
                st.write("Occurrence decisions")
                for occurrence in candidate.occurrences:
                    current = decision.occurrence_decisions.get(
                        occurrence.id, OccurrenceDecision.UNDECIDED
                    )
                    selected = st.selectbox(
                        f"{occurrence.location}: {occurrence.context}",
                        [item.value for item in OccurrenceDecision],
                        index=[item.value for item in OccurrenceDecision].index(current.value),
                        key=f"occurrence-{occurrence.id}",
                    )
                    decision.occurrence_decisions[occurrence.id] = OccurrenceDecision(selected)


st.markdown(
    f"""
    <div style="display:flex; align-items:baseline; gap:0.75rem;">
      <h1 style="margin-bottom:0;">Local DOCX PII Redactor</h1>
      <span style="font-size:0.8rem; color:#667085;">{APP_BUILD}</span>
    </div>
    """,
    unsafe_allow_html=True,
)
st.caption("Runs locally. No cloud API, no LLM, and the original DOCX is not modified.")

if st.button("Reset local working state"):
    clear_local_state()
    for key in [
        "candidates",
        "decisions",
        "file_bytes",
        "filename",
        "file_hash",
        "metadata",
        "review-active-key",
        "review-visible-keys",
    ]:
        st.session_state.pop(key, None)
    for key in list(st.session_state.keys()):
        if key.startswith("not_pii_report_snapshot_"):
            st.session_state.pop(key)
    st.rerun()

uploaded = st.file_uploader("Choose a DOCX file", type=["docx"])
use_spacy = st.checkbox("Use local spaCy person-name detection when available", value=True)
uploaded_decisions = st.file_uploader("Optional previous decisions JSON", type=["json"])

saved_state = None
if not uploaded and "file_bytes" not in st.session_state:
    saved_state = load_local_state()
    if saved_state:
        st.info(f"Restored local working document: {saved_state['filename']}")
        st.session_state.file_bytes = saved_state["file_bytes"]
        st.session_state.filename = saved_state["filename"]
        st.session_state.file_hash = saved_state["file_hash"]

if uploaded or "file_bytes" in st.session_state:
    with tempfile.TemporaryDirectory() as temp_dir:
        filename = uploaded.name if uploaded else st.session_state.filename
        file_bytes = bytes(uploaded.getbuffer()) if uploaded else st.session_state.file_bytes
        input_path = Path(temp_dir) / filename
        input_path.write_bytes(file_bytes)
        file_hash = sha256_file(input_path)
        new_file_uploaded = uploaded is not None and file_hash != st.session_state.get("file_hash")

        if st.button("Scan document") or "candidates" not in st.session_state or new_file_uploaded:
            with st.spinner("Scanning DOCX locally..."):
                st.session_state.candidates = scan_docx(input_path, use_spacy)
                st.session_state.decisions = build_default_decisions(st.session_state.candidates)
                local_state = saved_state or load_local_state()
                if local_state and local_state.get("file_hash") == file_hash:
                    st.session_state.decisions = apply_saved_review_state(
                        st.session_state.candidates, local_state
                    )
                if uploaded_decisions:
                    previous = decisions_from_json(json.loads(uploaded_decisions.getvalue().decode("utf-8")))
                    st.session_state.decisions.update(previous)
                st.session_state.file_bytes = file_bytes
                st.session_state.filename = filename
                st.session_state.file_hash = file_hash
                st.session_state.metadata = extract_docx_metadata(input_path)
                save_local_state(
                    st.session_state.filename,
                    st.session_state.file_bytes,
                    st.session_state.file_hash,
                    st.session_state.candidates,
                    st.session_state.decisions,
                )
                for key in list(st.session_state.keys()):
                    if key.startswith("not_pii_report_snapshot_"):
                        st.session_state.pop(key)

        candidates = st.session_state.get("candidates", [])
        decisions = st.session_state.get("decisions", {})
        if candidates:
            df = candidate_dataframe(candidates, decisions)
            st.subheader("Item Check")
            st.write("Change decisions directly in this table, or expand an item below for context.")
            render_decision_table(candidates, decisions)

            tabs = st.tabs(["People", "Numbers/IDs", "Email addresses", "Phone numbers", "Other possible identifiers"])
            with tabs[0]:
                render_candidate_editor(candidates, decisions, "person")
            with tabs[1]:
                render_candidate_editor(candidates, decisions, "cin")
                render_candidate_editor(candidates, decisions, "long_numeric_id")
            with tabs[2]:
                render_candidate_editor(candidates, decisions, "email")
            with tabs[3]:
                render_candidate_editor(candidates, decisions, "phone")
            with tabs[4]:
                other_types = sorted(
                    {candidate.detected_type for candidate in candidates}
                    - {"person", "cin", "long_numeric_id", "email", "phone"}
                )
                for detected_type in other_types:
                    render_candidate_editor(candidates, decisions, detected_type)

            render_not_pii_report(candidates, decisions, st.session_state.file_hash)

            if st.session_state.metadata:
                with st.expander("Document metadata found"):
                    st.json(st.session_state.metadata)

            undecided = sum(1 for d in decisions.values() if d.decision == Decision.UNDECIDED)
            not_sensitive_count = sum(1 for d in decisions.values() if d.decision == Decision.NOT_SENSITIVE)
            rename_count = sum(1 for d in decisions.values() if d.decision == Decision.RENAME)
            redact_count = sum(1 for d in decisions.values() if d.decision == Decision.REDACT)
            review_undecided = sum(
                1
                for candidate in candidates
                if decisions[candidate.key].decision == Decision.REVIEW
                for occurrence in candidate.occurrences
                if decisions[candidate.key].occurrence_decisions.get(
                    occurrence.id, OccurrenceDecision.UNDECIDED
                )
                == OccurrenceDecision.UNDECIDED
            )
            st.subheader("Safety check")
            st.write(f"Candidates: {len(candidates)}")
            st.write(f"Marked for rename: {rename_count}")
            st.write(f"Marked for redaction: {redact_count}")
            st.write(f"Marked Ignore: {not_sensitive_count}")
            st.write(f"Undecided and kept for now: {undecided}")
            st.write(f"Occurrence reviews still undecided: {review_undecided}")

            can_generate = review_undecided == 0
            if not can_generate:
                st.warning("Finish occurrence-level review decisions before generating output.")

            if st.button("Generate redacted DOCX and audit files", disabled=not can_generate):
                work_input = Path(temp_dir) / st.session_state.filename
                work_input.write_bytes(st.session_state.file_bytes)
                redacted_path, csv_path, json_path = output_paths(work_input)
                with st.spinner("Writing redacted copy and audit files..."):
                    write_redacted_docx(work_input, redacted_path, json_path, candidates, decisions)
                    write_audit_csv(csv_path, candidates, decisions, st.session_state.file_hash)
                    redacted_doc = load_docx(redacted_path)
                    redacted_candidates = [
                        candidate
                        for candidate in candidates
                        if decisions[candidate.key].decision in {Decision.REDACT, Decision.RENAME}
                        or (
                            decisions[candidate.key].decision == Decision.REVIEW
                            and any(
                                decision == OccurrenceDecision.REDACT
                                for decision in decisions[candidate.key].occurrence_decisions.values()
                            )
                        )
                    ]
                    remaining = rescan_for_originals(redacted_doc, redacted_candidates)
                    new_candidates = detect_all_candidates(
                        iter_docx_text_blocks(redacted_doc), use_spacy=use_spacy
                    )
                    reviewed_keys = {candidate.key for candidate in candidates}
                    newly_detected = [candidate.text for candidate in new_candidates if candidate.key not in reviewed_keys]

                st.success("Generated output files.")
                st.download_button("Download redacted DOCX", redacted_path.read_bytes(), redacted_path.name)
                st.download_button("Download redaction log CSV", csv_path.read_bytes(), csv_path.name)
                st.download_button("Download decisions JSON", json_path.read_bytes(), json_path.name)
                st.write("Remaining reviewed original values found after rescan:")
                st.json(remaining)
                st.write("Newly detected candidates in output that were not reviewed:")
                st.json(newly_detected[:50])
        else:
            st.info("Choose a DOCX file, then scan it.")
