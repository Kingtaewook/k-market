"""회원 전용 데이터 저장소 (Supabase member_data 표).

「정리」 화면의 하루 기록(journal)·돌아보기(review)는 공개 저장소(data/)에 두지 않고,
승인된 회원만 읽을 수 있는 Supabase 표에 저장한다. 쓰기는 서비스 키(SUPABASE_SERVICE_KEY)로만.
"""
from __future__ import annotations

import datetime as dt
import json
import os

import requests

SB_URL = "https://unqahkpxfasufcvpbeai.supabase.co"


class StoreError(Exception):
    pass


def _headers():
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not key:
        return None
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def enabled() -> bool:
    return _headers() is not None


def get(name: str, default):
    """저장된 값을 읽는다. 행이 없으면 default. 연결 오류는 StoreError (빈 값으로 덮어쓰지 않도록)."""
    h = _headers()
    if not h:
        raise StoreError("SUPABASE_SERVICE_KEY 없음")
    try:
        r = requests.get(f"{SB_URL}/rest/v1/member_data", params={"id": f"eq.{name}", "select": "data"}, headers=h, timeout=20)
        r.raise_for_status()
        rows = r.json()
    except Exception as e:  # noqa: BLE001
        raise StoreError(f"{name} 읽기 실패: {e}") from e
    return rows[0]["data"] if rows else default


def put(name: str, data) -> None:
    h = _headers()
    if not h:
        raise StoreError("SUPABASE_SERVICE_KEY 없음")
    body = {"id": name, "data": data, "updated_at": dt.datetime.now(dt.timezone.utc).isoformat()}
    r = requests.post(f"{SB_URL}/rest/v1/member_data?on_conflict=id",
                      headers={**h, "Prefer": "resolution=merge-duplicates,return=minimal"},
                      data=json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode(), timeout=30)
    if r.status_code >= 300:
        raise StoreError(f"{name} 저장 실패: {r.status_code} {r.text[:200]}")
    print(f"[회원 전용] {name} 저장")
