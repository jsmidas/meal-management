#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Uploads Router
파일 업로드 API 엔드포인트 (Cloudinary 지원)
"""

import os
import uuid
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, HTTPException
from pathlib import Path

# Cloudinary 유틸리티 (환경변수 미설정 시 로컬 저장)
from utils.cloudinary_utils import (
    CLOUDINARY_ENABLED,
    upload_image_to_cloudinary,
    delete_image_from_cloudinary
)

router = APIRouter()

# 로컬 업로드 설정 (Cloudinary 미설정 시 폴백)
UPLOAD_DIR = Path("static/uploads")
ALLOWED_EXTENSIONS = {'jpg', 'jpeg', 'png', 'gif', 'webp'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


def allowed_file(filename: str) -> bool:
    """허용된 파일 확장자인지 확인"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def generate_unique_filename(original_filename: str) -> str:
    """고유한 파일명 생성"""
    ext = original_filename.rsplit('.', 1)[1].lower()
    unique_id = uuid.uuid4().hex[:8]
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    return f"{timestamp}_{unique_id}.{ext}"


def save_to_local(content: bytes, original_filename: str) -> str:
    """로컬 파일 시스템에 저장"""
    year_month = datetime.now().strftime('%Y%m')
    upload_path = UPLOAD_DIR / year_month
    upload_path.mkdir(parents=True, exist_ok=True)

    unique_filename = generate_unique_filename(original_filename)
    file_path = upload_path / unique_filename

    with open(file_path, 'wb') as f:
        f.write(content)

    return f"/static/uploads/{year_month}/{unique_filename}"


@router.post("/api/upload/image")
async def upload_image(file: UploadFile = File(...)):
    """이미지 파일 업로드 (Cloudinary 우선, 없으면 로컬)"""
    try:
        # 파일 확장자 검사
        if not file.filename:
            raise HTTPException(status_code=400, detail="파일명이 없습니다")

        if not allowed_file(file.filename):
            raise HTTPException(status_code=400, detail=f"허용되지 않는 파일 형식입니다. 허용: {', '.join(ALLOWED_EXTENSIONS)}")

        # 파일 크기 검사
        content = await file.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail=f"파일 크기가 너무 큽니다. 최대: {MAX_FILE_SIZE // (1024*1024)}MB")

        # Cloudinary 또는 로컬 저장
        if CLOUDINARY_ENABLED:
            result = upload_image_to_cloudinary(content, file.filename)
            if result["success"]:
                return {
                    "success": True,
                    "data": {
                        "url": result["url"],
                        "public_id": result.get("public_id"),
                        "filename": file.filename,
                        "original_filename": file.filename,
                        "size": len(content),
                        "mime_type": file.content_type,
                        "storage": "cloudinary"
                    },
                    "message": "파일 업로드 성공 (Cloudinary)"
                }
            else:
                # Cloudinary 실패 시 로컬 폴백
                print(f"[UPLOAD] Cloudinary 실패, 로컬 저장: {result.get('error')}")

        # 로컬 저장
        relative_url = save_to_local(content, file.filename)

        return {
            "success": True,
            "data": {
                "url": relative_url,
                "filename": generate_unique_filename(file.filename),
                "original_filename": file.filename,
                "size": len(content),
                "mime_type": file.content_type,
                "storage": "local"
            },
            "message": "파일 업로드 성공"
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[UPLOAD ERROR] {e}")
        raise HTTPException(status_code=500, detail=f"파일 업로드 실패: {str(e)}")


@router.post("/api/upload/images")
async def upload_multiple_images(files: list[UploadFile] = File(...)):
    """여러 이미지 파일 업로드"""
    try:
        if not files:
            raise HTTPException(status_code=400, detail="업로드할 파일이 없습니다")

        if len(files) > 10:
            raise HTTPException(status_code=400, detail="최대 10개의 파일만 업로드 가능합니다")

        uploaded_files = []

        for file in files:
            if not file.filename or not allowed_file(file.filename):
                continue

            content = await file.read()
            if len(content) > MAX_FILE_SIZE:
                continue

            # Cloudinary 또는 로컬 저장
            if CLOUDINARY_ENABLED:
                result = upload_image_to_cloudinary(content, file.filename)
                if result["success"]:
                    uploaded_files.append({
                        "url": result["url"],
                        "public_id": result.get("public_id"),
                        "filename": file.filename,
                        "original_filename": file.filename,
                        "size": len(content),
                        "mime_type": file.content_type,
                        "storage": "cloudinary"
                    })
                    continue

            # 로컬 저장
            relative_url = save_to_local(content, file.filename)
            uploaded_files.append({
                "url": relative_url,
                "filename": generate_unique_filename(file.filename),
                "original_filename": file.filename,
                "size": len(content),
                "mime_type": file.content_type,
                "storage": "local"
            })

        if not uploaded_files:
            raise HTTPException(status_code=400, detail="업로드된 파일이 없습니다 (허용되지 않는 파일 형식)")

        return {
            "success": True,
            "data": {
                "files": uploaded_files,
                "count": len(uploaded_files)
            },
            "message": f"{len(uploaded_files)}개 파일 업로드 성공"
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[UPLOAD ERROR] {e}")
        raise HTTPException(status_code=500, detail=f"파일 업로드 실패: {str(e)}")


@router.delete("/api/upload/image")
async def delete_image(url: str):
    """업로드된 이미지 삭제"""
    try:
        # Cloudinary URL인 경우
        if "cloudinary.com" in url:
            # URL에서 public_id 추출
            # 예: https://res.cloudinary.com/xxx/image/upload/v123/daham-meals/202601/file.jpg
            # public_id: daham-meals/202601/file
            try:
                parts = url.split("/upload/")
                if len(parts) > 1:
                    path_with_version = parts[1]
                    # v숫자/ 제거
                    if path_with_version.startswith("v"):
                        path_with_version = "/".join(path_with_version.split("/")[1:])
                    # 확장자 제거
                    public_id = path_with_version.rsplit(".", 1)[0]

                    result = delete_image_from_cloudinary(public_id)
                    if result["success"]:
                        return {"success": True, "message": "파일 삭제 성공 (Cloudinary)"}
            except Exception as e:
                print(f"[CLOUDINARY DELETE] public_id 추출 실패: {e}")

        # 로컬 파일인 경우
        if url.startswith("/static/uploads/"):
            file_path = Path(url.lstrip('/')).resolve()
            allowed_dir = Path("static/uploads").resolve()

            if not str(file_path).startswith(str(allowed_dir)):
                raise HTTPException(status_code=400, detail="허용되지 않은 파일 경로입니다")

            if not file_path.exists():
                raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다")

            file_path.unlink()
            return {"success": True, "message": "파일 삭제 성공"}

        raise HTTPException(status_code=400, detail="유효하지 않은 파일 경로입니다")

    except HTTPException:
        raise
    except Exception as e:
        print(f"[UPLOAD DELETE ERROR] {e}")
        raise HTTPException(status_code=500, detail=f"파일 삭제 실패: {str(e)}")
