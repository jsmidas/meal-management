#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Notices Router
공지사항 API 엔드포인트 (업무연락 + 위생안전)
"""

from fastapi import APIRouter, Request, HTTPException
from core.database import get_db_connection
from typing import Optional
from datetime import datetime

router = APIRouter()


@router.get("/api/notices")
async def get_notices(
    notice_type: Optional[str] = None,  # 'business' or 'hygiene'
    limit: int = 20,
    offset: int = 0,
    user_id: Optional[int] = None,
    site_id: Optional[int] = None,
    group_id: Optional[int] = None
):
    """공지사항 목록 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 기본 쿼리
            query = """
                SELECT
                    n.id, n.notice_type, n.title, n.content,
                    n.target_type, n.target_id, n.is_urgent,
                    n.author_id, n.created_at, n.updated_at, n.is_active,
                    u.username as author_name,
                    CASE WHEN nr.id IS NOT NULL THEN TRUE ELSE FALSE END as is_read
                FROM notices n
                LEFT JOIN users u ON n.author_id = u.id
                LEFT JOIN notice_reads nr ON n.id = nr.notice_id AND nr.user_id = %s
                WHERE n.is_active = TRUE
            """
            params = [user_id or 0]

            # 공지 타입 필터
            if notice_type:
                query += " AND n.notice_type = %s"
                params.append(notice_type)

            # 대상 필터 (전체 공지 또는 해당 사업장/그룹 대상)
            if site_id:
                query += " AND (n.target_type = 'all' OR (n.target_type = 'site' AND n.target_id = %s))"
                params.append(site_id)
            elif group_id:
                query += " AND (n.target_type = 'all' OR (n.target_type = 'group' AND n.target_id = %s))"
                params.append(group_id)

            query += " ORDER BY n.is_urgent DESC, n.created_at DESC LIMIT %s OFFSET %s"
            params.extend([limit, offset])

            cursor.execute(query, params)
            columns = [desc[0] for desc in cursor.description]
            notices = [dict(zip(columns, row)) for row in cursor.fetchall()]

            # 첨부파일 조회
            for notice in notices:
                cursor.execute("""
                    SELECT id, file_name, file_path, file_size, mime_type
                    FROM attachments
                    WHERE ref_type = 'notice' AND ref_id = %s
                """, (notice['id'],))
                att_columns = [desc[0] for desc in cursor.description]
                notice['attachments'] = [dict(zip(att_columns, row)) for row in cursor.fetchall()]

            # 전체 개수 조회
            count_query = "SELECT COUNT(*) FROM notices WHERE is_active = TRUE"
            count_params = []
            if notice_type:
                count_query += " AND notice_type = %s"
                count_params.append(notice_type)

            cursor.execute(count_query, count_params if count_params else None)
            total_count = cursor.fetchone()[0]

            cursor.close()

            return {
                "success": True,
                "data": {
                    "notices": notices,
                    "total": total_count,
                    "limit": limit,
                    "offset": offset
                }
            }

    except Exception as e:
        print(f"[NOTICES ERROR] {e}")
        return {"success": False, "error": f"공지사항 조회 실패: {str(e)}"}


@router.get("/api/notices/{notice_id}")
async def get_notice(notice_id: int, user_id: Optional[int] = None):
    """공지사항 상세 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT
                    n.id, n.notice_type, n.title, n.content,
                    n.target_type, n.target_id, n.is_urgent,
                    n.author_id, n.created_at, n.updated_at, n.is_active,
                    u.username as author_name
                FROM notices n
                LEFT JOIN users u ON n.author_id = u.id
                WHERE n.id = %s AND n.is_active = TRUE
            """, (notice_id,))

            row = cursor.fetchone()
            if not row:
                cursor.close()
                raise HTTPException(status_code=404, detail="공지사항을 찾을 수 없습니다")

            columns = [desc[0] for desc in cursor.description]
            notice = dict(zip(columns, row))

            # 첨부파일 조회
            cursor.execute("""
                SELECT id, file_name, file_path, file_size, mime_type
                FROM attachments
                WHERE ref_type = 'notice' AND ref_id = %s
            """, (notice_id,))
            att_columns = [desc[0] for desc in cursor.description]
            notice['attachments'] = [dict(zip(att_columns, row)) for row in cursor.fetchall()]

            # 읽음 처리
            if user_id:
                cursor.execute("""
                    INSERT INTO notice_reads (notice_id, user_id)
                    VALUES (%s, %s)
                    ON CONFLICT (notice_id, user_id) DO NOTHING
                """, (notice_id, user_id))
                conn.commit()

            cursor.close()

            return {
                "success": True,
                "data": notice
            }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[NOTICE ERROR] {e}")
        return {"success": False, "error": f"공지사항 조회 실패: {str(e)}"}


