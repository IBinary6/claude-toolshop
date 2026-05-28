"""日志模块：提供 rotating file handler 日志支持。

使用 RotatingFileHandler 写入文件，同时输出到 stderr。
初始化失败时 graceful degrade 到仅 stderr 输出。
"""
import logging
import sys
from logging.handlers import RotatingFileHandler

from .paths import get_log_path

_FMT = '%(asctime)s %(levelname)s %(name)s %(message)s'
_MAX_BYTES = 1 * 1024 * 1024  # 1 MB
_BACKUP_COUNT = 3

# 缓存已创建的 logger，避免重复添加 handler
_loggers: dict[str, logging.Logger] = {}


def get_logger(name: str = 'bugdb') -> logging.Logger:
    """获取带 rotating file handler 和 stderr handler 的 logger。

    日志文件路径来自 ``paths.get_log_path()``，目录不存在时自动创建。
    文件 handler 初始化失败时仅保留 stderr 输出，不抛异常。

    Args:
        name: logger 名称，默认 ``'bugdb'``。

    Returns:
        配置好的 ``logging.Logger`` 实例。

    Example::

        logger = get_logger()
        logger.info('bugdb 启动')
    """
    if name in _loggers:
        return _loggers[name]

    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)

    formatter = logging.Formatter(_FMT)

    # stderr handler — 始终添加
    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setLevel(logging.DEBUG)
    stderr_handler.setFormatter(formatter)
    logger.addHandler(stderr_handler)

    # 文件 handler — 失败时静默降级
    try:
        log_path = get_log_path()
        log_path.parent.mkdir(parents=True, exist_ok=True)
        file_handler = RotatingFileHandler(
            str(log_path),
            maxBytes=_MAX_BYTES,
            backupCount=_BACKUP_COUNT,
            encoding='utf-8',
        )
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    except Exception:
        # 文件 handler 初始化失败，仅保留 stderr
        logger.debug('日志文件初始化失败，降级为仅 stderr 输出', exc_info=True)

    _loggers[name] = logger
    return logger
