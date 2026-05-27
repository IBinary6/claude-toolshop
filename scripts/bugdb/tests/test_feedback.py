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
    for _ in range(3):
        db.feedback(b.id, success=False)
    fetched = db.get(b.id)
    # 3 失败 + 成功率 0/3 < 0.3 → confidence 100 - 20 = 80
    assert fetched.confidence == 80
    assert fetched.consecutive_failures == 0  # 衰减后清零


def test_confidence_decay_to_deprecated(db):
    b = db.add(_bug())
    b.confidence = 40
    db.update(b)
    for _ in range(3):
        db.feedback(b.id, success=False)
    fetched = db.get(b.id)
    # 40 - 20 = 20 → 触发 deprecated
    assert fetched.confidence == 20
    assert fetched.status == Status.DEPRECATED
    assert fetched.deprecation_note == 'auto: low confidence'


def test_no_decay_with_high_success_rate(db):
    b = db.add(_bug())
    # 7 successes, then 3 failures: success_rate = 7/10 = 0.7 > 0.3 → 不衰减
    for _ in range(7):
        db.feedback(b.id, success=True)
    for _ in range(3):
        db.feedback(b.id, success=False)
    fetched = db.get(b.id)
    assert fetched.confidence == 100
