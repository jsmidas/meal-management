"""
TTL 캐시 구현 - 서버 측 캐싱 (성능 최적화)
- LRU 방식 eviction (maxsize 제한)
"""
from collections import OrderedDict
from datetime import datetime, timedelta


class TTLCache:
    def __init__(self, ttl_seconds=60, maxsize=1000):
        self._cache = OrderedDict()
        self._ttl = ttl_seconds
        self._maxsize = maxsize

    def get(self, key):
        if key in self._cache:
            value, timestamp = self._cache[key]
            if datetime.now() - timestamp < timedelta(seconds=self._ttl):
                # LRU: 접근 시 맨 뒤로 이동
                self._cache.move_to_end(key)
                return value
            del self._cache[key]
        return None

    def set(self, key, value):
        # 이미 있으면 삭제 후 다시 삽입 (맨 뒤로)
        if key in self._cache:
            del self._cache[key]
        self._cache[key] = (value, datetime.now())
        # maxsize 초과 시 가장 오래된 항목 제거 (LRU)
        while len(self._cache) > self._maxsize:
            self._cache.popitem(last=False)

    def invalidate(self, key_prefix=None):
        if key_prefix:
            keys_to_delete = [k for k in self._cache if k.startswith(key_prefix)]
            for k in keys_to_delete:
                del self._cache[k]
        else:
            self._cache.clear()

    def cleanup_expired(self):
        """만료된 항목 일괄 제거"""
        now = datetime.now()
        expired = [k for k, (_, ts) in self._cache.items()
                   if now - ts >= timedelta(seconds=self._ttl)]
        for k in expired:
            del self._cache[k]
        return len(expired)
