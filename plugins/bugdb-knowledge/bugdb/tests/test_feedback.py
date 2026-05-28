import pytest

from bugdb.db import (
    _DECAY_FAILURE_THRESHOLD,
    _DECAY_FLOOR,
    _DECAY_STEP,
)
from bugdb.exceptions import RecordNotFound
from bugdb.models import KnowledgeRecord, Category, EntryKind, Status


def _rec() -> KnowledgeRecord:
    return KnowledgeRecord(
        entry_kind=EntryKind.BUG,
        category=Category.LINK,
        key_pattern="LNK2001",
        cause="missing lib",
        content="link lib",
        language="c++",
    )


def test_feedback_success_increments(db):
    saved = db.add(_rec())
    db.feedback(saved.id, success=True)
    fetched = db.get(saved.id)
    assert fetched.usage_count == 1
    assert fetched.success_count == 1
    assert fetched.consecutive_failures == 0


def test_feedback_failure_increments(db):
    saved = db.add(_rec())
    db.feedback(saved.id, success=False)
    fetched = db.get(saved.id)
    assert fetched.usage_count == 1
    assert fetched.success_count == 0
    assert fetched.consecutive_failures == 1


def test_feedback_success_resets_failures(db):
    saved = db.add(_rec())
    db.feedback(saved.id, success=False)
    db.feedback(saved.id, success=False)
    db.feedback(saved.id, success=True)
    fetched = db.get(saved.id)
    assert fetched.consecutive_failures == 0


def test_confidence_decay_after_3_failures(db):
    saved = db.add(_rec())
    for _ in range(_DECAY_FAILURE_THRESHOLD):
        db.feedback(saved.id, success=False)
    fetched = db.get(saved.id)
    assert fetched.confidence == 100 - _DECAY_STEP
    assert fetched.consecutive_failures == 0


def test_confidence_decay_to_deprecated(db):
    saved = db.add(_rec())
    saved.confidence = 40
    db.update(saved)
    for _ in range(_DECAY_FAILURE_THRESHOLD):
        db.feedback(saved.id, success=False)
    fetched = db.get(saved.id)
    assert fetched.confidence == _DECAY_FLOOR
    assert fetched.status == Status.DEPRECATED
    assert fetched.deprecation_note == 'auto: low confidence'


def test_no_decay_with_high_success_rate(db):
    saved = db.add(_rec())
    for _ in range(7):
        db.feedback(saved.id, success=True)
    for _ in range(_DECAY_FAILURE_THRESHOLD):
        db.feedback(saved.id, success=False)
    fetched = db.get(saved.id)
    assert fetched.confidence == 100
    assert fetched.consecutive_failures == _DECAY_FAILURE_THRESHOLD


def test_floor_clamps_below_twenty(db):
    """起始 confidence=21，3 次失败触发衰减后 max(21-20, 20)=20，floor 生效。"""
    saved = db.add(_rec())
    saved.confidence = 21
    db.update(saved)
    for _ in range(_DECAY_FAILURE_THRESHOLD):
        db.feedback(saved.id, success=False)
    fetched = db.get(saved.id)
    assert fetched.confidence == _DECAY_FLOOR
    assert fetched.status == Status.DEPRECATED


def test_decay_at_floor_stays_at_floor(db):
    """confidence 已经在 floor，再 3 次失败仍停在 floor 并变 deprecated。"""
    saved = db.add(_rec())
    saved.confidence = _DECAY_FLOOR
    db.update(saved)
    for _ in range(_DECAY_FAILURE_THRESHOLD):
        db.feedback(saved.id, success=False)
    fetched = db.get(saved.id)
    assert fetched.confidence == _DECAY_FLOOR
    assert fetched.status == Status.DEPRECATED


def test_feedback_on_deprecated_still_accumulates(db):
    """deprecated 状态下 feedback 不短路：usage/success 仍累加，failures 清零。"""
    saved = db.add(_rec())
    saved.status = Status.DEPRECATED
    db.update(saved)
    original_confidence = saved.confidence

    db.feedback(saved.id, success=False)
    mid = db.get(saved.id)
    assert mid.consecutive_failures == 1
    assert mid.status == Status.DEPRECATED

    db.feedback(saved.id, success=True)
    fetched = db.get(saved.id)
    assert fetched.usage_count == 2
    assert fetched.success_count == 1
    assert fetched.consecutive_failures == 0
    assert fetched.confidence == original_confidence
    assert fetched.status == Status.DEPRECATED


def test_feedback_nonexistent_raises(db):
    with pytest.raises(RecordNotFound):
        db.feedback(99999, success=True)
