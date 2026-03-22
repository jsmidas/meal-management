#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
System Requests Router
시스템 요청 API 엔드포인트 (버그 리포트, 기능 요청)
"""

from fastapi import APIRouter, Request, HTTPException
from core.database import get_db_connection
from typing import Optional
from datetime import datetime, date

router = APIRouter()


def _serialize_row(columns, row):
    """DB 행을 JSON 직렬화 가능한 dict로 변환 (datetime 안전 처리)"""
    result = {}
    for col, val in zip(columns, row):
        if isinstance(val, (datetime, date)):
            result[col] = val.isoformat()
        else:
            result[col] = val
    return result


@router.get("/api/system-requests")
async def get_system_requests(
    request_type: Optional[str] = None,  # 'bug', 'feature', 'question'
    status: Optional[str] = None,  # 'pending', 'in_progress', 'resolved', 'closed'
    site_id: Optional[int] = None,
    author_id: Optional[int] = None,
    limit: int = 20,
    offset: int = 0
):
    """시스템 요청 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT
                    sr.id, sr.request_type, sr.title, sr.content,
                    sr.status, sr.author_id, sr.site_id,
                    sr.response, sr.responded_by, sr.responded_at,
                    sr.created_at,
                    COALESCE(u.full_name, u.username) as author_name,
                    s.site_name as site_name,
                    COALESCE(ru.full_name, ru.username) as responder_name
                FROM system_requests sr
                LEFT JOIN users u ON sr.author_id = u.id
                LEFT JOIN business_locations s ON sr.site_id = s.id
                LEFT JOIN users ru ON sr.responded_by = ru.id
                WHERE 1=1
            """
            params = []

            if request_type:
                query += " AND sr.request_type = %s"
                params.append(request_type)

            if status:
                query += " AND sr.status = %s"
                params.append(status)

            if site_id:
                query += " AND sr.site_id = %s"
                params.append(site_id)

            if author_id:
                query += " AND sr.author_id = %s"
                params.append(author_id)

            query += " ORDER BY sr.created_at DESC LIMIT %s OFFSET %s"
            params.extend([limit, offset])

            cursor.execute(query, params)
            columns = [desc[0] for desc in cursor.description]
            requests = [_serialize_row(columns, row) for row in cursor.fetchall()]

            # 첨부파일 조회
            for req in requests:
                cursor.execute("""
                    SELECT id, file_name, file_path, file_size, mime_type
                    FROM attachments
                    WHERE ref_type = 'system_request' AND ref_id = %s
                """, (req['id'],))
                att_columns = [desc[0] for desc in cursor.description]
                req['attachments'] = [dict(zip(att_columns, row)) for row in cursor.fetchall()]

            # 전체 개수
            count_query = "SELECT COUNT(*) FROM system_requests WHERE 1=1"
            count_params = []

            if request_type:
                count_query += " AND request_type = %s"
                count_params.append(request_type)
            if status:
                count_query += " AND status = %s"
                count_params.append(status)
            if site_id:
                count_query += " AND site_id = %s"
                count_params.append(site_id)

            cursor.execute(count_query, count_params if count_params else None)
            total_count = cursor.fetchone()[0]

            cursor.close()

            return {
                "success": True,
                "data": {
                    "requests": requests,
                    "total": total_count,
                    "limit": limit,
                    "offset": offset
                }
            }

    except Exception as e:
        print(f"[SYSTEM REQUESTS ERROR] {e}")
        return {"success": False, "error": f"조회 실패: {str(e)}"}


@router.get("/api/system-requests/stats")
async def get_request_stats():
    """시스템 요청 통계"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 상태별 통계
            cursor.execute("""
                SELECT status, COUNT(*) as count
                FROM system_requests
                GROUP BY status
            """)
            status_stats = {row[0]: row[1] for row in cursor.fetchall()}

            # 유형별 통계
            cursor.execute("""
                SELECT request_type, COUNT(*) as count
                FROM system_requests
                GROUP BY request_type
            """)
            type_stats = {row[0]: row[1] for row in cursor.fetchall()}

            cursor.close()

            return {
                "success": True,
                "data": {
                    "by_status": status_stats,
                    "by_type": type_stats,
                    "pending_count": status_stats.get('pending', 0)
                }
            }

    except Exception as e:
        print(f"[SYSTEM REQUEST STATS ERROR] {e}")
        return {"success": False, "error": f"통계 조회 실패: {str(e)}"}


