"""API for the Central Revenue portal. Deploy as an HTTP Cloud Function."""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import date, datetime, timezone
from urllib.parse import quote, urlparse

import functions_framework
from flask import jsonify, make_response, request
from google.auth.transport import requests as google_requests
from google.cloud import firestore, storage
from google.oauth2 import id_token


MAX_UPLOAD_BYTES = 12 * 1024 * 1024
ALLOWED_TYPES = {
    "application/pdf", "text/plain", "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "image/jpeg", "image/png", "image/webp",
}
CONTENT_TYPES = {"link", "document", "notice", "quote"}
CONTENT = "central_revenue_content"
UPLOADS = "central_revenue_uploads"

_db = None
_storage = None


def _csv_env(name: str) -> set[str]:
    return {part.strip().casefold() for part in os.environ.get(name, "").split(",") if part.strip()}


def _origin() -> str:
    return request.headers.get("Origin", "")


def _allowed_origins() -> set[str]:
    defaults = {"https://gabriel-loiola-jca.github.io", "http://localhost:3000", "http://localhost:47821"}
    configured = os.environ.get("ALLOWED_ORIGINS", "")
    return {value.strip().rstrip("/") for value in configured.split(",") if value.strip()} or defaults


def _cors(response):
    origin = _origin().rstrip("/")
    if origin in _allowed_origins():
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
        response.headers["Access-Control-Max-Age"] = "3600"
    response.headers["Cache-Control"] = "no-store"
    return response


def _json(payload, status=200):
    return _cors(make_response(jsonify(payload), status))


def _database():
    global _db
    if _db is None:
        _db = firestore.Client()
    return _db


def _bucket():
    global _storage
    if _storage is None:
        name = os.environ.get("UPLOAD_BUCKET", "").strip()
        if not name:
            raise RuntimeError("UPLOAD_BUCKET is not configured")
        _storage = storage.Client().bucket(name)
    return _storage


def _authenticate():
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None, (_json({"error": "Faça login com sua conta Google."}, 401))
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
    if not client_id:
        return None, (_json({"error": "O login Google ainda não está configurado."}, 503))
    try:
        claims = id_token.verify_oauth2_token(header[7:].strip(), google_requests.Request(), client_id)
    except Exception:
        return None, (_json({"error": "Sua sessão Google expirou. Entre novamente."}, 401))
    email = str(claims.get("email", "")).strip().casefold()
    if not email or claims.get("email_verified") is not True:
        return None, (_json({"error": "O Google não confirmou este endereço de e-mail."}, 401))
    allowed = _csv_env("ALLOWED_EMAILS")
    admins = _csv_env("ADMIN_EMAILS")
    if not allowed or not admins or not admins.issubset(allowed):
        return None, (_json({"error": "A lista de acesso da Central Revenue não está configurada."}, 503))
    if email not in allowed:
        return None, (_json({"error": "Esta conta não está autorizada a acessar a Central Revenue."}, 403))
    profile = {
        "email": email,
        "name": str(claims.get("name", "")).strip()[:120] or email,
        "picture": str(claims.get("picture", ""))[:2048],
        "role": "admin" if email in admins else "member",
    }
    return profile, None


def _is_admin(user):
    return user["role"] == "admin"


def _content_dict(snapshot):
    item = snapshot.to_dict() or {}
    item["id"] = snapshot.id
    return item


def _clean_payload(raw, existing=None):
    if not isinstance(raw, dict):
        raise ValueError("Conteúdo inválido.")
    data = {}
    for key in ("type", "title", "body", "category", "url", "fileId", "fileName", "expiresAt"):
        if key in raw:
            data[key] = str(raw[key] or "").strip()
    if "featured" in raw:
        data["featured"] = raw["featured"] is True
    if existing:
        data = {**existing, **data}
    kind = data.get("type", "")
    if kind not in CONTENT_TYPES:
        raise ValueError("Escolha um tipo de conteúdo válido.")
    title = data.get("title", "")
    if not title or len(title) > 160:
        raise ValueError("O título deve ter entre 1 e 160 caracteres.")
    data["title"] = title
    data["body"] = data.get("body", "")[:1200]
    data["category"] = data.get("category", "Geral")[:80] or "Geral"
    data["featured"] = data.get("featured") is True
    if kind == "link":
        parsed = urlparse(data.get("url", ""))
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("Links precisam usar um endereço HTTPS válido.")
    else:
        data["url"] = ""
    if kind == "notice":
        try:
            date.fromisoformat(data.get("expiresAt", ""))
        except ValueError:
            raise ValueError("Informe uma data de validade para o aviso.") from None
    else:
        data["expiresAt"] = ""
    if kind == "document" and not data.get("fileId"):
        raise ValueError("Envie um arquivo para publicar o material.")
    if kind != "document":
        data["fileId"] = ""
        data["fileName"] = ""
    return data


def _safe_filename(value: str) -> str:
    name = re.sub(r"[^\w.() -]", "_", value, flags=re.UNICODE).strip(" .")[:180]
    return name or "arquivo"


