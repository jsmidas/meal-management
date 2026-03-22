#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Cloudinary 이미지 업로드 유틸리티
"""

import os
import cloudinary
import cloudinary.uploader
from datetime import datetime

# Cloudinary 설정 초기화
def init_cloudinary():
    """환경변수에서 Cloudinary 설정 로드"""
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME")
    api_key = os.getenv("CLOUDINARY_API_KEY")
    api_secret = os.getenv("CLOUDINARY_API_SECRET")

    if not all([cloud_name, api_key, api_secret]):
        print("[CLOUDINARY] 환경변수 미설정 - 로컬 저장 모드로 동작")
        return False

    cloudinary.config(
        cloud_name=cloud_name,
        api_key=api_key,
        api_secret=api_secret,
        secure=True
    )
    print(f"[CLOUDINARY] 초기화 완료 (cloud: {cloud_name})")
    return True


# Cloudinary 활성화 여부
CLOUDINARY_ENABLED = init_cloudinary()


def upload_image_to_cloudinary(file_content: bytes, original_filename: str, folder: str = "daham-meals") -> dict:
    """
    이미지를 Cloudinary에 업로드

    Args:
        file_content: 파일 바이너리 내용
        original_filename: 원본 파일명
        folder: Cloudinary 폴더명

    Returns:
        dict: {success, url, public_id, error}
    """
    if not CLOUDINARY_ENABLED:
        return {"success": False, "error": "Cloudinary가 설정되지 않았습니다"}

    try:
        # 월별 폴더 구성
        year_month = datetime.now().strftime('%Y%m')
        full_folder = f"{folder}/{year_month}"

        # 업로드
        result = cloudinary.uploader.upload(
            file_content,
            folder=full_folder,
            resource_type="image",
            use_filename=True,
            unique_filename=True,
            overwrite=False,
            transformation=[
                {"quality": "auto:good"},
                {"fetch_format": "auto"}
            ]
        )

        return {
            "success": True,
            "url": result.get("secure_url"),
            "public_id": result.get("public_id"),
            "width": result.get("width"),
            "height": result.get("height"),
            "format": result.get("format"),
            "bytes": result.get("bytes")
        }

    except Exception as e:
        print(f"[CLOUDINARY ERROR] {e}")
        return {"success": False, "error": str(e)}


def delete_image_from_cloudinary(public_id: str) -> dict:
    """
    Cloudinary에서 이미지 삭제

    Args:
        public_id: Cloudinary public_id

    Returns:
        dict: {success, error}
    """
    if not CLOUDINARY_ENABLED:
        return {"success": False, "error": "Cloudinary가 설정되지 않았습니다"}

    try:
        result = cloudinary.uploader.destroy(public_id)
        return {"success": result.get("result") == "ok"}
    except Exception as e:
        print(f"[CLOUDINARY DELETE ERROR] {e}")
        return {"success": False, "error": str(e)}


def get_thumbnail_url(url: str, width: int = 100, height: int = 100) -> str:
    """
    Cloudinary URL에서 썸네일 URL 생성

    Args:
        url: 원본 Cloudinary URL
        width: 썸네일 너비
        height: 썸네일 높이

    Returns:
        str: 썸네일 URL
    """
    if not url or "cloudinary.com" not in url:
        return url

    # /upload/ 뒤에 변환 파라미터 추가
    if "/upload/" in url:
        return url.replace("/upload/", f"/upload/c_fill,w_{width},h_{height}/")

    return url