@router.get("/api/system-requests/{request_id}")
async def get_system_request(request_id: int):
    """시스템 요청 상세 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT
                    sr.id, sr.request_type, sr.title, sr.content,
                    sr.status, sr.author_id, sr.site_id,
                    sr.response, sr.responded_by, sr.responded_at,
                    sr.created_at,
                    COALESCE(u.full_name, u.username) as author_name,
                    s.site_name as site_name,
                    COALESCE(ru.full_name, ru.username) as responder_name
                FROM system_requests sr
                LEFT JOIN users u ON sr.author_id = u.id
                LEFT JOIN business_locations s ON sr.site_id = s.id
                LEFT JOIN users ru ON sr.responded_by = ru.id
                WHERE sr.id = %s
            """, (request_id,))

            row = cursor.fetchone()
            if not row:
                cursor.close()
                raise HTTPException(status_code=404, detail="요청을 찾을 수 없습니다")

            columns = [desc[0] for desc in cursor.description]
            req = _serialize_row(columns, row)

            # 첨부파일 조회
            cursor.execute("""
                SELECT id, file_name, file_path, file_size, mime_type
                FROM attachments
                WHERE ref_type = 'system_request' AND ref_id = %s
            """, (request_id,))
            att_columns = [desc[0] for desc in cursor.description]
            req['attachments'] = [dict(zip(att_columns, r)) for r in cursor.fetchall()]

            cursor.close()

            return {
                "success": True,
                "data": req
            }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[SYSTEM REQUEST ERROR] {e}")
        return {"success": False, "error": f"조회 실패: {str(e)}"}


@router.post("/api/system-requests")
async def create_system_request(request: Request):
    """시스템 요청 등록"""
    try:
        data = await request.json()

        request_type = data.get('request_type')  # 'bug', 'feature', 'question'
        title = data.get('title')
        content = data.get('content', '')
        author_id = data.get('author_id')
        site_id = data.get('site_id')
        attachments = data.get('attachments', [])

        if not request_type or not title:
            return {"success": False, "error": "요청 유형과 제목은 필수입니다"}

        if request_type not in ['bug', 'feature', 'question']:
            return {"success": False, "error": "요청 유형은 'bug', 'feature', 'question' 중 하나여야 합니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                INSERT INTO system_requests (request_type, title, content, author_id, site_id)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
            """, (request_type, title, content, author_id, site_id))

            request_id = cursor.fetchone()[0]

            # 첨부파일 등록
            for att in attachments:
                cursor.execute("""
                    INSERT INTO attachments (ref_type, ref_id, file_name, file_path, file_size, mime_type)
                    VALUES ('system_request', %s, %s, %s, %s, %s)
                """, (request_id, att.get('filename', ''), att.get('url', ''), att.get('size'), att.get('mime_type')))

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "data": {"id": request_id},
                "message": "요청이 등록되었습니다"
            }

    except Exception as e:
        print(f"[SYSTEM REQUEST CREATE ERROR] {e}")
        return {"success": False, "error": f"요청 등록 실패: {str(e)}"}


@router.put("/api/system-requests/{request_id}")
async def update_system_request(request_id: int, request: Request):
    """시스템 요청 수정 (상태 변경, 답변 등)"""
    try:
        data = await request.json()

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 요청 존재 확인
            cursor.execute("SELECT id FROM system_requests WHERE id = %s", (request_id,))
            if not cursor.fetchone():
                cursor.close()
                raise HTTPException(status_code=404, detail="요청을 찾을 수 없습니다")

            update_fields = []
            update_values = []

            if 'title' in data:
                update_fields.append("title = %s")
                update_values.append(data['title'])
            if 'content' in data:
                update_fields.append("content = %s")
                update_values.append(data['content'])
            if 'status' in data:
                update_fields.append("status = %s")
                update_values.append(data['status'])
            if 'response' in data:
                update_fields.append("response = %s")
                update_values.append(data['response'])
                # 답변 작성자와 시간
                if data.get('responded_by'):
                    update_fields.append("responded_by = %s")
                    update_values.append(data['responded_by'])
                update_fields.append("responded_at = NOW()")

            if update_fields:
                query = f"UPDATE system_requests SET {', '.join(update_fields)} WHERE id = %s"
                update_values.append(request_id)
                cursor.execute(query, update_values)

            # 첨부파일 업데이트
            if 'attachments' in data:
                cursor.execute("DELETE FROM attachments WHERE ref_type = 'system_request' AND ref_id = %s", (request_id,))
                for att in data['attachments']:
                    cursor.execute("""
                        INSERT INTO attachments (ref_type, ref_id, file_name, file_path, file_size, mime_type)
                        VALUES ('system_request', %s, %s, %s, %s, %s)
                    """, (request_id, att.get('filename', ''), att.get('url', ''), att.get('size'), att.get('mime_type')))

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": "요청이 수정되었습니다"
            }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[SYSTEM REQUEST UPDATE ERROR] {e}")
        return {"success": False, "error": f"요청 수정 실패: {str(e)}"}


@router.delete("/api/system-requests/{request_id}")
async def delete_system_request(request_id: int):
    """시스템 요청 삭제"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 첨부파일 먼저 삭제
            cursor.execute("DELETE FROM attachments WHERE ref_type = 'system_request' AND ref_id = %s", (request_id,))

            # 요청 삭제
            cursor.execute("DELETE FROM system_requests WHERE id = %s", (request_id,))

            if cursor.rowcount == 0:
                cursor.close()
                raise HTTPException(status_code=404, detail="요청을 찾을 수 없습니다")

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": "요청이 삭제되었습니다"
            }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[SYSTEM REQUEST DELETE ERROR] {e}")
        return {"success": False, "error": f"요청 삭제 실패: {str(e)}"}