@router.post("/api/notices")
async def create_notice(request: Request):
    """공지사항 등록 (본사만 가능)"""
    try:
        data = await request.json()

        notice_type = data.get('notice_type')  # 'business' or 'hygiene'
        title = data.get('title')
        content = data.get('content', '')
        target_type = data.get('target_type', 'all')  # 'all', 'group', 'site'
        target_id = data.get('target_id')  # group_id or site_id
        is_urgent = data.get('is_urgent', False)
        author_id = data.get('author_id')
        attachments = data.get('attachments', [])  # [{"url": "...", "filename": "...", ...}]

        if not notice_type or not title:
            return {"success": False, "error": "공지 유형과 제목은 필수입니다"}

        if notice_type not in ['business', 'hygiene']:
            return {"success": False, "error": "공지 유형은 'business' 또는 'hygiene'이어야 합니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 공지사항 등록
            cursor.execute("""
                INSERT INTO notices (notice_type, title, content, target_type, target_id, is_urgent, author_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (notice_type, title, content, target_type, target_id, is_urgent, author_id))

            notice_id = cursor.fetchone()[0]

            # 첨부파일 등록
            for att in attachments:
                cursor.execute("""
                    INSERT INTO attachments (ref_type, ref_id, file_name, file_path, file_size, mime_type)
                    VALUES ('notice', %s, %s, %s, %s, %s)
                """, (notice_id, att.get('filename', ''), att.get('url', ''), att.get('size'), att.get('mime_type')))

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "data": {"id": notice_id},
                "message": "공지사항이 등록되었습니다"
            }

    except Exception as e:
        print(f"[NOTICE CREATE ERROR] {e}")
        return {"success": False, "error": f"공지사항 등록 실패: {str(e)}"}


@router.put("/api/notices/{notice_id}")
async def update_notice(notice_id: int, request: Request):
    """공지사항 수정"""
    try:
        data = await request.json()

        title = data.get('title')
        content = data.get('content')
        target_type = data.get('target_type')
        target_id = data.get('target_id')
        is_urgent = data.get('is_urgent')
        attachments = data.get('attachments', [])

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 공지사항 존재 확인
            cursor.execute("SELECT id FROM notices WHERE id = %s AND is_active = TRUE", (notice_id,))
            if not cursor.fetchone():
                cursor.close()
                raise HTTPException(status_code=404, detail="공지사항을 찾을 수 없습니다")

            # 업데이트할 필드 구성
            update_fields = []
            update_values = []

            if title:
                update_fields.append("title = %s")
                update_values.append(title)
            if content is not None:
                update_fields.append("content = %s")
                update_values.append(content)
            if target_type:
                update_fields.append("target_type = %s")
                update_values.append(target_type)
            if target_id is not None:
                update_fields.append("target_id = %s")
                update_values.append(target_id)
            if is_urgent is not None:
                update_fields.append("is_urgent = %s")
                update_values.append(is_urgent)

            update_fields.append("updated_at = NOW()")

            if update_fields:
                query = f"UPDATE notices SET {', '.join(update_fields)} WHERE id = %s"
                update_values.append(notice_id)
                cursor.execute(query, update_values)

            # 첨부파일 업데이트 (기존 삭제 후 재등록)
            if 'attachments' in data:
                cursor.execute("DELETE FROM attachments WHERE ref_type = 'notice' AND ref_id = %s", (notice_id,))
                for att in attachments:
                    cursor.execute("""
                        INSERT INTO attachments (ref_type, ref_id, file_name, file_path, file_size, mime_type)
                        VALUES ('notice', %s, %s, %s, %s, %s)
                    """, (notice_id, att.get('filename', ''), att.get('url', ''), att.get('size'), att.get('mime_type')))

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": "공지사항이 수정되었습니다"
            }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[NOTICE UPDATE ERROR] {e}")
        return {"success": False, "error": f"공지사항 수정 실패: {str(e)}"}


@router.delete("/api/notices/{notice_id}")
async def delete_notice(notice_id: int):
    """공지사항 삭제 (소프트 삭제)"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                UPDATE notices SET is_active = FALSE, updated_at = NOW()
                WHERE id = %s
            """, (notice_id,))

            if cursor.rowcount == 0:
                cursor.close()
                raise HTTPException(status_code=404, detail="공지사항을 찾을 수 없습니다")

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": "공지사항이 삭제되었습니다"
            }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[NOTICE DELETE ERROR] {e}")
        return {"success": False, "error": f"공지사항 삭제 실패: {str(e)}"}


@router.get("/api/notices/unread-count")
async def get_unread_count(user_id: int, notice_type: Optional[str] = None):
    """읽지 않은 공지 수 조회"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            query = """
                SELECT COUNT(*)
                FROM notices n
                LEFT JOIN notice_reads nr ON n.id = nr.notice_id AND nr.user_id = %s
                WHERE n.is_active = TRUE AND nr.id IS NULL
            """
            params = [user_id]

            if notice_type:
                query += " AND n.notice_type = %s"
                params.append(notice_type)

            cursor.execute(query, params)
            count = cursor.fetchone()[0]

            cursor.close()

            return {
                "success": True,
                "data": {"unread_count": count}
            }

    except Exception as e:
        print(f"[NOTICE UNREAD COUNT ERROR] {e}")
        return {"success": False, "error": f"조회 실패: {str(e)}"}


@router.post("/api/notices/{notice_id}/read")
async def mark_as_read(notice_id: int, request: Request):
    """공지사항 읽음 처리"""
    try:
        data = await request.json()
        user_id = data.get('user_id')

        if not user_id:
            return {"success": False, "error": "user_id가 필요합니다"}

        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                INSERT INTO notice_reads (notice_id, user_id)
                VALUES (%s, %s)
                ON CONFLICT (notice_id, user_id) DO NOTHING
            """, (notice_id, user_id))

            conn.commit()
            cursor.close()

            return {
                "success": True,
                "message": "읽음 처리되었습니다"
            }

    except Exception as e:
        print(f"[NOTICE READ ERROR] {e}")
        return {"success": False, "error": f"읽음 처리 실패: {str(e)}"}
