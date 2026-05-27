import pytest

from bugdb.db import (
    _DECAY_FAILURE_THRESHOLD,
    _DECAY_FLOOR,
    _DECAY_STEP,
)
from bugdb.exceptions import RecordNotFound
from bugdb.models import BugRecord, ErrorType, Status


def _bug() -> BugRecord:
    return BugRecord(
        error_type=ErrorType.LINK,
        error_pattern="LNK2001",
        root_cause="missing lib",
        solution="link lib",
        language="c++",
    )


def test_feedback_success_increments(db):
    b = db.add(_bug())
    db.feedback(b.id, success=True)
    fetched = db.get(b.id)
    assert fetched.usage_count == 1
    assert fetched.success_count == 1
    assert fetched.consecutive_failures == 0


def test_feedback_failure_increments(db):
    b = db.add(_bug())
    db.feedback(b.id, success=False)
    fetched = db.get(b.id)
    assert fetched.usage_count == 1
    assert fetched.success_count == 0
    assert fetched.consecutive_failures == 1


def test_feedback_success_resets_failures(db):
    b = db.add(_bug())
    db.feedback(b.id, success=False)
    db.feedback(b.id, success=False)
    db.feedback(b.id, success=True)
    fetched = db.get(b.id)
    assert fetched.consecutive_failures == 0


def test_confidence_decay_after_3_failures(db):
    b = db.add(_bug())
    for _ in range(_DECAY_FAILURE_THRESHOLD):
        db.feedback(b.id, success=False)
    fetched = db.get(b.id)
    # 3 失败 + 成功率 0/3 < 0.3 → confidence 100 - 20 = 80
    assert fetched.confidence == 100 - _DECAY_STEP
    assert fetched.consecutive_failures == 0  # 衰减后清零


def test_confidence_decay_to_deprecated(db):
    b = db.add(_bug())
    b.confidence = 40
    db.update(b)
    for _ in range(_DECAY_FAILURE_THRESHOLD):
        db.feedback(b.id, success=False)
    fetched = db.get(b.id)
    # 40 - 20 = 20 → 触发 deprecated
    assert fetched.confidence == _DECAY_FLOOR
    assert fetched.status == Status.DEPRECATED
    assert fetched.deprecation_note == 'auto: low confidence'


def test_no_decay_with_high_success_rate(db):
    b = db.add(_bug())
    # 7 successes, then 3 failures: success_rate = 7/10 = 0.7 > 0.3 → 不衰减
    for _ in range(7):
        db.feedback(b.id, success=True)
    for _ in range(_DECAY_FAILURE_THRESHOLD):
        db.feedback(b.id, success=False)
    fetched = db.get(b.id)
    assert fetched.confidence == 100
    # 最后 3 次都是失败，没有触发衰减重置，因此 consecutive_failures 保持累计值
    assert fetched.consecutive_failures == _DECAY_FAILURE_THRESHOLD


def test_floor_clamps_below_twenty(db):
    """起始 confidence=21，3 次失败触发衰减后 max(21-20, 20)=20，floor 生效。"""
    b = db.add(_bug())
    b.confidence = 21
    db.update(b)
    for _ in range(_DECAY_FAILURE_THRESHOLD):
        db.feedback(b.id, success=False)
    fetched = db.get(b.id)
    assert fetched.confidence == _DECAY_FLOOR
    assert fetched.status == Status.DEPRECATED


def test_decay_at_floor_stays_at_floor(db):
    """confidence 已经在 floor，再 3 次失败仍停在 floor 并变 deprecated。"""
    b = db.add(_bug())
    b.confidence = _DECAY_FLOOR
    db.update(b)
    for _ in range(_DECAY_FAILURE_THRESHOLD):
        db.feedback(b.id, success=False)
    fetched = db.get(b.id)
    assert fetched.confidence == _DECAY_FLOOR
    assert fetched.status == Status.DEPRECATED


def test_feedback_on_deprecated_still_accumulates(db):
    """deprecated 状态下 feedback 不短路：usage/success 仍累加，failures 清零。"""
    b = db.add(_bug())
    b.status = Status.DEPRECATED
    db.update(b)
    original_confidence = b.confidence

    # 先制造一次失败累计 consecutive_failures
    db.feedback(b.id, success=False)
    mid = db.get(b.id)
    assert mid.consecutive_failures == 1
    assert mid.status == Status.DEPRECATED  # feedback 不会自动改回 active

    # 再来一次 success：应清零 failures、累加 success_count，confidence 不变
    db.feedback(b.id, success=True)
    fetched = db.get(b.id)
    assert fetched.usage_count == 2
    assert fetched.success_count == 1
    assert fetched.consecutive_failures == 0
    assert fetched.confidence == original_confidence
    assert fetched.status == Status.DEPRECATED


def test_feedback_nonexistent_raises(db):
    with pytest.raises(RecordNotFound):
        db.feedback(99999, success=True)