def _require_admin(user):
    if not _is_admin(user):
        return _json({"error": "Somente administradores podem publicar ou alterar conteúdo."}, 403)
    return None


@functions_framework.http
def main(request):
    if request.method == "OPTIONS":
        return _cors(make_response("", 204))
    if _origin().rstrip("/") not in _allowed_origins():
        return _json({"error": "Origem não autorizada."}, 403)
    user, error = _authenticate()
    if error:
        return error

    path = request.path.rstrip("/")
    try:
        if path == "/api/v1/session" and request.method == "GET":
            return _json({"user": user})

        if path == "/api/v1/content" and request.method == "GET":
            docs = _database().collection(CONTENT).order_by("updatedAt", direction=firestore.Query.DESCENDING).stream()
            today = date.today().isoformat()
            items = [_content_dict(doc) for doc in docs]
            items = [item for item in items if item.get("active") is not False and (not item.get("expiresAt") or item["expiresAt"] >= today)]
            return _json({"items": items})

        if path == "/api/v1/content" and request.method == "POST":
            denied = _require_admin(user)
            if denied:
                return denied
            data = _clean_payload(request.get_json(silent=True))
            now = datetime.now(timezone.utc).isoformat()
            data.update({"createdAt": now, "updatedAt": now, "createdBy": user["email"], "active": True})
            ref = _database().collection(CONTENT).document()
            ref.set(data)
            return _json({"id": ref.id}, 201)

        if path == "/api/v1/uploads" and request.method == "POST":
            denied = _require_admin(user)
            if denied:
                return denied
            upload = request.files.get("file")
            if not upload or not upload.filename:
                return _json({"error": "Selecione um arquivo."}, 400)
            mime = (upload.mimetype or "application/octet-stream").lower()
            content = upload.stream.read(MAX_UPLOAD_BYTES + 1)
            if len(content) > MAX_UPLOAD_BYTES:
                return _json({"error": "O limite por arquivo é 12 MB."}, 413)
            if mime not in ALLOWED_TYPES:
                return _json({"error": "Formato não permitido. Use PDF, Office, texto, CSV ou imagem."}, 415)
            file_id = uuid.uuid4().hex
            name = _safe_filename(upload.filename)
            object_name = f"portal/{file_id}/{name}"
            blob = _bucket().blob(object_name)
            blob.upload_from_string(content, content_type=mime)
            _database().collection(UPLOADS).document(file_id).set({
                "object": object_name, "name": name, "contentType": mime,
                "size": len(content), "createdAt": datetime.now(timezone.utc).isoformat(),
                "createdBy": user["email"],
            })
            return _json({"fileId": file_id, "fileName": name}, 201)

        if path.startswith("/api/v1/content/"):
            item_id = path.rsplit("/", 1)[-1]
            ref = _database().collection(CONTENT).document(item_id)
            snap = ref.get()
            if request.method == "PATCH":
                denied = _require_admin(user)
                if denied:
                    return denied
                if not snap.exists:
                    return _json({"error": "Conteúdo não encontrado."}, 404)
                current = snap.to_dict() or {}
                data = _clean_payload(request.get_json(silent=True), current)
                data["updatedAt"] = datetime.now(timezone.utc).isoformat()
                data["updatedBy"] = user["email"]
                ref.set(data)
                return _json({"id": item_id})
            if request.method == "DELETE":
                denied = _require_admin(user)
                if denied:
                    return denied
                if not snap.exists:
                    return _json({"error": "Conteúdo não encontrado."}, 404)
                ref.delete()
                return _json({}, 204)

        if path.startswith("/api/v1/files/") and request.method == "GET":
            file_id = path.rsplit("/", 1)[-1]
            if not re.fullmatch(r"[a-f0-9]{32}", file_id):
                return _json({"error": "Arquivo não encontrado."}, 404)
            metadata = _database().collection(UPLOADS).document(file_id).get()
            if not metadata.exists:
                return _json({"error": "Arquivo não encontrado."}, 404)
            record = metadata.to_dict() or {}
            # Only files referenced by published content can be downloaded.
            linked = _database().collection(CONTENT).where("fileId", "==", file_id).limit(1).get()
            if not linked:
                return _json({"error": "Arquivo não encontrado."}, 404)
            blob = _bucket().blob(record["object"])
            data = blob.download_as_bytes()
            response = make_response(data)
            response.headers["Content-Type"] = record.get("contentType", "application/octet-stream")
            response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(record.get('name', 'arquivo'), safe='')}"
            response.headers["X-Content-Type-Options"] = "nosniff"
            return _cors(response)

        return _json({"error": "Rota não encontrada."}, 404)
    except ValueError as exc:
        return _json({"error": str(exc)}, 400)
    except Exception:
        # Details remain in Cloud Logging; never expose service internals to users.
        print(json.dumps({"event": "central_revenue_api_error", "path": path}, ensure_ascii=False))
        return _json({"error": "A central encontrou um erro. Tente novamente em instantes."}, 500)
